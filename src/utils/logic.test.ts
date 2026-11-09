import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBrowserCommand, normalizeUrlOrSearch } from './browserCommands.ts';
import { scoreMemoryRelevance, findRelevantMemories, detectMemoryIntent, MemoryItem } from './memoryMatcher.ts';
import { detectLanguage, cleanTextForSpeech, getEmotionSpeechParameters } from './conversationUtils.ts';

test('Browser command parsing handles shortcuts correctly', () => {
  const ytAction = parseBrowserCommand('Open YouTube');
  assert.ok(ytAction);
  assert.equal(ytAction?.type, 'open_url');
  assert.equal(ytAction?.targetUrl, 'https://www.youtube.com');

  const ytNewTab = parseBrowserCommand('Open YouTube in a new tab');
  assert.ok(ytNewTab);
  assert.equal(ytNewTab?.type, 'open_url');
  assert.equal(ytNewTab?.targetUrl, 'https://www.youtube.com');

  const taskAction = parseBrowserCommand('assign chrome task: open youtube in another tab');
  assert.ok(taskAction);
  assert.equal(taskAction?.type, 'open_url');
  assert.equal(taskAction?.targetUrl, 'https://www.youtube.com');

  const githubAction = parseBrowserCommand('please open github');
  assert.ok(githubAction);
  assert.equal(githubAction?.type, 'open_url');
  assert.equal(githubAction?.targetUrl, 'https://github.com');
});

test('Browser command parsing handles queries and custom domains', () => {
  const searchAction = parseBrowserCommand('Search for Python tutorials');
  assert.ok(searchAction);
  assert.equal(searchAction?.type, 'search');
  assert.equal(searchAction?.query, 'Python tutorials');

  const namitSearch = parseBrowserCommand('google search about namit malhotras rmayana in a new tab in my chrome');
  assert.ok(namitSearch);
  assert.equal(namitSearch?.type, 'search');
  assert.equal(namitSearch?.query, 'namit malhotras rmayana');
  assert.equal(namitSearch?.targetUrl, 'https://www.google.com/search?q=namit%20malhotras%20rmayana');

  const directUrl = normalizeUrlOrSearch('https://example.com');
  assert.equal(directUrl.url, 'https://example.com/');
  assert.equal(directUrl.isSearch, false);

  const domainUrl = normalizeUrlOrSearch('wikipedia.org');
  assert.equal(domainUrl.url, 'https://wikipedia.org');
  assert.equal(domainUrl.isSearch, false);
});

test('Browser command parsing handles YouTube playback controls', () => {
  const playCmd = parseBrowserCommand('play this music bohemian rhapsody');
  assert.ok(playCmd);
  assert.equal(playCmd?.type, 'youtube_play');
  assert.equal(playCmd?.trackName, 'bohemian rhapsody');
  assert.equal(playCmd?.targetUrl, 'https://www.youtube.com/results?search_query=bohemian%20rhapsody');

  const changeThisCmd = parseBrowserCommand('change to this shape of you');
  assert.ok(changeThisCmd);
  assert.equal(changeThisCmd?.type, 'youtube_change');
  assert.equal(changeThisCmd?.trackName, 'shape of you');

  const changeCmd = parseBrowserCommand('change to kesariya');
  assert.ok(changeCmd);
  assert.equal(changeCmd?.type, 'youtube_change');
  assert.equal(changeCmd?.trackName, 'kesariya');

  const pauseCmd = parseBrowserCommand('pause youtube');
  assert.ok(pauseCmd);
  assert.equal(pauseCmd?.type, 'youtube_pause');

  const resumeCmd = parseBrowserCommand('resume music');
  assert.ok(resumeCmd);
  assert.equal(resumeCmd?.type, 'youtube_resume');

  const nextCmd = parseBrowserCommand('next song');
  assert.ok(nextCmd);
  assert.equal(nextCmd?.type, 'youtube_next');

  const hindiPlay = parseBrowserCommand('गाना चलाओ');
  assert.ok(hindiPlay);
  assert.equal(hindiPlay?.type, 'youtube_play');
});

