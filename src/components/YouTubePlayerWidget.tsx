import React, { useState } from 'react';
import {
  Play,
  Pause,
  SkipForward,
  ExternalLink,
  Volume2,
  VolumeX,
  Music,
  Radio,
  X,
  Sparkles,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';

export interface YouTubePlayerState {
  trackName: string;
  isPlaying: boolean;
  targetUrl: string;
  history: string[];
}

interface YouTubePlayerWidgetProps {
  playerState: YouTubePlayerState;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onChangeTrack: (newTrack: string) => void;
  onOpenTab: (url: string) => void;
  onClose: () => void;
}

export function YouTubePlayerWidget({
  playerState,
  onPlay,
  onPause,
  onNext,
  onChangeTrack,
  onOpenTab,
  onClose,
}: YouTubePlayerWidgetProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [customTrackInput, setCustomTrackInput] = useState('');
  const [showInput, setShowInput] = useState(false);

  const popularTracks = [
    'Kesariya - Brahmastra',
    'Bohemian Rhapsody - Queen',
    'Namit Malhotra Ramayana Soundtrack',
    'Lofi Hip Hop Radio',
    'Dil Nu - AP Dhillon',
    'Shape of You - Ed Sheeran',
  ];

  const handleTrackSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customTrackInput.trim()) {
      onChangeTrack(customTrackInput.trim());
      setCustomTrackInput('');
      setShowInput(false);
    }
  };

  return (
    <div className="w-full max-w-3xl bg-slate-900/95 border border-red-500/40 hover:border-red-500/70 rounded-2xl p-3 shadow-2xl backdrop-blur-xl transition-all duration-300">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between gap-3">
        {/* Left: YouTube Badge and Track Name */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-red-600/20 border border-red-500/50 flex items-center justify-center text-red-500 flex-shrink-0">
            <Music className="w-4 h-4 animate-pulse" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-red-950/80 text-red-400 border border-red-800/60 px-1.5 py-0.5 rounded">
                YouTube Music
              </span>
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    playerState.isPlaying ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'
                  }`}
                />
                <span className="text-[11px] text-slate-400 font-medium">
                  {playerState.isPlaying ? 'Playing on YouTube' : 'Paused'}
                </span>
              </div>
            </div>

            <p className="text-xs font-semibold text-slate-100 truncate max-w-[220px] sm:max-w-md">
              {playerState.trackName || 'YouTube Music Stream'}
            </p>
          </div>
        </div>

        {/* Center/Right: Playback Controls */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Play/Pause Button */}
          <button
            type="button"
            onClick={playerState.isPlaying ? onPause : onPlay}
            aria-label={playerState.isPlaying ? 'Pause YouTube music' : 'Play YouTube music'}
            className="p-2 rounded-xl bg-red-600 hover:bg-red-500 text-white shadow-md shadow-red-600/30 transition-all cursor-pointer flex items-center justify-center"
            title={playerState.isPlaying ? 'Pause (or say "pause")' : 'Play (or say "resume")'}
          >
            {playerState.isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
          </button>

          {/* Next Song Button */}
          <button
            type="button"
            onClick={onNext}
            aria-label="Skip to next song"
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
            title="Next song (or say 'next song')"
          >
            <SkipForward className="w-4 h-4" />
          </button>

          {/* Open in YouTube New Tab Button */}
          <button
            type="button"
            onClick={() => onOpenTab(playerState.targetUrl)}
            aria-label="Open in YouTube tab"
            className="px-2.5 py-1.5 rounded-xl bg-red-950/70 hover:bg-red-900/80 border border-red-800/80 text-red-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Open in new Chrome tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Open Tab</span>
          </button>

          {/* Toggle Expand / Video Embed */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-label={isExpanded ? 'Collapse player' : 'Expand player'}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {/* Close Widget */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close YouTube controller"
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Expanded Stage: Quick Change Track & Embedded YouTube Preview */}
      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-col gap-3 animate-in fade-in duration-200">
          {/* Quick Change Track Input */}
          <form onSubmit={handleTrackSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={customTrackInput}
              onChange={(e) => setCustomTrackInput(e.target.value)}
              placeholder="Change track (e.g. 'Bohemian Rhapsody' or 'Kesariya')..."
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-red-500"
            />
            <button
              type="submit"
              disabled={!customTrackInput.trim()}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white rounded-xl text-xs font-medium transition-colors cursor-pointer"
            >
              Change
            </button>
          </form>

          {/* Preset Suggested Tracks */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
            <span className="text-[10px] text-slate-500 uppercase flex-shrink-0">Quick Change:</span>
            {popularTracks.map((trk, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onChangeTrack(trk)}
                className="px-2 py-1 rounded-lg bg-slate-950/80 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-red-300 whitespace-nowrap transition-colors cursor-pointer"
              >
                {trk}
              </button>
            ))}
          </div>

          {/* Embedded YouTube preview player */}
          <div className="relative w-full h-44 rounded-xl overflow-hidden bg-black/80 border border-slate-800">
            <iframe
              src={`https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(
                playerState.trackName || 'music'
              )}&autoplay=${playerState.isPlaying ? 1 : 0}`}
              title="YouTube Music Player"
              className="w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      )}
    </div>
  );
}
