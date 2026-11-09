/**
 * Localized spoken replies for the deterministic paths (fast path and offline mode).
 * The LLM path writes its own replies; these keep the no-LLM experience natural and honest.
 */

export type Lang = 'en' | 'hi' | 'bn';

type Phrase = (...a: any[]) => string;
type Table = Record<string, Phrase>;

const en: Table = {
  extensionOffline: () => "I can't see or control your browser right now. Please make sure the SAGE Chrome extension is installed and connected.",
  openedFallback: (site: string) => `I've opened ${site} in a new tab. Connect the SAGE extension so I can see the page and help further.`,
  opened: (title: string) => `Opened ${title}.`,
  searched: (q: string, engine: string, n: number) =>
    n > 0 ? `Here are the ${engine} results for "${q}". Want me to open one?` : `I searched ${engine} for "${q}", but I can't read the results yet.`,
  openedResult: (n: number, title: string) => `Opening result ${n}: ${title}.`,
  playing: (title: string) => (title ? `"${title}" is playing now.` : `The video is playing now.`),
  playNotConfirmed: () => "I pressed play, but I can't confirm it's actually playing yet. It may still be loading.",
  autoplayBlocked: () => 'Chrome blocked playback on this page. Click the video once, and after that I can control it by voice.',
  paused: () => 'Paused.',
  seeked: (delta: number, at: string) => `Skipped ${delta >= 0 ? 'forward' : 'back'} ${Math.abs(delta)} seconds, now at ${at}.`,
  seekedTo: (at: string) => `Jumped to ${at}.`,
  speed: (r: number) => `Playing at ${r}x speed.`,
  volume: (p: number) => `Volume is at ${p} percent.`,
  muted: () => 'Muted.',
  unmuted: () => 'Sound is back on.',
  fullscreenOn: () => 'The video is fullscreen now.',
  fullscreenOff: () => 'Exited fullscreen.',
  nextVideo: (title: string) => (title ? `Now playing the next video: ${title}.` : 'Moved to the next video.'),
  prevVideo: () => 'Went back to the previous video.',
  wentBack: (title: string) => (title ? `Went back to ${title}.` : 'Went back.'),
  wentForward: () => 'Went forward.',
  reloaded: () => 'Reloaded the page.',
  switchedFilter: (name: string, n: number) => `Switched to the ${name} tab${n > 0 ? `; there are ${n} results` : ''}.`,
  noVideo: () => "I don't see a video open right now. What would you like me to play?",
  whichResult: (n: number) => `I can see ${n} results. Which one should I play?`,
  noResults: () => "There aren't any results on screen to choose from. What should I search for?",
  outOfRange: (n: number) => `I only see ${n} results. Which one do you mean?`,
  signIn: (site: string) => `${site} needs you to sign in. Please sign in yourself, then tell me to continue.`,
  confirmCancelled: () => "Okay, I won't do that.",
  confirmAgain: (s: string) => `Just to be sure, should I ${s}? Please say yes or no.`,
  failed: (what: string) => `Sorry, I couldn't do that: ${what}`,
  cancelled: () => 'Okay, I stopped.',
  partial: (what: string) => `I got partway there: ${what}. Want me to keep going?`,
  greeting: () => "Hi! I'm SAGE. I can search, open sites, and play and control videos for you. What would you like to do?",
  remembered: (v: string) => `Got it, I'll remember that ${v}.`,
  recall: (k: string, v: string) => `You told me your ${k} is ${v}.`,
  help: () => 'I can search the web, open sites, play and control videos, and remember things for you. What would you like to do?',
  needLlmForThat: () => "I need my AI reasoning engine for that, and it's unavailable right now. You can still ask me to search, open sites, or control the video.",
  done: () => 'Done.',
  currentlyOpen: (title: string, site: string) => `You have "${title}" open, on ${site}.`,
  nothingOpen: () => "I don't see any regular web page open right now.",
  resultIs: (n: number, title: string, source: string) => `Result ${n} is "${title}"${source ? `, from ${source}` : ''}.`,
  permissionRequired: () => 'I can see which tab is open, but I need browser access to read or control the page. Please click "Enable Browser Access" in SAGE.',
  screenDisabled: () => 'Screen capture is off. You can turn on visual observation in the Browser panel if you want me to look at your screen.',
  captcha: (site: string) => `${site || 'The site'} is asking you to confirm you're human. Please complete that check in the tab, then tell me to continue.`,
};

