/**
 * SAGE Chrome Extension: background service worker (Manifest V3)
 *
 * Transport: the SAGE web app connects to this worker with chrome.runtime.connect (allowed by
 * `externally_connectable`). The app performs a handshake (hello → hello_ack with id, version,
 * capabilities and permissions), sends heartbeats, and relays RPC calls between the SAGE server
 * and this worker. If the worker is suspended or restarted the port drops, and the app reconnects,
 * which wakes the worker again.
 *
 * RPC methods: get_active_tab · observe · open_url · navigate · activate_tab · page_action ·
 * site_search · media · capture
 */

const PROTOCOL = 3;
const VERSION = chrome.runtime.getManifest().version;
const CAPABILITIES = ['observe', 'actions', 'media', 'site_search', 'capture', 'fullscreen_window', 'fullscreen_debugger', 'events'];
const WEB_ORIGINS = ['http://*/*', 'https://*/*'];
const CONTENT_SCRIPT_ID = 'sage-content';

/** Open connections from SAGE app tabs: port -> { tabId, origin } */
const appPorts = new Map();
let lastWorkTabId = null; // most recent non-SAGE tab the user or SAGE worked in
const prevWindowState = {}; // windowId -> state before SAGE made it fullscreen

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -----------------------------------------------------------------------------
// Connection with the SAGE app (externally_connectable)
// -----------------------------------------------------------------------------

chrome.runtime.onConnectExternal.addListener((port) => {
  if (port.name !== 'sage-app') {
    port.disconnect();
    return;
  }
  const sender = port.sender || {};
  let origin = sender.origin || '';
  if (!origin && sender.url) {
    try {
      origin = new URL(sender.url).origin;
    } catch {}
  }
  appPorts.set(port, { tabId: sender.tab ? sender.tab.id : null, origin });
  // The SAGE tab may have been recorded as the work tab before it identified itself.
  if (sender.tab && lastWorkTabId === sender.tab.id) setWorkTab(null);
  port.onMessage.addListener((msg) => onAppMessage(port, msg));
  port.onDisconnect.addListener(() => {
    appPorts.delete(port);
    updateBadge();
  });
  updateBadge();
});

async function onAppMessage(port, msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case 'hello':
      post(port, { type: 'hello_ack', nonce: msg.nonce, info: await extensionInfo() });
      pushTabs();
      break;
    case 'ping':
      post(port, { type: 'pong', t: msg.t });
      break;
    case 'rpc':
      handleRpc(port, msg);
      break;
    case 'request_permission':
      await openPermissionWindow(msg.want);
      post(port, { type: 'permission_window_opened', want: msg.want });
      break;
    case 'get_info':
      post(port, { type: 'info', info: await extensionInfo() });
      break;
  }
}

function post(port, message) {
  try {
    port.postMessage(message);
  } catch {}
}

function emit(event, data) {
  for (const port of appPorts.keys()) post(port, { type: 'event', event, data });
}

async function extensionInfo() {
  return { id: chrome.runtime.id, version: VERSION, protocol: PROTOCOL, capabilities: CAPABILITIES, permissions: await permissionStatus() };
}

function updateBadge() {
  const linked = appPorts.size > 0;
  chrome.action.setBadgeText({ text: linked ? '' : 'off' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: '#be123c' }).catch(() => {});
}

// Messages from the extension's own pages (popup, permission window) and content scripts.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'SAGE_EVENT' && sender.tab) {
    emit(msg.event, { ...(msg.data || {}), tabId: sender.tab.id, frameId: sender.frameId });
    return false;
  }
  if (msg && msg.type === 'SAGE_STATUS') {
    permissionStatus().then((permissions) =>
      sendResponse({ appConnections: appPorts.size, permissions, version: VERSION, id: chrome.runtime.id, lastWorkTabId })
    );
    return true;
  }
  return false;
});

// -----------------------------------------------------------------------------
// Permissions (all host access is optional and user-approved)
// -----------------------------------------------------------------------------

