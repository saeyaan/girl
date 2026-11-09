/**
 * Conversation Utilities
 * Emotion detection, multilingual formatting, and speech cadence hints.
 */

export type AssistantEmotion = 'friendly' | 'thoughtful' | 'happy' | 'empathetic' | 'curious' | 'neutral';

export type SupportedLanguage = 'en' | 'hi' | 'bn';

export interface EmotionCue {
  emotion: AssistantEmotion;
  rate: number; // 0.8 to 1.2
  pitch: number; // 0.9 to 1.3
}

/**
 * Maps emotional cues to natural female speech modulation
 */
export function getEmotionSpeechParameters(emotion: AssistantEmotion): EmotionCue {
  switch (emotion) {
    case 'happy':
      return { emotion: 'happy', rate: 1.05, pitch: 1.15 };
    case 'empathetic':
      return { emotion: 'empathetic', rate: 0.95, pitch: 0.98 };
    case 'thoughtful':
      return { emotion: 'thoughtful', rate: 0.92, pitch: 0.95 };
    case 'curious':
      return { emotion: 'curious', rate: 1.02, pitch: 1.1 };
    case 'friendly':
    default:
      return { emotion: 'friendly', rate: 1.0, pitch: 1.05 };
  }
}

/**
 * Detects language from text characters (Devanagari for Hindi, Bengali script for Bengali)
 */
export function detectLanguage(text: string): SupportedLanguage {
  // Bengali Unicode range: \u0980-\u09FF
  if (/[\u0980-\u09FF]/.test(text)) {
    return 'bn';
  }
  // Devanagari Unicode range (Hindi): \u0900-\u097F
  if (/[\u0900-\u097F]/.test(text)) {
    return 'hi';
  }
  return 'en';
}

/**
 * Cleans assistant response text for speech synthesis:
 * removes markdown stars, brackets, code blocks, and URLs so the voice doesn't read out "asterisk asterisk"
 */
export function cleanTextForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, 'Code block omitted.')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/[*_~#>]/g, '')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/\s+/g, ' ')
    .trim();
}
