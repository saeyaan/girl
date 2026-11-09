/**
 * SAGE tool layer: structured function declarations for the model plus an executor that performs
 * each action through the browser bridge, waits for the page to settle, observes it again and
 * reports what actually happened (OBSERVE → ACT → VERIFY).
 */

import { Type, type FunctionDeclaration } from '@google/genai';
import { normalizeUrlOrSearch } from '../../src/utils/browserCommands.ts';
import type { MediaSnapshot, PageElement, PageSnapshot, SearchResultItem } from '../../src/utils/browserContextManager.ts';
import { BridgeError, type BrowserBridge } from './browserBridge.ts';
import { classifyRisk, matchesPending } from './safety.ts';
import { normalizeVideoUrl, truncate, type WorkingMemory } from './workingMemory.ts';

// -----------------------------------------------------------------------------
// Declarations (what the model can call)
// -----------------------------------------------------------------------------

export const MEDIA_ACTIONS = [
  'play',
  'pause',
  'seek',
  'seek_to',
  'speed',
  'volume_up',
  'volume_down',
  'volume_set',
  'mute',
  'unmute',
  'next',
  'prev',
  'fullscreen',
  'exit_fullscreen',
] as const;
export type MediaAction = (typeof MEDIA_ACTIONS)[number];

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'get_active_tab',
    description:
      'Which tab is focused in the browser right now and which tab SAGE is working in (title, URL, website), plus the open tabs. Use for "what is open in my browser?". If the focused tab is the SAGE app itself, describe the working tab.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'get_current_page_context',
    description:
      'Read the working tab again: URL, title, website, visible text, selected text, search query and results, filter tabs, links/buttons/inputs with ids, and video state. Use when the context may be stale.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'capture_visible_screen',
    description:
      'Take a screenshot of the visible part of the working tab and look at it, together with the page structure. Only for visual questions ("what is on my screen?", "where is the Videos tab?", "what does this look like?"). Only works if the user enabled screen capture.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'search_current_website',
    description: "Search within the current website using its own search box (e.g. search Amazon or Wikipedia while it's open). Falls back to a Google site: search.",
    parameters: {
      type: Type.OBJECT,
      properties: { query: { type: Type.STRING } },
      required: ['query'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web. Use engine "youtube" when the user wants videos/tutorials/music to watch, otherwise "google". Reuses the working tab.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Search query, rewritten to capture what the user actually wants' },
        engine: { type: Type.STRING, enum: ['google', 'youtube'], description: 'Search engine' },
        new_tab: { type: Type.BOOLEAN, description: 'Only true if the user asked for a new tab' },
      },
      required: ['query', 'engine'],
    },
  },
  {
    name: 'create_new_tab',
    description: 'Open a URL or well-known site in a new tab and make it the working tab.',
    parameters: {
      type: Type.OBJECT,
      properties: { url: { type: Type.STRING } },
      required: ['url'],
    },
  },
  {
    name: 'open_url',
    description: 'Open a website or URL (e.g. https://mail.google.com). Reuses the working tab unless new_tab is true.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: { type: Type.STRING, description: 'Full URL or a well-known site name' },
        new_tab: { type: Type.BOOLEAN, description: 'Only true if the user asked for a new tab' },
      },
      required: ['url'],
    },
  },
  {
    name: 'open_result',
    description: 'Open one of the results listed on the current page (search results, or related videos on a watch page). position is 1-based ("the second one" = 2). Set skip_watched to pick the first result at or after position that has not been watched this session ("find another one").',
    parameters: {
      type: Type.OBJECT,
      properties: {
        position: { type: Type.INTEGER, description: '1-based position in the result list; -1 for the last one' },
        skip_watched: { type: Type.BOOLEAN },
      },
      required: ['position'],
    },
  },
  {
    name: 'switch_search_filter',
    description: 'Switch the current Google results page to a filter tab such as Videos, Images, News or Shopping, keeping the same query.',
    parameters: {
      type: Type.OBJECT,
      properties: { name: { type: Type.STRING, description: 'Filter tab name, e.g. "Videos"' } },
      required: ['name'],
    },
  },
  {
    name: 'click_element',
    description:
      'Click an interactive element: by its id from the latest observation (e.g. "e12"), or by a description of its visible label and role (e.g. "Subscribe button", "Images tab"). Purchases, sending, posting, deleting and account changes are blocked until the user confirms.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        element_id: { type: Type.STRING, description: 'Element id from the observation (preferred)' },
        description: { type: Type.STRING, description: 'Visible label/role when no id is known' },
      },
    },
  },
  {
    name: 'type_text',
    description: 'Type into an input from the latest observation (e.g. a site search box). submit=true presses Enter/submits. Never use for passwords.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        element_id: { type: Type.STRING },
        text: { type: Type.STRING },
        submit: { type: Type.BOOLEAN },
      },
      required: ['element_id', 'text'],
    },
  },
  {
    name: 'navigate_back',
    description: 'Go back to the previous page in the working tab.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'navigate_forward',
    description: 'Go forward in the working tab history.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'switch_tab',
    description: 'Make another open tab the working tab (by tab id from the context).',
    parameters: {
      type: Type.OBJECT,
      properties: { tab_id: { type: Type.INTEGER } },
      required: ['tab_id'],
    },
  },
  {
    name: 'scroll_page',
    description: 'Scroll the working tab to reveal more results or content.',
    parameters: {
      type: Type.OBJECT,
      properties: { direction: { type: Type.STRING, enum: ['down', 'up', 'top'] } },
      required: ['direction'],
    },
  },
  {
    name: 'play_video',
    description: 'Play (or resume) the video in the working tab and confirm it is actually playing.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'pause_video',
    description: 'Pause the video in the working tab and confirm it paused.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'get_video_status',
    description: 'Read the live state of the video in the working tab: title, playing/paused/buffering, time, duration, volume, speed, fullscreen.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'media_control',
    description:
      'Control the video in the working tab and get its verified state back. seek: value = seconds relative (+30 / -10). seek_to: absolute seconds. speed: value = rate (0.25-4). volume_set: value 0-100. volume_up/down: value = percent step (default 15). next/prev: next or previous video.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, enum: [...MEDIA_ACTIONS] },
        value: { type: Type.NUMBER },
      },
      required: ['action'],
    },
  },
  {
    name: 'ask_user',
    description: 'Ask the user a short clarifying question when essential information is missing or the reference is genuinely ambiguous. Ends your turn.',
    parameters: {
      type: Type.OBJECT,
      properties: { question: { type: Type.STRING } },
      required: ['question'],
    },
  },
  {
    name: 'request_confirmation',
    description: 'Ask the user to explicitly approve a sensitive action (purchase, payment, sending a message, posting, account change, deleting, submitting an important form). Ends your turn.',
    parameters: {
      type: Type.OBJECT,
      properties: { summary: { type: Type.STRING, description: 'Spoken question describing exactly what will happen' } },
      required: ['summary'],
    },
  },
  {
    name: 'save_memory',
    description: 'Save a lasting personal fact or preference about the user to long-term memory (not temporary browsing state).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        category: { type: Type.STRING, enum: ['profile', 'preference', 'fact', 'task'] },
        key: { type: Type.STRING },
        value: { type: Type.STRING },
        tags: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['category', 'key', 'value'],
    },
  },
  {
    name: 'finish',
    description: 'End your turn with the short spoken reply for the user. Only describe outcomes the tool results verified.',
    parameters: {
      type: Type.OBJECT,
      properties: { reply: { type: Type.STRING } },
      required: ['reply'],
    },
  },
];

