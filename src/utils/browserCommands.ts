/**
 * Browser Command Resolver & URL Normalizer
 * Pure logic for interpreting voice commands like "Open YouTube", "Search for AI news",
 * "Open https://github.com", and generating safe, normalized URLs and browser actions.
 */

export interface BrowserAction {
  type: 'open_url' | 'search' | 'navigate' | 'summarize' | 'click_element' | 'go_back' | 'go_forward' | 'youtube_play' | 'youtube_change' | 'youtube_pause' | 'youtube_resume' | 'youtube_next';
  targetUrl?: string;
  query?: string;
  siteName?: string;
  trackName?: string;
  selector?: string;
  description: string;
}

// Well-known site shortcuts
const SITE_SHORTCUTS: Record<string, { url: string; name: string }> = {
  google: { url: 'https://www.google.com', name: 'Google' },
  youtube: { url: 'https://www.youtube.com', name: 'YouTube' },
  github: { url: 'https://github.com', name: 'GitHub' },
  facebook: { url: 'https://www.facebook.com', name: 'Facebook' },
  instagram: { url: 'https://www.instagram.com', name: 'Instagram' },
  chatgpt: { url: 'https://chatgpt.com', name: 'ChatGPT' },
  twitter: { url: 'https://x.com', name: 'X / Twitter' },
  x: { url: 'https://x.com', name: 'X / Twitter' },
  wikipedia: { url: 'https://www.wikipedia.org', name: 'Wikipedia' },
  reddit: { url: 'https://www.reddit.com', name: 'Reddit' },
  linkedin: { url: 'https://www.linkedin.com', name: 'LinkedIn' },
  netflix: { url: 'https://www.netflix.com', name: 'Netflix' },
  amazon: { url: 'https://www.amazon.com', name: 'Amazon' },
  spotify: { url: 'https://open.spotify.com', name: 'Spotify' },
  gmail: { url: 'https://mail.google.com', name: 'Gmail' },
  maps: { url: 'https://maps.google.com', name: 'Google Maps' },
};

/**
 * Normalizes input text into a clean URL or search query.
 */
export function normalizeUrlOrSearch(input: string): { url: string; isSearch: boolean; title: string } {
  const trimmed = input.trim();

  // If already full URL
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return { url: parsed.href, isSearch: false, title: parsed.hostname };
    } catch {
      // Fallback to search
    }
  }

  // Check for domain-like input (e.g., example.com, openai.com)
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(trimmed)) {
    return { url: `https://${trimmed}`, isSearch: false, title: trimmed };
  }

  // Check site shortcuts
  const lower = trimmed.toLowerCase();
  if (SITE_SHORTCUTS[lower]) {
    return { url: SITE_SHORTCUTS[lower].url, isSearch: false, title: SITE_SHORTCUTS[lower].name };
  }

  // Otherwise, default to Google Search
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  return { url: searchUrl, isSearch: true, title: `Search: "${trimmed}"` };
}

/**
 * Parses user voice/text command into a structured browser action
 */
