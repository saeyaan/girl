<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/7b22ed58-bbe9-4d04-a87b-47c648e43599

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
4. Load the browser extension from [chrome-extension/](chrome-extension/README.md), open the app,
   and click **Enable Browser Access**. The top-right status shows 🟢 **Extension Online** when
   everything is linked.

Tests: `npm test` · Type-check: `npm run lint`

## How SAGE works

```
voice/text ─▶ /api/chat ─▶ SageAgent ─▶ tools ─▶ bridge ─ws─▶ SAGE app page ─runtime port─▶ extension ─▶ page
                              ▲   │                                         (handshake + heartbeat)      │
                              │   └── working memory ◀──── observations + pushed tab/video/permission events
                              └── live plan + context to the UI (/ws?role=ui)
```

The app page holds the extension link (`chrome.runtime.connect`, allowed by the extension's
`externally_connectable`), so the status you see is the real state of that link.

- **Observe → think → act → verify.** Each turn begins with a fresh look at the working tab. Gemini
  then calls structured tools one at a time (`web_search`, `open_result`, `switch_search_filter`,
  `media_control`, `click_element`, …). Each tool acts through the extension, waits for the page to
  settle, observes it again and returns the verified result to the model, which continues until the
  goal is done ([server/agent/agentLoop.ts](server/agent/agentLoop.ts), [tools.ts](server/agent/tools.ts)).
- **Working memory** ([server/agent/workingMemory.ts](server/agent/workingMemory.ts)) holds the
  current objective, the working tab, the last search and its real results, what has been watched,
  the verified video state and any pending confirmation. That is how "open the second one", "play
  it", "skip 30 seconds" and "find something more advanced" work without repeating context. It is
  separate from long-term personal memory (`memoryStore`).
- **Fast path.** Short, unambiguous follow-ups ("pause", "go back", "the third one", "videos tab")
  skip the model round trip but still run through the same verified tools
  ([server/agent/fastPath.ts](server/agent/fastPath.ts)).
- **Safety gate.** Purchases, payments, sending, posting, deleting and account changes are blocked
  in code until you say yes ([server/agent/safety.ts](server/agent/safety.ts)).
- **Fallbacks.** Without an API key, SAGE uses the deterministic parsers and template plans, still
  executed and verified for real. Without the extension, SAGE opens links in a new tab and says
  clearly that it can't see or control the page.
