/**
 * Test doubles: a small simulated browser that speaks the extension RPC protocol, and a scripted
 * model. Used by the agent tests to run real conversations through the real loop and tools.
 */

import type { Content } from '@google/genai';
import type { MediaSnapshot, PageElement, PageSnapshot, SearchResultItem } from '../../src/utils/browserContextManager.ts';
import type { BridgeEvent, BrowserBridge, ExtensionInfo } from './browserBridge.ts';
import type { ModelClient, ModelFunctionCall, ModelRequest, ModelResponse } from './model.ts';

interface FakeTab {
  id: number;
  history: string[];
  idx: number;
}

interface FakeMedia {
  paused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  fullscreen: boolean;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

export class FakeBrowser implements BrowserBridge {
  connected = true;
  autoplayBlocked = false;
  /** Watch pages start paused (so tests can check that SAGE really starts playback). */
  autoplay = false;
  calls: Array<{ method: string; params: any }> = [];
  ui: Array<{ type: string; data: any }> = [];
  private tabs = new Map<number, FakeTab>();
  private media = new Map<number, FakeMedia>();
  private nextTab = 100;
  private activeTab: number | null = null;

  isConnected(): boolean {
    return this.connected;
  }
  onEvent(_h: (e: BridgeEvent) => void): void {}
  onStatus(_h: (c: boolean, info: ExtensionInfo | null) => void): void {}
  /** Simulates the user not having clicked "Enable Browser Access" (titles/URLs only). */
  browserAccess = true;
  screenCapture = true;
  extensionInfo(): ExtensionInfo | null {
    return this.connected
      ? { id: 'fake', version: 'test', protocol: 3, capabilities: [], permissions: { browserAccess: this.browserAccess, screenCapture: this.screenCapture, realFullscreen: false } }
      : null;
  }
  broadcastUi(type: string, data: unknown): void {
    this.ui.push({ type, data });
  }

  callsOf(method: string) {
    return this.calls.filter((c) => c.method === method);
  }

  currentUrl(tabId = this.activeTab): string {
    const t = tabId ? this.tabs.get(tabId) : undefined;
    return t ? t.history[t.idx] : '';
  }

  mediaOf(tabId = this.activeTab): FakeMedia | undefined {
    return tabId ? this.media.get(tabId) : undefined;
  }

