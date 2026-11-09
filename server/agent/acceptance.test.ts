import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageSnapshot } from '../../src/utils/browserContextManager.ts';
import { SageAgent } from './agentLoop.ts';
import { parseResultQuestion } from './fastPath.ts';
import { matchElementByDescription } from './tools.ts';
import { WorkingMemory } from './workingMemory.ts';
import { FakeBrowser, ScriptedModel, inMemoryStore, lastUserText } from './testFakes.ts';

function setup(model: ScriptedModel | null) {
  const browser = new FakeBrowser();
  const wm = new WorkingMemory();
  const m = model || { available: () => false, generate: async () => { throw new Error('no model'); } };
  const agent = new SageAgent({ bridge: browser, wm, model: m, memory: inMemoryStore(), limits: { totalMs: 10000 } });
  return { browser, wm, agent };
}
const call = (name: string, args: Record<string, unknown> = {}) => ({ name, args });
const lastResponse = (req: any) => (req.contents[req.contents.length - 1].parts?.[0] as any)?.functionResponse;

test('acceptance conversation (with model): open tab → search → Videos tab → first result → play it', async () => {
  const model = new ScriptedModel([]);
  const { browser, wm, agent } = setup(model);
  await browser.call('open_url', { url: 'https://github.com/', newTab: true }); // what the user already has open

  model.push(
    () => [call('get_active_tab')],
    (req) => {
      assert.match(lastResponse(req).response.message, /Page github\.com/);
      return [call('finish', { reply: 'You have GitHub open.' })];
    }
  );
  const r1 = await agent.run({ message: 'Maya, what is currently open in my browser?' });
  assert.equal(r1.replyText, 'You have GitHub open.');

  const searchCalls = model.requests.length;
  const r2 = await agent.run({ message: 'Search for machine learning tutorials.' });
  assert.equal(model.requests.length, searchCalls, 'a plain search is done directly, exactly as asked');
  assert.equal(r2.reasoningPipeline.mode, 'fast');
  assert.match(browser.currentUrl(), /google\.com\/search\?q=machine%20learning%20tutorials/);

  const r3 = await agent.run({ message: 'Go to the Videos tab.' });
  assert.equal(r3.reasoningPipeline.mode, 'fast');
  assert.match(browser.currentUrl(), /tbm=vid/);

  model.push((req) => {
    assert.match(lastUserText(req), /1\. "machine learning tutorials video 1"/, 'the model sees the real results');
    return [call('finish', { reply: 'The first result is "machine learning tutorials video 1".' })];
  });
  const r4 = await agent.run({ message: 'Which is the first result?' });
  assert.match(r4.replyText, /video 1/);
  assert.equal(wm.referencedResult?.position, 1);

  const before = model.requests.length;
  const r5 = await agent.run({ message: 'Play it.' });
  assert.equal(model.requests.length, before, '"play it" resolves to the result just discussed');
  assert.equal(browser.currentUrl(), 'https://www.youtube.com/watch?v=gmachinelearningtutorials1');
  assert.equal(browser.mediaOf()?.paused, false);
  assert.match(r5.replyText, /playing/);
});

test('"play it" after asking about a result plays THAT result, even when another video is open', async () => {
  const { browser, wm, agent } = setup(null);
  await browser.call('open_url', { url: 'https://www.youtube.com/results?search_query=ml', newTab: true });
  await agent.run({ message: 'open the first one' }); // a video is now open; the page lists related videos
  assert.ok(wm.hasActiveMedia());
  await agent.run({ message: 'Which is the second result?' });
  await agent.run({ message: 'Play it.' });
  assert.match(browser.currentUrl(), /watch\?v=ml1r2$/, 'opened the related video that was discussed');
  assert.equal(browser.mediaOf()?.paused, false);
  // The reference only lasts one turn: a later "play it" just resumes what is open.
  await agent.run({ message: 'pause' });
  await agent.run({ message: 'play it' });
  assert.match(browser.currentUrl(), /watch\?v=ml1r2$/);
});

