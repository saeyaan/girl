import test from 'node:test';
import assert from 'node:assert/strict';
import { SageAgent, enforceHonesty, offlineSearchArgs } from './agentLoop.ts';
import { WorkingMemory } from './workingMemory.ts';
import { FakeBrowser, ScriptedModel, inMemoryStore, lastUserText } from './testFakes.ts';

function setup(opts: { model?: ScriptedModel | null } = {}) {
  const browser = new FakeBrowser();
  const wm = new WorkingMemory((url) => url.startsWith('http://localhost:3000'));
  const model = opts.model === null ? { available: () => false, generate: async () => { throw new Error('no model'); } } : opts.model || new ScriptedModel([]);
  const agent = new SageAgent({ bridge: browser, wm, model, memory: inMemoryStore(), limits: { totalMs: 10000 } });
  return { browser, wm, agent, model };
}

const call = (name: string, args: Record<string, unknown> = {}) => ({ name, args });

test('spec conversation: find a React tutorial → second one → play → skip → fullscreen → more advanced', async () => {
  const model = new ScriptedModel([
    () => [call('web_search', { query: 'react tutorial', engine: 'youtube' })],
    () => [call('finish', { reply: 'Here are some React tutorials on YouTube.' })],
  ]);
  const { browser, wm, agent } = setup({ model });

  const t1 = await agent.run({ message: 'Hey Sage, find a React tutorial.' });
  assert.equal(t1.reasoningPipeline.mode, 'llm');
  assert.match(browser.currentUrl(), /youtube\.com\/results\?search_query=react%20tutorial/);
  assert.equal(wm.lastSearch?.results.length, 5);

  // "Open the second one" resolves against the results actually on the page — no model call needed.
  const before = model.requests.length;
  const t2 = await agent.run({ message: 'Open the second one.' });
  assert.equal(model.requests.length, before, 'fast path should not call the model');
  assert.equal(t2.reasoningPipeline.mode, 'fast');
  assert.equal(browser.currentUrl(), 'https://www.youtube.com/watch?v=reacttutorial2');
  assert.equal(wm.selectedResult?.index, 1);

  // "Play it" → the opened video; reply only claims playing because the player confirms it.
  assert.equal(browser.mediaOf()?.paused, true);
  const t3 = await agent.run({ message: 'Play it.' });
  assert.equal(browser.mediaOf()?.paused, false);
  assert.match(t3.replyText, /playing/i);
  assert.equal(t3.browserContext.activeMedia.isPlaying, true);
  assert.equal(t3.browserContext.activeMedia.verified, true);

  const t4 = await agent.run({ message: 'Skip 30 seconds.' });
  assert.equal(Math.round(browser.mediaOf()!.currentTime), 31);
  assert.match(t4.replyText, /forward 30 seconds/);

  const t5 = await agent.run({ message: 'Make it full screen.' });
  assert.equal(browser.mediaOf()?.fullscreen, true);
  assert.match(t5.replyText, /fullscreen/i);
  assert.equal(wm.fullscreenMode, 'window');

  // "Find something more advanced" → reasoning loop, with the previous search visible in context.
  model.push(
    (req) => {
      const ctx = lastUserText(req);
      assert.match(ctx, /Last search: "react tutorial"/);
      assert.match(ctx, /PLAYING/);
      return [call('web_search', { query: 'advanced react tutorial', engine: 'youtube' })];
    },
    () => [call('finish', { reply: 'I found some more advanced React tutorials.' })]
  );
  const t6 = await agent.run({ message: 'Find something more advanced.' });
  assert.match(browser.currentUrl(), /search_query=advanced%20react%20tutorial/);
  assert.equal(t6.replyText, 'I found some more advanced React tutorials.');
  assert.equal(wm.lastSearch?.query, 'advanced react tutorial');
});

test('google flow: search → Videos tab (same query, no new search) → open second → pause → go back', async () => {
  const model = new ScriptedModel([]);
  const { browser, agent } = setup({ model });
  const r0 = await agent.run({ message: 'Search for best Java tutorials.' });
  assert.equal(r0.reasoningPipeline.mode, 'fast');
  assert.equal(model.requests.length, 0);
  const searches = browser.callsOf('open_url').length;

  const tab = await agent.run({ message: 'Go to the Videos tab.' });
  assert.equal(browser.callsOf('open_url').length, searches, 'must not run another search');
  assert.match(browser.currentUrl(), /q=best%20Java%20tutorials&tbm=vid/);
  assert.match(tab.replyText, /Videos tab/);

  await agent.run({ message: 'Open the second result.' });
  assert.equal(browser.currentUrl(), 'https://www.youtube.com/watch?v=gbestjavatutorials2');

  await agent.run({ message: 'Play it' });
  const p = await agent.run({ message: 'Pause.' });
  assert.equal(browser.mediaOf()?.paused, true);
  assert.match(p.replyText, /Paused/);

  const back = await agent.run({ message: 'Go back.' });
  assert.match(browser.currentUrl(), /tbm=vid/);
  assert.match(back.replyText, /Went back/);
});

