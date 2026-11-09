import { BrowserAction } from './utils/browserCommands.ts';
import { MemoryItem } from './utils/memoryMatcher.ts';
import { AssistantEmotion, SupportedLanguage } from './utils/conversationUtils.ts';

export type AssistantState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  emotion?: AssistantEmotion;
  detectedLanguage?: SupportedLanguage;
  browserAction?: BrowserAction | null;
  savedMemory?: MemoryItem | null;
  audioBase64?: string | null;
}

export interface AssistantSettings {
  voiceProvider: 'gemini' | 'browser';
  femaleVoice: string; // 'Kore', 'Aoede', 'Zephyr', or browser voice name
  speakingRate: number; // 0.8 - 1.5
  pitch: number; // 0.8 - 1.4
  volume: number; // 0 - 1
  language: SupportedLanguage;
  continuousListening: boolean;
  autoSpeak: boolean;
  autoOpenTabs: boolean;
  soundEffects: boolean;
  /** Use the extension's debugger permission for true video fullscreen (otherwise window + player fill). */
  useDebuggerFullscreen: boolean;
  /** Let SAGE take screenshots of the visible tab for visual questions (each capture is announced). */
  allowScreenCapture: boolean;
}