async function permissionStatus() {
  const [web, all, dbg] = await Promise.all([
    chrome.permissions.contains({ origins: WEB_ORIGINS }).catch(() => false),
    chrome.permissions.contains({ origins: ['<all_urls>'] }).catch(() => false),
    chrome.permissions.contains({ permissions: ['debugger'] }).catch(() => false),
  ]);
  return { browserAccess: Boolean(web || all), screenCapture: Boolean(all), realFullscreen: Boolean(dbg) };
}

async function openPermissionWindow(want) {
  const kind = ['browser', 'screen', 'fullscreen'].includes(want) ? want : 'browser';
  await chrome.windows.create({ url: chrome.runtime.getURL(`permissions.html?want=${kind}`), type: 'popup', width: 480, height: 560, focused: true });
}

/** Read access to pages is granted at runtime, so the content script is registered dynamically. */
async function syncContentScripts() {
  const { browserAccess } = await permissionStatus();
  let registered = [];
  try {
    registered = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  } catch {}
  try {
    if (browserAccess && registered.length === 0) {
      await chrome.scripting.registerContentScripts([
        { id: CONTENT_SCRIPT_ID, matches: WEB_ORIGINS, js: ['content.js'], allFrames: true, runAt: 'document_idle', persistAcrossSessions: true },
      ]);
    } else if (!browserAccess && registered.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    }
  } catch (err) {
    console.warn('[SAGE] content script registration failed:', err);
  }
}

async function onPermissionsChanged() {
  await syncContentScripts();
  const permissions = await permissionStatus();
  emit('permissions', { permissions });
}

chrome.permissions.onAdded.addListener(onPermissionsChanged);
chrome.permissions.onRemoved.addListener(onPermissionsChanged);
chrome.runtime.onInstalled.addListener(() => {
  syncContentScripts();
  updateBadge();
});
chrome.runtime.onStartup.addListener(() => {
  syncContentScripts();
  updateBadge();
});

chrome.storage.session
  .get('lastWorkTabId')
  .then((v) => {
    if (v && v.lastWorkTabId) lastWorkTabId = v.lastWorkTabId;
  })
  .catch(() => {});

function setWorkTab(tabId) {
  lastWorkTabId = tabId;
  chrome.storage.session.set({ lastWorkTabId: tabId }).catch(() => {});
}

// -----------------------------------------------------------------------------
// RPC
// -----------------------------------------------------------------------------

async function handleRpc(port, { id, method, params }) {
  try {
    const fn = RPC[method];
    if (!fn) throw new Error(`unknown_method:${method}`);
    const result = await fn(params || {});
    post(port, { type: 'rpc_result', id, ok: true, result });
  } catch (err) {
    post(port, { type: 'rpc_result', id, ok: false, error: (err && err.message) || String(err) });
  }
}

