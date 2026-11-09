import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageSnapshot } from '../../src/utils/browserContextManager.ts';
import { WorkingMemory, normalizeVideoUrl } from './workingMemory.ts';

const isSage = (url: string) => url.startsWith('http://localhost:3000');

function snap(partial: Partial<PageSnapshot>): PageSnapshot {
  return {
    tabId: 7,
    url: 'https://example.com',
    title: 'Example',
    pageKind: 'generic',
    results: [],
    filterTabs: [],
    elements: [],
    media: null,
    auth: { needsLogin: false },
    textSummary: '',
    at: Date.now(),
    ...partial,
  };
}

const ytResults = [1, 2, 3].map((i) => ({ index: i - 1, title: `React ${i}`, url: `https://www.youtube.com/watch?v=r${i}`, type: 'video' as const }));

const media = (paused: boolean) => ({
  present: true,
  paused,
  ended: false,
  buffering: false,
  currentTime: 12,
  duration: 600,
  volume: 0.7,
  muted: false,
  playbackRate: 1,
  fullscreen: false,
  maximized: false,
  title: 'React 2',
  playerType: 'youtube' as const,
});

test('search observations become the last search; watch pages become verified media', () => {
  const wm = new WorkingMemory(isSage);
  wm.applySnapshot(snap({ url: 'https://www.youtube.com/results?search_query=react', pageKind: 'youtube_search', query: 'react', results: ytResults }));
  assert.equal(wm.lastSearch?.query, 'react');
  assert.equal(wm.currentResults().length, 3);
  assert.equal(wm.workingTabId, 7);

  wm.applySnapshot(snap({ url: 'https://www.youtube.com/watch?v=r2', pageKind: 'youtube_watch', media: media(false) }));
  assert.ok(wm.hasActiveMedia());
  assert.ok(wm.hasWatched('https://www.youtube.com/watch?v=r2&t=30s'));
  assert.equal(wm.toContext().activeMedia.isPlaying, true);
  assert.equal(wm.lastSearch?.results.length, 3, 'the earlier search is remembered for "find another one"');

  // Navigating that tab away from the video clears the media.
  wm.applySnapshot(snap({ url: 'https://www.google.com/', pageKind: 'generic' }));
  assert.equal(wm.hasActiveMedia(), false);
});

test("SAGE's own UI tab is never treated as the working context", () => {
  const wm = new WorkingMemory(isSage);
  wm.applySnapshot(snap({ tabId: 1, url: 'https://www.youtube.com/results?search_query=x', pageKind: 'youtube_search', results: ytResults }));
  wm.applySnapshot(snap({ tabId: 2, url: 'http://localhost:3000/' }));
  wm.applyEvent({ event: 'tab_activated', data: { tabId: 2, url: 'http://localhost:3000/' } });
  assert.equal(wm.workingTabId, 1);
  wm.applyEvent({ event: 'tab_activated', data: { tabId: 9, url: 'https://github.com/' } });
  assert.equal(wm.workingTabId, 9, 'switching to another site manually moves the context');
});

test('pushed media events update state; closing the tab clears it', () => {
  const wm = new WorkingMemory(isSage);
  wm.applySnapshot(snap({ url: 'https://www.youtube.com/watch?v=r1', pageKind: 'youtube_watch', media: media(false) }));
  wm.applyEvent({ event: 'media_state', data: { tabId: 7, media: media(true) } });
  assert.equal(wm.toContext().activeMedia.isPaused, true);
  wm.applyEvent({ event: 'tab_removed', data: { tabId: 7 } });
  assert.equal(wm.hasActiveMedia(), false);
  assert.equal(wm.workingTabId, null);
});

test('replaceObjective resets task state but keeps browser context', () => {
  const wm = new WorkingMemory(isSage);
  wm.applySnapshot(snap({ url: 'https://www.youtube.com/results?search_query=minecraft', pageKind: 'youtube_search', query: 'minecraft', results: ytResults }));
  wm.objective = 'find minecraft survival';
  wm.pendingQuestion = 'which one?';
  wm.replaceObjective('Actually, search for horror games');
  assert.equal(wm.objective, 'Actually, search for horror games');
  assert.equal(wm.pendingQuestion, null);
  assert.equal(wm.lastSearch?.query, 'minecraft');
  assert.equal(wm.workingTabId, 7);
});

test('prompt summary mentions what the model needs to resolve references', () => {
  const wm = new WorkingMemory(isSage);
  wm.extensionConnected = true;
  wm.applySnapshot(snap({ url: 'https://www.youtube.com/watch?v=r2', pageKind: 'youtube_watch', media: media(true) }));
  const s = wm.summarizeForPrompt();
  assert.match(s, /Extension connected: yes/);
  assert.match(s, /PAUSED at 0:12\/10:00/);
});

test('normalizeVideoUrl recognises the same video across URL forms', () => {
  assert.equal(normalizeVideoUrl('https://www.youtube.com/watch?v=abc&t=10'), 'yt:abc');
  assert.equal(normalizeVideoUrl('https://youtu.be/abc'), 'yt:abc');
  assert.equal(normalizeVideoUrl('https://www.youtube.com/shorts/abc'), 'yt:abc');
});
