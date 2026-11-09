/**
 * SAGE Working Memory
 *
 * Short-lived task state for the current interaction: what the user is trying to do, which tab
 * SAGE is working in, the last search and its results, the media that is actually playing, the
 * last actions and any pending confirmation. It is updated only from real observations and
 * verified tool results, never from what SAGE merely intended to do.
 *
 * This is deliberately separate from the long-term `memoryStore` (personal facts/preferences).
 */

import type {
  BrowserContextState,
  BrowserTabInfo,
  MediaSnapshot,
  PageKind,
  PageSnapshot,
  SearchResultItem,
} from '../../src/utils/browserContextManager.ts';
import type { TaskPlan } from '../../src/utils/taskPlanner.ts';
import type { ExtensionInfo } from './browserBridge.ts';

export interface ActionRecord {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  message: string;
  at: number;
}

export interface PendingConfirmation {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  createdAt: number;
}

export interface MediaMemory extends MediaSnapshot {
  tabId: number;
  url: string;
  verifiedAt: number;
}

export interface SearchMemory {
  query: string;
  engine: 'google' | 'youtube' | 'other';
  results: SearchResultItem[];
  tabId: number;
  url: string;
  at: number;
}

const SEARCH_KINDS: PageKind[] = ['google_serp', 'google_videos', 'youtube_search'];
const MAX_LOG = 20;

export type WorkingMemoryEvent =
  | { event: 'tab_activated'; data: { tabId: number; url?: string; title?: string; windowId?: number } }
  | { event: 'tab_updated'; data: { tabId: number; url?: string; title?: string; status?: string } }
  | { event: 'tab_removed'; data: { tabId: number } }
  | { event: 'tabs'; data: { tabs: BrowserTabInfo[] } }
  | { event: 'media_state'; data: { tabId: number; url?: string; media: MediaSnapshot | null } }
  | { event: 'page_navigated'; data: { tabId: number; url: string; title?: string } };

export class WorkingMemory {
  objective: string | null = null;
  currentTask: TaskPlan | null = null;
  workingTabId: number | null = null;
  tabs: BrowserTabInfo[] = [];
  lastSnapshot: PageSnapshot | null = null;
  lastSearch: SearchMemory | null = null;
  selectedResult: SearchResultItem | null = null;
  watchedUrls: string[] = [];
  media: MediaMemory | null = null;
  lastAction: ActionRecord | null = null;
  pendingConfirmation: PendingConfirmation | null = null;
  pendingQuestion: string | null = null;
  completedActions: ActionRecord[] = [];
  failedActions: ActionRecord[] = [];
  extensionConnected = false;
  extension: ExtensionInfo | null = null;
  /** Result the user just asked about ("which is the first result?"), so "play it" means that one. */
  referencedResult: { position: number; url: string } | null = null;
  lastSyncAt = 0;
  fullscreenMode: 'none' | 'window' | 'native' = 'none';

  constructor(private readonly isSageUrl: (url: string) => boolean = () => false) {}

  // ---------------------------------------------------------------------------
  // Updates from the browser
  // ---------------------------------------------------------------------------

  applySnapshot(snapshot: PageSnapshot): void {
    if (this.isSageUrl(snapshot.url)) return; // never treat SAGE's own UI tab as the work context
    this.lastSnapshot = snapshot;
    this.workingTabId = snapshot.tabId;
    this.lastSyncAt = Date.now();
    if (snapshot.tabs) this.tabs = snapshot.tabs.filter((t) => !this.isSageUrl(t.url));

    if (SEARCH_KINDS.includes(snapshot.pageKind) && snapshot.results.length > 0) {
      this.lastSearch = {
        query: snapshot.query || this.lastSearch?.query || '',
        engine: snapshot.pageKind === 'youtube_search' ? 'youtube' : 'google',
        results: snapshot.results,
        tabId: snapshot.tabId,
        url: snapshot.url,
        at: snapshot.at,
      };
    }

    if (snapshot.pageKind === 'youtube_watch' || (snapshot.media && snapshot.media.present)) {
      this.markWatched(snapshot.url);
    }

    if (snapshot.media && snapshot.media.present) {
      this.media = { ...snapshot.media, tabId: snapshot.tabId, url: snapshot.url, verifiedAt: snapshot.at };
      if (!this.media.title) this.media.title = snapshot.title;
    } else if (this.media && this.media.tabId === snapshot.tabId) {
      // The tab we were watching no longer shows a video.
      this.media = null;
      this.fullscreenMode = 'none';
    }
  }