const hi: Table = {
  extensionOffline: () => 'मैं अभी आपका ब्राउज़र देख या चला नहीं पा रही हूँ। कृपया SAGE Chrome एक्सटेंशन इंस्टॉल और कनेक्ट करें।',
  openedFallback: (site: string) => `मैंने ${site} नए टैब में खोल दिया है। आगे मदद के लिए SAGE एक्सटेंशन कनेक्ट करें।`,
  opened: (title: string) => `${title} खोल दिया।`,
  searched: (q: string, engine: string, n: number) =>
    n > 0 ? `"${q}" के लिए ${engine} के नतीजे ये रहे। कोई खोलूँ?` : `मैंने ${engine} पर "${q}" खोजा, पर अभी नतीजे पढ़ नहीं पा रही।`,
  openedResult: (n: number, title: string) => `नतीजा ${n} खोल रही हूँ: ${title}।`,
  playing: (title: string) => (title ? `"${title}" अब चल रहा है।` : 'वीडियो अब चल रहा है।'),
  playNotConfirmed: () => 'मैंने प्ले दबाया, पर अभी पक्का नहीं कह सकती कि वीडियो चल रहा है। शायद लोड हो रहा है।',
  autoplayBlocked: () => 'Chrome ने इस पेज पर प्लेबैक रोक दिया। एक बार वीडियो पर क्लिक करें, फिर मैं आवाज़ से कंट्रोल कर पाऊँगी।',
  paused: () => 'रोक दिया।',
  seeked: (delta: number, at: string) => `${Math.abs(delta)} सेकंड ${delta >= 0 ? 'आगे' : 'पीछे'} किया, अब ${at} पर है।`,
  seekedTo: (at: string) => `${at} पर पहुँच गई।`,
  speed: (r: number) => `अब ${r}x स्पीड पर चल रहा है।`,
  volume: (p: number) => `आवाज़ ${p} प्रतिशत पर है।`,
  muted: () => 'म्यूट कर दिया।',
  unmuted: () => 'आवाज़ वापस चालू है।',
  fullscreenOn: () => 'वीडियो अब फुल स्क्रीन है।',
  fullscreenOff: () => 'फुल स्क्रीन से बाहर आ गई।',
  nextVideo: (title: string) => (title ? `अगला वीडियो चल रहा है: ${title}।` : 'अगले वीडियो पर चली गई।'),
  prevVideo: () => 'पिछले वीडियो पर वापस आ गई।',
  wentBack: (title: string) => (title ? `${title} पर वापस आ गई।` : 'वापस आ गई।'),
  wentForward: () => 'आगे बढ़ गई।',
  reloaded: () => 'पेज रीलोड कर दिया।',
  switchedFilter: (name: string, n: number) => `${name} टैब पर आ गई${n > 0 ? `, ${n} नतीजे हैं` : ''}।`,
  noVideo: () => 'अभी कोई वीडियो खुला नहीं दिख रहा। क्या चलाऊँ?',
  whichResult: (n: number) => `मुझे ${n} नतीजे दिख रहे हैं। कौन सा चलाऊँ?`,
  noResults: () => 'स्क्रीन पर चुनने के लिए कोई नतीजे नहीं हैं। क्या खोजूँ?',
  outOfRange: (n: number) => `मुझे सिर्फ़ ${n} नतीजे दिख रहे हैं। आपका मतलब कौन सा है?`,
  signIn: (site: string) => `${site} में साइन इन करना होगा। कृपया खुद साइन इन करें, फिर मुझे आगे बढ़ने को कहें।`,
  confirmCancelled: () => 'ठीक है, मैं ऐसा नहीं करूँगी।',
  confirmAgain: (s: string) => `पक्का करने के लिए: क्या मैं ${s}? हाँ या ना कहें।`,
  failed: (what: string) => `माफ़ कीजिए, यह नहीं हो पाया: ${what}`,
  cancelled: () => 'ठीक है, रोक दिया।',
  partial: (what: string) => `मैं कुछ हद तक कर पाई: ${what}। आगे बढ़ूँ?`,
  greeting: () => 'नमस्ते! मैं SAGE हूँ। मैं खोज सकती हूँ, साइट खोल सकती हूँ और वीडियो चला व कंट्रोल कर सकती हूँ। क्या करूँ?',
  remembered: (v: string) => `ठीक है, मैं याद रखूँगी कि ${v}।`,
  recall: (k: string, v: string) => `आपने बताया था कि आपकी ${k}: ${v} है।`,
  help: () => 'मैं वेब खोज सकती हूँ, साइट खोल सकती हूँ, वीडियो चला सकती हूँ और बातें याद रख सकती हूँ। क्या करूँ?',
  needLlmForThat: () => 'इसके लिए मुझे अपना AI इंजन चाहिए, जो अभी उपलब्ध नहीं है। आप खोज, साइट खोलने या वीडियो कंट्रोल के लिए कह सकते हैं।',
  done: () => 'हो गया।',
  currentlyOpen: (title: string, site: string) => `आपके ब्राउज़र में "${title}" खुला है, ${site} पर।`,
  nothingOpen: () => 'अभी कोई सामान्य वेब पेज खुला नहीं दिख रहा।',
  resultIs: (n: number, title: string, source: string) => `नतीजा ${n} है "${title}"${source ? `, ${source} से` : ''}।`,
  permissionRequired: () => 'मुझे दिख रहा है कौन सा टैब खुला है, पर पेज पढ़ने या चलाने के लिए ब्राउज़र एक्सेस चाहिए। कृपया SAGE में "Enable Browser Access" दबाएँ।',
  screenDisabled: () => 'स्क्रीन कैप्चर बंद है। चाहें तो Browser पैनल में विज़ुअल ऑब्ज़र्वेशन चालू करें।',
  captcha: (site: string) => `${site || 'साइट'} पूछ रही है कि आप इंसान हैं। कृपया टैब में वह जाँच पूरी करें, फिर मुझे आगे बढ़ने को कहें।`,
};