const RPC = {
  /** What the user has open: the focused tab (may be SAGE itself) and the tab SAGE works in. */
  async get_active_tab() {
    const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const working = await resolveTab(null);
    const describe = (t) =>
      t
        ? { id: t.id, url: t.url || '', title: t.title || '', site: siteOf(t.url), windowId: t.windowId, isSageApp: isSageTab(t), readable: isScriptable(t.url) }
        : null;
    return { focusedTab: describe(focused), workingTab: describe(working), tabs: await listTabs(), permissions: await permissionStatus() };
  },

  async observe({ tabId, waitFor }) {
    const tab = await resolveTab(tabId);
    if (!tab) throw new Error('no_working_tab: no regular browser tab is open');
    return snapshotTab(tab, waitFor);
  },

  async open_url({ url, tabId, newTab }) {
    let tab = null;
    if (!newTab && tabId) {
      tab = await chrome.tabs.get(tabId).catch(() => null);
      if (tab && isSageTab(tab)) tab = null;
    }
    let prevUrl = null;
    if (tab) {
      prevUrl = tab.url !== url ? tab.url : null;
      await chrome.tabs.update(tab.id, { url, active: true });
    } else {
      // Open next to the user's other work, not inside SAGE's own window when avoidable.
      const ref = lastWorkTabId ? await chrome.tabs.get(lastWorkTabId).catch(() => null) : null;
      tab = await chrome.tabs.create(ref && !isSageTab(ref) ? { url, active: true, windowId: ref.windowId } : { url, active: true });
    }
    setWorkTab(tab.id);
    await waitForNavigation(tab.id, prevUrl, 20000);
    return { tabId: tab.id };
  },

  async navigate({ tabId, direction }) {
    const tab = await chrome.tabs.get(tabId);
    const before = tab.url;
    try {
      if (direction === 'back') await chrome.tabs.goBack(tabId);
      else if (direction === 'forward') await chrome.tabs.goForward(tabId);
      else await chrome.tabs.reload(tabId);
    } catch {
      return { ok: false, error: 'no_history' };
    }
    await waitForNavigation(tabId, direction === 'reload' ? null : before, 12000);
    return { ok: true };
  },

  async activate_tab({ tabId }) {
    try {
      await chrome.tabs.update(tabId, { active: true });
      setWorkTab(tabId);
      return { ok: true };
    } catch {
      return { ok: false, error: 'no_such_tab' };
    }
  },

  async page_action({ tabId, action, args }) {
    const access = await ensureAccess(tabId);
    if (access !== 'full') return { ok: false, error: access };
    const before = (await chrome.tabs.get(tabId)).url;
    const res = (await sendToTab(tabId, { type: 'SAGE_ACTION', action, args: args || {} }, 0, 8000)) || { ok: false, error: 'no_response' };
    if (res.ok && (action === 'click' || (action === 'type' && args && args.submit))) {
      await sleep(700);
      const t = await chrome.tabs.get(tabId);
      if (t.url !== before || t.status === 'loading') {
        await waitForNavigation(tabId, before, 15000);
        res.navigated = true;
      } else {
        await sleep(400); // let in-page updates (SPA filters, menus) render
      }
    }
    return res;
  },

  /** Use the website's own search box. */
  async site_search({ tabId, query }) {
    const access = await ensureAccess(tabId);
    if (access !== 'full') return { ok: false, error: access };
    const before = (await chrome.tabs.get(tabId)).url;
    const res = (await sendToTab(tabId, { type: 'SAGE_ACTION', action: 'site_search', args: { query } }, 0, 8000)) || { ok: false, error: 'no_response' };
    if (res.ok) {
      await sleep(700);
      await waitForNavigation(tabId, before, 15000);
    }
    return res;
  },

  async media({ tabId, action, value, fullscreenMode }) {
    const access = await ensureAccess(tabId);
    if (access !== 'full') return { ok: false, error: access, media: null };
    let frameId = 0;
    const top = await sendToTab(tabId, { type: 'SAGE_MEDIA', action: 'state' }, 0, 4000).catch(() => null);
    if (!top || !top.media) {
      const f = await findMediaFrameId(tabId);
      if (f === null) return { ok: false, error: 'no_video', media: null };
      frameId = f;
    }

    if (action === 'fullscreen') return enterFullscreen(tabId, frameId, fullscreenMode);
    if (action === 'exit_fullscreen') return exitFullscreen(tabId, frameId);

    if (action === 'prev') {
      const r = await sendToTab(tabId, { type: 'SAGE_MEDIA', action: 'prev' }, frameId, 15000);
      if (r && r.error === 'use_history_back') {
        const before = (await chrome.tabs.get(tabId)).url;
        try {
          await chrome.tabs.goBack(tabId);
        } catch {
          return { ok: false, error: 'no_previous_video' };
        }
        await waitForNavigation(tabId, before, 12000);
        await ensureContentScript(tabId);
        const st = await sendToTab(tabId, { type: 'SAGE_MEDIA', action: 'wait_playing' }, 0, 10000).catch(() => null);
        return { ok: true, verified: Boolean(st && st.verified), media: st ? st.media : null, navigated: true };
      }
      return r;
    }

    const res = await sendToTab(tabId, { type: 'SAGE_MEDIA', action, value }, frameId, action === 'next' ? 16000 : 12000);
    if (action === 'next' && res) res.navigated = true;
    return res;
  },

  /** Screenshot of the visible part of the working tab (needs the user-granted <all_urls> permission). */
  async capture({ tabId }) {
    const { screenCapture } = await permissionStatus();
    if (!screenCapture) return { ok: false, error: 'screen_permission_required' };
    const tab = await resolveTab(tabId);
    if (!tab) return { ok: false, error: 'no_working_tab' };
    if (!isScriptable(tab.url)) return { ok: false, error: 'restricted_page' };
    let activated = false;
    if (!tab.active) {
      await chrome.tabs.update(tab.id, { active: true });
      activated = true;
      await sleep(400);
    }
    const win = await chrome.windows.get(tab.windowId);
    if (win.state === 'minimized') return { ok: false, error: 'window_minimized' };
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 60 });
      const [, mimeType, data] = dataUrl.match(/^data:([^;]+);base64,(.*)$/) || [];
      return { ok: true, mimeType: mimeType || 'image/jpeg', data, tabId: tab.id, url: tab.url, title: tab.title, activated, at: Date.now() };
    } catch (err) {
      return { ok: false, error: `capture_failed: ${err && err.message ? err.message : err}` };
    }
  },
};