  applyEvent(e: WorkingMemoryEvent): void {
    switch (e.event) {
      case 'tabs':
        this.tabs = e.data.tabs.filter((t) => !this.isSageUrl(t.url));
        if (this.workingTabId !== null && !this.tabs.some((t) => t.id === this.workingTabId)) {
          this.workingTabId = null;
        }
        break;
      case 'tab_activated': {
        if (e.data.url && this.isSageUrl(e.data.url)) break;
        this.workingTabId = e.data.tabId;
        this.tabs = this.tabs.map((t) => ({ ...t, active: t.id === e.data.tabId }));
        if (!this.tabs.some((t) => t.id === e.data.tabId) && e.data.url) {
          this.tabs.push({ id: e.data.tabId, url: e.data.url, title: e.data.title || '', active: true });
        }
        break;
      }
      case 'tab_updated':
      case 'page_navigated': {
        const { tabId, url, title } = e.data;
        if (url && this.isSageUrl(url)) break;
        const existing = this.tabs.find((t) => t.id === tabId);
        if (existing) {
          if (url) existing.url = url;
          if (title) existing.title = title;
        } else if (url) {
          this.tabs.push({ id: tabId, url, title: title || '', active: false });
        }
        if (this.lastSnapshot && this.lastSnapshot.tabId === tabId && url && url !== this.lastSnapshot.url) {
          // Page changed under us (user clicked something, SPA navigation). Mark the snapshot stale.
          this.lastSnapshot = { ...this.lastSnapshot, at: 0 };
        }
        break;
      }
      case 'tab_removed':
        this.tabs = this.tabs.filter((t) => t.id !== e.data.tabId);
        if (this.workingTabId === e.data.tabId) this.workingTabId = null;
        if (this.media?.tabId === e.data.tabId) this.media = null;
        if (this.lastSnapshot?.tabId === e.data.tabId) this.lastSnapshot = null;
        break;
      case 'media_state': {
        const { tabId, media, url } = e.data;
        if (media && media.present) {
          this.media = {
            ...media,
            title: media.title || this.media?.title || '',
            tabId,
            url: url || this.media?.url || '',
            verifiedAt: Date.now(),
          };
        } else if (this.media?.tabId === tabId) {
          this.media = null;
        }
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Task bookkeeping
  // ---------------------------------------------------------------------------

  /** Starts a new objective (e.g. "Actually, search for horror games") without losing tab context. */
  replaceObjective(objective: string): void {
    this.objective = objective;
    this.currentTask = null;
    this.pendingQuestion = null;
    this.pendingConfirmation = null;
  }

  recordAction(tool: string, args: Record<string, unknown>, ok: boolean, message: string): ActionRecord {
    const rec: ActionRecord = { tool, args, ok, message, at: Date.now() };
    this.lastAction = rec;
    const log = ok ? this.completedActions : this.failedActions;
    log.unshift(rec);
    if (log.length > MAX_LOG) log.length = MAX_LOG;
    return rec;
  }

  markWatched(url: string): void {
    const key = normalizeVideoUrl(url);
    if (!key) return;
    this.watchedUrls = [key, ...this.watchedUrls.filter((u) => u !== key)].slice(0, 50);
  }

  hasWatched(url: string): boolean {
    const key = normalizeVideoUrl(url);
    return Boolean(key && this.watchedUrls.includes(key));
  }

  /** Results the user is most likely referring to right now: the current page's, else the last search. */
  currentResults(): SearchResultItem[] {
    if (this.lastSnapshot && this.lastSnapshot.results.length > 0 && this.lastSnapshot.tabId === this.workingTabId) {
      return this.lastSnapshot.results;
    }
    return this.lastSearch?.results || [];
  }

  /** Is there a video SAGE has actually seen in the working tab? */
  hasActiveMedia(): boolean {
    return Boolean(this.media && this.media.present);
  }

  reset(): void {
    this.objective = null;
    this.currentTask = null;
    this.lastSearch = null;
    this.selectedResult = null;
    this.watchedUrls = [];
    this.media = null;
    this.lastAction = null;
    this.pendingConfirmation = null;
    this.pendingQuestion = null;
    this.referencedResult = null;
    this.completedActions = [];
    this.failedActions = [];
    this.fullscreenMode = 'none';
  }

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  /** Compact, model-facing description of the current situation. */
  summarizeForPrompt(): string {
    const lines: string[] = [];
    lines.push(`Extension connected: ${this.extensionConnected ? 'yes' : 'NO (SAGE cannot see or control pages)'}`);
    if (this.extensionConnected && this.extension) {
      const p = this.extension.permissions;
      lines.push(
        `Permissions: browser access ${p.browserAccess ? 'granted' : 'NOT granted (only tab titles/URLs are visible; page content and actions on pages need "Enable Browser Access")'}, screen capture ${p.screenCapture ? 'granted' : 'not granted'}`
      );
    }
    lines.push(`Current objective: ${this.objective || '(none)'}`);
    const tab = this.tabs.find((t) => t.id === this.workingTabId);
    lines.push(
      `Working tab: ${tab ? `#${tab.id} "${truncate(tab.title, 80)}" ${tab.url}` : this.lastSnapshot ? `#${this.lastSnapshot.tabId} ${this.lastSnapshot.url}` : '(none yet)'}`
    );
    if (this.tabs.length > 0) {
      lines.push(
        `Open tabs: ${this.tabs
          .slice(0, 10)
          .map((t) => `#${t.id} "${truncate(t.title, 40)}"`)
          .join(', ')}`
      );
    }
    if (this.lastSearch) {
      lines.push(`Last search: "${this.lastSearch.query}" on ${this.lastSearch.engine} (${this.lastSearch.results.length} results)`);
    }
    if (this.selectedResult) {
      lines.push(`Last opened result: #${this.selectedResult.index + 1} "${truncate(this.selectedResult.title, 80)}"`);
    }
    if (this.media && this.media.present) {
      const m = this.media;
      lines.push(
        `Video (verified ${Math.round((Date.now() - m.verifiedAt) / 1000)}s ago, tab #${m.tabId}): "${truncate(m.title, 80)}" ` +
          `${m.paused ? 'PAUSED' : m.buffering ? 'BUFFERING' : 'PLAYING'} at ${fmtTime(m.currentTime)}/${fmtTime(m.duration)}, ` +
          `speed ${m.playbackRate}x, volume ${Math.round(m.volume * 100)}%${m.muted ? ' (muted)' : ''}, ` +
          `fullscreen: ${m.fullscreen || m.maximized || this.fullscreenMode !== 'none' ? 'yes' : 'no'}`
      );
    } else {
      lines.push('Video: none detected in the working tab');
    }
    if (this.watchedUrls.length > 0) lines.push(`Already watched this session: ${this.watchedUrls.length} video(s)`);
    if (this.lastAction) {
      lines.push(`Last action: ${this.lastAction.tool} -> ${this.lastAction.ok ? 'ok' : 'FAILED'}: ${truncate(this.lastAction.message, 120)}`);
    }
    if (this.pendingQuestion) lines.push(`SAGE previously asked the user: "${this.pendingQuestion}"`);
    if (this.pendingConfirmation) lines.push(`Awaiting user confirmation for: ${this.pendingConfirmation.summary}`);
    return lines.join('\n');
  }

  /** UI-facing state (kept compatible with the existing BrowserContextBar). */
  toContext(): BrowserContextState {
    const snap = this.lastSnapshot;
    const tab = this.tabs.find((t) => t.id === this.workingTabId) || null;
    const m = this.media;
    return {
      activeTab: tab
        ? { ...tab, active: true }
        : snap
        ? { id: snap.tabId, url: snap.url, title: snap.title, active: true }
        : null,
      openTabs: this.tabs,
      lastSearchQuery: this.lastSearch?.query || '',
      searchEngine: this.lastSearch ? (this.lastSearch.engine === 'other' ? 'none' : this.lastSearch.engine) : 'none',
      searchResults: this.currentResults().slice(0, 10),
      activeMedia: {
        hasVideo: Boolean(m && m.present),
        isPlaying: Boolean(m && m.present && !m.paused && !m.ended),
        isPaused: Boolean(m && m.paused),
        isBuffering: Boolean(m && m.buffering),
        isMuted: Boolean(m && m.muted),
        volume: m ? m.volume : 1,
        playbackRate: m ? m.playbackRate : 1,
        currentTime: m ? m.currentTime : 0,
        duration: m ? m.duration : 0,
        isFullscreen: Boolean(m && (m.fullscreen || m.maximized)) || this.fullscreenMode !== 'none',
        title: m?.title || '',
        url: m?.url || '',
        playerType: m?.playerType || 'unknown',
        verified: Boolean(m),
        tabId: m?.tabId,
        verifiedAt: m?.verifiedAt,
      },
      visibleNavTabs: snap?.filterTabs.map((f) => f.name) || [],
      currentFilterTab: snap?.filterTabs.find((f) => f.selected)?.name,
      lastActionDescription: this.lastAction?.message,
      lastActionTimestamp: this.lastAction?.at,
      extensionConnected: this.extensionConnected,
      extension: this.extension ? { id: this.extension.id, version: this.extension.version, permissions: this.extension.permissions } : null,
      pageAccess: snap?.access,
      lastSyncAt: this.lastSyncAt || undefined,
      pageKind: snap?.pageKind,
      objective: this.objective,
    };
  }
}

/** Canonical key for a video URL so the same video is recognised across URL variants. */
export function normalizeVideoUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      const v = u.searchParams.get('v');
      if (v) return `yt:${v}`;
      const shorts = u.pathname.match(/^\/shorts\/([\w-]+)/);
      if (shorts) return `yt:${shorts[1]}`;
      return null;
    }
    if (u.hostname === 'youtu.be') return `yt:${u.pathname.slice(1)}`;
    return `${u.hostname}${u.pathname}`;
  } catch {
    return null;
  }
}

export function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
