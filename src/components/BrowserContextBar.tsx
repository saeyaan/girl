import React from 'react';
import {
  Compass,
  Search,
  Video,
  Maximize2,
  Minimize2,
  RotateCcw,
  FastForward,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Gauge,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { BrowserContextState } from '../utils/browserContextManager.ts';

interface BrowserContextBarProps {
  context: BrowserContextState;
  onVideoCommand: (action: string, value?: any) => void;
  onOpenResult: (url: string, title: string) => void;
  onSwitchFilterTab: (filterUrl: string) => void;
}

export function BrowserContextBar({
  context,
  onVideoCommand,
  onOpenResult,
  onSwitchFilterTab,
}: BrowserContextBarProps) {
  const activeMedia = context.activeMedia;
  const hasSearchResults = context.searchResults && context.searchResults.length > 0;
  const connected = Boolean(context.extensionConnected);
  const mediaStatus = activeMedia.isBuffering ? 'Buffering' : activeMedia.isPlaying ? 'Playing' : 'Paused';
  const onGoogle = context.pageKind === 'google_serp';

  return (
    <div className="w-full max-w-3xl bg-slate-900/90 border border-slate-800 rounded-2xl p-2.5 shadow-xl backdrop-blur-xl flex flex-col gap-2 text-xs">
      {/* Upper Status Line */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {/* Left: Active Tab & Context */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-sky-950 border border-sky-800/80 flex items-center justify-center text-sky-400 flex-shrink-0">
            <Compass className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0 flex items-center gap-1.5">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
              {connected ? 'SAGE is working in:' : 'Browser:'}
            </span>
            <span className={`font-medium truncate max-w-[200px] sm:max-w-xs ${connected ? 'text-slate-200' : 'text-rose-300'}`}>
              {connected ? context.activeTab?.title || context.activeTab?.url || 'No tab yet' : 'Extension not connected'}
            </span>
          </div>
        </div>

        {/* Right: Pronoun resolution badge */}
        <div className="flex items-center gap-1.5 text-[11px] text-purple-300 bg-purple-950/60 border border-purple-800/60 px-2 py-0.5 rounded-full">
          <Sparkles className="w-3 h-3 text-purple-400" />
          <span>
            {activeMedia.hasVideo
              ? `"it" → ${activeMedia.title ? activeMedia.title.slice(0, 22) : 'video'}… (${mediaStatus})`
              : hasSearchResults
              ? `"the first one" → ${context.searchResults[0]?.title.slice(0, 22)}…`
              : '"it" → current page'}
          </span>
        </div>
      </div>

      {/* Middle Line: Search Results Quick Access Pills if search results are indexed */}
      {hasSearchResults && (
        <div className="flex items-center gap-1.5 overflow-x-auto py-1 border-t border-slate-800/80">
          <span className="text-[10px] text-slate-500 uppercase flex-shrink-0 flex items-center gap-1">
            <Search className="w-3 h-3" /> Results:
          </span>
          {context.searchResults.slice(0, 4).map((item, idx) => (
            <button
              key={item.index}
              type="button"
              onClick={() => onOpenResult(item.url, item.title)}
              className="px-2 py-0.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-purple-500/60 text-slate-300 text-[11px] whitespace-nowrap transition-colors flex items-center gap-1 cursor-pointer"
              title={`Open ${item.title}`}
            >
              <span className="text-purple-400 font-bold">#{idx + 1}</span>
              <span className="truncate max-w-[120px]">{item.title}</span>
            </button>
          ))}
          {/* Quick Videos tab filter pill */}
          {context.lastSearchQuery && onGoogle && (
            <button
              type="button"
              onClick={() =>
                onSwitchFilterTab(
                  `https://www.google.com/search?q=${encodeURIComponent(context.lastSearchQuery)}&tbm=vid`
                )
              }
              className="px-2 py-0.5 rounded-lg bg-red-950/70 hover:bg-red-900 border border-red-800/60 text-red-300 text-[11px] whitespace-nowrap transition-colors flex items-center gap-1 cursor-pointer"
            >
              <Video className="w-3 h-3" />
              <span>Videos Tab</span>
            </button>
          )}
        </div>
      )}

      {/* Lower Line: Intelligent Video Controls Bar */}
      <div
        className={`flex items-center justify-between gap-2 pt-1 border-t border-slate-800/80 ${activeMedia.hasVideo ? '' : 'opacity-40 pointer-events-none'}`}
        aria-disabled={!activeMedia.hasVideo}
        title={activeMedia.hasVideo ? undefined : 'No video detected in the working tab'}
      >
        <div className="flex items-center gap-1.5">
          {/* Play/Pause */}
          <button
            type="button"
            onClick={() => onVideoCommand(activeMedia.isPlaying ? 'pause' : 'play')}
            aria-label={activeMedia.isPlaying ? 'Pause video' : 'Play video'}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
            title={activeMedia.isPlaying ? 'Pause (or say "pause")' : 'Play (or say "play it")'}
          >
            {activeMedia.isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>

          {/* Seek -10s */}
          <button
            type="button"
            onClick={() => onVideoCommand('seek', -10)}
            aria-label="Seek back 10 seconds"
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer flex items-center gap-0.5"
            title='Seek -10s (or say "go back 10 seconds")'
          >
            <RotateCcw className="w-3 h-3" />
            <span className="text-[10px] font-mono">10s</span>
          </button>

          {/* Seek +30s */}
          <button
            type="button"
            onClick={() => onVideoCommand('seek', 30)}
            aria-label="Seek forward 30 seconds"
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer flex items-center gap-0.5"
            title='Seek +30s (or say "skip forward 30 seconds")'
          >
            <FastForward className="w-3 h-3" />
            <span className="text-[10px] font-mono">30s</span>
          </button>

          {/* Fullscreen Toggle */}
          <button
            type="button"
            onClick={() => onVideoCommand(activeMedia.isFullscreen ? 'exit_fullscreen' : 'fullscreen')}
            aria-label={activeMedia.isFullscreen ? 'Exit fullscreen' : 'Make fullscreen'}
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer"
            title='Toggle fullscreen (or say "make it full screen")'
          >
            {activeMedia.isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Mute Toggle */}
          <button
            type="button"
            onClick={() => onVideoCommand(activeMedia.isMuted ? 'unmute' : 'mute')}
            aria-label={activeMedia.isMuted ? 'Unmute video' : 'Mute video'}
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer"
            title='Toggle mute (or say "mute the video")'
          >
            {activeMedia.isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Speed Selector Buttons */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-500 uppercase mr-0.5 flex items-center gap-0.5">
            <Gauge className="w-3 h-3" /> Speed:
          </span>
          {[1.0, 1.5, 2.0].map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={() => onVideoCommand('speed', rate)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium transition-colors cursor-pointer ${
                activeMedia.playbackRate === rate
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {rate}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