export const TERMINAL_TOOLS = new Set(['finish', 'ask_user', 'request_confirmation']);
/** Tools that only look; they are not shown as plan steps or logged as actions. */
export const READ_ONLY_TOOLS = new Set(['observe_page', 'get_current_page_context', 'get_active_tab', 'get_video_status', 'capture_visible_screen', 'save_memory']);

// -----------------------------------------------------------------------------
// Executor
// -----------------------------------------------------------------------------

export interface ToolResult {
  ok: boolean;
  /** True when the outcome was confirmed by reading the page back. */
  verified?: boolean;
  message: string;
  errorCode?: string;
  terminal?: 'finish' | 'ask_user' | 'request_confirmation';
  reply?: string;
  snapshot?: PageSnapshot | null;
  media?: MediaSnapshot | null;
  /** When the extension is offline, the web app opens this URL itself. */
  fallbackOpenUrl?: string;
  savedMemory?: unknown;
  /** Screenshot for the model (capture_visible_screen). Never stored. */
  image?: { mimeType: string; data: string };
}

export interface ScreenCaptureNotice {
  tabId: number;
  url: string;
  title: string;
  at: number;
}

export interface ExecutorOptions {
  useDebuggerFullscreen?: boolean;
  /** The user enabled visual observation in SAGE settings. */
  allowScreenCapture?: boolean;
  /** Called whenever a screenshot is taken, so the UI can tell the user. */
  onScreenCapture?: (n: ScreenCaptureNotice) => void;
  /** The user's latest turn approved the pending sensitive action. Consumed by the first gated action. */
  approvalGranted?: boolean;
  saveMemory?: (m: { category: string; key: string; value: string; tags: string[] }) => unknown;
}

const TIMEOUTS = { observe: 12000, navigate: 25000, action: 12000, media: 15000 };

export class ToolExecutor {
  private failures = new Map<string, number>();
  private approval: boolean;

  constructor(
    private readonly bridge: BrowserBridge,
    private readonly wm: WorkingMemory,
    private readonly opts: ExecutorOptions = {}
  ) {
    this.approval = Boolean(opts.approvalGranted);
  }

  async execute(name: string, rawArgs: Record<string, unknown> = {}): Promise<ToolResult> {
    const args = rawArgs || {};
    const key = `${name}:${JSON.stringify(args)}`;
    if ((this.failures.get(key) || 0) >= 2) {
      return {
        ok: false,
        errorCode: 'repeated_failure',
        message: 'This exact action already failed twice. Do not retry it; try a different approach or tell the user what went wrong.',
      };
    }

    let result: ToolResult;
    try {
      result = await this.dispatch(name, args);
    } catch (err) {
      result = this.fromError(err);
    }

    if (!TERMINAL_TOOLS.has(name) && !READ_ONLY_TOOLS.has(name)) {
      this.wm.recordAction(name, args, result.ok, result.message);
    }
    if (!result.ok) this.failures.set(key, (this.failures.get(key) || 0) + 1);
    return result;
  }

  private async dispatch(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (name) {
      case 'observe_page':
      case 'get_current_page_context':
        return this.observePage();
      case 'get_active_tab':
        return this.getActiveTab();
      case 'capture_visible_screen':
        return this.captureScreen();
      case 'search_current_website':
        return this.searchCurrentWebsite(String(args.query || ''));
      case 'create_new_tab':
        return this.openUrl(String(args.url || ''), true);
      case 'navigate_back':
        return this.navigate('back');
      case 'navigate_forward':
        return this.navigate('forward');
      case 'scroll_page':
        return this.scroll(String(args.direction || 'down'));
      case 'play_video':
        return this.media('play');
      case 'pause_video':
        return this.media('pause');
      case 'get_video_status':
        return this.videoStatus();
      case 'web_search':
        return this.webSearch(String(args.query || ''), args.engine === 'youtube' ? 'youtube' : 'google', Boolean(args.new_tab));
      case 'open_url':
        return this.openUrl(String(args.url || ''), Boolean(args.new_tab));
      case 'open_result':
        return this.openResult(Number(args.position ?? 1), Boolean(args.skip_watched));
      case 'switch_search_filter':
        return this.switchFilter(String(args.name || ''));
      case 'click_element':
        return this.click(String(args.element_id || ''), String(args.description || ''));
      case 'type_text':
        return this.typeText(String(args.element_id || ''), String(args.text ?? ''), Boolean(args.submit), args);
      case 'navigate':
        return this.navigate(String(args.direction || 'back'));
      case 'switch_tab':
        return this.switchTab(Number(args.tab_id));
      case 'scroll':
        return this.scroll(String(args.direction || 'down'));
      case 'media_control':
        return this.media(String(args.action || '') as MediaAction, args.value === undefined ? undefined : Number(args.value));
      case 'ask_user': {
        const q = String(args.question || '').trim();
        this.wm.pendingQuestion = q;
        return { ok: true, message: 'asked', terminal: 'ask_user', reply: q };
      }
      case 'request_confirmation': {
        const summary = String(args.summary || '').trim();
        if (!this.wm.pendingConfirmation) {
          this.wm.pendingConfirmation = { tool: '', args: {}, summary, createdAt: Date.now() };
        } else {
          this.wm.pendingConfirmation.summary = summary || this.wm.pendingConfirmation.summary;
        }
        return { ok: true, message: 'awaiting confirmation', terminal: 'request_confirmation', reply: summary };
      }
      case 'save_memory': {
        if (!this.opts.saveMemory) return { ok: false, message: 'Memory storage unavailable' };
        const saved = this.opts.saveMemory({
          category: String(args.category || 'fact'),
          key: String(args.key || ''),
          value: String(args.value || ''),
          tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
        });
        return { ok: true, message: `Saved "${args.key}" to long-term memory`, savedMemory: saved };
      }
      case 'finish':
        return { ok: true, message: 'done', terminal: 'finish', reply: String(args.reply || '').trim() };
      default:
        return { ok: false, errorCode: 'unknown_tool', message: `Unknown tool "${name}"` };
    }
  }

