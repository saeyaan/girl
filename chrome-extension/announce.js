/**
 * Runs only on local pages (localhost / 127.0.0.1). If the page is the SAGE app (it carries
 * <meta name="sage-app">), tell it this extension's id so it can connect even if the id differs
 * from the built-in default (e.g. a repacked build).
 */
(() => {
  const announce = () => {
    if (!document.querySelector('meta[name="sage-app"]')) return;
    window.postMessage(
      { source: 'sage-extension', type: 'announce', id: chrome.runtime.id, version: chrome.runtime.getManifest().version },
      location.origin
    );
  };
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.source === 'sage-app' && e.data.type === 'discover') announce();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', announce);
  else announce();
})();