test('Memory matching scores relevant user facts and personal information', () => {
  const sampleMemories: MemoryItem[] = [
    {
      id: '1',
      category: 'profile',
      key: 'User Name',
      value: 'Sarah Connor',
      confidence: 1,
      timestamp: Date.now(),
      tags: ['name', 'identity']
    },
    {
      id: '2',
      category: 'preference',
      key: 'Favorite Drink',
      value: 'Matcha Green Tea Latte with oat milk',
      confidence: 0.9,
      timestamp: Date.now(),
      tags: ['drink', 'tea', 'latte', 'coffee']
    },
    {
      id: '3',
      category: 'fact',
      key: 'Pet Name',
      value: 'Golden retriever named Luna',
      confidence: 0.8,
      timestamp: Date.now(),
      tags: ['dog', 'pet', 'luna']
    }
  ];

  const matched = findRelevantMemories('What is my favorite drink?', sampleMemories);
  assert.ok(matched.length > 0);
  assert.equal(matched[0].key, 'Favorite Drink');

  const nameIntent = detectMemoryIntent('My name is Alex');
  assert.equal(nameIntent.shouldRemember, true);
  assert.equal(nameIntent.category, 'profile');
  assert.equal(nameIntent.extractedValue, 'Alex');
});

test('Language detection accurately identifies English, Hindi, and Bengali', () => {
  assert.equal(detectLanguage('Hello, how can I help you today?'), 'en');
  assert.equal(detectLanguage('नमस्ते, आप कैसे हैं?'), 'hi');
  assert.equal(detectLanguage('কেমন আছেন? আমি আপনাকে সাহায্য করতে পারি।'), 'bn');
});

test('Speech text cleaner removes markdown formatting', () => {
  const raw = 'Here is **bold** text and a [link](https://test.com) with `code`.';
  const cleaned = cleanTextForSpeech(raw);
  assert.equal(cleaned, 'Here is bold text and a link with code.');
});

test('Emotion parameters provide appropriate pitch and rate modulation', () => {
  const happy = getEmotionSpeechParameters('happy');
  assert.ok(happy.pitch > 1.0);
  const thoughtful = getEmotionSpeechParameters('thoughtful');
  assert.ok(thoughtful.rate < 1.0);
});

test('Context-Aware Reference Resolver resolves ordinals and search filters', async () => {
  const { resolveContextualReference, initialBrowserContext } = await import('./browserContextManager.ts');

  const contextWithResults = {
    ...initialBrowserContext,
    lastSearchQuery: 'machine learning',
    searchResults: [
      { index: 0, title: 'Intro to Machine Learning', url: 'https://youtube.com/watch?v=123' },
      { index: 1, title: 'Deep Learning Crash Course', url: 'https://youtube.com/watch?v=456' },
      { index: 2, title: 'Neural Networks 101', url: 'https://youtube.com/watch?v=789' },
    ],
  };

  // 1. Ordinals
  const firstRes = resolveContextualReference('play the first one', contextWithResults);
  assert.equal(firstRes.isContextual, true);
  assert.equal(firstRes.resolvedTargetUrl, 'https://youtube.com/watch?v=123');

  const secondRes = resolveContextualReference('open the second result', contextWithResults);
  assert.equal(secondRes.isContextual, true);
  assert.equal(secondRes.resolvedTargetUrl, 'https://youtube.com/watch?v=456');

  // 2. Search filters: "Go to the Videos tab"
  const videosFilter = resolveContextualReference('Go to the Videos tab', contextWithResults);
  assert.equal(videosFilter.isContextual, true);
  assert.ok(videosFilter.resolvedTargetUrl?.includes('&tbm=vid'));

  // 3. Pronoun controls: "make it full screen", "play it"
  const fsRes = resolveContextualReference('make it full screen', contextWithResults);
  assert.equal(fsRes.isContextual, true);
  assert.equal(fsRes.videoCommand?.action, 'fullscreen');

  const playItRes = resolveContextualReference('play it', contextWithResults);
  assert.equal(playItRes.isContextual, true);
  assert.equal(playItRes.videoCommand?.action, 'play');
});