  // --- observation ----------------------------------------------------------

  async observe(waitFor?: 'results' | 'video' | null, tabId?: number | null): Promise<PageSnapshot> {
    const snap = await this.bridge.call<PageSnapshot>(
      'observe',
      { tabId: tabId ?? this.wm.workingTabId, waitFor: waitFor || null },
      TIMEOUTS.observe
    );
    this.wm.applySnapshot(snap);
    return snap;
  }

  /** Latest snapshot of the working tab, re-observing if it is missing or stale. */
  private async freshSnapshot(maxAgeMs = 4000): Promise<PageSnapshot> {
    const s = this.wm.lastSnapshot;
    if (s && s.tabId === this.wm.workingTabId && s.at > 0 && Date.now() - s.at < maxAgeMs) return s;
    return this.observe();
  }

  private async observePage(): Promise<ToolResult> {
    if (!this.bridge.isConnected()) return this.offline();
    const snap = await this.observe();
    const note = snap.access && snap.access !== 'full' ? ` (${accessExplanation(snap.access)})` : '';
    return { ok: true, verified: true, message: `Read "${truncate(snap.title, 80)}" on ${siteOf(snap.url)}${note}`, snapshot: snap };
  }

  private async getActiveTab(): Promise<ToolResult> {
    if (!this.bridge.isConnected()) return this.offline();
    type TabDesc = { id: number; url: string; title: string; site: string; isSageApp: boolean; readable: boolean } | null;
    const res = await this.bridge.call<{ focusedTab: TabDesc; workingTab: TabDesc; tabs: any[] }>('get_active_tab', {}, TIMEOUTS.action);
    if (Array.isArray(res.tabs)) this.wm.applyEvent({ event: 'tabs', data: { tabs: res.tabs } });
    if (res.workingTab && !res.workingTab.isSageApp) this.wm.workingTabId = res.workingTab.id;
    const d = (t: TabDesc) => (t ? `"${truncate(t.title, 90)}" on ${t.site || t.url} (tab #${t.id})` : 'none');
    const parts = [
      `Focused tab: ${d(res.focusedTab)}${res.focusedTab?.isSageApp ? ' — this is the SAGE app itself' : ''}`,
      `Working tab (what the user was last looking at besides SAGE): ${d(res.workingTab)}`,
      `${res.tabs?.length || 0} other open tab(s): ${(res.tabs || []).slice(0, 8).map((t: any) => `"${truncate(t.title, 40)}"`).join(', ')}`,
    ];
    return { ok: true, verified: true, message: parts.join('\n') };
  }

  private async captureScreen(): Promise<ToolResult> {
    if (!this.opts.allowScreenCapture) {
      return {
        ok: false,
        errorCode: 'screen_capture_disabled',
        message: 'Screen capture is turned off in SAGE settings. Answer from the page text instead, or tell the user they can enable "Visual observation" in settings.',
      };
    }
    if (!this.bridge.isConnected()) return this.offline();
    const res = await this.bridge.call<{ ok: boolean; error?: string; data?: string; mimeType?: string; tabId?: number; url?: string; title?: string; at?: number; activated?: boolean }>(
      'capture',
      { tabId: this.wm.workingTabId },
      TIMEOUTS.action
    );
    if (!res?.ok || !res.data) {
      const why =
        res?.error === 'screen_permission_required'
          ? 'the extension has not been granted screen capture yet. Tell the user to press "Capture visible screen" in the Browser panel (or the SAGE extension popup) and allow it.'
          : res?.error === 'restricted_page'
          ? 'Chrome does not allow capturing this kind of page.'
          : res?.error || 'unknown error';
      return { ok: false, errorCode: res?.error || 'capture_failed', message: `Could not capture the screen: ${why}` };
    }
    this.opts.onScreenCapture?.({ tabId: res.tabId!, url: res.url || '', title: res.title || '', at: res.at || Date.now() });
    let snapshot: PageSnapshot | null = null;
    try {
      snapshot = await this.observe(null, res.tabId);
    } catch {}
    return {
      ok: true,
      verified: true,
      message: `Captured the visible screen of "${truncate(res.title || '', 80)}"${res.activated ? ' (switched to that tab to capture it)' : ''}. The screenshot is attached; combine it with the page structure.`,
      image: { mimeType: res.mimeType || 'image/jpeg', data: res.data },
      snapshot,
    };
  }

  private async searchCurrentWebsite(query: string): Promise<ToolResult> {
    query = query.trim();
    if (!query) return { ok: false, errorCode: 'bad_args', message: 'Search query is empty' };
    if (!this.bridge.isConnected()) return this.offline();
    const snap = await this.freshSnapshot();
    if (snap.pageKind.startsWith('youtube')) return this.webSearch(query, 'youtube', false);
    if (snap.pageKind.startsWith('google')) return this.webSearch(query, 'google', false);
    const res = await this.bridge.call<{ ok: boolean; error?: string }>('site_search', { tabId: snap.tabId, query }, TIMEOUTS.navigate);
    if (res?.ok) {
      const after = await this.observe('results', snap.tabId);
      return { ok: true, verified: true, message: `Searched ${siteOf(snap.url)} for "${query}"; now on "${truncate(after.title, 80)}" with ${after.results.length} results`, snapshot: after };
    }
    if (res?.error === 'permission_required') return this.permissionRequired();
    // No usable search box: search the site through Google instead.
    const site = siteOf(snap.url);
    const viaGoogle = await this.webSearch(site ? `site:${site} ${query}` : query, 'google', false);
    return { ...viaGoogle, message: `${site || 'This page'} has no usable search box, so I searched it through Google. ${viaGoogle.message}` };
  }

