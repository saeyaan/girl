import React from 'react';
import { Mic, Globe, Radio } from 'lucide-react';
import { SupportedLanguage } from '../utils/conversationUtils.ts';

interface LiveTranscriptionProps {
  isListening: boolean;
  interimTranscript: string;
  audioLevel: number;
  language: SupportedLanguage;
}

export const LiveTranscription: React.FC<LiveTranscriptionProps> = ({
  isListening,
  interimTranscript,
  audioLevel,
  language,
}) => {
  const languageNames: Record<SupportedLanguage, string> = {
    en: 'English (US)',
    hi: 'हिंदी (Hindi)',
    bn: 'বাংলা (Bengali)',
  };

  return (
    <div className="w-full max-w-2xl px-4 py-3 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-xl shadow-lg transition-all">
      <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5 pb-1 border-b border-slate-800/60">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-2 w-2 rounded-full ${
              isListening ? 'bg-sky-400 animate-ping' : 'bg-slate-600'
            }`}
          />
          <span className="font-medium flex items-center gap-1.5">
            <Mic className="w-3.5 h-3.5 text-slate-400" />
            {isListening ? 'Live Speech Recognition' : 'Microphone Ready'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Audio level equalizer bars */}
          {isListening && (
            <div className="flex items-end gap-0.5 h-3 px-1.5">
              {[0.2, 0.5, 0.8, 0.4, 0.7].map((factor, i) => (
                <div
                  key={i}
                  className="w-1 bg-sky-400 rounded-full transition-all duration-75"
                  style={{
                    height: `${Math.max(3, Math.min(12, audioLevel * 12 * (1 + factor)))}px`,
                  }}
                />
              ))}
            </div>
          )}

          <div className="flex items-center gap-1 text-[11px] font-medium text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded-md">
            <Globe className="w-3 h-3 text-purple-400" />
            <span>{languageNames[language]}</span>
          </div>
        </div>
      </div>

      {/* Transcription Content */}
      <div className="min-h-[28px] flex items-center">
        {interimTranscript ? (
          <p className="text-sm font-medium text-sky-200 animate-pulse italic leading-relaxed">
            "{interimTranscript}..."
          </p>
        ) : isListening ? (
          <p className="text-xs text-slate-400 italic flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-sky-400 animate-spin" />
            Listening to your voice... Speak naturally in {languageNames[language]}.
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            Press the mic button or Spacebar to speak, or type your message below.
          </p>
        )}
      </div>
    </div>
  );
};
