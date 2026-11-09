import React from 'react';
import { ChatMessageItem } from '../types.ts';
import { Volume2, ExternalLink, Bookmark, Bot, User, Sparkles, Compass } from 'lucide-react';
import { AssistantEmotion } from '../utils/conversationUtils.ts';

interface ConversationStreamProps {
  messages: ChatMessageItem[];
  onReplaySpeech: (text: string, emotion?: AssistantEmotion) => void;
  onOpenBrowserUrl: (url: string, siteName?: string) => void;
}

export const ConversationStream: React.FC<ConversationStreamProps> = ({
  messages,
  onReplaySpeech,
  onOpenBrowserUrl,
}) => {
  const getEmotionBadge = (emotion?: AssistantEmotion) => {
    switch (emotion) {
      case 'happy':
        return <span className="text-[10px] bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 px-2 py-0.5 rounded-full font-medium">✨ Joyful</span>;
      case 'empathetic':
        return <span className="text-[10px] bg-rose-950/60 text-rose-300 border border-rose-800/60 px-2 py-0.5 rounded-full font-medium">🤍 Empathetic</span>;
      case 'thoughtful':
        return <span className="text-[10px] bg-amber-950/60 text-amber-300 border border-amber-800/60 px-2 py-0.5 rounded-full font-medium">💭 Thoughtful</span>;
      case 'curious':
        return <span className="text-[10px] bg-indigo-950/60 text-indigo-300 border border-indigo-800/60 px-2 py-0.5 rounded-full font-medium">🔍 Curious</span>;
      case 'friendly':
      default:
        return <span className="text-[10px] bg-purple-950/60 text-purple-300 border border-purple-800/60 px-2 py-0.5 rounded-full font-medium">🌸 Warm</span>;
    }
  };

  return (
    <div className="flex-1 w-full max-w-3xl overflow-y-auto px-4 py-3 space-y-4 scroll-smooth">
      {messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400 space-y-3">
          <div className="p-3.5 rounded-2xl bg-slate-800/60 border border-slate-700/50 shadow-inner">
            <Bot className="w-8 h-8 text-purple-400" />
          </div>
          <h2 className="text-base font-semibold text-slate-200">Say hello to Maya!</h2>
          <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
            I'm your human-like female companion &amp; browser co-pilot. You can talk to me, ask me anything, or give browser commands like:
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            {[
              'Open YouTube',
              'Open Google',
              'Search for Python tutorials',
              'Remember that I like astrophysics',
              'नमस्ते माया, आप कैसी हैं?',
              'তুমি কেমন আছো?'
            ].map((prompt, i) => (
              <span
                key={i}
                className="text-xs font-mono bg-slate-800/90 hover:bg-slate-700/80 text-purple-300 border border-slate-700/80 px-2.5 py-1 rounded-lg cursor-default transition-colors shadow-sm"
              >
                "{prompt}"
              </span>
            ))}
          </div>
        </div>
      ) : (
        messages.map((msg) => {
          const isAssistant = msg.role === 'assistant';

          return (
            <div
              key={msg.id}
              className={`flex gap-3 ${isAssistant ? 'justify-start' : 'justify-end'} group`}
            >
              {isAssistant && (
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-600 to-rose-500 flex items-center justify-center shadow-md flex-shrink-0 mt-1">
                  <Bot className="w-4 h-4 text-white" />
                </div>
              )}

              <div
                className={`max-w-[85%] sm:max-w-[78%] rounded-2xl px-4 py-3 transition-all ${
                  isAssistant
                    ? 'bg-slate-900/80 border border-slate-800/80 text-slate-200 shadow-md backdrop-blur-md'
                    : 'bg-purple-600 text-white shadow-purple-900/30 shadow-lg'
                }`}
              >
                {/* Header for assistant message */}
                {isAssistant && (
                  <div className="flex items-center justify-between gap-3 mb-1.5 pb-1 border-b border-slate-800/60 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-purple-300 text-xs">Maya</span>
                      {getEmotionBadge(msg.emotion)}
                    </div>

                    <button
                      type="button"
                      onClick={() => onReplaySpeech(msg.content, msg.emotion)}
                      aria-label="Replay voice audio"
                      className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Replay voice"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* Message Text */}
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>

                {/* Browser Action Card if triggered */}
                {msg.browserAction && (
                  <div className="mt-2.5 p-2.5 rounded-xl bg-slate-950/70 border border-sky-800/60 text-xs text-sky-200 space-y-1.5 shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold flex items-center gap-1.5 text-sky-300">
                        <Compass className="w-3.5 h-3.5 text-sky-400" />
                        Browser Action
                      </span>
                      {msg.browserAction.targetUrl && (
                        <button
                          type="button"
                          onClick={() => onOpenBrowserUrl(msg.browserAction!.targetUrl!, msg.browserAction!.siteName)}
                          className="flex items-center gap-1 px-2 py-0.5 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30 rounded-md font-medium transition-colors cursor-pointer"
                        >
                          <span>Open in Tab</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-300">{msg.browserAction.description}</p>
                    {msg.browserAction.targetUrl && (
                      <p className="text-[10px] font-mono text-slate-400 truncate">
                        {msg.browserAction.targetUrl}
                      </p>
                    )}
                  </div>
                )}

                {/* Memory Saved Badge */}
                {msg.savedMemory && (
                  <div className="mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 text-xs">
                    <Bookmark className="w-3 h-3 text-emerald-400" />
                    <span>
                      Remembered: <strong>{msg.savedMemory.key}</strong>
                    </span>
                  </div>
                )}

                {/* Timestamp */}
                <div
                  className={`text-[10px] mt-1.5 ${
                    isAssistant ? 'text-slate-500 text-left' : 'text-purple-200 text-right'
                  }`}
                >
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>

              {!isAssistant && (
                <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center shadow-md flex-shrink-0 mt-1">
                  <User className="w-4 h-4 text-purple-300" />
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};
