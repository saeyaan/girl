import test from 'node:test';
import assert from 'node:assert/strict';
import { decideFastPath, normalizeCommand, parseMediaIntent, parseOrdinalCommand } from './fastPath.ts';
import { WorkingMemory } from './workingMemory.ts';

test('normalizeCommand strips wake words, politeness and punctuation', () => {
  assert.equal(normalizeCommand('Hey Sage, open the second one.'), 'open the second one');
  assert.equal(normalizeCommand('Now make it full screen!'), 'make it full screen');
  assert.equal(normalizeCommand('Please pause the video please'), 'pause the video');
});

test('ordinal references', () => {
  assert.deepEqual(parseOrdinalCommand('Open the second one.'), { position: 2, play: false });
  assert.deepEqual(parseOrdinalCommand('play the first video'), { position: 1, play: true });
  assert.deepEqual(parseOrdinalCommand('the 3rd result'), { position: 3, play: false });
  assert.deepEqual(parseOrdinalCommand('open result 4'), { position: 4, play: false });
  assert.deepEqual(parseOrdinalCommand('open the last one'), { position: -1, play: false });
  assert.deepEqual(parseOrdinalCommand('दूसरा वाला चलाओ'), { position: 2, play: true });
  assert.equal(parseOrdinalCommand('find something better than the first one'), null);
  assert.equal(parseOrdinalCommand('first, search for cats'), null);
});

test('media intents cover natural phrasing', () => {
  assert.deepEqual(parseMediaIntent('Skip 30 seconds.', true), { action: 'seek', value: 30 });
  assert.deepEqual(parseMediaIntent('go back 10 seconds', true), { action: 'seek', value: -10 });
  assert.deepEqual(parseMediaIntent('skip forward 2 minutes', true), { action: 'seek', value: 120 });
  assert.deepEqual(parseMediaIntent('Lower the volume', true), { action: 'volume_down', value: 15 });
  assert.deepEqual(parseMediaIntent('make it full screen', true), { action: 'fullscreen' });
  assert.deepEqual(parseMediaIntent('exit full screen', true), { action: 'exit_fullscreen' });
  assert.deepEqual(parseMediaIntent('play the video at 2x speed', true), { action: 'speed', value: 2 });
  assert.deepEqual(parseMediaIntent('Mute the video', true), { action: 'mute' });
  assert.deepEqual(parseMediaIntent('resume playing', true), { action: 'play' });
  assert.deepEqual(parseMediaIntent('pause', true), { action: 'pause' });
  assert.deepEqual(parseMediaIntent('play the next video', true), { action: 'next' });
  assert.deepEqual(parseMediaIntent('set volume to 40 percent', true), { action: 'volume_set', value: 40 });
});

test('media intents do not hijack search requests', () => {
  assert.equal(parseMediaIntent('find a 3x3 rubik cube tutorial', true), null);
  assert.equal(parseMediaIntent('find another video like this', true), null);
  assert.equal(parseMediaIntent('search for this video full version', true), null);
  assert.equal(parseMediaIntent('stop', false), null, 'bare "stop" only pauses when a video exists');
});

test('decideFastPath: play with no video asks the right question', () => {
  const wm = new WorkingMemory();
  assert.deepEqual(decideFastPath('play it', wm), { kind: 'ask', key: 'noVideo' });
  wm.lastSearch = {
    query: 'q',
    engine: 'youtube',
    tabId: 1,
    url: 'https://www.youtube.com/results?search_query=q',
    at: Date.now(),
    results: [
      { index: 0, title: 'a', url: 'https://www.youtube.com/watch?v=a' },
      { index: 1, title: 'b', url: 'https://www.youtube.com/watch?v=b' },
    ],
  };
  assert.deepEqual(decideFastPath('play that video', wm), { kind: 'ask', key: 'whichResult', count: 2 });
});

test('decideFastPath leaves compound and fuzzy requests to the reasoning loop', () => {
  const wm = new WorkingMemory();
  assert.equal(decideFastPath('Find a video about neural networks, open a good one, and play it', wm), null);
  assert.equal(decideFastPath('find something more advanced', wm), null);
  assert.equal(decideFastPath('open the second one', wm), null, 'no results known yet');
});