test('"find another one" opens an unwatched result of the same search', async () => {
  const model = new ScriptedModel([
    () => [call('web_search', { query: 'minecraft survival', engine: 'youtube' })],
    () => [call('finish', { reply: 'Here you go.' })],
  ]);
  const { browser, agent } = setup({ model });
  await agent.run({ message: 'Search YouTube for Minecraft survival' });
  await agent.run({ message: 'open the first one' });
  assert.match(browser.currentUrl(), /minecraftsurvival1$/);

  model.push(
    () => [call('navigate', { direction: 'back' })],
    () => [call('open_result', { position: 1, skip_watched: true })],
    () => [call('finish', { reply: 'Here is another Minecraft survival video.' })]
  );
  await agent.run({ message: 'Find another one.' });
  assert.match(browser.currentUrl(), /minecraftsurvival2$/, 'should skip the already watched first result');
});

test('honesty: autoplay-blocked playback is reported, never claimed', async () => {
  const model = new ScriptedModel([
    () => [call('web_search', { query: 'lofi', engine: 'youtube' })],
    () => [call('finish', { reply: 'Found lofi videos.' })],
  ]);
  const { browser, agent, wm } = setup({ model });
  await agent.run({ message: 'find lofi music videos' });
  await agent.run({ message: 'open the first one' });
  browser.autoplayBlocked = true;
  const r = await agent.run({ message: 'play it' });
  assert.doesNotMatch(r.replyText, /is playing/i);
  assert.match(r.replyText, /Chrome blocked playback/);

  // And an over-eager model reply is corrected when the player says it is paused.
  assert.equal(enforceHonesty("It's playing now!", wm, 'en').includes('playing now'), false);
});

test('ambiguity: "play that video" asks only when the context really is ambiguous', async () => {
  const model = new ScriptedModel([
    () => [call('web_search', { query: 'cats', engine: 'youtube' })],
    () => [call('finish', { reply: 'Here are cat videos.' })],
  ]);
  const { agent, browser } = setup({ model });
  await agent.run({ message: 'find cat videos' });
  const ask = await agent.run({ message: 'play that video' });
  assert.match(ask.replyText, /Which one should I play/);
  assert.equal(browser.callsOf('media').length, 0);

  await agent.run({ message: 'open the third one' });
  const play = await agent.run({ message: 'play that video' });
  assert.match(play.replyText, /playing/);
});

test('safety: purchases are blocked until the user explicitly confirms', async () => {
  const model = new ScriptedModel([
    () => [call('open_url', { url: 'https://shop.example/item' })],
    () => [call('click_element', { element_id: 'e5' })],
    (req) => {
      const last = req.contents[req.contents.length - 1];
      const resp = (last.parts?.[0] as any)?.functionResponse?.response;
      assert.equal(resp.error, 'needs_confirmation');
      return [call('request_confirmation', { summary: 'Should I click Buy now to purchase this item?' })];
    },
  ]);
  const { browser, agent, wm } = setup({ model });
  const r1 = await agent.run({ message: 'buy this item for me on shop.example' });
  assert.equal(r1.replyText, 'Should I click Buy now to purchase this item?');
  const clicks = () => browser.callsOf('page_action').filter((c) => c.params.args?.elementId === 'e5').length;
  assert.equal(clicks(), 0, 'nothing may be bought before approval');
  assert.ok(wm.pendingConfirmation);

  model.push(() => [call('finish', { reply: 'Done, I clicked Buy now.' })]);
  const r2 = await agent.run({ message: 'yes, go ahead' });
  assert.equal(clicks(), 1);
  assert.equal(r2.reasoningPipeline.mode, 'confirmation');
  assert.equal(wm.pendingConfirmation, null);
});

