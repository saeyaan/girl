/**
 * Browser Context Manager & Reference Resolver
 * Maintains real-time state of active tabs, current search queries & results,
 * active video/media playback state, visible tabs, and resolves pronoun references
 * such as "the first one", "the second result", "it", "videos tab", "same video".
 */

export interface SearchResultItem {
  index: number;
  title: string;
  url: string;
  snippet?: string;
  source?: string;
  channel?: string;
  duration?: string;
  type?: 'web' | 'video' | 'news' | 'image' | 'related';
}

export type PageKind =
  | 'google_serp'
  | 'google_videos'
  | 'youtube_home'
  | 'youtube_search'
  | 'youtube_watch'
  | 'vimeo'
  | 'dailymotion'
  | 'gmail'
  | 'login_page'
  | 'captcha'
  | 'generic'
  | 'restricted'
  | 'blank';

/** An interactive element the content script found on the page, addressable by `id`. */
export interface PageElement {
  id: string;
  role: string; // link | button | input | textarea | select | tab | checkbox ...
  label: string;
  href?: string;
  inputType?: string;
  /** 'search' when the element lives in a search form/box, 'other' for any other form, undefined otherwise. */
  form?: 'search' | 'other';
}

/** Live state of the page's active <video>, as read back from the DOM (never assumed). */
export interface MediaSnapshot {
  present: boolean;
  paused: boolean;
  ended: boolean;
  buffering: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  fullscreen: boolean; // real element fullscreen (document.fullscreenElement)
  maximized: boolean; // SAGE "player fill" mode
  title: string;
  playerType: 'youtube' | 'vimeo' | 'dailymotion' | 'html5';
  frameId?: number;
}

/** Structured observation of one browser tab, produced by the extension. */
export interface PageSnapshot {
  tabId: number;
  windowId?: number;
  url: string;
  title: string;
  pageKind: PageKind;
  query?: string;
  results: SearchResultItem[];
  filterTabs: Array<{ name: string; elementId: string; selected?: boolean }>;
  elements: PageElement[];
  media: MediaSnapshot | null;
  auth: { needsLogin: boolean };
  textSummary: string;
  /** 'full' = page readable; otherwise only tab title/URL are known and this says why. */
  access?: 'full' | 'permission_required' | 'restricted' | 'unreadable';
  selection?: string;
  site?: string;
  windowFullscreen?: boolean;
  tabs?: BrowserTabInfo[];
  at: number;
}

export interface ActiveMediaState {
  hasVideo: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  isBuffering: boolean;
  isMuted: boolean;
  volume: number; // 0 to 1
  playbackRate: number; // 0.25 to 2.0
  currentTime: number; // seconds
  duration: number; // seconds
  isFullscreen: boolean;
  title: string;
  url: string;
  playerType: 'youtube' | 'vimeo' | 'dailymotion' | 'html5' | 'unknown';
  /** True only when this state was read back from the real player. */
  verified?: boolean;
  tabId?: number;
  verifiedAt?: number;
}

export interface BrowserTabInfo {
  id: number;
  url: string;
  title: string;
  active: boolean;
  windowId?: number;
  favicon?: string;
}

export interface BrowserContextState {
  activeTab: BrowserTabInfo | null;
  openTabs: BrowserTabInfo[];
  lastSearchQuery: string;
  searchEngine: 'google' | 'youtube' | 'bing' | 'duckduckgo' | 'none';
  searchResults: SearchResultItem[];
  activeMedia: ActiveMediaState;
  visibleNavTabs: string[]; // e.g. ["All", "Videos", "Images", "News", "Maps", "Shopping"]
  currentFilterTab?: string; // e.g. "Videos"
  lastActionDescription?: string;
  lastActionTimestamp?: number;
  extensionConnected?: boolean;
  extension?: {
    id: string;
    version: string;
    permissions: { browserAccess: boolean; screenCapture: boolean; realFullscreen: boolean };
  } | null;
  pageAccess?: PageSnapshot['access'];
  pageKind?: PageKind;
  objective?: string | null;
  lastSyncAt?: number;
}