  async call<T = any>(method: string, params: any = {}): Promise<T> {
    if (!this.connected) throw new Error('offline');
    this.calls.push({ method, params });
    switch (method) {
      case 'get_active_tab': {
        const d = (id: number | null) => {
          if (!id) return null;
          const url = this.currentUrl(id);
          return { id, url, title: `Page ${new URL(url).hostname}`, site: new URL(url).hostname.replace(/^www./, ''), isSageApp: false, readable: true };
        };
        return { focusedTab: d(this.activeTab), workingTab: d(this.activeTab), tabs: [], permissions: this.extensionInfo()!.permissions } as T;
      }
      case 'capture':
        if (!this.screenCapture) return { ok: false, error: 'screen_permission_required' } as T;
        if (!this.activeTab) return { ok: false, error: 'no_working_tab' } as T;
        return { ok: true, mimeType: 'image/jpeg', data: 'ZmFrZQ==', tabId: this.activeTab, url: this.currentUrl(), title: 'Captured', at: Date.now() } as T;
      case 'site_search':
        return { ok: false, error: this.browserAccess ? 'no_search_box' : 'permission_required' } as T;
      case 'observe': {
        const tabId = params.tabId && this.tabs.has(params.tabId) ? params.tabId : this.activeTab;
        if (!tabId) throw new Error('no_working_tab');
        return this.snapshot(tabId) as T;
      }
      case 'open_url': {
        let tab = !params.newTab && params.tabId ? this.tabs.get(params.tabId) : undefined;
        if (!tab) {
          tab = { id: this.nextTab++, history: [], idx: -1 };
          this.tabs.set(tab.id, tab);
        }
        this.navigateTo(tab, params.url);
        this.activeTab = tab.id;
        return { tabId: tab.id } as T;
      }
      case 'navigate': {
        const tab = this.tabs.get(params.tabId)!;
        if (params.direction === 'back') {
          if (tab.idx === 0) return { ok: false, error: 'no_history' } as T;
          tab.idx--;
        } else if (params.direction === 'forward') {
          if (tab.idx >= tab.history.length - 1) return { ok: false, error: 'no_history' } as T;
          tab.idx++;
        }
        this.onLoad(tab);
        return { ok: true } as T;
      }
      case 'activate_tab':
        if (!this.tabs.has(params.tabId)) return { ok: false } as T;
        this.activeTab = params.tabId;
        return { ok: true } as T;
      case 'page_action': {
        if (!this.browserAccess) return { ok: false, error: 'permission_required' } as T;
        const tab = this.tabs.get(params.tabId)!;
        if (params.action === 'click') {
          const el = this.elementsFor(this.currentUrl(tab.id)).find((e) => e.id === params.args.elementId);
          const filter = this.filterTabsFor(this.currentUrl(tab.id)).find((f) => f.elementId === params.args.elementId);
          if (filter) {
            const q = new URL(this.currentUrl(tab.id)).searchParams.get('q') || '';
            this.navigateTo(tab, `https://www.google.com/search?q=${encodeURIComponent(q)}${filter.name === 'Videos' ? '&tbm=vid' : ''}`);
            return { ok: true, navigated: true } as T;
          }
          if (!el) return { ok: false, error: 'element_not_found' } as T;
          if (el.href) this.navigateTo(tab, el.href);
          return { ok: true } as T;
        }
        return { ok: true } as T;
      }
      case 'media': {
        if (!this.browserAccess) return { ok: false, error: 'permission_required', media: null } as T;
        const m = this.media.get(params.tabId);
        if (!m) return { ok: false, error: 'no_video', media: null } as T;
        switch (params.action) {
          case 'play':
            if (this.autoplayBlocked) return { ok: false, error: 'blocked_by_autoplay', media: this.mediaSnap(params.tabId) } as T;
            m.paused = false;
            m.currentTime += 0.5;
            break;
          case 'pause':
            m.paused = true;
            break;
          case 'seek':
            m.currentTime = Math.max(0, Math.min(m.duration, m.currentTime + Number(params.value)));
            break;
          case 'seek_to':
            m.currentTime = Number(params.value);
            break;
          case 'speed':
            m.playbackRate = Number(params.value);
            break;
          case 'volume_down':
            m.volume = Math.max(0, m.volume - (Number(params.value) || 15) / 100);
            break;
          case 'volume_up':
            m.volume = Math.min(1, m.volume + (Number(params.value) || 15) / 100);
            break;
          case 'mute':
            m.muted = true;
            break;
          case 'fullscreen':
            m.fullscreen = true;
            return { ok: true, verified: true, mode: params.fullscreenMode === 'debugger' ? 'native' : 'window', media: this.mediaSnap(params.tabId) } as T;
          case 'exit_fullscreen':
            m.fullscreen = false;
            break;
          case 'next': {
            const tab = this.tabs.get(params.tabId)!;
            const v = new URL(this.currentUrl(tab.id)).searchParams.get('v') || 'x';
            this.navigateTo(tab, `https://www.youtube.com/watch?v=${v}next`);
            this.media.get(tab.id)!.paused = false;
            return { ok: true, verified: true, navigated: true, media: this.mediaSnap(tab.id) } as T;
          }
        }
        return { ok: true, verified: true, media: this.mediaSnap(params.tabId) } as T;
      }
    }
    throw new Error(`unknown method ${method}`);
  }

  // --- simulated web ----------------------------------------------------------

  private navigateTo(tab: FakeTab, url: string) {
    if (/mail\.google\.com/.test(url)) url = 'https://accounts.google.com/signin?continue=mail';
    tab.history = tab.history.slice(0, tab.idx + 1);
    tab.history.push(url);
    tab.idx = tab.history.length - 1;
    this.onLoad(tab);
  }

  private onLoad(tab: FakeTab) {
    const url = tab.history[tab.idx];
    if (/youtube\.com\/watch/.test(url)) {
      this.media.set(tab.id, { paused: !this.autoplay, currentTime: 0, duration: 900, volume: 0.8, muted: false, playbackRate: 1, fullscreen: false });
    } else {
      this.media.delete(tab.id);
    }
  }

  resultsFor(url: string): SearchResultItem[] {
    const u = new URL(url);
    if (u.hostname.endsWith('youtube.com') && u.pathname === '/results') {
      const q = u.searchParams.get('search_query') || '';
      return [1, 2, 3, 4, 5].map((i) => ({
        index: i - 1,
        title: `${q} video ${i}`,
        url: `https://www.youtube.com/watch?v=${slug(q)}${i}`,
        channel: `Channel ${i}`,
        duration: `${10 + i}:00`,
        type: 'video' as const,
      }));
    }
    if (u.hostname.endsWith('google.com') && u.pathname === '/search') {
      const q = u.searchParams.get('q') || '';
      const videos = u.searchParams.get('tbm') === 'vid';
      return [1, 2, 3].map((i) => ({
        index: i - 1,
        title: `${q} ${videos ? 'video' : 'page'} ${i}`,
        url: videos ? `https://www.youtube.com/watch?v=g${slug(q)}${i}` : `https://example.com/${slug(q)}/${i}`,
        type: videos ? ('video' as const) : ('web' as const),
      }));
    }
    if (u.hostname.endsWith('youtube.com') && u.pathname === '/watch') {
      const v = u.searchParams.get('v');
      return [1, 2].map((i) => ({ index: i - 1, title: `Related ${i}`, url: `https://www.youtube.com/watch?v=${v}r${i}`, type: 'related' as const }));
    }
    return [];
  }

