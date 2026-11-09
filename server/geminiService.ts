/**
 * Gemini client plus speech services (TTS + transcription).
 * Conversation reasoning lives in server/agent/agentLoop.ts.
 */
import { GoogleGenAI } from '@google/genai';
import { detectLanguage } from '../src/utils/conversationUtils.ts';
import { withTimeout } from './agent/model.ts';

// Shared server-side client, created lazily so a key loaded by dotenv after import is still picked up.
let client: GoogleGenAI | null = null;
export function getAi(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!client) {
    client = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
  }
  return client;
}

/**
 * Text-to-Speech using Gemini 3.8 Flash Lite TTS
 * Returns base64 WAV audio bytes for playback
 */
export async function generateSpeechAudio(
  text: string,
  _voiceName: 'Kore' | 'Aoede' | 'Zephyr' | 'Puck' = 'Kore'
): Promise<{ audioBase64: string | null; mimeType: string }> {
  const ai = getAi();
  if (!ai) {
    return { audioBase64: null, mimeType: 'audio/wav' };
  }

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [{ text }],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
        },
      }),
      3500
    );

    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (audioData) {
      return { audioBase64: audioData, mimeType: 'audio/wav' };
    }
    return { audioBase64: null, mimeType: 'audio/wav' };
  } catch (_err) {
    // Gracefully fallback to client voice synthesis without emitting unhandled error traces
    return { audioBase64: null, mimeType: 'audio/wav' };
  }
}

/**
 * Audio Transcription using Gemini
 * Accepts base64 audio and transcribes into text with language detection
 */
export async function transcribeAudio(
  base64Audio: string,
  mimeType = 'audio/webm'
): Promise<{ text: string; language: 'en' | 'hi' | 'bn' }> {
  const ai = getAi();
  if (!ai) return { text: '', language: 'en' };
  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Audio,
              },
            },
            {
              text: 'Transcribe this spoken audio accurately. It may be in English, Hindi, or Bengali. Return only the exact transcribed words.',
            },
          ],
        },
      }),
      4000
    );

    const text = (response.text || '').trim();
    const language = detectLanguage(text);
    return { text, language };
  } catch (_err) {
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: [
            {
              inlineData: {
                mimeType,
                data: base64Audio,
              },
            },
            {
              text: 'Transcribe this spoken audio accurately into text. Return only the exact transcribed speech.',
            },
          ],
        }),
        3500
      );
      const text = (response.text || '').trim();
      return { text, language: detectLanguage(text) };
    } catch (_fallbackErr) {
      return { text: '', language: 'en' };
    }
  }
}