export const initialBrowserContext: BrowserContextState = {
  activeTab: null,
  openTabs: [],
  lastSearchQuery: '',
  searchEngine: 'none',
  searchResults: [],
  extensionConnected: false,
  objective: null,
  activeMedia: {
    hasVideo: false,
    isPlaying: false,
    isPaused: false,
    isBuffering: false,
    isMuted: false,
    volume: 1.0,
    playbackRate: 1.0,
    currentTime: 0,
    duration: 0,
    isFullscreen: false,
    title: '',
    url: '',
    playerType: 'unknown',
  },
  visibleNavTabs: [],
  currentFilterTab: undefined,
  lastActionDescription: 'Waiting for the SAGE browser extension',
  lastActionTimestamp: 0,
};

/**
 * Resolves pronoun and contextual references from user input based on current browser context.
 * e.g. "the first one", "second video", "videos tab", "make it fullscreen", "play it", "go back"
 */
export function resolveContextualReference(
  userInput: string,
  context: BrowserContextState
): {
  isContextual: boolean;
  resolvedAction?: string;
  resolvedTargetUrl?: string;
  resolvedTargetItem?: SearchResultItem;
  description?: string;
  videoCommand?: {
    action: 'play' | 'pause' | 'resume' | 'fullscreen' | 'exit_fullscreen' | 'seek' | 'speed' | 'volume' | 'mute';
    value?: any;
  };
} {
  let clean = userInput.trim().toLowerCase();
  // Strip conversational leading words like "now ", "please ", "can you ", "ok ", "so "
  clean = clean.replace(/^(?:now\s+|please\s+|can\s+you\s+|could\s+you\s+|ok(?:ay)?\s+|so\s+)+/i, '').trim();

  // 1. Ordinal References: "the first one", "open the first result", "play the second one", "3rd result"
  const ordinalMatch = clean.match(/(?:open|play|click|go\s+to|select)?\s*(?:the\s+)?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|#1|#2|#3)\s*(?:one|result|video|link|item)?/i);
  if (ordinalMatch && context.searchResults.length > 0) {
    const word = ordinalMatch[1].toLowerCase();
    const indexMap: Record<string, number> = {
      first: 0,
      '1st': 0,
      '#1': 0,
      second: 1,
      '2nd': 1,
      '#2': 1,
      third: 2,
      '3rd': 2,
      '#3': 2,
      fourth: 3,
      '4th': 3,
      '#4': 3,
      fifth: 4,
      '5th': 4,
      '#5': 4,
    };

    const targetIdx = indexMap[word] ?? 0;
    const targetItem = context.searchResults[targetIdx] || context.searchResults[0];

    if (targetItem) {
      return {
        isContextual: true,
        resolvedAction: 'open_search_result',
        resolvedTargetUrl: targetItem.url,
        resolvedTargetItem: targetItem,
        description: `Opening result #${targetIdx + 1}: "${targetItem.title}"`,
      };
    }
  }

  // 2. Google / Search Engine Tab Filters: "Go to the Videos tab", "Images tab", "News tab"
  const tabFilterMatch = clean.match(/(?:go\s+to|switch\s+to|click|open)?\s*(?:the\s+)?(videos?|images?|news|maps|shopping|all)\s+tab/i);
  if (tabFilterMatch && context.lastSearchQuery) {
    const rawTab = tabFilterMatch[1].toLowerCase();
    const query = encodeURIComponent(context.lastSearchQuery);
    let targetUrl = `https://www.google.com/search?q=${query}`;
    let tabName = 'All';

    if (rawTab.startsWith('video')) {
      targetUrl = `https://www.google.com/search?q=${query}&tbm=vid`;
      tabName = 'Videos';
    } else if (rawTab.startsWith('image')) {
      targetUrl = `https://www.google.com/search?q=${query}&tbm=isch`;
      tabName = 'Images';
    } else if (rawTab.startsWith('new')) {
      targetUrl = `https://www.google.com/search?q=${query}&tbm=nws`;
      tabName = 'News';
    } else if (rawTab.startsWith('map')) {
      targetUrl = `https://maps.google.com/maps?q=${query}`;
      tabName = 'Maps';
    }

    return {
      isContextual: true,
      resolvedAction: 'switch_search_filter',
      resolvedTargetUrl: targetUrl,
      description: `Switching to ${tabName} filter for "${context.lastSearchQuery}"`,
    };
  }

  // 3. Pronoun video controls: "make it full screen", "fullscreen it", "exit fullscreen", "play it", "pause it"
  if (/^(?:make\s+it\s+full\s*screen|fullscreen(?:\s+it)?|maximize\s+video)$/i.test(clean)) {
    return {
      isContextual: true,
      resolvedAction: 'video_control',
      videoCommand: { action: 'fullscreen' },
      description: 'Activating fullscreen mode for current video',
    };
  }

  if (/^(?:exit\s+full\s*screen|leave\s+fullscreen|unfullscreen|normal\s+screen)$/i.test(clean)) {
    return {
      isContextual: true,
      resolvedAction: 'video_control',
      videoCommand: { action: 'exit_fullscreen' },
      description: 'Exiting fullscreen mode',
    };
  }

  if (/^(?:play\s+it|resume(?:\s+it)?|start\s+playback)$/i.test(clean)) {
    return {
      isContextual: true,
      resolvedAction: 'video_control',
      videoCommand: { action: 'play' },
      description: 'Starting playback of active video',
    };
  }

  if (/^(?:pause\s+it|stop\s+it|hold\s+on)$/i.test(clean)) {
    return {
      isContextual: true,
      resolvedAction: 'video_control',
      videoCommand: { action: 'pause' },
      description: 'Pausing active video',
    };
  }

  // 4. Seek controls: "skip forward 30 seconds", "go back 10 seconds", "fast forward 15s"
  const seekMatch = clean.match(/(?:skip|seek|go|fast\s+forward)\s*(forward|ahead|back|backward)?\s*(\d+)\s*(?:seconds?|secs?|s)/i);
  if (seekMatch) {
    const dir = seekMatch[1]?.toLowerCase().includes('back') ? -1 : 1;
    const seconds = parseInt(seekMatch[2], 10) * dir;
    return {
      isContextual: true,
      resolvedAction: 'video_control',
      videoCommand: { action: 'seek', value: seconds },
      description: `Seeking ${Math.abs(seconds)} seconds ${seconds > 0 ? 'forward' : 'backward'}`,
    };
  }

  // 5. Playback rate: "play at 2x speed", "2x speed", "double speed", "1.5x speed", "normal speed"
  const speedMatch = clean.match(/(?:play\s+at\s+)?(\d(?:\.\d+)?)\s*x(?:\s+speed)?/i);
  if (speedMatch) {
    const rate = parseFloat(speedMatch[1]);
    return {
      isContextual: true,
      resolvedAction: 'video_control',
      videoCommand: { action: 'speed', value: rate },
      description: `Setting video speed to ${rate}x`,
    };
  }

  if (/normal\s+speed|1x\s+speed/i.test(clean)) {
    return {
      isContextual: true,
      resolvedAction: 'video_control',
      videoCommand: { action: 'speed', value: 1.0 },
      description: 'Setting video speed to normal 1x',
    };
  }

  // 6. Navigation: "go back", "previous page", "return"
  if (/^(?:go\s+back|previous\s+page|back)$/i.test(clean)) {
    return {
      isContextual: true,
      resolvedAction: 'navigate_back',
      description: 'Navigating to previous browser page',
    };
  }

  return { isContextual: false };
}