  private filterTabsFor(url: string) {
    const u = new URL(url);
    if (!(u.hostname.endsWith('google.com') && u.pathname === '/search')) return [];
    const videos = u.searchParams.get('tbm') === 'vid';
    return [
      { name: 'All', elementId: 'f1', selected: !videos },
      { name: 'Videos', elementId: 'f2', selected: videos },
      { name: 'Images', elementId: 'f3', selected: false },
    ];
  }

  private elementsFor(url: string): PageElement[] {
    if (/shop\.example/.test(url)) {
      return [
        { id: 'e4', role: 'link', label: 'Product details', href: 'https://shop.example/details' },
        { id: 'e5', role: 'button', label: 'Buy now', inputType: 'button' },
      ];
    }
    return [{ id: 'e1', role: 'input', label: 'Search', inputType: 'text', form: 'search' }];
  }

  private mediaSnap(tabId: number): MediaSnapshot | null {
    const m = this.media.get(tabId);
    if (!m) return null;
    return {
      present: true,
      paused: m.paused,
      ended: false,
      buffering: false,
      currentTime: m.currentTime,
      duration: m.duration,
      volume: m.volume,
      muted: m.muted,
      playbackRate: m.playbackRate,
      fullscreen: m.fullscreen,
      maximized: false,
      title: `Title of ${new URL(this.currentUrl(tabId)).searchParams.get('v')}`,
      playerType: 'youtube',
    };
  }

  private snapshot(tabId: number): PageSnapshot {
    const url = this.currentUrl(tabId);
    const u = new URL(url);
    if (!this.browserAccess) {
      return {
        tabId, url, title: `Page ${u.hostname}${u.pathname}`, pageKind: 'restricted', access: 'permission_required',
        results: [], filterTabs: [], elements: [], media: null, auth: { needsLogin: false }, textSummary: '', at: Date.now(),
      };
    }
    let pageKind: PageSnapshot['pageKind'] = 'generic';
    if (u.hostname.endsWith('youtube.com')) pageKind = u.pathname === '/watch' ? 'youtube_watch' : u.pathname === '/results' ? 'youtube_search' : 'youtube_home';
    else if (u.hostname.endsWith('google.com') && u.pathname === '/search') pageKind = u.searchParams.get('tbm') === 'vid' ? 'google_videos' : 'google_serp';
    else if (u.hostname === 'accounts.google.com') pageKind = 'login_page';
    return {
      tabId,
      url,
      title: `Page ${u.hostname}${u.pathname}`,
      pageKind,
      query: u.searchParams.get('q') || u.searchParams.get('search_query') || undefined,
      results: this.resultsFor(url),
      filterTabs: this.filterTabsFor(url),
      elements: this.elementsFor(url),
      media: this.mediaSnap(tabId),
      auth: { needsLogin: pageKind === 'login_page' },
      textSummary: '',
      access: 'full',
      site: u.hostname.replace(/^www./, ''),
      tabs: [...this.tabs.values()].map((t) => ({ id: t.id, url: t.history[t.idx], title: 'tab', active: t.id === this.activeTab })),
      at: Date.now(),
    };
  }
}

/** Model that replays a script. Each entry decides the calls for one generate() request. */
export class ScriptedModel implements ModelClient {
  requests: ModelRequest[] = [];
  constructor(private script: Array<(req: ModelRequest) => ModelFunctionCall[] | string>) {}
  available() {
    return true;
  }
  push(...steps: Array<(req: ModelRequest) => ModelFunctionCall[] | string>) {
    this.script.push(...steps);
  }
  async generate(req: ModelRequest): Promise<ModelResponse> {
    this.requests.push({ ...req, contents: JSON.parse(JSON.stringify(req.contents)) });
    const step = this.script.shift();
    if (!step) throw new Error('ScriptedModel: script exhausted');
    const out = step(req);
    if (typeof out === 'string') {
      return { content: { role: 'model', parts: [{ text: out }] }, functionCalls: [], text: out };
    }
    const content: Content = { role: 'model', parts: out.map((c) => ({ functionCall: { name: c.name, args: c.args, id: c.id } })) };
    return { content, functionCalls: out, text: '' };
  }
}

/** The text of the latest user turn in a request (context + user message). */
export function lastUserText(req: ModelRequest): string {
  for (let i = req.contents.length - 1; i >= 0; i--) {
    const c = req.contents[i];
    const text = (c.parts || []).map((p) => p.text || '').join('');
    if (c.role === 'user' && text) return text;
  }
  return '';
}

export const inMemoryStore = () => {
  const items: any[] = [];
  return {
    items,
    getAll: () => items,
    add: (m: any) => {
      const saved = { ...m, id: `m${items.length + 1}`, timestamp: Date.now() };
      items.push(saved);
      return saved;
    },
  };
};