test('SAGE Task Planner breaks compound human requests into ordered steps', async () => {
  const { isMultiStepGoal, planTask } = await import('./taskPlanner.ts');

  assert.equal(isMultiStepGoal('Find a video explaining how neural networks work, open a good one, and play it'), true);
  assert.equal(isMultiStepGoal('Open Gmail, go to my inbox, and search for emails from Google'), true);

  const neuralPlan = planTask('Find a video explaining how neural networks work, open a good one, and play it');
  assert.ok(neuralPlan.steps.length >= 4);
  assert.equal(neuralPlan.steps[0].actionType, 'analyze_intent');
  assert.ok(neuralPlan.steps.some((s) => s.actionType === 'video_play'));

  const gmailPlan = planTask('Open Gmail, go to my inbox, and search for emails from Google');
  assert.ok(gmailPlan.steps.length >= 3);
  assert.ok(gmailPlan.steps.some((s) => s.targetUrl?.includes('mail.google.com')));
});

test('Intelligent Video Controller parses speed, seek, and volume commands', async () => {
  const { parseVideoCommand } = await import('./videoController.ts');

  const seekForward = parseVideoCommand('skip forward 30 seconds');
  assert.ok(seekForward);
  assert.equal(seekForward?.action, 'seek');
  assert.equal(seekForward?.value, 30);

  const seekBack = parseVideoCommand('go back 10 seconds');
  assert.ok(seekBack);
  assert.equal(seekBack?.action, 'seek');
  assert.equal(seekBack?.value, -10);

  const speed2x = parseVideoCommand('play the video at 2x speed');
  assert.ok(speed2x);
  assert.equal(speed2x?.action, 'speed');
  assert.equal(speed2x?.value, 2.0);

  const muteCmd = parseVideoCommand('mute the video');
  assert.ok(muteCmd);
  assert.equal(muteCmd?.action, 'mute');

  const fsCmd = parseVideoCommand('make it fullscreen');
  assert.ok(fsCmd);
  assert.equal(fsCmd?.action, 'fullscreen');
});

test('SAGE agent (no model, no extension) handles conversational queries and browser actions', async () => {
  const { SageAgent } = await import('../../server/agent/agentLoop.ts');
  const { WorkingMemory } = await import('../../server/agent/workingMemory.ts');
  const offlineBridge = {
    isConnected: () => false,
    call: async () => {
      throw new Error('offline');
    },
    onEvent: () => {},
    onStatus: () => {},
    broadcastUi: () => {},
  };
  const memories: any[] = [];
  const agent = new SageAgent({
    bridge: offlineBridge,
    wm: new WorkingMemory(),
    model: { available: () => false, generate: async () => { throw new Error('no model'); } },
    memory: { getAll: () => memories, add: (m: any) => ({ ...m, id: 'x', timestamp: Date.now() }) },
  });

  // Test 1: informational request → Google search, opened by the web app because the extension is offline
  const ramayanaResult = await agent.run({ message: 'tell me about namit malhotras ramayana' });
  assert.ok(ramayanaResult.replyText);
  assert.equal(ramayanaResult.browserAction?.type, 'search');
  assert.ok(ramayanaResult.fallbackOpenUrl?.includes('google.com/search'));

  // Test 2: music request → YouTube search
  const ytResult = await agent.run({ message: 'play this music shape of you' });
  assert.ok(ytResult.fallbackOpenUrl?.includes('youtube.com/results?search_query=shape%20of%20you'));

  // Test 3: Multilingual Hindi greeting
  const hiResult = await agent.run({ message: 'नमस्ते, आप कैसी हैं?' });
  assert.equal(hiResult.detectedLanguage, 'hi');
  assert.ok(hiResult.replyText.length > 0);
});

test('generateSpeechAudio returns safely without unhandled payload exceptions', async () => {
  const { generateSpeechAudio } = await import('../../server/geminiService.ts');

  const ttsRes = await generateSpeechAudio('Hello, this is a test speech synthesis.');
  assert.ok(ttsRes);
  assert.equal(typeof ttsRes.mimeType, 'string');
  // Either returns valid base64 audio string or null for client fallback
  assert.ok(ttsRes.audioBase64 === null || typeof ttsRes.audioBase64 === 'string');
});