  private async videoStatus(): Promise<ToolResult> {
    if (!this.bridge.isConnected()) return this.offline();
    const snap = await this.observe('video');
    if (!snap.media || !snap.media.present) {
      if (snap.access === 'permission_required') return this.permissionRequired();
      return { ok: false, errorCode: 'no_video', message: 'No video player is detected in the working tab.', snapshot: snap };
    }
    const m = snap.media;
    return {
      ok: true,
      verified: true,
      message: `Video "${truncate(m.title, 90)}": ${m.paused ? 'PAUSED' : m.buffering ? 'BUFFERING' : 'PLAYING'} at ${fmt(m.currentTime)} of ${fmt(m.duration)}, speed ${m.playbackRate}x, volume ${Math.round(m.volume * 100)}%${m.muted ? ' (muted)' : ''}${m.fullscreen || m.maximized ? ', fullscreen' : ''}`,
      media: m,
      snapshot: snap,
    };
  }

  private permissionRequired(): ToolResult {
    return {
      ok: false,
      errorCode: 'permission_required',
      message: 'SAGE can see this tab’s title and address but has no permission to read or act on the page. Ask the user to click "Enable Browser Access" in SAGE.',
    };
  }

  // --- navigation -----------------------------------------------------------

  private async webSearch(query: string, engine: 'google' | 'youtube', newTab: boolean): Promise<ToolResult> {
    query = query.trim();
    if (!query) return { ok: false, errorCode: 'bad_args', message: 'Search query is empty' };
    const url =
      engine === 'youtube'
        ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
        : `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    if (!this.bridge.isConnected()) {
      return { ...this.offline(), ok: true, fallbackOpenUrl: url, message: `Opened the ${engine} search in a new tab (extension offline: SAGE cannot read the results)` };
    }
    const snap = await this.goTo(url, newTab, 'results');
    if (snap.pageKind === 'captcha') {
      return {
        ok: false,
        errorCode: 'captcha',
        message: `${engine === 'youtube' ? 'YouTube' : 'Google'} is showing a "verify you are human" check instead of results. The user must complete it in the tab; SAGE must not.`,
        snapshot: snap,
      };
    }
    this.wm.lastSearch = {
      query,
      engine,
      results: snap.results,
      tabId: snap.tabId,
      url: snap.url,
      at: snap.at,
    };
    this.wm.selectedResult = null;
    this.wm.referencedResult = null;
    const count = snap.results.length;
    return {
      ok: true,
      verified: count > 0,
      message:
        count > 0
          ? `Searched ${engine === 'youtube' ? 'YouTube' : 'Google'} for "${query}"; ${count} results visible`
          : snap.access === 'permission_required'
          ? `Opened the ${engine} search for "${query}", but SAGE cannot read the results without browser access permission (ask the user to click "Enable Browser Access")`
          : `Opened the ${engine} results page for "${query}" but could not read any results yet`,
      snapshot: snap,
    };
  }

  private async openUrl(input: string, newTab: boolean): Promise<ToolResult> {
    if (!input.trim()) return { ok: false, errorCode: 'bad_args', message: 'URL is empty' };
    const { url, title } = normalizeUrlOrSearch(input);
    const risk = classifyRisk('open_url', { url }, undefined, undefined);
    if (risk.level === 'needs_confirmation') {
      return { ok: false, errorCode: 'blocked_url', message: `Refused to open: ${risk.reason}` };
    }
    if (!this.bridge.isConnected()) {
      return { ...this.offline(), ok: true, fallbackOpenUrl: url, message: `Opened ${title} in a new tab (extension offline: SAGE cannot see the page)` };
    }
    const snap = await this.goTo(url, newTab, expectationFor(url));
    const verified = sameSite(snap.url, url);
    let message = `Opened "${truncate(snap.title || title, 80)}" (${snap.url})`;
    if (snap.auth.needsLogin) message += '. The page is asking the user to sign in; SAGE must not enter credentials.';
    else if (!verified) message += ` — note: ended up on a different site than requested`;
    return { ok: true, verified, message, snapshot: snap };
  }

  private async openResult(position: number, skipWatched: boolean): Promise<ToolResult> {
    if (!this.bridge.isConnected()) return this.offline();
    let results: SearchResultItem[] = [];
    try {
      const snap = await this.freshSnapshot();
      results = snap.results;
    } catch {}
    if (results.length === 0) results = this.wm.currentResults();
    if (results.length === 0) {
      return { ok: false, errorCode: 'no_results', message: 'There are no results on the current page to open. Search first or ask the user what to open.' };
    }
    let idx = position === -1 ? results.length - 1 : Math.max(0, Math.floor(position) - 1);
    if (idx >= results.length) {
      return { ok: false, errorCode: 'out_of_range', message: `Only ${results.length} results are visible; there is no #${position}.` };
    }
    if (skipWatched) {
      const next = results.findIndex((r, i) => i >= idx && !this.wm.hasWatched(r.url) && r.url !== this.wm.media?.url);
      if (next === -1) {
        return { ok: false, errorCode: 'all_watched', message: 'Every visible result has already been watched this session. Try scrolling or a new search.' };
      }
      idx = next;
    }
    const item = results[idx];
    const snap = await this.goTo(item.url, false, expectationFor(item.url));
    this.wm.selectedResult = { ...item, index: idx };
    const verified = sameVideoOrPage(snap.url, item.url);
    return {
      ok: true,
      verified,
      message: `Opened result #${idx + 1}: "${truncate(item.title, 100)}"${snap.media?.present ? ` — video player found (${snap.media.paused ? 'paused' : 'playing'})` : ''}`,
      snapshot: snap,
      media: snap.media,
    };
  }

  private async switchFilter(name: string): Promise<ToolResult> {
    if (!this.bridge.isConnected()) return this.offline();
    const snap = await this.freshSnapshot();
    const wanted = name.trim().toLowerCase().replace(/\s+tab$/, '');
    const isGoogle = snap.pageKind === 'google_serp' || snap.pageKind === 'google_videos';
    const tab = snap.filterTabs.find((f) => {
      const n = f.name.toLowerCase();
      return n === wanted || n.startsWith(wanted) || wanted.startsWith(n);
    });

    let after: PageSnapshot | null = null;
    if (tab) {
      if (tab.selected) return { ok: true, verified: true, message: `Already on the ${tab.name} tab`, snapshot: snap };
      try {
        await this.bridge.call('page_action', { tabId: snap.tabId, action: 'click', args: { elementId: tab.elementId } }, TIMEOUTS.navigate);
        after = await this.observe('results', snap.tabId);
      } catch {
        after = null;
      }
    }
    if ((!after || !filterApplied(after, wanted)) && isGoogle) {
      const query = snap.query || this.wm.lastSearch?.query;
      const param = GOOGLE_FILTER_PARAMS[wanted.replace(/s$/, '')];
      if (query && param !== undefined) {
        after = await this.goTo(`https://www.google.com/search?q=${encodeURIComponent(query)}${param}`, false, 'results');
      }
    }
    if (!after) {
      return { ok: false, errorCode: 'no_filter_tab', message: `This page (${snap.pageKind}) has no "${name}" tab.` };
    }
    const ok = filterApplied(after, wanted);
    if (ok && after.results.length > 0) {
      this.wm.lastSearch = {
        query: after.query || this.wm.lastSearch?.query || '',
        engine: 'google',
        results: after.results,
        tabId: after.tabId,
        url: after.url,
        at: after.at,
      };
    }
    return {
      ok,
      verified: ok,
      message: ok ? `Switched to the ${name} tab; ${after.results.length} results visible` : `Tried to switch to ${name} but the page did not change`,
      snapshot: after,
    };
  }

  // --- page interaction -----------------------------------------------------

  private async click(elementId: string, description: string): Promise<ToolResult> {
    if (!this.bridge.isConnected()) return this.offline();
    const snap = await this.freshSnapshot(15000);
    if (snap.access === 'permission_required') return this.permissionRequired();
    let el = elementId ? findElement(snap, elementId) : undefined;
    if (!el && (description || elementId)) {
      const match = matchElementByDescription(snap, description || elementId);
      if (match.kind === 'ambiguous') {
        return { ok: false, errorCode: 'ambiguous_element', message: `Several elements match "${description}": ${match.candidates.map((c) => `${c.id} "${c.label}"`).join(', ')}. Pick one by id.` };
      }
      if (match.kind === 'found') el = match.element;
    }
    if (!el) {
      return {
        ok: false,
        errorCode: 'unknown_element',
        message: `No element matching "${elementId || description}" in the latest observation. Call get_current_page_context and use an id from it.`,
      };
    }
    elementId = el.id;
    const gate = this.gate('click_element', { element_id: elementId }, el, snap.url);
    if (gate) return gate;

    const res = await this.bridge.call<{ ok: boolean; error?: string; navigated?: boolean }>(
      'page_action',
      { tabId: snap.tabId, action: 'click', args: { elementId } },
      TIMEOUTS.navigate
    );
    if (res?.error === 'permission_required') return this.permissionRequired();
    if (!res?.ok) return { ok: false, errorCode: res?.error || 'click_failed', message: `Could not click "${el.label}": ${res?.error || 'unknown error'}` };
    const after = await this.observe(null, snap.tabId);
    return {
      ok: true,
      verified: true,
      message: `Clicked "${truncate(el.label, 60)}"${res.navigated || after.url !== snap.url ? `; now on "${truncate(after.title, 60)}"` : ''}`,
      snapshot: after,
    };
  }

  private async typeText(elementId: string, text: string, submit: boolean, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.bridge.isConnected()) return this.offline();
    const snap = await this.freshSnapshot(15000);
    const el = findElement(snap, elementId);
    if (!el) {
      return { ok: false, errorCode: 'unknown_element', message: `No element "${elementId}" in the latest observation. Call observe_page first.` };
    }
    const gate = this.gate('type_text', { element_id: elementId, text, submit }, el, snap.url);
    if (gate) return gate;
    const res = await this.bridge.call<{ ok: boolean; error?: string }>(
      'page_action',
      { tabId: snap.tabId, action: 'type', args: { elementId, text, submit } },
      TIMEOUTS.navigate
    );
    if (res?.error === 'permission_required') return this.permissionRequired();
    if (!res?.ok) return { ok: false, errorCode: res?.error || 'type_failed', message: `Could not type into "${el.label}": ${res?.error || 'unknown error'}` };
    const after = await this.observe(submit ? 'results' : null, snap.tabId);
    return {
      ok: true,
      verified: true,
      message: `Typed "${truncate(text, 60)}" into "${truncate(el.label, 40)}"${submit ? ' and submitted' : ''}; page: "${truncate(after.title, 60)}"`,
      snapshot: after,
    };
  }

  private async navigate(direction: string): Promise<ToolResult> {
    if (!this.bridge.isConnected()) return this.offline();
    if (this.wm.workingTabId === null) return { ok: false, errorCode: 'no_tab', message: 'There is no working tab to navigate.' };
    const before = this.wm.lastSnapshot?.url;
    const res = await this.bridge.call<{ ok: boolean; error?: string }>(
      'navigate',
      { tabId: this.wm.workingTabId, direction },
      TIMEOUTS.navigate
    );
    if (!res?.ok) return { ok: false, errorCode: res?.error || 'navigate_failed', message: `Could not go ${direction}: ${res?.error || 'no history'}` };
    const snap = await this.observe(null);
    const changed = direction === 'reload' || snap.url !== before;
    return {
      ok: changed,
      verified: changed,
      message: changed ? `Went ${direction} to "${truncate(snap.title, 80)}"` : `Went ${direction} but the page did not change (no history?)`,
      snapshot: snap,
    };
  }

  private async switchTab(tabId: number): Promise<ToolResult> {
    if (!this.bridge.isConnected()) return this.offline();
    if (!Number.isFinite(tabId)) return { ok: false, errorCode: 'bad_args', message: 'tab_id is required' };
    const res = await this.bridge.call<{ ok: boolean; error?: string }>('activate_tab', { tabId }, TIMEOUTS.action);
    if (!res?.ok) return { ok: false, errorCode: 'no_such_tab', message: `Tab #${tabId} is not open` };
    this.wm.workingTabId = tabId;
    const snap = await this.observe(null, tabId);
    return { ok: true, verified: true, message: `Switched to "${truncate(snap.title, 80)}"`, snapshot: snap };
  }

  private async scroll(direction: string): Promise<ToolResult> {
    if (!this.bridge.isConnected()) return this.offline();
    if (this.wm.workingTabId === null) return { ok: false, errorCode: 'no_tab', message: 'There is no working tab.' };
    await this.bridge.call('page_action', { tabId: this.wm.workingTabId, action: 'scroll', args: { direction } }, TIMEOUTS.action);
    const snap = await this.observe(null);
    return { ok: true, verified: true, message: `Scrolled ${direction}; ${snap.results.length} results visible`, snapshot: snap };
  }

  // --- media ----------------------------------------------------------------

  private async media(action: MediaAction, value?: number): Promise<ToolResult> {
    if (!MEDIA_ACTIONS.includes(action)) return { ok: false, errorCode: 'bad_args', message: `Unknown media action "${action}"` };
    if (!this.bridge.isConnected()) return this.offline();

    let tabId = this.wm.media?.tabId ?? this.wm.workingTabId;
    if (!this.wm.hasActiveMedia()) {
      try {
        const snap = await this.observe('video');
        tabId = snap.tabId;
      } catch {}
    }
    if (!this.wm.hasActiveMedia() || tabId === null) {
      if (this.wm.lastSnapshot?.access === 'permission_required') return this.permissionRequired();
      const results = this.wm.currentResults().length;
      return {
        ok: false,
        errorCode: 'no_video',
        message:
          results > 0
            ? `No video is open yet; ${results} results are listed. Open one first (or ask which one if it is ambiguous).`
            : 'No video player was found in the working tab.',
      };
    }

    const res = await this.bridge.call<{
      ok: boolean;
      verified?: boolean;
      error?: string;
      media?: MediaSnapshot | null;
      mode?: 'window' | 'native' | 'none';
      navigated?: boolean;
      note?: string;
    }>(
      'media',
      { tabId, action, value, fullscreenMode: this.opts.useDebuggerFullscreen ? 'debugger' : 'auto' },
      TIMEOUTS.media
    );

    if (res?.error === 'permission_required') return this.permissionRequired();
    if (res?.media) {
      this.wm.applyEvent({ event: 'media_state', data: { tabId, media: res.media, url: this.wm.media?.url } });
    }
    if (action === 'fullscreen' && res?.ok) this.wm.fullscreenMode = res.mode === 'native' ? 'native' : 'window';
    if (action === 'exit_fullscreen' && res?.ok) this.wm.fullscreenMode = 'none';

    let snapshot: PageSnapshot | null = null;
    if (res?.navigated || action === 'next' || action === 'prev') {
      snapshot = await this.observe('video', tabId);
    }

    if (!res?.ok) {
      const why =
        res?.error === 'blocked_by_autoplay'
          ? 'The browser blocked playback (autoplay policy). The user needs to click the video once, then voice control works.'
          : res?.error === 'buffering'
          ? 'Play was requested but the video is still buffering; playback is not confirmed yet.'
          : res?.error || 'unknown error';
      return { ok: false, verified: false, errorCode: res?.error || 'media_failed', message: `${action} failed: ${why}`, media: res?.media ?? null, snapshot };
    }
    const m = res.media || this.wm.media;
    return {
      ok: true,
      verified: Boolean(res.verified),
      message: describeMediaOutcome(action, m, snapshot, res.mode, res.note, Boolean(res.verified)),
      media: m ?? null,
      snapshot,
    };
  }

  // --- helpers --------------------------------------------------------------

  /** Navigate the working tab (or a new one) and return the settled observation. */
  private async goTo(url: string, newTab: boolean, waitFor: 'results' | 'video' | null): Promise<PageSnapshot> {
    const useNew = newTab || this.wm.workingTabId === null;
    const res = await this.bridge.call<{ tabId: number }>(
      'open_url',
      { url, tabId: useNew ? null : this.wm.workingTabId, newTab: useNew },
      TIMEOUTS.navigate
    );
    this.wm.workingTabId = res.tabId;
    return this.observe(waitFor, res.tabId);
  }

  private gate(tool: string, args: Record<string, unknown>, el: PageElement, pageUrl: string): ToolResult | null {
    const risk = classifyRisk(tool, args, el, pageUrl);
    if (risk.level === 'safe') return null;
    if (this.approval && (matchesPending(this.wm.pendingConfirmation, tool, args) || !this.wm.pendingConfirmation?.tool)) {
      this.approval = false; // one approval = one sensitive action
      this.wm.pendingConfirmation = null;
      return null;
    }
    this.wm.pendingConfirmation = {
      tool,
      args,
      summary: `${tool === 'click_element' ? `click "${el.label}"` : `submit "${String(args.text)}" in "${el.label}"`} (${risk.reason})`,
      createdAt: Date.now(),
    };
    return {
      ok: false,
      errorCode: 'needs_confirmation',
      message: `Blocked until the user approves: ${risk.reason}. Call request_confirmation with a clear question; do not look for a workaround.`,
    };
  }

  private offline(): ToolResult {
    return {
      ok: false,
      errorCode: 'extension_offline',
      message: 'The SAGE Chrome extension is not connected, so SAGE cannot see or control browser pages. Tell the user to load/enable the extension.',
    };
  }

  private fromError(err: unknown): ToolResult {
    if (err instanceof BridgeError) {
      if (err.code === 'EXTENSION_OFFLINE') return this.offline();
      if (err.code === 'TIMEOUT') return { ok: false, errorCode: 'timeout', message: err.message };
      return { ok: false, errorCode: 'browser_error', message: err.message };
    }
    return { ok: false, errorCode: 'internal_error', message: err instanceof Error ? err.message : String(err) };
  }
}

