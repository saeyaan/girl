/**
 * Explains and requests SAGE's optional permissions. chrome.permissions.request must run from a
 * click inside an extension page, which is why the SAGE app opens this window.
 */
const KINDS = {
  browser: {
    title: 'Enable Browser Access',
    request: { origins: ['http://*/*', 'https://*/*'] },
    items: [
      ['Read the pages you ask SAGE about', 'Page title and address, visible text, search results, links, buttons, selected text and the video player, so SAGE can answer “what is open?” or “which is the first result?”.'],
      ['Act on those pages', 'Open results, switch the Google Videos tab, scroll, type into search boxes and play, pause or seek videos when you ask.'],
    ],
  },
  screen: {
    title: 'Allow Screen Capture',
    request: { origins: ['<all_urls>'] },
    items: [
      ['Capture the visible part of the tab', 'Only when you ask a visual question (“what is on my screen?”) or press “Capture visible screen”. SAGE shows you each time it captures.'],
      ['Sent to SAGE’s AI model', 'The image goes to your SAGE server and its Gemini model to answer, and is not saved.'],
    ],
  },
  fullscreen: {
    title: 'Allow Real Video Fullscreen',
    request: { permissions: ['debugger'] },
    items: [
      ['True fullscreen for videos', 'Chrome only allows fullscreen after a real click. SAGE briefly attaches Chrome’s debugger to trigger it; Chrome shows a “started debugging” bar while it does.'],
    ],
  },
};

const want = new URLSearchParams(location.search).get('want');
const kind = KINDS[want] || KINDS.browser;
document.getElementById('title').textContent = kind.title;
document.title = `SAGE – ${kind.title}`;
const explain = document.getElementById('explain');
for (const [head, body] of kind.items) {
  const div = document.createElement('div');
  div.className = 'item';
  const b = document.createElement('b');
  b.textContent = head;
  div.append(b, document.createTextNode(body));
  explain.append(div);
}

const result = document.getElementById('result');
document.getElementById('grant').addEventListener('click', async () => {
  try {
    const granted = await chrome.permissions.request(kind.request);
    result.className = granted ? 'ok' : 'no';
    result.textContent = granted ? 'Granted. You can close this window; SAGE has updated.' : 'Not granted. SAGE will keep working with what it already has.';
    if (granted) setTimeout(() => window.close(), 1500);
  } catch (err) {
    result.className = 'no';
    result.textContent = `Chrome refused the request: ${err && err.message ? err.message : err}`;
  }
});
document.getElementById('close').addEventListener('click', () => window.close());