const bn: Table = {
  extensionOffline: () => 'আমি এখন আপনার ব্রাউজার দেখতে বা চালাতে পারছি না। দয়া করে SAGE Chrome এক্সটেনশন ইনস্টল ও কানেক্ট করুন।',
  openedFallback: (site: string) => `আমি ${site} নতুন ট্যাবে খুলে দিয়েছি। আরও সাহায্যের জন্য SAGE এক্সটেনশন কানেক্ট করুন।`,
  opened: (title: string) => `${title} খুলে দিলাম।`,
  searched: (q: string, engine: string, n: number) =>
    n > 0 ? `"${q}" এর জন্য ${engine} এর ফলাফল এখানে। কোনোটা খুলব?` : `আমি ${engine} এ "${q}" খুঁজেছি, কিন্তু এখনও ফলাফল পড়তে পারছি না।`,
  openedResult: (n: number, title: string) => `${n} নম্বর ফলাফল খুলছি: ${title}।`,
  playing: (title: string) => (title ? `"${title}" এখন চলছে।` : 'ভিডিওটি এখন চলছে।'),
  playNotConfirmed: () => 'আমি প্লে চেপেছি, কিন্তু এখনও নিশ্চিত নই যে ভিডিওটি চলছে। হয়তো লোড হচ্ছে।',
  autoplayBlocked: () => 'Chrome এই পেজে প্লেব্যাক আটকে দিয়েছে। একবার ভিডিওতে ক্লিক করুন, তারপর আমি কণ্ঠস্বরে নিয়ন্ত্রণ করতে পারব।',
  paused: () => 'থামিয়ে দিলাম।',
  seeked: (delta: number, at: string) => `${Math.abs(delta)} সেকেন্ড ${delta >= 0 ? 'এগিয়ে' : 'পিছিয়ে'} দিলাম, এখন ${at}।`,
  seekedTo: (at: string) => `${at} এ চলে গেলাম।`,
  speed: (r: number) => `এখন ${r}x গতিতে চলছে।`,
  volume: (p: number) => `ভলিউম ${p} শতাংশে।`,
  muted: () => 'মিউট করে দিলাম।',
  unmuted: () => 'আওয়াজ আবার চালু।',
  fullscreenOn: () => 'ভিডিওটি এখন ফুল স্ক্রিনে।',
  fullscreenOff: () => 'ফুল স্ক্রিন থেকে বেরিয়ে এলাম।',
  nextVideo: (title: string) => (title ? `পরের ভিডিও চলছে: ${title}।` : 'পরের ভিডিওতে গেলাম।'),
  prevVideo: () => 'আগের ভিডিওতে ফিরে গেলাম।',
  wentBack: (title: string) => (title ? `${title} এ ফিরে গেলাম।` : 'ফিরে গেলাম।'),
  wentForward: () => 'এগিয়ে গেলাম।',
  reloaded: () => 'পেজটি রিলোড করলাম।',
  switchedFilter: (name: string, n: number) => `${name} ট্যাবে গেলাম${n > 0 ? `, ${n}টি ফলাফল আছে` : ''}।`,
  noVideo: () => 'এখন কোনো ভিডিও খোলা দেখছি না। কী চালাব?',
  whichResult: (n: number) => `আমি ${n}টি ফলাফল দেখছি। কোনটা চালাব?`,
  noResults: () => 'স্ক্রিনে বেছে নেওয়ার মতো কোনো ফলাফল নেই। কী খুঁজব?',
  outOfRange: (n: number) => `আমি মাত্র ${n}টি ফলাফল দেখছি। কোনটার কথা বলছেন?`,
  signIn: (site: string) => `${site} এ সাইন ইন করতে হবে। দয়া করে নিজে সাইন ইন করুন, তারপর আমাকে চালিয়ে যেতে বলুন।`,
  confirmCancelled: () => 'ঠিক আছে, আমি এটা করব না।',
  confirmAgain: (s: string) => `নিশ্চিত হতে চাই: আমি কি ${s}? হ্যাঁ বা না বলুন।`,
  failed: (what: string) => `দুঃখিত, এটা করতে পারলাম না: ${what}`,
  cancelled: () => 'ঠিক আছে, থামিয়ে দিলাম।',
  partial: (what: string) => `আমি কিছুটা করতে পেরেছি: ${what}। চালিয়ে যাব?`,
  greeting: () => 'নমস্কার! আমি SAGE। আমি খুঁজতে, সাইট খুলতে আর ভিডিও চালাতে ও নিয়ন্ত্রণ করতে পারি। কী করব?',
  remembered: (v: string) => `ঠিক আছে, মনে রাখব যে ${v}।`,
  recall: (k: string, v: string) => `আপনি বলেছিলেন আপনার ${k}: ${v}।`,
  help: () => 'আমি ওয়েবে খুঁজতে, সাইট খুলতে, ভিডিও চালাতে আর কথা মনে রাখতে পারি। কী করব?',
  needLlmForThat: () => 'এর জন্য আমার AI ইঞ্জিন দরকার, যা এখন পাওয়া যাচ্ছে না। আপনি খোঁজা, সাইট খোলা বা ভিডিও নিয়ন্ত্রণের কথা বলতে পারেন।',
  done: () => 'হয়ে গেছে।',
  currentlyOpen: (title: string, site: string) => `আপনার ব্রাউজারে "${title}" খোলা আছে, ${site} এ।`,
  nothingOpen: () => 'এখন কোনো সাধারণ ওয়েব পেজ খোলা দেখছি না।',
  resultIs: (n: number, title: string, source: string) => `${n} নম্বর ফলাফল হলো "${title}"${source ? `, ${source} থেকে` : ''}।`,
  permissionRequired: () => 'কোন ট্যাব খোলা দেখতে পাচ্ছি, কিন্তু পেজ পড়তে বা চালাতে ব্রাউজার অ্যাক্সেস লাগবে। দয়া করে SAGE এ "Enable Browser Access" চাপুন।',
  screenDisabled: () => 'স্ক্রিন ক্যাপচার বন্ধ আছে। চাইলে Browser প্যানেলে ভিজ্যুয়াল অবজারভেশন চালু করুন।',
  captcha: (site: string) => `${site || 'সাইটটি'} জানতে চাইছে আপনি মানুষ কি না। দয়া করে ট্যাবে সেই যাচাই সম্পূর্ণ করুন, তারপর আমাকে চালিয়ে যেতে বলুন।`,
};

const TABLES: Record<Lang, Table> = { en, hi, bn };

export function say(lang: Lang, key: keyof typeof en, ...args: any[]): string {
  const fn = TABLES[lang]?.[key] || en[key];
  return fn(...args);
}

export function fmtClock(sec: number | undefined): string {
  if (!sec || !Number.isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