test('safety: "no" cancels the pending action', async () => {
  const model = new ScriptedModel([
    () => [call('open_url', { url: 'https://shop.example/item' })],
    () => [call('click_element', { element_id: 'e5' })],
    () => [call('request_confirmation', { summary: 'Buy it?' })],
  ]);
  const { browser, agent, wm } = setup({ model });
  await agent.run({ message: 'buy it' });
  const r = await agent.run({ message: 'no' });
  assert.match(r.replyText, /won't/);
  assert.equal(wm.pendingConfirmation, null);
  assert.equal(browser.callsOf('page_action').length, 0);
});

test('sign-in pages are never automated', async () => {
  const model = new ScriptedModel([
    () => [call('open_url', { url: 'https://mail.google.com' })],
    (req) => {
      const resp = (req.contents[req.contents.length - 1].parts?.[0] as any)?.functionResponse?.response;
      assert.match(resp.page, /SIGN-IN REQUIRED/);
      return [call('ask_user', { question: 'Gmail needs you to sign in. Tell me when you are done.' })];
    },
  ]);
  const { agent, wm } = setup({ model });
  const r = await agent.run({ message: 'Open Gmail, go to my inbox, and search for emails from Google' });
  assert.match(r.replyText, /sign in/);
  assert.ok(wm.pendingQuestion);
});

test('offline engine executes the multi-step template for real and reports a live plan', async () => {
  const { browser, agent } = setup({ model: null });
  const r = await agent.run({ message: 'Find a video explaining how neural networks work, open a good one, and play it' });
  assert.equal(r.reasoningPipeline.mode, 'offline');
  assert.match(browser.currentUrl(), /youtube\.com\/watch\?v=howneuralnetworkswork1/);
  assert.equal(browser.mediaOf()?.paused, false);
  assert.match(r.replyText, /playing/);
  assert.ok(r.taskPlan);
  const statuses = r.taskPlan!.steps.map((s) => s.status);
  assert.ok(!statuses.includes('failed'));
  assert.ok(browser.ui.some((u) => u.type === 'plan'), 'plan progress must be streamed to the UI');
});

test('extension offline: SAGE says so and hands the URL to the web app', async () => {
  const { browser, agent } = setup({ model: null });
  browser.connected = false;
  const r1 = await agent.run({ message: 'pause' });
  assert.match(r1.replyText, /can't see or control your browser|don't see a video/);
  const r2 = await agent.run({ message: 'search for weather in Kolkata' });
  assert.equal(r2.fallbackOpenUrl, 'https://www.google.com/search?q=weather%20in%20Kolkata');
});

test('offline search picks YouTube for video requests and cleans the query', () => {
  assert.deepEqual(offlineSearchArgs('a React tutorial video'), { query: 'React tutorial', engine: 'youtube' });
  assert.deepEqual(offlineSearchArgs('me a video about machine learning'), { query: 'machine learning', engine: 'youtube' });
  assert.deepEqual(offlineSearchArgs('weather in Kolkata'), { query: 'weather in Kolkata', engine: 'google' });
  assert.deepEqual(offlineSearchArgs('best Java tutorials'), { query: 'best Java tutorials', engine: 'google' });
});

test('a model failure before any action falls back to the offline engine', async () => {
  const failing = { available: () => true, generate: async () => { throw new Error('quota'); } };
  const browser = new FakeBrowser();
  const agent = new SageAgent({ bridge: browser, wm: new WorkingMemory(), model: failing, memory: inMemoryStore() });
  const r = await agent.run({ message: 'find java tutorials' });
  assert.equal(r.reasoningPipeline.mode, 'offline');
  assert.match(browser.currentUrl(), /google\.com\/search\?q=java%20tutorials/);
});

test('a repeated failing call is refused instead of retried blindly', async () => {
  const model = new ScriptedModel([
    () => [call('open_result', { position: 1 })],
    () => [call('open_result', { position: 1 })],
    (req) => {
      const resp = (req.contents[req.contents.length - 1].parts?.[0] as any)?.functionResponse?.response;
      assert.equal(resp.error, 'no_results');
      return [call('open_result', { position: 1 })];
    },
    (req) => {
      const resp = (req.contents[req.contents.length - 1].parts?.[0] as any)?.functionResponse?.response;
      assert.equal(resp.error, 'repeated_failure');
      return [call('ask_user', { question: 'What should I search for?' })];
    },
  ]);
  const { agent } = setup({ model });
  const r = await agent.run({ message: 'open whatever is first on the page please' });
  assert.equal(r.replyText, 'What should I search for?');
});