// -----------------------------------------------------------------------------
// Fullscreen: window fill (default) or trusted fullscreen via the debugger (opt-in)
// -----------------------------------------------------------------------------

async function enterFullscreen(tabId, frameId, mode) {
  const tab = await chrome.tabs.get(tabId);
  await chrome.tabs.update(tabId, { active: true });
  let note;

  if (mode === 'debugger') {
    const r = await debuggerFullscreen(tabId).catch((e) => ({ ok: false, error: e.message }));
    if (r && r.ok) {
      const st = await sendToTab(tabId, { type: 'SAGE_MEDIA', action: 'state' }, frameId, 4000).catch(() => null);
      return { ok: true, verified: true, mode: 'native', media: st ? st.media : null };
    }
    note =
      r && r.error === 'debugger_permission_missing'
        ? 'real fullscreen needs the debugger permission: enable it in the SAGE extension popup'
        : `real fullscreen failed (${(r && r.error) || 'unknown'}), used window fullscreen instead`;
  }

  const win = await chrome.windows.get(tab.windowId);
  if (win.state !== 'fullscreen') {
    prevWindowState[win.id] = win.state;
    await chrome.windows.update(win.id, { state: 'fullscreen' });
    await sleep(450);
  }
  if (frameId !== 0) {
    // Embedded player: stretch the iframe in the page, and the video inside the iframe.
    await sendToTab(tabId, { type: 'SAGE_MEDIA', action: 'maximize', value: 'iframe' }, 0, 4000).catch(() => null);
  }
  const r = (await sendToTab(tabId, { type: 'SAGE_MEDIA', action: 'maximize' }, frameId, 5000).catch(() => null)) || { ok: false };
  const w2 = await chrome.windows.get(win.id);
  const verified = w2.state === 'fullscreen' && Boolean(r.maximized);
  return { ok: Boolean(r.ok) || w2.state === 'fullscreen', verified, mode: 'window', media: r.media || null, note };
}

async function exitFullscreen(tabId, frameId) {
  await sendToTab(tabId, { type: 'SAGE_MEDIA', action: 'unmaximize' }, frameId, 4000).catch(() => null);
  if (frameId !== 0) await sendToTab(tabId, { type: 'SAGE_MEDIA', action: 'unmaximize' }, 0, 4000).catch(() => null);
  const tab = await chrome.tabs.get(tabId);
  const win = await chrome.windows.get(tab.windowId);
  if (win.state === 'fullscreen') {
    await chrome.windows.update(win.id, { state: prevWindowState[win.id] || 'maximized' });
    delete prevWindowState[win.id];
    await sleep(300);
  }
  const st = await sendToTab(tabId, { type: 'SAGE_MEDIA', action: 'state' }, frameId, 4000).catch(() => null);
  const w2 = await chrome.windows.get(win.id);
  const media = st ? st.media : null;
  return { ok: true, verified: w2.state !== 'fullscreen' && !(media && (media.fullscreen || media.maximized)), media };
}