// -----------------------------------------------------------------------------
// Pure helpers (exported for tests / prompt building)
// -----------------------------------------------------------------------------

const GOOGLE_FILTER_PARAMS: Record<string, string> = {
  all: '',
  video: '&tbm=vid',
  image: '&udm=2',
  new: '&tbm=nws',
  shopping: '&udm=28',
  book: '&tbm=bks',
};

function filterApplied(snap: PageSnapshot, wanted: string): boolean {
  const w = wanted.replace(/s$/, '');
  if (w === 'video') return snap.pageKind === 'google_videos';
  const sel = snap.filterTabs.find((f) => f.selected);
  if (sel) return sel.name.toLowerCase().startsWith(w);
  const param = GOOGLE_FILTER_PARAMS[w];
  return param ? snap.url.includes(param.slice(1)) : false;
}

export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function accessExplanation(access: NonNullable<PageSnapshot['access']>): string {
  switch (access) {
    case 'permission_required':
      return 'only the title and address are visible: browser access permission is not granted';
    case 'restricted':
      return 'browser-internal page that extensions cannot read';
    case 'unreadable':
      return 'this site does not let extensions read it';
    default:
      return '';
  }
}

/**
 * Resolve "the Subscribe button" / "Images tab" to an element from the observation by its visible
 * label (semantic match, never screen coordinates).
 */
