/**
 * SAGE Chrome Extension: content script
 *
 * Reads the page into a structured observation (page kind, search results, filter tabs, visible
 * interactive elements with stable ids, live video state) and performs page actions and video
 * controls, reading the result back so the server can verify it. Runs in every frame so embedded
 * players can be controlled; only the top frame answers observations.
 */
(() => {
  if (window.__sageContentLoaded) return;
  window.__sageContentLoaded = true;

  const IS_TOP = window.top === window;
  let idCounter = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------------------
  // Generic helpers
  // ---------------------------------------------------------------------------

  async function until(fn, timeoutMs = 3000, step = 120) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        if (fn()) return true;
      } catch {}
      await sleep(step);
    }
    try {
      return Boolean(fn());
    } catch {
      return false;
    }
  }

  function clean(s, n = 100) {
    return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  }

  function rendered(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }

  function visible(el) {
    if (!rendered(el)) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  }

  function nearViewport(el, factor = 1.5) {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight * factor && r.right > 0 && r.left < innerWidth;
  }

  function sageId(el) {
    if (!el.dataset.sageId) el.dataset.sageId = `e${++idCounter}`;
    return el.dataset.sageId;
  }

  function byId(id) {
    if (!id) return null;
    try {
      return document.querySelector(`[data-sage-id="${CSS.escape(id)}"]`);
    } catch {
      return null;
    }
  }

  function host() {
    return location.hostname.replace(/^www\./, '');
  }

  // ---------------------------------------------------------------------------
  // Page understanding
  // ---------------------------------------------------------------------------

  function pageKind() {
    const h = location.hostname;
    const p = location.pathname;
    const sp = new URLSearchParams(location.search);
    // "Prove you're human" pages: SAGE never solves these; the user has to.
    if ((/(^|\.)google\.[a-z.]+$/.test(h) && p.startsWith('/sorry/')) || (/^just a moment/i.test(document.title) && document.querySelector('#challenge-form, #challenge-running, .cf-turnstile, #cf-challenge-running'))) {
      return 'captcha';
    }
    const hasPassword = Boolean(document.querySelector('input[type="password"]'));
    if (/^accounts\.google\./.test(h) || (hasPassword && /(log-?in|sign-?in|auth|session)/i.test(location.href))) return 'login_page';
    if (/(^|\.)google\.[a-z.]+$/.test(h) && p === '/search') {
      return sp.get('tbm') === 'vid' || sp.get('udm') === '7' ? 'google_videos' : 'google_serp';
    }
    if (/(^|\.)youtube\.com$/.test(h)) {
      if (p === '/watch' || p.startsWith('/shorts/')) return 'youtube_watch';
      if (p === '/results') return 'youtube_search';
      return 'youtube_home';
    }
    if (h === 'mail.google.com') return 'gmail';
    if (/(^|\.)vimeo\.com$/.test(h)) return 'vimeo';
    if (/(^|\.)dailymotion\.com$/.test(h)) return 'dailymotion';
    return 'generic';
  }

  function currentQuery(kind) {
    const sp = new URLSearchParams(location.search);
    if (kind === 'google_serp' || kind === 'google_videos') return sp.get('q') || '';
    if (kind === 'youtube_search') return sp.get('search_query') || '';
    if (kind === 'gmail') {
      const m = location.hash.match(/#search\/(.+)$/);
      return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
    }
    const box = document.querySelector('input[type="search"]');
    return box ? clean(box.value, 120) : '';
  }

  const VIDEO_URL = /youtube\.com\/(watch|shorts)|youtu\.be\/|vimeo\.com\/\d|dailymotion\.com\/video\//i;

  function unwrapGoogleHref(href) {
    try {
      const u = new URL(href);
      if (/google\./.test(u.hostname) && u.pathname === '/url') return u.searchParams.get('q') || u.searchParams.get('url') || href;
    } catch {}
    return href;
  }

  function googleResults() {
    const root = document.querySelector('#search') || document.querySelector('#rso') || document.querySelector('#center_col') || document.body;
    const anchors = [...root.querySelectorAll('a[href]')].filter((a) => a.querySelector('h3, [role="heading"]') && rendered(a));
    const seen = new Set();
    const out = [];
    for (const a of anchors) {
      const href = unwrapGoogleHref(a.href);
      if (!/^https?:/i.test(href)) continue;
      let hostName = '';
      try {
        hostName = new URL(href).hostname;
      } catch {
        continue;
      }
      if (/(^|\.)google\.[a-z.]+$/.test(hostName) && !/^(maps|books|scholar)\./.test(hostName)) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      const heading = a.querySelector('h3, [role="heading"]');
      const box = a.closest('div.g, div.MjjYud, div[data-hveid], div[data-ved]') || a.parentElement;
      const boxText = box ? box.innerText || '' : '';
      const dur = boxText.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/);
      out.push({
        index: out.length,
        title: clean(heading.innerText || heading.textContent, 160),
        url: href,
        snippet: clean(box && box.querySelector('.VwiC3b, [data-sncf], .ITZIwc, .Uroaid') ? box.querySelector('.VwiC3b, [data-sncf], .ITZIwc, .Uroaid').innerText : '', 200),
        source: hostName.replace(/^www\./, ''),
        duration: dur ? dur[0] : undefined,
        type: VIDEO_URL.test(href) ? 'video' : 'web',
      });
      if (out.length >= 10) break;
    }
    return out;
  }

  function youtubeResults(kind) {
    let selector;
    if (kind === 'youtube_search') selector = 'ytd-search ytd-video-renderer, ytd-search yt-lockup-view-model';
    else if (kind === 'youtube_watch') selector = '#secondary ytd-compact-video-renderer, #secondary yt-lockup-view-model, ytd-watch-next-secondary-results-renderer yt-lockup-view-model';
    else selector = 'ytd-rich-item-renderer, ytd-browse yt-lockup-view-model';
    const out = [];
    const seen = new Set();
    for (const node of document.querySelectorAll(selector)) {
      if (!rendered(node) || node.closest('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-reel-shelf-renderer')) continue;
      const a = node.querySelector(
        'a#video-title, a#video-title-link, a.yt-lockup-metadata-view-model-wiz__title, a.yt-lockup-metadata-view-model__title, a#thumbnail[href*="/watch"], a[href*="/watch?v="]'
      );
      if (!a || !a.href || !/\/(watch|shorts)/.test(a.href)) continue;
      const url = a.href.replace(/&pp=[^&]*/, '');
      if (seen.has(url)) continue;
      seen.add(url);
      const titleEl = node.querySelector('#video-title, .yt-lockup-metadata-view-model-wiz__title, .yt-lockup-metadata-view-model__title, h3');
      const title = clean(a.getAttribute('title') || (titleEl && (titleEl.getAttribute('title') || titleEl.innerText)) || a.innerText, 160);
      if (!title) continue;
      const ch = node.querySelector('ytd-channel-name a, #channel-name a, ytd-channel-name #text, .yt-content-metadata-view-model-wiz__metadata-text, .yt-content-metadata-view-model__metadata-text');
      const du = node.querySelector('ytd-thumbnail-overlay-time-status-renderer #text, .badge-shape-wiz__text, .yt-badge-shape__text, badge-shape div');
      out.push({
        index: out.length,
        title,
        url,
        channel: ch ? clean(ch.innerText, 60) : undefined,
        duration: du ? clean(du.innerText, 12) || undefined : undefined,
        type: kind === 'youtube_watch' ? 'related' : 'video',
      });
      if (out.length >= 12) break;
    }
    return out;
  }

  function linkResults(match) {
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href]')) {
      if (!match(a) || !rendered(a)) continue;
      const url = a.href.split('#')[0];
      if (seen.has(url) || url === location.href.split('#')[0]) continue;
      const title = clean(a.getAttribute('title') || a.getAttribute('aria-label') || a.innerText, 160);
      if (title.length < 4) continue;
      seen.add(url);
      out.push({ index: out.length, title, url, type: VIDEO_URL.test(url) ? 'video' : 'web' });
      if (out.length >= 10) break;
    }
    return out;
  }

  function results(kind) {
    switch (kind) {
      case 'google_serp':
      case 'google_videos':
        return googleResults();
      case 'youtube_search':
      case 'youtube_home':
      case 'youtube_watch':
        return youtubeResults(kind);
      case 'vimeo':
        return linkResults((a) => /^https:\/\/vimeo\.com\/\d+/.test(a.href));
      case 'dailymotion':
        return linkResults((a) => /dailymotion\.com\/video\//.test(a.href));
      case 'generic':
        return linkResults((a) => Boolean(a.closest('main, article, [role="main"]')) && Boolean(a.querySelector('h2, h3')));
      default:
        return [];
    }
  }

  const GOOGLE_TABS = ['All', 'Images', 'Videos', 'News', 'Shopping', 'Maps', 'Books', 'Web', 'Short videos', 'Forums', 'Flights', 'Finance'];

  function googleFilterTabs(kind) {
    const sp = new URLSearchParams(location.search);
    const selectedName =
      kind === 'google_videos'
        ? 'Videos'
        : sp.get('udm') === '2' || sp.get('tbm') === 'isch'
        ? 'Images'
        : sp.get('tbm') === 'nws'
        ? 'News'
        : sp.get('udm') === '28' || sp.get('tbm') === 'shop'
        ? 'Shopping'
        : sp.get('udm') === '14'
        ? 'Web'
        : !sp.get('udm') && !sp.get('tbm')
        ? 'All'
        : '';
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href]')) {
      const name = clean(a.innerText || a.textContent, 30);
      if (!GOOGLE_TABS.includes(name) || seen.has(name)) continue;
      const r = a.getBoundingClientRect();
      if (r.top > 320 || r.width < 2) continue;
      seen.add(name);
      out.push({ name, elementId: sageId(a), selected: name === selectedName || a.getAttribute('aria-current') === 'page' });
    }
    if (selectedName && !seen.has(selectedName)) out.unshift({ name: selectedName, elementId: '', selected: true });
    return out;
  }

  const INTERACTIVE =
    'a[href], button, input:not([type="hidden"]), textarea, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="combobox"], [role="searchbox"], [contenteditable="true"]';

  function isField(el) {
    return el.matches('input, textarea, select, [contenteditable="true"], [role="searchbox"], [role="combobox"]');
  }

  function roleOf(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (['submit', 'button', 'reset', 'image'].includes(t)) return 'button';
      if (['checkbox', 'radio'].includes(t)) return t;
      return 'input';
    }
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    if (el.isContentEditable) return 'textbox';
    return tag;
  }

  function labelFor(el) {
    let label =
      el.getAttribute('aria-label') ||
      (el.labels && el.labels[0] && el.labels[0].innerText) ||
      (isField(el) ? el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('title') : '') ||
      el.innerText ||
      el.getAttribute('title') ||
      (el.querySelector && el.querySelector('img[alt]') && el.querySelector('img[alt]').alt) ||
      // Only button captions; never what the user typed into a field.
      (el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes((el.type || '').toLowerCase()) ? el.value : '') ||
      '';
    return clean(label, 80);
  }

  function isSearchField(el) {
    const hint = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('name') || ''} ${el.id || ''}`;
    return el.type === 'search' || el.getAttribute('role') === 'searchbox' || ['q', 'search_query', 'search', 'query'].includes(el.getAttribute('name') || '') || /search/i.test(hint);
  }

  function isSearchForm(form) {
    if (!form) return false;
    if (form.getAttribute('role') === 'search') return true;
    if (/search/i.test(form.getAttribute('action') || '') || /search/i.test(form.id || '')) return true;
    return Boolean(form.querySelector('input[type="search"], input[name="q"], input[name="search_query"], input[name="search"], [role="searchbox"]'));
  }

  function interactiveElements() {
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll(INTERACTIVE)) {
      if (out.length >= 60) break;
      if (!visible(el) || !nearViewport(el) || el.closest('[aria-hidden="true"]')) continue;
      const role = roleOf(el);
      const label = labelFor(el);
      if (!label && !isField(el)) continue;
      const key = `${role}|${label}`;
      if (role === 'link' && seen.has(key)) continue;
      seen.add(key);
      const item = { id: sageId(el), role, label };
      if (el.href) item.href = String(el.href).slice(0, 200);
      if (isField(el)) item.inputType = (el.type || (el.isContentEditable ? 'contenteditable' : el.getAttribute('role')) || 'text').toLowerCase();
      else if (el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && role === 'button')) item.inputType = (el.type || 'button').toLowerCase();
      const form = el.closest('form, [role="search"]');
      if (form) item.form = isSearchForm(form) || (isField(el) && isSearchField(el)) ? 'search' : 'other';
      else if (isField(el) && isSearchField(el)) item.form = 'search';
      out.push(item);
    }
    return out;
  }

  /** Readable text of the page (visible area first). Search pages get less: their results are listed separately. */
  function textSummary(kind) {
    if (kind === 'login_page') return '';
    const limit = kind === 'generic' || kind === 'gmail' ? 2000 : 600;
    const main = document.querySelector('main, article, [role="main"]') || document.body;
    return clean(main ? main.innerText : '', limit);
  }

  function selectedText() {
    const active = document.activeElement;
    if (active && active.matches && active.matches('input, textarea')) return ''; // never read typed field contents
    const sel = window.getSelection ? String(window.getSelection() || '') : '';
    return clean(sel, 1000);
  }

  /** Find the site's own search box. */
  function findSearchBox() {
    const candidates = [...document.querySelectorAll('input:not([type="hidden"]):not([type="password"]), textarea, [role="searchbox"], [contenteditable="true"][role="combobox"]')].filter(
      (el) => visible(el) && (isSearchField(el) || isSearchForm(el.closest('form')))
    );
    return candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
  }

  // ---------------------------------------------------------------------------
  // Media
  // ---------------------------------------------------------------------------

  const maxState = { active: false };

  function isPreviewVideo(v) {
    return Boolean(v.closest('ytd-video-preview, #video-preview, #inline-preview-player, ytd-moving-thumbnail-renderer, [id*="preview" i]'));
  }

  function area(el) {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  }

  function activeVideo() {
    const vids = [...document.querySelectorAll('video')].filter((v) => !isPreviewVideo(v) && (v.currentSrc || v.src || v.readyState > 0));
    if (!vids.length) return null;
    if (/(^|\.)youtube\.com$/.test(location.hostname) && !/^\/(watch|shorts\/)/.test(location.pathname)) {
      // On YouTube browse/search pages only the miniplayer counts.
      const mini = vids.find((v) => v.closest('ytd-miniplayer'));
      if (!mini) return null;
      return mini;
    }
    const playing = vids.filter((v) => !v.paused && !v.ended);
    const pool = playing.length ? playing : vids.filter(rendered).length ? vids.filter(rendered) : vids;
    return pool.sort((a, b) => area(b) - area(a))[0];
  }

  function playerType() {
    const h = location.hostname;
    if (/youtube\.com$/.test(h)) return 'youtube';
    if (/vimeo\.com$/.test(h)) return 'vimeo';
    if (/dailymotion\.com$/.test(h)) return 'dailymotion';
    return 'html5';
  }

  function mediaTitle() {
    if (/youtube\.com$/.test(location.hostname)) {
      const h1 = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, ytd-watch-metadata h1, h1.title');
      if (h1 && h1.innerText.trim()) return clean(h1.innerText, 160);
      return clean(document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, ''), 160);
    }
    const og = document.querySelector('meta[property="og:title"]');
    return clean((og && og.content) || document.title, 160);
  }

  function mediaState(v) {
    if (!v) return null;
    return {
      present: true,
      paused: v.paused,
      ended: v.ended,
      buffering: !v.paused && v.readyState < 3,
      currentTime: Math.round(v.currentTime * 10) / 10,
      duration: Number.isFinite(v.duration) ? Math.round(v.duration) : 0,
      volume: Math.round(v.volume * 100) / 100,
      muted: v.muted,
      playbackRate: v.playbackRate,
      fullscreen: Boolean(document.fullscreenElement),
      maximized: maxState.active,
      title: mediaTitle(),
      playerType: playerType(),
    };
  }

  function advancing(v, ms) {
    const t0 = v.currentTime;
    return until(() => !v.paused && v.currentTime > t0 + 0.15, ms);
  }

  async function seekTo(v, t) {
    const dur = Number.isFinite(v.duration) ? v.duration : Infinity;
    const target = Math.max(0, Math.min(dur - 0.5, t));
    v.currentTime = target;
    await until(() => Math.abs(v.currentTime - target) < 1.5 && !v.seeking, 2500);
    const ok = Math.abs(v.currentTime - target) < 2.5;
    return { ok, verified: ok, media: mediaState(v) };
  }

  async function setVolume(v, x) {
    const target = Math.max(0, Math.min(1, x));
    v.volume = target;
    if (target > 0) v.muted = false;
    await sleep(120);
    const ok = Math.abs(v.volume - target) < 0.03;
    return { ok, verified: ok, media: mediaState(v) };
  }

  function sitePlayButton() {
    return document.querySelector('.ytp-play-button, .vp-controls button[aria-label*="Play" i], button[aria-label="Play"], [data-testid="play-button"]');
  }

  async function changeVideo(buttonSelector, relatedSelector) {
    const before = location.href;
    const btn = document.querySelector(buttonSelector);
    if (btn && visible(btn)) btn.click();
    else {
      const rel = relatedSelector && document.querySelector(relatedSelector);
      if (!rel) return null;
      rel.click();
    }
    const moved = await until(() => location.href !== before, 8000);
    if (!moved) return { ok: false, error: 'video_did_not_change' };
    await until(() => {
      const nv = activeVideo();
      return nv && !nv.paused && nv.currentTime > 0.3;
    }, 7000);
    const nv = activeVideo();
    return { ok: true, verified: Boolean(nv && !nv.paused), media: mediaState(nv) };
  }

  function escHandler(e) {
    if (e.key === 'Escape' && maxState.active) unmaximize();
  }

  async function maximize(target) {
    let el = null;
    if (target === 'iframe') {
      el = [...document.querySelectorAll('iframe')].filter(rendered).sort((a, b) => area(b) - area(a))[0] || null;
    } else if (/youtube\.com$/.test(location.hostname)) {
      el = document.querySelector('#movie_player');
    } else {
      el = activeVideo();
    }
    if (!el) return { ok: false, error: 'no_video' };
    unmaximize(true);
    el.setAttribute('data-sage-max', '1');
    const style = document.createElement('style');
    style.id = 'sage-max-style';
    style.textContent = `
      [data-sage-max]{position:fixed!important;inset:0!important;top:0!important;left:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;transform:none!important;z-index:2147483646!important;background:#000!important}
      video[data-sage-max]{object-fit:contain!important}
      [data-sage-max] video{width:100%!important;height:100%!important;left:0!important;top:0!important;object-fit:contain!important}
      [data-sage-max] .ytp-chrome-bottom{width:calc(100% - 24px)!important;left:12px!important}
      html.sage-max-on,html.sage-max-on body{overflow:hidden!important}`;
    document.documentElement.appendChild(style);
    document.documentElement.classList.add('sage-max-on');
    maxState.active = true;
    document.addEventListener('keydown', escHandler, true);
    window.dispatchEvent(new Event('resize'));
    await sleep(350);
    window.dispatchEvent(new Event('resize'));
    const r = el.getBoundingClientRect();
    const filled = r.width >= innerWidth * 0.95 && r.height >= innerHeight * 0.9;
    return { ok: filled, verified: filled, maximized: filled, media: mediaState(activeVideo()) };
  }

  function unmaximize(silent) {
    document.querySelectorAll('[data-sage-max]').forEach((el) => el.removeAttribute('data-sage-max'));
    const style = document.getElementById('sage-max-style');
    if (style) style.remove();
    document.documentElement.classList.remove('sage-max-on');
    document.removeEventListener('keydown', escHandler, true);
    const was = maxState.active;
    maxState.active = false;
    if (!silent && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (was) window.dispatchEvent(new Event('resize'));
    return { ok: true, verified: true, media: mediaState(activeVideo()) };
  }

  async function mediaAction(action, value) {
    if (action === 'maximize') return maximize(value);
    if (action === 'unmaximize') {
      const r = unmaximize(false);
      await sleep(200);
      return { ...r, media: mediaState(activeVideo()) };
    }
    if (action === 'wait_playing') {
      await until(() => {
        const v = activeVideo();
        return v && !v.paused;
      }, 6000);
      const v = activeVideo();
      return { ok: Boolean(v), verified: Boolean(v && !v.paused), media: mediaState(v) };
    }

    const v = activeVideo();
    if (!v) return { ok: false, error: 'no_video', media: null };

    switch (action) {
      case 'state':
        return { ok: true, verified: true, media: mediaState(v) };
      case 'play': {
        if (!v.paused && !v.ended) {
          const moving = await advancing(v, 1500);
          return moving
            ? { ok: true, verified: true, media: mediaState(v), note: 'it was already playing' }
            : { ok: false, error: 'buffering', media: mediaState(v) };
        }
        if (v.ended) v.currentTime = 0;
        let blocked = false;
        try {
          await Promise.race([v.play(), sleep(4000)]);
        } catch (e) {
          if (e && e.name === 'NotAllowedError') blocked = true;
        }
        if (blocked || v.paused) {
          const btn = sitePlayButton();
          if (btn) {
            btn.click();
            await sleep(600);
          }
        }
        if (v.paused) return { ok: false, error: blocked ? 'blocked_by_autoplay' : 'did_not_start', media: mediaState(v) };
        const moving = await advancing(v, 4500);
        if (moving) return { ok: true, verified: true, media: mediaState(v) };
        return { ok: false, error: 'buffering', media: mediaState(v) };
      }
      case 'pause': {
        v.pause();
        const ok = await until(() => v.paused, 1500);
        return { ok, verified: ok, media: mediaState(v) };
      }
      case 'seek':
        return seekTo(v, v.currentTime + (Number(value) || 0));
      case 'seek_to':
        return seekTo(v, Number(value) || 0);
      case 'speed': {
        const rate = Math.max(0.25, Math.min(4, Number(value) || 1));
        v.playbackRate = rate;
        await sleep(200);
        const ok = Math.abs(v.playbackRate - rate) < 0.01;
        return { ok, verified: ok, media: mediaState(v) };
      }
      case 'volume_up':
        return setVolume(v, (v.muted ? 0 : v.volume) + (Number(value) || 15) / 100);
      case 'volume_down':
        return setVolume(v, v.volume - (Number(value) || 15) / 100);
      case 'volume_set':
        return setVolume(v, (Number(value) || 0) / 100);
      case 'mute': {
        v.muted = true;
        await sleep(100);
        return { ok: v.muted, verified: v.muted, media: mediaState(v) };
      }
      case 'unmute': {
        v.muted = false;
        if (v.volume === 0) v.volume = 0.5;
        await sleep(100);
        return { ok: !v.muted, verified: !v.muted, media: mediaState(v) };
      }
      case 'next': {
        const r = await changeVideo(
          '.ytp-next-button',
          '#secondary ytd-compact-video-renderer a#thumbnail, #secondary yt-lockup-view-model a[href*="/watch"], ytd-watch-next-secondary-results-renderer a[href*="/watch"]'
        );
        return r || { ok: false, error: 'no_next_video', media: mediaState(v) };
      }
      case 'prev': {
        const btn = document.querySelector('.ytp-prev-button');
        if (btn && visible(btn)) return (await changeVideo('.ytp-prev-button', null)) || { ok: false, error: 'no_previous_video' };
        return { ok: false, error: 'use_history_back' };
      }
      default:
        return { ok: false, error: `unsupported_action:${action}` };
    }
  }

  // ---------------------------------------------------------------------------
  // Observation & actions
  // ---------------------------------------------------------------------------

  async function observe(waitFor, timeoutMs) {
    if (waitFor === 'results') await until(() => results(pageKind()).length > 0, timeoutMs || 6000, 200);
    if (waitFor === 'video') await until(() => {
      const v = activeVideo();
      return v && v.readyState >= 1;
    }, timeoutMs || 6000, 200);
    const kind = pageKind();
    return {
      url: location.href,
      title: document.title,
      pageKind: kind,
      query: currentQuery(kind),
      results: kind === 'login_page' ? [] : results(kind),
      filterTabs: kind === 'google_serp' || kind === 'google_videos' ? googleFilterTabs(kind) : [],
      elements: interactiveElements(),
      media: mediaState(activeVideo()),
      auth: { needsLogin: kind === 'login_page' },
      textSummary: textSummary(kind),
      selection: selectedText(),
      site: host(),
      at: Date.now(),
    };
  }

  function flash(el) {
    const prev = el.style.outline;
    el.style.outline = '3px solid #8b5cf6';
    setTimeout(() => (el.style.outline = prev), 900);
  }

  function setNativeValue(el, text) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Returns [response, afterResponse] so navigation-triggering work runs after the reply is sent. */
  function pageAction(action, args) {
    if (action === 'scroll') {
      if (args.direction === 'top') window.scrollTo({ top: 0 });
      else window.scrollBy({ top: (args.direction === 'up' ? -1 : 1) * innerHeight * 0.85 });
      return [{ ok: true }, null];
    }
    if (action === 'site_search') {
      const box = findSearchBox();
      if (!box) return [{ ok: false, error: 'no_search_box' }, null];
      args = { elementId: sageId(box), text: args.query || '', submit: true };
      action = 'type';
    }
    const el = byId(args.elementId);
    if (!el || !el.isConnected) return [{ ok: false, error: 'element_not_found' }, null];

    if (action === 'click') {
      el.scrollIntoView({ block: 'center' });
      flash(el);
      if (el.tagName === 'A' && el.target === '_blank') el.removeAttribute('target'); // keep SAGE in the working tab
      return [{ ok: true, clicked: labelFor(el) }, () => el.click()];
    }

    if (action === 'type') {
      if (el.type === 'password') return [{ ok: false, error: 'refused_password_field' }, null];
      el.scrollIntoView({ block: 'center' });
      el.focus();
      if (el.isContentEditable) {
        el.textContent = args.text || '';
        el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      } else {
        setNativeValue(el, args.text || '');
      }
      flash(el);
      if (!args.submit) return [{ ok: true }, null];
      return [
        { ok: true, submitted: true },
        () => {
          const form = el.form || el.closest('form');
          if (form && form.requestSubmit) {
            try {
              form.requestSubmit();
              return;
            } catch {}
          }
          const enter = (type) => el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          enter('keydown');
          enter('keypress');
          enter('keyup');
        },
      ];
    }
    return [{ ok: false, error: `unsupported_action:${action}` }, null];
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('SAGE_')) return false;

    if (msg.type === 'SAGE_PING') {
      sendResponse({ ok: true, top: IS_TOP });
      return false;
    }

    if (msg.type === 'SAGE_OBSERVE') {
      if (!IS_TOP) return false;
      observe(msg.waitFor, msg.timeoutMs)
        .then(sendResponse)
        .catch((e) => sendResponse(null));
      return true;
    }

    if (msg.type === 'SAGE_ACTION') {
      if (!IS_TOP) return false;
      let after = null;
      let res;
      try {
        [res, after] = pageAction(msg.action, msg.args || {});
      } catch (e) {
        res = { ok: false, error: String(e && e.message ? e.message : e) };
      }
      if (msg.action === 'scroll') {
        sleep(700).then(() => sendResponse(res));
        return true;
      }
      sendResponse(res);
      if (after) setTimeout(after, 60);
      return false;
    }

    if (msg.type === 'SAGE_MEDIA') {
      mediaAction(msg.action, msg.value)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
      return true;
    }

    return false;
  });

  // ---------------------------------------------------------------------------
  // Push live state to the server (through the background worker)
  // ---------------------------------------------------------------------------

  let pushTimer = null;
  function pushMedia() {
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      const v = activeVideo();
      // Sub-frames only report real players (ignore ads and tiny previews).
      if (!IS_TOP && (!v || area(v) < 320 * 180)) return;
      try {
        chrome.runtime.sendMessage({ type: 'SAGE_EVENT', event: 'media_state', data: { url: location.href, media: mediaState(v) } });
      } catch {}
    }, 400);
  }

  ['play', 'pause', 'playing', 'waiting', 'ratechange', 'volumechange', 'ended', 'seeked', 'loadedmetadata', 'emptied'].forEach((type) =>
    document.addEventListener(
      type,
      (e) => {
        if (e.target instanceof HTMLVideoElement && !isPreviewVideo(e.target)) pushMedia();
      },
      true
    )
  );
  document.addEventListener('fullscreenchange', pushMedia);

  if (IS_TOP) {
    window.addEventListener('yt-navigate-finish', () => {
      try {
        chrome.runtime.sendMessage({ type: 'SAGE_EVENT', event: 'page_navigated', data: { url: location.href, title: document.title } });
      } catch {}
      pushMedia();
    });
  }
})();