test('acceptance conversation (offline engine) works without a model too', async () => {
  const { browser, agent } = setup(null);
  await browser.call('open_url', { url: 'https://github.com/', newTab: true });
  const r1 = await agent.run({ message: 'Maya, what is currently open in my browser?' });
  assert.match(r1.replyText, /github\.com/);
  await agent.run({ message: 'Search for machine learning tutorials.' });
  await agent.run({ message: 'Go to the Videos tab.' });
  const r4 = await agent.run({ message: 'Which is the first result?' });
  assert.match(r4.replyText, /Result 1 is "machine learning tutorials video 1"/);
  const r5 = await agent.run({ message: 'Play it.' });
  assert.equal(browser.mediaOf()?.paused, false);
  assert.match(r5.replyText, /playing/);
});

test('without browser access SAGE still knows the tab, and explains the missing permission', async () => {
  const { browser, agent } = setup(null);
  await browser.call('open_url', { url: 'https://www.youtube.com/watch?v=abc', newTab: true });
  browser.browserAccess = false;
  const r1 = await agent.run({ message: 'what is open in my browser' });
  assert.match(r1.replyText, /youtube\.com/);
  const r2 = await agent.run({ message: 'pause' });
  assert.match(r2.replyText, /Enable Browser Access/);
  assert.equal(r2.browserContext.pageAccess, 'permission_required');
});

test('screen capture happens only when enabled, and the image reaches the model', async () => {
  const model = new ScriptedModel([
    () => [call('capture_visible_screen')],
    (req) => {
      const fr = lastResponse(req);
      assert.equal(fr.response.error, 'screen_capture_disabled');
      assert.equal(fr.parts, undefined);
      return [call('finish', { reply: 'Screen capture is off.' })];
    },
  ]);
  const { browser, agent } = setup(model);
  await browser.call('open_url', { url: 'https://www.google.com/search?q=x', newTab: true });
  await agent.run({ message: 'what is on my screen?' });
  assert.equal(browser.callsOf('capture').length, 0);

  model.push(
    () => [call('capture_visible_screen')],
    (req) => {
      const fr = lastResponse(req);
      assert.equal(fr.response.ok, true);
      assert.equal(fr.parts?.[0]?.inlineData?.mimeType, 'image/jpeg');
      return [call('finish', { reply: 'I can see Google results.' })];
    }
  );
  const r = await agent.run({ message: 'what is on my screen?', allowScreenCapture: true });
  assert.equal(r.replyText, 'I can see Google results.');
  assert.ok(browser.ui.some((u) => u.type === 'screen_captured'), 'the user is told a screenshot was taken');
});

test('result questions', () => {
  assert.deepEqual(parseResultQuestion('Which is the first result?'), { position: 1 });
  assert.deepEqual(parseResultQuestion("Maya, what's the second video?"), { position: 2 });
  assert.equal(parseResultQuestion('which result is best for beginners?'), null);
});

test('click targets resolve from descriptions, not coordinates', () => {
  const snap = {
    tabId: 1, url: 'https://www.youtube.com/watch?v=1', title: 't', pageKind: 'youtube_watch', results: [], media: null,
    auth: { needsLogin: false }, textSummary: '', at: 0,
    filterTabs: [{ name: 'Videos', elementId: 'f2' }],
    elements: [
      { id: 'e1', role: 'button', label: 'Subscribe' },
      { id: 'e2', role: 'link', label: 'Show more comments' },
      { id: 'e3', role: 'button', label: 'Share' },
      { id: 'e4', role: 'input', label: 'Search', form: 'search' },
      { id: 'e5', role: 'button', label: 'Save to playlist' },
      { id: 'e6', role: 'button', label: 'Save' },
    ],
  } as unknown as PageSnapshot;
  const m = (d: string) => matchElementByDescription(snap, d) as any;
  assert.equal(m('the Subscribe button').element.id, 'e1');
  assert.equal(m('Videos tab').element.id, 'f2');
  assert.equal(m('search box').element.id, 'e4');
  assert.equal(m('more comments').element.id, 'e2');
  assert.equal(m('Save').element.id, 'e6', 'exact label wins');
  assert.equal(m('download').kind, 'none');
});