export function matchElementByDescription(
  snap: PageSnapshot,
  description: string
): { kind: 'found'; element: PageElement } | { kind: 'ambiguous'; candidates: PageElement[] } | { kind: 'none' } {
  const roleWords: Record<string, string[]> = {
    button: ['button', 'btn'],
    link: ['link'],
    tab: ['tab', 'filter'],
    input: ['box', 'field', 'input', 'searchbox', 'search bar'],
  };
  let want = description.toLowerCase().replace(/^(?:the|a|an)\s+/, '').trim();
  let wantRole: string | null = null;
  for (const [role, words] of Object.entries(roleWords)) {
    for (const w of words) {
      const re = new RegExp(`\\s+${w}$`);
      if (re.test(want)) {
        wantRole = role;
        want = want.replace(re, '').trim();
      }
    }
  }
  if (!want) return { kind: 'none' };
  const pool: PageElement[] = [
    ...snap.filterTabs.filter((f) => f.elementId).map((f) => ({ id: f.elementId, role: 'tab', label: f.name })),
    ...snap.elements,
  ];
  const tokens = want.split(/\s+/).filter(Boolean);
  const scored = pool
    .map((el) => {
      const label = el.label.toLowerCase();
      let score = 0;
      if (label === want) score = 3;
      else if (label.startsWith(want)) score = 2;
      else if (label.includes(want)) score = 1.5;
      else score = tokens.filter((t) => label.includes(t)).length / tokens.length;
      if (wantRole && (el.role === wantRole || (wantRole === 'input' && ['input', 'textarea', 'combobox', 'searchbox'].includes(el.role)))) score += 0.5;
      return { el, score };
    })
    .filter((s) => s.score >= 0.75)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { kind: 'none' };
  const best = scored[0];
  const ties = scored.filter((s) => s.score === best.score && s.el.label.toLowerCase() !== best.el.label.toLowerCase());
  if (ties.length > 0 && best.score < 3) return { kind: 'ambiguous', candidates: [best.el, ...ties.map((t) => t.el)].slice(0, 5) };
  return { kind: 'found', element: best.el };
}

