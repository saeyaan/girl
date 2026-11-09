/**
 * Fast path: short, unambiguous follow-up commands ("pause", "skip 30 seconds", "open the second
 * one", "go back", "videos tab") are mapped straight to tool calls without an LLM round trip.
 * They still go through the same executor, so every action is verified.
 *
 * Anything compound, fuzzy or not clearly matched returns null and goes to the reasoning loop.
 */

import { parseBrowserCommand } from '../../src/utils/browserCommands.ts';
import { isMultiStepGoal } from '../../src/utils/taskPlanner.ts';
import { parseVideoCommand } from '../../src/utils/videoController.ts';
import type { MediaAction } from './tools.ts';
import { normalizeVideoUrl, type WorkingMemory } from './workingMemory.ts';

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export type FastDecision =
  | { kind: 'calls'; calls: ToolCall[] }
  | { kind: 'ask'; key: 'whichResult' | 'noVideo' | 'noResults'; count?: number };

const ORDINAL_WORDS: Record<string, number> = {
  first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5,
  sixth: 6, '6th': 6, seventh: 7, '7th': 7, eighth: 8, '8th': 8, ninth: 9, '9th': 9, tenth: 10, '10th': 10,
  last: -1, top: 1,
  pehla: 1, pehli: 1, pahla: 1, pahli: 1, dusra: 2, doosra: 2, dusri: 2, doosri: 2, teesra: 3, tisra: 3, teesri: 3,
  'पहला': 1, 'पहली': 1, 'दूसरा': 2, 'दूसरी': 2, 'तीसरा': 3, 'तीसरी': 3, 'आखिरी': -1,
  prothom: 1, ditiyo: 2, dwitiyo: 2, tritiyo: 3, 'প্রথম': 1, 'দ্বিতীয়': 2, 'তৃতীয়': 3, 'শেষ': -1,
};

/** Lowercase, strip wake words, politeness and trailing punctuation. */
export function normalizeCommand(text: string, keepCase = false): string {
  const base = keepCase ? text.trim() : text.trim().toLowerCase();
  return base
    .replace(/[.!?।,]+$/g, '')
    .replace(/^(?:(?:hey|hi|ok|okay)\s+)?(?:sage|maya)[,\s]+/i, '')
    .replace(/^(?:now|please|can you|could you|would you|ok(?:ay)?|so|and|then|just)\s+/gi, '')
    .replace(/^(?:now|please|can you|could you|just)\s+/gi, '')
    .replace(/\s+(?:please|now|for me)$/gi, '')
    .trim();
}

/** "open the second one" → {position: 2, play: false}; "play the first video" → {position: 1, play: true}. */
export function parseOrdinalCommand(text: string): { position: number; play: boolean } | null {
  const t = normalizeCommand(text);
  const ordAlternation = Object.keys(ORDINAL_WORDS)
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const re = new RegExp(
    `^(?:(open|play|click(?: on)?|watch|select|choose|pick|show(?: me)?|go to|start)\\s+)?(?:the\\s+)?(?:(${ordAlternation})|#?(\\d{1,2})(?:st|nd|rd|th)?|(?:number|no\\.?)\\s*(\\d{1,2}))\\s*(?:one|result|video|link|item|option|wala|vala|वाला|वाली|টা)?(?:\\s+(?:one|result|video|link|item))?(?:\\s+(?:khol(?:o|do)|chalao|खोलो|चलाओ|খোলো|চালাও))?$`,
    'i'
  );
  const m = t.match(re);
  let position: number | null = null;
  let verb = '';
  if (m) {
    verb = (m[1] || '').toLowerCase();
    if (m[2]) position = ORDINAL_WORDS[m[2].toLowerCase()] ?? ORDINAL_WORDS[m[2]] ?? null;
    else if (m[3]) position = parseInt(m[3], 10);
    else if (m[4]) position = parseInt(m[4], 10);
  } else {
    const alt = t.match(/^(open|play|watch)?\s*(?:the\s+)?(?:result|video|option)\s+(?:number\s+)?(\d{1,2})$/i);
    if (alt) {
      verb = (alt[1] || '').toLowerCase();
      position = parseInt(alt[2], 10);
    }
  }
  if (position === null || position === 0) return null;
  const play = /play|watch|start|chalao|चलाओ|চালাও/.test(verb + t);
  return { position, play };
}

/**
 * "play it", "play that video", "play this one", "continue"... — playback of something already in
 * context, never a search for the words "that video".
 */
export function isPronounPlay(text: string): boolean {
  const t = normalizeCommand(text);
  return (
    /^(?:play|play now|continue|keep playing|resume playback|start playing|start it|unpause it)$/.test(t) ||
    /^(?:play|start|resume|watch)\s+(?:it|this|that|the same|same)(?:\s+(?:one|video|clip|song|track))?(?:\s+again)?$/.test(t) ||
    /^(?:play|start|resume)\s+the\s+(?:video|clip|song|track)$/.test(t) ||
    /^(?:चलाओ|इसे चलाओ|वीडियो चलाओ|চালাও|এটা চালাও|ভিডিও চালাও)$/.test(t)
  );
}

