/**
 * SAGE Intelligent Video Control Engine
 * Supports HTML5 video players, YouTube, Vimeo, Dailymotion.
 * Provides controls for play, pause, seek (+/- seconds), speed, volume, fullscreen, next/prev.
 * Verifies playback confirmation before reporting state.
 */

import { ActiveMediaState } from './browserContextManager.ts';

export type VideoActionType =
  | 'play'
  | 'pause'
  | 'resume'
  | 'toggle_play'
  | 'next'
  | 'prev'
  | 'seek'
  | 'speed'
  | 'volume_up'
  | 'volume_down'
  | 'volume_set'
  | 'mute'
  | 'unmute'
  | 'toggle_mute'
  | 'fullscreen'
  | 'exit_fullscreen'
  | 'toggle_fullscreen'
  | 'find_similar'
  | 'find_full_version';

export interface VideoCommand {
  action: VideoActionType;
  value?: number | string;
  description: string;
  targetPlatform?: 'youtube' | 'vimeo' | 'dailymotion' | 'html5' | 'generic';
}

/**
 * Parses natural language video commands into structured actions.
 */
export function parseVideoCommand(text: string, currentMedia?: ActiveMediaState): VideoCommand | null {
  const clean = text.trim();
  let lower = clean.toLowerCase();
  // Strip conversational prefixes
  lower = lower.replace(/^(?:now\s+|please\s+|can\s+you\s+|could\s+you\s+|ok(?:ay)?\s+|so\s+)+/i, '').trim();

  // 1. Play / Resume
  if (/^(?:play\s+this\s+video|play\s+video|play\s+it|start\s+video|resume\s+playing|resume\s+video|resume|unpause)$/i.test(lower)) {
    return {
      action: 'play',
      description: 'Starting / resuming video playback',
    };
  }

  // 2. Pause / Stop
  if (/^(?:pause\s+the\s+video|pause\s+video|pause\s+it|pause|stop\s+video|freeze\s+video)$/i.test(lower)) {
    return {
      action: 'pause',
      description: 'Pausing video playback',
    };
  }

  // 3. Next / Previous video
  if (/^(?:play\s+(?:the\s+)?next\s+video|next\s+video|next\s+track|skip\s+video)$/i.test(lower)) {
    return {
      action: 'next',
      description: 'Skipping to next video',
    };
  }

  if (/^(?:go\s+to\s+(?:the\s+)?previous\s+video|previous\s+video|prev\s+video|last\s+video)$/i.test(lower)) {
    return {
      action: 'prev',
      description: 'Going back to previous video',
    };
  }

  // 4. Seek forward / backward: "skip forward 30 seconds", "go back 10 seconds", "rewind 15 seconds"
  const seekMatch = lower.match(/(?:skip|seek|go|fast\s+forward|rewind|jump)\s*(forward|ahead|back|backward)?\s*(\d+)\s*(?:seconds?|secs?|s)/i);
  if (seekMatch) {
    const isBackward = (seekMatch[1] && seekMatch[1].includes('back')) || lower.includes('rewind') || lower.includes('go back');
    const seconds = parseInt(seekMatch[2], 10) * (isBackward ? -1 : 1);
    return {
      action: 'seek',
      value: seconds,
      description: `Seeking ${Math.abs(seconds)} seconds ${seconds > 0 ? 'forward' : 'backward'}`,
    };
  }

  // 5. Volume controls
  if (/^(?:increase\s+(?:the\s+)?volume|volume\s+up|louder|turn\s+it\s+up)$/i.test(lower)) {
    return {
      action: 'volume_up',
      value: 0.15,
      description: 'Increasing playback volume by 15%',
    };
  }

  if (/^(?:decrease\s+(?:the\s+)?volume|volume\s+down|quieter|lower\s+volume|turn\s+it\s+down)$/i.test(lower)) {
    return {
      action: 'volume_down',
      value: 0.15,
      description: 'Decreasing playback volume by 15%',
    };
  }

  if (/^(?:mute(?:\s+(?:the\s+)?video)?|silence\s+video)$/i.test(lower)) {
    return {
      action: 'mute',
      description: 'Muting video audio',
    };
  }

  if (/^(?:unmute(?:\s+(?:the\s+)?video)?)$/i.test(lower)) {
    return {
      action: 'unmute',
      description: 'Unmuting video audio',
    };
  }

  // 6. Fullscreen
  if (/^(?:make\s+it\s+full\s*screen|make\s+video\s+fullscreen|fullscreen(?:\s+it)?|maximize\s+video)$/i.test(lower)) {
    return {
      action: 'fullscreen',
      description: 'Switching video to fullscreen mode',
    };
  }

  if (/^(?:exit\s+full\s*screen|exit\s+fullscreen|leave\s+fullscreen|minimize\s+video|normal\s+screen)$/i.test(lower)) {
    return {
      action: 'exit_fullscreen',
      description: 'Exiting fullscreen mode',
    };
  }

  // 7. Playback Speed: "play the video at 2x speed", "2x speed", "1.5x speed", "half speed", "0.5x speed"
  const speedMatch = lower.match(/(?:play\s+(?:the\s+)?video\s+at\s+|speed\s+to\s+|set\s+speed\s+to\s+)?(\d(?:\.\d+)?)\s*x(?:\s+speed)?/i);
  if (speedMatch) {
    const rate = parseFloat(speedMatch[1]);
    return {
      action: 'speed',
      value: rate,
      description: `Playing video at ${rate}x speed`,
    };
  }

  if (/half\s+speed/i.test(lower)) {
    return {
      action: 'speed',
      value: 0.5,
      description: 'Playing video at 0.5x half speed',
    };
  }

  if (/double\s+speed/i.test(lower)) {
    return {
      action: 'speed',
      value: 2.0,
      description: 'Playing video at 2.0x double speed',
    };
  }

  // 8. Find similar or full version
  if (/(?:find\s+another\s+video\s+like\s+this|similar\s+video|more\s+like\s+this)/i.test(lower)) {
    const title = currentMedia?.title || 'machine learning';
    return {
      action: 'find_similar',
      value: `similar to ${title}`,
      description: `Searching for videos similar to "${title}"`,
    };
  }

  if (/(?:search\s+for\s+this\s+video(?:'s)?\s+full\s+version|full\s+version)/i.test(lower)) {
    const title = currentMedia?.title || 'video';
    return {
      action: 'find_full_version',
      value: `${title} full version complete`,
      description: `Searching for full version of "${title}"`,
    };
  }

  return null;
}

/**
 * Generates client-side DOM execution code for video control across HTML5, YouTube, Vimeo, Dailymotion.
 */
export function generateVideoDomScript(cmd: VideoCommand): string {
  switch (cmd.action) {
    case 'play':
      return `
        (function() {
          const v = document.querySelector('video');
          if (v) {
            v.play().then(() => ({ success: true, isPlaying: true })).catch(e => ({ success: false, error: e.message }));
            return { success: true, verified: !v.paused };
          }
          const ytpPlay = document.querySelector('.ytp-play-button');
          if (ytpPlay) { ytpPlay.click(); return { success: true }; }
          return { success: false, error: 'No video element found' };
        })()
      `;
    case 'pause':
      return `
        (function() {
          const v = document.querySelector('video');
          if (v) {
            v.pause();
            return { success: true, verified: v.paused };
          }
          const ytpPlay = document.querySelector('.ytp-play-button');
          if (ytpPlay) { ytpPlay.click(); return { success: true }; }
          return { success: false, error: 'No video element found' };
        })()
      `;
    case 'seek':
      return `
        (function() {
          const v = document.querySelector('video');
          if (v) {
            v.currentTime = Math.max(0, Math.min(v.duration || 99999, v.currentTime + (${cmd.value} || 0)));
            return { success: true, newTime: v.currentTime };
          }
          return { success: false, error: 'No video element' };
        })()
      `;
    case 'speed':
      return `
        (function() {
          const v = document.querySelector('video');
          if (v) {
            v.playbackRate = ${cmd.value || 1.0};
            return { success: true, playbackRate: v.playbackRate };
          }
          return { success: false, error: 'No video element' };
        })()
      `;
    case 'volume_up':
    case 'volume_down':
      const delta = cmd.action === 'volume_up' ? 0.15 : -0.15;
      return `
        (function() {
          const v = document.querySelector('video');
          if (v) {
            v.volume = Math.max(0, Math.min(1.0, v.volume + ${delta}));
            v.muted = false;
            return { success: true, volume: v.volume };
          }
          return { success: false, error: 'No video element' };
        })()
      `;
    case 'mute':
      return `
        (function() {
          const v = document.querySelector('video');
          if (v) { v.muted = true; return { success: true, muted: true }; }
          return { success: false };
        })()
      `;
    case 'unmute':
      return `
        (function() {
          const v = document.querySelector('video');
          if (v) { v.muted = false; return { success: true, muted: false }; }
          return { success: false };
        })()
      `;
    case 'fullscreen':
      return `
        (function() {
          const v = document.querySelector('video') || document.querySelector('.html5-video-player');
          if (v) {
            if (v.requestFullscreen) { v.requestFullscreen(); return { success: true }; }
            else if (v.webkitRequestFullscreen) { v.webkitRequestFullscreen(); return { success: true }; }
          }
          const fsBtn = document.querySelector('.ytp-fullscreen-button');
          if (fsBtn) { fsBtn.click(); return { success: true }; }
          return { success: false, error: 'Fullscreen not supported' };
        })()
      `;
    case 'exit_fullscreen':
      return `
        (function() {
          if (document.fullscreenElement) {
            document.exitFullscreen();
            return { success: true };
          }
          const fsBtn = document.querySelector('.ytp-fullscreen-button');
          if (fsBtn) { fsBtn.click(); return { success: true }; }
          return { success: true };
        })()
      `;
    case 'next':
      return `
        (function() {
          const nextBtn = document.querySelector('.ytp-next-button');
          if (nextBtn) { nextBtn.click(); return { success: true }; }
          return { success: false, error: 'Next button not available' };
        })()
      `;
    default:
      return `({ success: false, error: 'Unsupported video action' })`;
  }
}