function findElement(snap: PageSnapshot, id: string): PageElement | undefined {
  const el = snap.elements.find((e) => e.id === id);
  if (el) return el;
  const tab = snap.filterTabs.find((f) => f.elementId === id);
  return tab ? { id, role: 'tab', label: tab.name } : undefined;
}

export function expectationFor(url: string): 'results' | 'video' | null {
  try {
    const u = new URL(url);
    if (/youtube\.com$/.test(u.hostname) && (u.pathname === '/watch' || u.pathname.startsWith('/shorts/'))) return 'video';
    if (u.hostname === 'youtu.be') return 'video';
    if (/vimeo\.com$/.test(u.hostname) && /^\/\d+/.test(u.pathname)) return 'video';
    if (/dailymotion\.com$/.test(u.hostname) && u.pathname.startsWith('/video/')) return 'video';
    if (/youtube\.com$/.test(u.hostname) && u.pathname === '/results') return 'results';
    if (/google\.[a-z.]+$/.test(u.hostname) && u.pathname === '/search') return 'results';
  } catch {}
  return null;
}

function sameSite(actual: string, requested: string): boolean {
  try {
    const a = new URL(actual).hostname.replace(/^www\./, '');
    const r = new URL(requested).hostname.replace(/^www\./, '');
    const base = (h: string) => h.split('.').slice(-2).join('.');
    return a === r || base(a) === base(r) || a.endsWith(`.${r}`);
  } catch {
    return false;
  }
}

function sameVideoOrPage(actual: string, requested: string): boolean {
  const a = normalizeVideoUrl(actual);
  const r = normalizeVideoUrl(requested);
  if (a && r) return a === r;
  return sameSite(actual, requested);
}