const SEARCHY =/\b(find|search|look\s+(?:for|up)|show me|tutorials?|about|like this|similar|full version|another)\b/i;

/** Natural-language media command → media_control call, or null. */
export function parseMediaIntent(text: string, hasMedia: boolean): { action: MediaAction; value?: number } | null {
  const t = normalizeCommand(text);
  if (!t || t.split(/\s+/).length > 9) return null;
  if (SEARCHY.test(t)) return null;

  // Phrases the shared parser doesn't cover.
  if (isPronounPlay(t)) return { action: 'play' };
  if (/^(?:(?:make|put|turn) (?:it|this|the video|video) (?:to |in )?)?(?:go )?full ?screen(?: mode)?$/.test(t) || /^(?:maximi[sz]e|enlarge)(?: it| the video)?$/.test(t)) return { action: 'fullscreen' };
  if (/^(?:exit|leave|close|get out of|quit) (?:the )?full ?screen(?: mode)?$|^(?:minimi[sz]e|small screen|normal screen)(?: it)?$/.test(t)) return { action: 'exit_fullscreen' };
  if (/^(?:lower|reduce|decrease|turn down)(?: the)? (?:volume|sound)(?: a (?:bit|little))?$|^(?:turn it down|volume down|quieter|softer|too loud|less loud)$/.test(t)) return { action: 'volume_down', value: 15 };
  if (/^(?:raise|increase|turn up|boost)(?: the)? (?:volume|sound)(?: a (?:bit|little))?$|^(?:turn it up|volume up|louder|too quiet|more volume)$/.test(t)) return { action: 'volume_up', value: 15 };
  const volSet = t.match(/^(?:set )?(?:the )?volume (?:to |at )?(\d{1,3})(?:\s*%|\s*percent)?$/);
  if (volSet) return { action: 'volume_set', value: Math.min(100, parseInt(volSet[1], 10)) };
  const fwd = t.match(/^(?:forward|ahead|skip)\s+(\d{1,4})\s*(seconds?|secs?|s|minutes?|mins?|m)$/);
  if (fwd) return { action: 'seek', value: parseInt(fwd[1], 10) * (/^m/.test(fwd[2]) ? 60 : 1) };
  const minuteSeek = t.match(/^(?:skip|go|jump|fast forward|rewind)\s*(forward|ahead|back|backward)?\s*(\d{1,3})\s*(?:minutes?|mins?)$/);
  if (minuteSeek) {
    const back = /back/.test(minuteSeek[1] || '') || /^rewind/.test(t);
    return { action: 'seek', value: parseInt(minuteSeek[2], 10) * 60 * (back ? -1 : 1) };
  }
  if (/^(?:next|next one|play next|skip this(?: one| video)?|skip it)$/.test(t) && hasMedia) return { action: 'next' };
  if (/^(?:normal speed|regular speed|reset speed|1x(?: speed)?)$/.test(t)) return { action: 'speed', value: 1 };
  if (/^(?:faster|speed (?:it )?up)$/.test(t)) return { action: 'speed', value: 1.5 };
  if (/^(?:slower|slow (?:it )?down)$/.test(t)) return { action: 'speed', value: 0.75 };
  if (/^(?:stop it|stop the video|pause it|pause this|pause that|पॉज़ करो|रुको|থামাও)$/.test(t)) return { action: 'pause' };
  if (/^(?:stop|hold on)$/.test(t) && hasMedia) return { action: 'pause' };

  const vc = parseVideoCommand(t);
  if (vc) {
    switch (vc.action) {
      case 'play':
      case 'resume':
        return { action: 'play' };
      case 'pause':
        return { action: 'pause' };
      case 'next':
        return { action: 'next' };
      case 'prev':
        return { action: 'prev' };
      case 'seek':
        return { action: 'seek', value: Number(vc.value) };
      case 'speed': {
        // Only accept "2x" style matches when the sentence is really about speed.
        if (!/\b(speed|x\s*speed|\d(?:\.\d+)?\s*x$|play(?:ing)? at)\b/.test(t) && !/^\d(?:\.\d+)?\s*x$/.test(t)) return null;
        return { action: 'speed', value: Number(vc.value) };
      }
      case 'volume_up':
        return { action: 'volume_up', value: 15 };
      case 'volume_down':
        return { action: 'volume_down', value: 15 };
      case 'mute':
        return { action: 'mute' };
      case 'unmute':
        return { action: 'unmute' };
      case 'fullscreen':
        return { action: 'fullscreen' };
      case 'exit_fullscreen':
        return { action: 'exit_fullscreen' };
      default:
        return null;
    }
  }

  // Legacy YouTube voice commands ("pause youtube", "रोको", "next song").
  const legacy = parseBrowserCommand(t);
  if (legacy?.type === 'youtube_pause') return { action: 'pause' };
  if (legacy?.type === 'youtube_resume') return { action: 'play' };
  if (legacy?.type === 'youtube_next' && hasMedia) return { action: 'next' };
  return null;
}