async function debuggerFullscreen(tabId) {
  const granted = await chrome.permissions.contains({ permissions: ['debugger'] }).catch(() => false);
  if (!granted || !chrome.debugger) throw new Error('debugger_permission_missing');
  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');
  try {
    const expression = `(async () => {
      const vids = [...document.querySelectorAll('video')];
      const v = vids.find((x) => !x.paused) || vids.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      const frame = !v && document.querySelector('iframe[src*="vimeo"], iframe[src*="dailymotion"], iframe[src*="youtube"], iframe[allowfullscreen]');
      const el = document.querySelector('#movie_player') || (v && (v.closest('[class*="player" i]') || v)) || frame;
      if (!el) return { ok: false, error: 'no_video' };
      await el.requestFullscreen();
      return { ok: Boolean(document.fullscreenElement) };
    })()`;
    // userGesture: true gives this evaluation real user activation, which requestFullscreen requires.
    const res = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression,
      userGesture: true,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res && res.exceptionDetails) return { ok: false, error: 'requestFullscreen_rejected' };
    return (res && res.result && res.result.value) || { ok: false, error: 'no_result' };
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

// -----------------------------------------------------------------------------
// Observation helpers
// -----------------------------------------------------------------------------

function siteOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** A tab showing the SAGE app itself (never treated as the page to work on). */
function isSageTab(tab) {
  if (!tab) return false;
  for (const { tabId, origin } of appPorts.values()) {
    if (tabId === tab.id) return true;
    if (origin && tab.url && tab.url.startsWith(origin + '/')) return true;
  }
  return false;
}

function isScriptable(url) {
  return /^https?:/i.test(url || '') && !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/.test(url);
}

async function resolveTab(tabId) {
  for (const id of [tabId, lastWorkTabId]) {
    if (!id) continue;
    const t = await chrome.tabs.get(id).catch(() => null);
    if (t && !isSageTab(t)) return t;
  }
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (focused && !isSageTab(focused)) return focused;
  // Otherwise: the web page the user used most recently (the SAGE tab is usually the focused one).
  const all = await chrome.tabs.query({});
  const recent = all
    .filter((t) => !isSageTab(t) && /^https?:/i.test(t.url || ''))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0) || Number(b.active) - Number(a.active));
  if (recent[0]) return recent[0];
  return all.find((t) => t.active && !isSageTab(t)) || null;
}

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((t) => !isSageTab(t) && /^https?:|^about:blank|^chrome:\/\/newtab/.test(t.url || ''))
    .slice(0, 25)
    .map((t) => ({ id: t.id, url: t.url, title: t.title || '', active: t.active, windowId: t.windowId }));
}

/** 'full' when SAGE may read/act on the tab, otherwise the reason it can't. */
async function ensureAccess(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return 'no_such_tab';
  if (!isScriptable(tab.url)) return 'restricted_page';
  const ok = await ensureContentScript(tabId);
  if (ok) return 'full';
  const origin = (() => {
    try {
      return new URL(tab.url).origin + '/*';
    } catch {
      return null;
    }
  })();
  const granted = origin ? await chrome.permissions.contains({ origins: [origin] }).catch(() => false) : false;
  return granted ? 'page_refused' : 'permission_required';
}