function fmt(sec: number | undefined): string {
  if (!sec || !Number.isFinite(sec)) return '0:00';
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

function describeMediaOutcome(
  action: MediaAction,
  m: MediaSnapshot | null | undefined,
  snap: PageSnapshot | null,
  mode: string | undefined,
  note: string | undefined,
  verified: boolean
): string {
  const v = verified ? 'verified' : 'NOT verified';
  const state = m ? `${m.paused ? 'paused' : 'playing'} at ${fmt(m.currentTime)}/${fmt(m.duration)}` : 'state unknown';
  const extra = note ? ` (${note})` : '';
  switch (action) {
    case 'play':
      return `Playback ${v}: ${state}${extra}`;
    case 'pause':
      return `Pause ${v}: ${state}${extra}`;
    case 'seek':
    case 'seek_to':
      return `Seek ${v}: now at ${fmt(m?.currentTime)}${extra}`;
    case 'speed':
      return `Speed ${v}: ${m?.playbackRate ?? '?'}x${extra}`;
    case 'volume_up':
    case 'volume_down':
    case 'volume_set':
      return `Volume ${v}: ${m ? Math.round(m.volume * 100) : '?'}%${m?.muted ? ' (muted)' : ''}${extra}`;
    case 'mute':
    case 'unmute':
      return `${action === 'mute' ? 'Mute' : 'Unmute'} ${v}${extra}`;
    case 'fullscreen':
      return `Fullscreen ${v} (${mode === 'native' ? 'true browser fullscreen' : 'window fullscreen with the player filling the screen'})${extra}`;
    case 'exit_fullscreen':
      return `Exited fullscreen (${v})${extra}`;
    case 'next':
    case 'prev':
      return `${action === 'next' ? 'Next' : 'Previous'} video: "${truncate(snap?.media?.title || snap?.title || m?.title || '', 80)}" ${state}${extra}`;
  }
}

/** Compact, model-readable rendering of a page observation. */
export function formatSnapshot(s: PageSnapshot | null | undefined): string {
  if (!s) return '(no observation)';
  const lines: string[] = [];
  lines.push(`Tab #${s.tabId}: "${truncate(s.title, 100)}" ${s.url} [${s.pageKind}] website: ${s.site || siteOf(s.url)}`);
  if (s.access && s.access !== 'full') lines.push(`ACCESS LIMITED: ${accessExplanation(s.access)}.`);
  if (s.auth.needsLogin) lines.push('SIGN-IN REQUIRED: the user must sign in themselves.');
  if (s.pageKind === 'captcha') lines.push('HUMAN VERIFICATION PAGE: the site wants the user to prove they are human. SAGE must not solve it; ask the user to complete it, then continue.');
  if (s.selection) lines.push(`Selected text: "${truncate(s.selection, 300)}"`);
  if (s.query) lines.push(`Search query on page: "${s.query}"`);
  if (s.filterTabs.length) {
    lines.push(`Filter tabs: ${s.filterTabs.map((f) => `${f.name}${f.selected ? '*' : ''} [${f.elementId}]`).join(', ')}`);
  }
  if (s.results.length) {
    lines.push(`Results (${s.results.length}):`);
    s.results.slice(0, 10).forEach((r, i) => {
      const meta = [r.channel, r.duration].filter(Boolean).join(' · ');
      lines.push(`  ${i + 1}. "${truncate(r.title, 90)}"${meta ? ` — ${meta}` : ''}${r.type === 'related' ? ' (related)' : ''}`);
    });
  }
  if (s.media && s.media.present) {
    const m = s.media;
    lines.push(
      `Video: "${truncate(m.title, 80)}" ${m.paused ? 'PAUSED' : m.buffering ? 'BUFFERING' : 'PLAYING'} ${fmt(m.currentTime)}/${fmt(m.duration)}, ${m.playbackRate}x, vol ${Math.round(m.volume * 100)}%${m.muted ? ' muted' : ''}${m.fullscreen || m.maximized ? ', fullscreen' : ''}`
    );
  }
  if (s.elements.length) {
    lines.push(
      `Elements: ${s.elements
        .slice(0, 40)
        .map((e) => `${e.id} ${e.role}${e.inputType ? `[${e.inputType}]` : ''}${e.form === 'search' ? '(search)' : ''} "${truncate(e.label, 40)}"`)
        .join('; ')}`
    );
  }
  if (s.textSummary) lines.push(`Text: ${truncate(s.textSummary.replace(/\s+/g, ' '), 500)}`);
  return lines.join('\n');
}

/** Short human title for a tool call, used for live plan steps. */
export function describeToolCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'web_search':
      return `Search ${args.engine === 'youtube' ? 'YouTube' : 'Google'} for "${args.query}"`;
    case 'open_url': {
      try {
        return `Open ${new URL(normalizeUrlOrSearch(String(args.url)).url).hostname.replace(/^www\./, '')}`;
      } catch {
        return `Open ${args.url}`;
      }
    }
    case 'open_result':
      return Number(args.position) === -1 ? 'Open the last result' : `Open result #${args.position}${args.skip_watched ? ' (not yet watched)' : ''}`;
    case 'switch_search_filter':
      return `Switch to the ${args.name} tab`;
    case 'click_element':
      return args.description ? `Click "${truncate(String(args.description), 40)}"` : `Click element ${args.element_id}`;
    case 'create_new_tab':
      return `Open ${describeToolCall('open_url', args).replace(/^Open /, '')} in a new tab`;
    case 'search_current_website':
      return `Search this website for "${truncate(String(args.query), 40)}"`;
    case 'navigate_back':
      return 'Go back';
    case 'navigate_forward':
      return 'Go forward';
    case 'scroll_page':
      return `Scroll ${args.direction}`;
    case 'play_video':
      return 'Start playback and verify';
    case 'pause_video':
      return 'Pause the video';
    case 'get_video_status':
      return 'Check the video';
    case 'get_active_tab':
      return 'Check the active tab';
    case 'get_current_page_context':
      return 'Read the page';
    case 'capture_visible_screen':
      return 'Look at the screen';
    case 'type_text':
      return `Type "${truncate(String(args.text), 40)}"${args.submit ? ' and submit' : ''}`;
    case 'navigate':
      return args.direction === 'back' ? 'Go back' : args.direction === 'forward' ? 'Go forward' : 'Reload the page';
    case 'switch_tab':
      return `Switch to tab #${args.tab_id}`;
    case 'scroll':
      return `Scroll ${args.direction}`;
    case 'observe_page':
      return 'Inspect the page';
    case 'media_control': {
      const a = String(args.action);
      const v = args.value;
      const map: Record<string, string> = {
        play: 'Start playback and verify',
        pause: 'Pause the video',
        seek: `Skip ${Number(v) >= 0 ? 'forward' : 'back'} ${Math.abs(Number(v) || 0)}s`,
        seek_to: `Jump to ${fmt(Number(v))}`,
        speed: `Set speed to ${v}x`,
        volume_up: 'Turn the volume up',
        volume_down: 'Turn the volume down',
        volume_set: `Set volume to ${v}%`,
        mute: 'Mute',
        unmute: 'Unmute',
        next: 'Play the next video',
        prev: 'Go to the previous video',
        fullscreen: 'Make the video fullscreen',
        exit_fullscreen: 'Exit fullscreen',
      };
      return map[a] || `Video: ${a}`;
    }
    case 'save_memory':
      return `Remember ${args.key}`;
    default:
      return name;
  }
}