export function parseBrowserCommand(text: string): BrowserAction | null {
  const clean = text.trim();
  const lower = clean.toLowerCase();

  // Clean task assignment prefixes (e.g. "assign chrome task: open youtube", "assign task: open youtube")
  let commandStr = clean
    .replace(/^(?:please\s+)?(?:can\s+you\s+)?(?:assign\s+(?:a\s+)?(?:chrome\s+)?task(?:\s+to)?|chrome\s+task|assign\s+task)(?:\s*:)?\s+/i, '')
    .trim();

  // Strip trailing "in a new tab in my chrome", "in another tab", "in my chrome", "in chrome", "in browser"
  commandStr = commandStr
    .replace(/\s+(?:in\s+(?:a\s+)?(?:new|another|separate)\s+tab(?:\s+in\s+(?:my\s+)?chrome|\s+in\s+browser)?|in\s+(?:my\s+)?chrome|in\s+(?:the\s+)?browser)$/i, '')
    .trim();

  // YouTube Playback Controls
  // 1. "Change to this [track]" / "Change to [track]" / "Switch to [track]" / "Change music to [track]" / "গান বদলাও" / "म्यूजिक बदलो"
  const changeMatch = commandStr.match(/^(?:please\s+)?(?:can\s+you\s+)?(?:change(?:\s+(?:the\s+)?(?:song|music|track))?\s+to(?:\s+this)?(?:\s+(?:song|music|track))?(?:\s*:)?|switch(?:\s+(?:the\s+)?(?:song|music|track))?\s+to(?:\s+this)?(?:\s+(?:song|music|track))?(?:\s*:)?|म्यूजिक\s+बदलो|गाना\s+बदलो|গান\s+বদল\s+করো|গান\s+বদলাও)(?:\s+(.+))?$/i);
  if (changeMatch) {
    const rawTrack = (changeMatch[1] || '').replace(/[.!?,]+$/, '').trim();
    const track = rawTrack && rawTrack.toLowerCase() !== 'this' ? rawTrack : 'Trending Music Hits';
    return {
      type: 'youtube_change',
      targetUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(track)}`,
      query: track,
      trackName: track,
      siteName: 'YouTube',
      description: `Changing YouTube music to "${track}" in a new tab`,
    };
  }

  // 2. "Play this music [track]" / "Play this [track]" / "Play song [track]" / "Play [track]"
  const playMatch = commandStr.match(/^(?:please\s+)?(?:can\s+you\s+)?play(?:\s+this)?(?:\s+(?:song|music|track|video))?(?:\s+(?:called|titled|named))?(?:\s*:)?(?:\s+(.+))?$/i);
  if (playMatch) {
    let rawTrack = (playMatch[1] || '').replace(/[.!?,]+$/, '').trim();
    // Strip trailing "on youtube" if present
    rawTrack = rawTrack.replace(/\s+on\s+youtube$/i, '').trim();
    const track = rawTrack && rawTrack.toLowerCase() !== 'this' ? rawTrack : 'Top Popular Music';

    return {
      type: 'youtube_play',
      targetUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(track)}`,
      query: track,
      trackName: track,
      siteName: 'YouTube',
      description: `Playing "${track}" on YouTube in a new tab`,
    };
  }

  // Hindi/Bengali music triggers: e.g. "गाना चलाओ", "म्यूजिक बजाओ", "গান চালাও"
  const hindiBengaliPlay = commandStr.match(/(?:गाना\s+(?:चलाओ|बजाओ)|म्यूजिक\s+(?:चलाओ|बजाओ)|গান\s+চালাও)(?:\s*:)?(?:\s+(.+))?/i);
  if (hindiBengaliPlay) {
    const track = (hindiBengaliPlay[1] || 'Bollywood Trending Music').replace(/[.!?,]+$/, '').trim();
    return {
      type: 'youtube_play',
      targetUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(track)}`,
      query: track,
      trackName: track,
      siteName: 'YouTube',
      description: `Playing "${track}" on YouTube`,
    };
  }

  // 3. Pause playback: "pause youtube", "pause music", "stop music", "pause", "रोको", "पॉज़"
  if (/^(?:pause(?:\s+(?:the\s+)?(?:youtube|music|song|video|playback))?|stop\s+(?:music|playback|the\s+song)|पॉज़|रोको|গান\s+থামাও)$/i.test(commandStr)) {
    return {
      type: 'youtube_pause',
      siteName: 'YouTube',
      description: 'Pausing YouTube playback',
    };
  }

  // 4. Resume playback: "resume youtube", "resume music", "unpause", "resume", "চালू करो"
  if (/^(?:resume(?:\s+(?:the\s+)?(?:youtube|music|song|video|playback))?|unpause|continue\s+playback|चालू\s+करो|फिर\s+से\s+चलाओ)$/i.test(commandStr)) {
    return {
      type: 'youtube_resume',
      siteName: 'YouTube',
      description: 'Resuming YouTube playback',
    };
  }

  // 5. Next song: "next song", "next track", "skip song", "next"
  if (/^(?:next(?:\s+(?:song|track|video))?|skip(?:\s+(?:this|the)?(?:\s+(?:song|track|video)))?|अगला\s+गाना|পরবর্তী\s+গান)$/i.test(commandStr)) {
    return {
      type: 'youtube_next',
      siteName: 'YouTube',
      description: 'Skipping to next YouTube track',
    };
  }

  // Search commands: "google search about [query]", "search for [query]", "google [query]", "open google search for [query]", "look up [query]"
  const searchMatch = commandStr.match(/^(?:please\s+)?(?:can\s+you\s+)?(?:open\s+)?(?:google\s+search(?:\s+(?:about|for|on|of))?|search(?:\s+(?:google|the\s+web|web))?(?:\s+(?:for|about|on|of))?|google(?:\s+(?:for|about|on|of))?|look\s+up|find(?:\s+out\s+about)?)\s+(.+)$/i);
  if (searchMatch) {
    let query = searchMatch[1].replace(/[.!?,]+$/, '').trim();
    // Remove redundant leading words if any
    query = query.replace(/^(?:about|for|on|of)\s+/i, '').trim();

    return {
      type: 'search',
      targetUrl: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      query,
      description: `Searching Google for "${query}" in a new tab`,
    };
  }

  // "Open [site/url]", "Go to [site]", "Navigate to [site]", "Launch [site]", "New tab with [site]"
  const openMatch = commandStr.match(/^(?:please\s+)?(?:can\s+you\s+)?(?:open(?:\s+a)?(?:\s+new)?(?:\s+tab)?(?:\s+for|\s+with)?|go\s+to|navigate\s+to|launch)\s+(.+)$/i);
  if (openMatch) {
    const rawTarget = openMatch[1].replace(/[.!?,]+$/, '').trim();
    const siteKey = rawTarget.toLowerCase().replace(/\s+/g, '');

    if (SITE_SHORTCUTS[siteKey]) {
      return {
        type: 'open_url',
        targetUrl: SITE_SHORTCUTS[siteKey].url,
        siteName: SITE_SHORTCUTS[siteKey].name,
        description: `Opening ${SITE_SHORTCUTS[siteKey].name} in a new tab`,
      };
    }

    const { url, isSearch, title } = normalizeUrlOrSearch(rawTarget);
    return {
      type: isSearch ? 'search' : 'open_url',
      targetUrl: url,
      siteName: title,
      query: isSearch ? rawTarget : undefined,
      description: isSearch ? `Searching for "${rawTarget}" in a new tab` : `Opening ${title} in a new tab`,
    };
  }

  // "Summarize this page" or "Read page"
  if (/(?:summarize|read|tell\s+me\s+about)\s+(?:this|the)\s+(?:page|website|tab)/i.test(lower)) {
    return {
      type: 'summarize',
      description: 'Analyzing and summarizing the current page content',
    };
  }

  // Navigation commands
  if (/^go\s+back(?:ward)?$/i.test(lower)) {
    return {
      type: 'go_back',
      description: 'Navigating back in browser history',
    };
  }

  if (/^go\s+forward$/i.test(lower)) {
    return {
      type: 'go_forward',
      description: 'Navigating forward in browser history',
    };
  }

  return null;
}
