# SAGE Chrome Extension (Manifest V3, v3)

The extension is SAGE's eyes and hands in the browser. The **SAGE web app connects to it
directly** with `chrome.runtime.connect` (allowed by `externally_connectable`) and relays requests
between the extension and the SAGE server. Every answer is read back from the page, so SAGE only
reports what actually happened.

```
SAGE server ⇄ WebSocket ⇄ SAGE app page ⇄ chrome.runtime port ⇄ extension service worker ⇄ content script ⇄ web page
```

## Install

1. Start SAGE: `npm run dev` (serves `http://localhost:3000`).
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick this
   `chrome-extension` folder. Chrome 116 or newer is required.
   - **Already had an older SAGE extension loaded?** Click **Remove** on it, then Load unpacked
     again (or click **Reload**). Version 3 has a fixed id, `dglbflkoabfpgeiplgpoclicefjoaahl`,
     which the app connects to.
3. Open (or reload) the SAGE app. The top-right status turns:
   - 🟡 **Connecting** → 🔘 **Permissions Required** once the handshake succeeds.
4. Click **Enable Browser Access** (in the Browser panel or Settings). SAGE explains what it needs,
   a small SAGE window opens, click **Grant access**, then **Allow** in Chrome's prompt.
   The status turns 🟢 **Extension Online**.
5. Optional, in the Browser panel: **Screen capture** (for visual questions) and **Real video
   fullscreen**.

## Status meanings

| Status | Meaning |
|---|---|
| 🟢 Extension Online | Handshake done, heartbeat answering, page access granted. |
| 🔘 Permissions Required | Connected, but page access isn't granted yet. SAGE can still see tab titles and addresses. |
| 🟡 Connecting | Handshake in progress, or reconnecting after the worker restarted. |
| 🔴 Extension Offline | See the reason in the Browser panel, for example: extension not detected (not installed or disabled, or this origin isn't allowed), no extension answered at the id (removed, disabled, or a different id), outdated version (click Reload), handshake timeout (check the service worker's errors), heartbeat lost, or SAGE server unreachable. |

The app only shows Online after a successful `hello` → `hello_ack` handshake and keeps checking
with a heartbeat every 10 s. If the service worker is suspended or restarted, the extension is
reloaded or re-enabled, or Chrome restarts, the app reconnects on its own. A request that arrives
during a reconnect waits for it instead of failing.

## What SAGE can read and do

- **Read** (needs *Browser access*): page title, address and website, visible text, selected text,
  search query and results (Google, including the Videos tab, plus YouTube, Vimeo and Dailymotion),
  filter tabs, visible links, buttons and inputs (each with a stable id), sign-in and "verify
  you're human" pages, and the live video state.
- **Always, even without Browser access:** which tab is active, its title and address, and the open
  tabs (from the `tabs` permission).
- **Act:** open URLs and new tabs, search the web or the current site, open a result, switch the
  Google filter tab, click by element id or by description (semantic, never screen coordinates),
  type into search boxes, scroll, go back or forward, switch tabs, and play, pause, seek, set the
  volume, change speed and go fullscreen on videos.
- **Screen capture** (needs *Screen capture*, plus *Visual observation* turned on in SAGE):
  `captureVisibleTab` of the working tab, sent to SAGE's model together with the page structure.
  You're shown every capture, and images aren't stored.

## Privacy and safety

- All host access is **optional** and granted by you. You can revoke it in chrome://extensions →
  SAGE → Details.
- SAGE never reads passwords, cookies, typed form values or hidden fields, never signs in for you,
  and never solves "verify you're human" checks.
- Purchases, payments, sending, posting, deleting and account changes need your explicit "yes".
- Only the SAGE app's own origins (`http://localhost:*`, `http://127.0.0.1:*`) can connect to the
  extension. If you host SAGE elsewhere, add that origin to `externally_connectable.matches` in
  `manifest.json` and reload the extension.

## Files

- `background.js`: connection with the app (handshake, heartbeat, RPC), permissions, tab events,
  observation, actions, fullscreen and capture.
- `content.js`: registered after Browser access is granted. Reads the page and performs page and
  video actions.
- `announce.js`: tells the SAGE page this extension's id, in case it differs from the default.
- `permissions.html` / `permissions.js`: explains each permission and requests it. Chrome only
  allows that from a click inside an extension page.
- `popup.html` / `popup.js`: link status, the tab SAGE is working in, and permission buttons.
