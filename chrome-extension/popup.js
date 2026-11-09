/**
 * SAGE Chrome Extension: popup
 * Shows whether the SAGE app is linked, the tab SAGE works in, and which optional permissions are
 * granted, with buttons to grant them (permission requests need a click in an extension page).
 */

document.addEventListener('DOMContentLoaded', () => {
  const badge = document.getElementById('bridge-status');
  const badgeText = document.getElementById('bridge-text');
  const tabTitle = document.getElementById('active-tab-title');
  const permList = document.getElementById('perm-list');

  const REQUESTS = {
    browser: { origins: ['http://*/*', 'https://*/*'] },
    screen: { origins: ['<all_urls>'] },
    fullscreen: { permissions: ['debugger'] },
  };
  const LABELS = { browserAccess: ['browser', 'Browser access (read & act on pages)'], screenCapture: ['screen', 'Screen capture'], realFullscreen: ['fullscreen', 'Real video fullscreen'] };

  function refresh() {
    chrome.runtime.sendMessage({ type: 'SAGE_STATUS' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        badgeText.textContent = 'Extension worker not responding: reload it in chrome://extensions';
        return;
      }
      const linked = res.appConnections > 0;
      badge.classList.toggle('off', !linked);
      badgeText.textContent = linked
        ? `Linked to the SAGE app (v${res.version})`
        : 'SAGE app not open: open it at http://localhost:3000';
      const show = (tab) => (tabTitle.textContent = tab ? tab.title || tab.url : 'No tab yet');
      if (res.lastWorkTabId) chrome.tabs.get(res.lastWorkTabId, (t) => show(chrome.runtime.lastError ? null : t));
      else chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => show(tabs && tabs[0]));

      permList.textContent = '';
      for (const [key, [kind, label]] of Object.entries(LABELS)) {
        const row = document.createElement('div');
        row.className = 'perm-row';
        const name = document.createElement('span');
        name.textContent = `${res.permissions[key] ? '✓' : '○'} ${label}`;
        name.className = res.permissions[key] ? 'granted' : '';
        row.append(name);
        if (!res.permissions[key]) {
          const btn = document.createElement('button');
          btn.className = 'secondary small';
          btn.textContent = 'Allow';
          btn.addEventListener('click', () => chrome.permissions.request(REQUESTS[kind], () => setTimeout(refresh, 200)));
          row.append(btn);
        }
        permList.append(row);
      }
    });
  }

  document.getElementById('btn-open-sage').addEventListener('click', () => {
    chrome.windows.create({ url: 'http://localhost:3000', type: 'normal', width: 520, height: 860 });
  });
  document.getElementById('btn-refresh').addEventListener('click', refresh);

  refresh();
});