/** "Which is the first result?" / "what's the second video?" → position, or null. */
export function parseResultQuestion(text: string): { position: number } | null {
  const t = normalizeCommand(text);
  const ords = Object.keys(ORDINAL_WORDS)
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const re = new RegExp(
    `^(?:which|what)(?:'s| is| one is)?\\s+(?:the\\s+)?(${ords}|#?\\d{1,2}(?:st|nd|rd|th)?)\\s+(?:result|video|one|link|item|option)(?:\\s+(?:on the page|here|now))?$`,
    'i'
  );
  const m = t.match(re);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  const position = ORDINAL_WORDS[raw] ?? ORDINAL_WORDS[m[1]] ?? parseInt(raw.replace(/\D/g, ''), 10);
  return Number.isFinite(position) && position !== 0 ? { position } : null;
}

/** "Search for X" / "Google X" (plain search, no video intent) → the Google query, else null. */
export function parsePlainSearch(text: string): string | null {
  const t = normalizeCommand(text, true); // keep the user's capitalisation in the query
  const m = t.match(/^(?:search|google|look up)(?:\s+(?:for|about|on google for))?\s+(.+)$/i);
  if (!m) return null;
  const q = m[1].replace(/\s+(?:on|in|using)\s+google$/i, '').trim();
  if (!q || /\b(youtube|videos?|play|watch|songs?|music)\b/i.test(q) || /\b(this|current|the) (site|website|page)\b/i.test(q)) return null;
  return q;
}

export function decideFastPath(
  text: string,
  wm: WorkingMemory,
  opts: { llmAvailable?: boolean; referenced?: { position: number; url: string } | null } = {}
): FastDecision | null {
  const t = normalizeCommand(text);
  if (!t || isMultiStepGoal(text)) return null;

  // Plain search requests do exactly that: a Google search, nothing more.
  const plain = parsePlainSearch(text);
  if (plain && plain.split(/\s+/).length <= 12) return { kind: 'calls', calls: [{ name: 'web_search', args: { query: plain, engine: 'google' } }] };

  if (t.split(/\s+/).length > 9) return null;

  // History navigation
  if (/^(?:go back|back|go to the previous page|previous page|go back to the previous page|take me back)$/.test(t)) {
    return { kind: 'calls', calls: [{ name: 'navigate', args: { direction: 'back' } }] };
  }
  if (/^(?:go forward|forward|next page)$/.test(t)) {
    return { kind: 'calls', calls: [{ name: 'navigate', args: { direction: 'forward' } }] };
  }
  if (/^(?:reload|refresh)(?: the page| it| this page)?$/.test(t)) {
    return { kind: 'calls', calls: [{ name: 'navigate', args: { direction: 'reload' } }] };
  }

  // Search filter tabs ("go to the videos tab")
  const filter = t.match(/^(?:go to|switch to|open|click(?: on)?|show(?: me)?)?\s*(?:the\s+)?(videos?|images?|news|shopping|all)\s+(?:tab|filter|section|results)$/);
  if (filter && wm.lastSnapshot && ['google_serp', 'google_videos'].includes(wm.lastSnapshot.pageKind)) {
    const raw = filter[1];
    const name = raw.startsWith('video') ? 'Videos' : raw.startsWith('image') ? 'Images' : raw === 'news' ? 'News' : raw === 'shopping' ? 'Shopping' : 'All';
    return { kind: 'calls', calls: [{ name: 'switch_search_filter', args: { name } }] };
  }

  // Ordinal references to visible results
  const ord = parseOrdinalCommand(t);
  if (ord) {
    const results = wm.currentResults();
    if (results.length === 0) return null; // let the reasoning loop work out what "the first one" means
    const calls: ToolCall[] = [{ name: 'open_result', args: { position: ord.position } }];
    if (ord.play) calls.push({ name: 'media_control', args: { action: 'play' } });
    return { kind: 'calls', calls };
  }

  // Media control
  const media = parseMediaIntent(t, wm.hasActiveMedia());
  if (media) {
    // "Which is the first result?" → "Play it." means that result, even if another video is open.
    const ref = opts.referenced;
    if (media.action === 'play' && ref && normalizeVideoUrl(ref.url) !== normalizeVideoUrl(wm.media?.url || '')) {
      const idx = wm.currentResults().findIndex((r) => r.url === ref.url);
      if (idx >= 0) {
        return {
          kind: 'calls',
          calls: [
            { name: 'open_result', args: { position: idx + 1 } },
            { name: 'media_control', args: { action: 'play' } },
          ],
        };
      }
    }
    if (media.action === 'play' && !wm.hasActiveMedia()) {
      const results = wm.currentResults();
      if (results.length === 1) {
        return {
          kind: 'calls',
          calls: [
            { name: 'open_result', args: { position: 1 } },
            { name: 'media_control', args: { action: 'play' } },
          ],
        };
      }
      // Several candidates: the model can use the conversation to tell which one; without it, ask.
      if (results.length > 1) return opts.llmAvailable ? null : { kind: 'ask', key: 'whichResult', count: results.length };
      return { kind: 'ask', key: 'noVideo' };
    }
    return { kind: 'calls', calls: [{ name: 'media_control', args: media.value === undefined ? { action: media.action } : { action: media.action, value: media.value } }] };
  }

  return null;
}