async function snapshotTab(tab, waitFor) {
  const [tabs, win] = await Promise.all([listTabs(), chrome.windows.get(tab.windowId).catch(() => null)]);
  const base = {
    tabId: tab.id,
    windowId: tab.windowId,
    tabs,
    windowFullscreen: Boolean(win && win.state === 'fullscreen'),
    at: Date.now(),
  };
  const limited = (access, note) => ({
    ...base,
    url: tab.url || '',
    title: tab.title || '',
    pageKind: !tab.url || /^about:blank|^chrome:\/\/newtab/.test(tab.url) ? 'blank' : 'restricted',
    access,
    results: [],
    filterTabs: [],
    elements: [],
    media: null,
    auth: { needsLogin: false },
    textSummary: note,
  });

  if (!isScriptable(tab.url)) return limited('restricted', tab.url && !/^about:blank|^chrome:\/\/newtab/.test(tab.url) ? 'This is a browser-internal page that extensions cannot read.' : '');
  const access = await ensureAccess(tab.id);
  if (access === 'permission_required') {
    return limited('permission_required', 'SAGE can see this tab’s title and address, but reading the page needs browser access. Click "Enable Browser Access" in SAGE.');
  }
  if (access !== 'full') return limited('unreadable', 'This website does not allow extensions to read it.');

  let snap = null;
  try {
    snap = await sendToTab(tab.id, { type: 'SAGE_OBSERVE', waitFor: waitFor || null, timeoutMs: waitFor ? 7000 : 0 }, 0, 12000);
  } catch {}
  if (!snap) return limited('unreadable', 'The page did not respond (it may still be loading).');
  if (!snap.media && ['vimeo', 'dailymotion', 'generic'].includes(snap.pageKind)) {
    // Players embedded in iframes (Vimeo, Dailymotion, most news sites).
    const frameId = await findMediaFrameId(tab.id);
    if (frameId !== null && frameId !== 0) {
      const st = await sendToTab(tab.id, { type: 'SAGE_MEDIA', action: 'state' }, frameId, 3000).catch(() => null);
      if (st && st.media) snap.media = { ...st.media, frameId };
    }
  }
  return { ...snap, ...base, access: 'full' };
}

async function findMediaFrameId(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const vs = [...document.querySelectorAll('video')];
        if (!vs.length) return null;
        let area = 0;
        let playing = false;
        for (const v of vs) {
          const r = v.getBoundingClientRect();
          area = Math.max(area, r.width * r.height);
          if (!v.paused) playing = true;
        }
        return { area, playing };
      },
    });
    const frames = results.filter((r) => r.result && r.result.area > 20000);
    if (!frames.length) return null;
    frames.sort((a, b) => Number(b.result.playing) - Number(a.result.playing) || b.result.area - a.result.area);
    return frames[0].frameId;
  } catch {
    return null;
  }
}

/** True when the content script is running in the tab (injecting it if needed and allowed). */
async function ensureContentScript(tabId) {
  const pong = await sendToTab(tabId, { type: 'SAGE_PING' }, 0, 1500).catch(() => null);
  if (pong && pong.ok) return true;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !isScriptable(tab.url)) return false;
  try {
    // Pages opened before access was granted don't have the content script yet.
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
  } catch {
    return false;
  }
  const again = await sendToTab(tabId, { type: 'SAGE_PING' }, 0, 1500).catch(() => null);
  return Boolean(again && again.ok);
}

function sendToTab(tabId, msg, frameId = 0, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('page_timeout')), timeoutMs);
    try {
      chrome.tabs.sendMessage(tabId, msg, { frameId }, (res) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(res);
      });
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

/** Resolve once the tab finished loading a new document (or the same one, for reloads). */
async function waitForNavigation(tabId, prevUrl, timeoutMs = 20000) {
  const start = Date.now();
  await sleep(250);
  while (Date.now() - start < timeoutMs) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) throw new Error('tab_closed');
    const moved = !prevUrl || t.url !== prevUrl;
    if (t.status === 'complete' && (moved || Date.now() - start > 3000)) {
      await ensureContentScript(tabId).catch(() => {});
      return t;
    }
    await sleep(200);
  }
  return chrome.tabs.get(tabId);
}

async function pushTabs() {
  emit('tabs', { tabs: await listTabs().catch(() => []) });
}

// -----------------------------------------------------------------------------
// Push events so SAGE stays aware of manual browsing too
// -----------------------------------------------------------------------------

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const t = await chrome.tabs.get(tabId).catch(() => null);
  if (!t) return;
  if (!isSageTab(t)) setWorkTab(tabId);
  emit('tab_activated', { tabId, windowId, url: t.url, title: t.title, isSageApp: isSageTab(t) });
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.title || info.status === 'complete') {
    emit('tab_updated', { tabId, url: tab.url, title: tab.title, status: info.status });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (lastWorkTabId === tabId) setWorkTab(null);
  emit('tab_removed', { tabId });
});

updateBadge();
syncContentScripts();
