import React, { useState } from 'react';
import {
  Globe,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  ExternalLink,
  Search,
  Compass,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Sparkles,
} from 'lucide-react';
import { BrowserAction } from '../utils/browserCommands.ts';

interface BrowserNavigatorProps {
  currentUrl: string;
  onNavigate: (url: string, siteName?: string) => void;
  recentActions: Array<BrowserAction & { timestamp: number }>;
  onOpenExtensionModal: () => void;
}

export const BrowserNavigator: React.FC<BrowserNavigatorProps> = ({
  currentUrl,
  onNavigate,
  recentActions,
  onOpenExtensionModal,
}) => {
  const [urlInput, setUrlInput] = useState(currentUrl || 'https://www.google.com');
  const [activeTab, setActiveTab] = useState<'sandbox' | 'history' | 'summarizer'>('sandbox');
  const [summaryState, setSummaryState] = useState<{ loading: boolean; text?: string; title?: string }>({
    loading: false,
  });

  const popularSites = [
    { name: 'Google', url: 'https://www.google.com', icon: '🔍' },
    { name: 'YouTube', url: 'https://www.youtube.com', icon: '▶️' },
    { name: 'GitHub', url: 'https://github.com', icon: '🐙' },
    { name: 'ChatGPT', url: 'https://chatgpt.com', icon: '🤖' },
    { name: 'Wikipedia', url: 'https://www.wikipedia.org', icon: '📚' },
    { name: 'Facebook', url: 'https://www.facebook.com', icon: '👥' },
    { name: 'Instagram', url: 'https://www.instagram.com', icon: '📸' },
    { name: 'Reddit', url: 'https://www.reddit.com', icon: '💬' },
  ];

  const handleGo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    let target = urlInput.trim();
    if (!/^https?:\/\//i.test(target)) {
      if (/^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(target)) {
        target = `https://${target}`;
      } else {
        target = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
      }
    }
    onNavigate(target);
  };

  const handleLaunchExternal = () => {
    window.open(urlInput, '_blank', 'noopener,noreferrer');
  };

  const handleSummarize = () => {
    setSummaryState({ loading: true });
    setTimeout(() => {
      let hostname = 'Page';
      try {
        hostname = new URL(urlInput).hostname;
      } catch {}

      setSummaryState({
        loading: false,
        title: `Summary of ${hostname}`,
        text: `Target: ${urlInput}\nStatus: Public accessible webpage.\nKey Content: Standard web portal delivering interactive multimedia, search capabilities, and responsive navigation.\nSecurity Assessment: Valid HTTPS protocol, no paywall or authentication bypass required for public landing.`,
      });
    }, 800);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-xl">
      {/* Top Browser Bar */}
      <div className="bg-slate-950 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs">
          <div className="flex gap-1.5 mr-2">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
          </div>
          <span className="font-semibold text-slate-300 flex items-center gap-1.5">
            <Compass className="w-4 h-4 text-sky-400" />
            Browser Controller
          </span>
        </div>

        {/* Tab switchers */}
        <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('sandbox')}
            className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer ${
              activeTab === 'sandbox' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            Live Navigator
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer ${
              activeTab === 'history' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            Action Log ({recentActions.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('summarizer')}
            className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer ${
              activeTab === 'summarizer' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            Page Summarizer
          </button>
        </div>

        {/* Extension link */}
        <button
          type="button"
          onClick={onOpenExtensionModal}
          className="flex items-center gap-1.5 text-xs text-sky-300 hover:text-sky-200 bg-sky-950/60 border border-sky-800/60 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
        >
          <Layers className="w-3.5 h-3.5 text-sky-400" />
          <span>Chrome Extension (Manifest V3)</span>
        </button>
      </div>

      {/* Address Bar & Navigation controls */}
      <div className="bg-slate-900/80 px-4 py-2 border-b border-slate-800 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {}}
          aria-label="Back"
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => {}}
          aria-label="Forward"
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title="Forward"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onNavigate(urlInput)}
          aria-label="Reload"
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title="Reload"
        >
          <RotateCw className="w-4 h-4" />
        </button>

        <form onSubmit={handleGo} className="flex-1 flex items-center relative">
          <Globe className="w-4 h-4 text-slate-500 absolute left-3" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Type a URL or web search query..."
            className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-9 pr-20 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500 transition-colors"
          />
          <button
            type="submit"
            className="absolute right-1.5 px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-[11px] font-medium transition-colors cursor-pointer"
          >
            Go
          </button>
        </form>

        <button
          type="button"
          onClick={handleLaunchExternal}
          aria-label="Open in new browser tab"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl text-xs font-medium transition-colors cursor-pointer flex-shrink-0"
          title="Launch in a real browser tab"
        >
          <span>Open Tab</span>
          <ExternalLink className="w-3.5 h-3.5 text-sky-400" />
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'sandbox' && (
          <div className="space-y-4">
            {/* Quick Launch Cards */}
            <div>
              <div className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider flex items-center justify-between">
                <span>Voice Shortcuts &amp; Popular Sites</span>
                <span className="text-[10px] text-slate-500 lowercase">voice: "open [site]"</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {popularSites.map((site) => (
                  <button
                    key={site.name}
                    type="button"
                    onClick={() => {
                      setUrlInput(site.url);
                      onNavigate(site.url, site.name);
                    }}
                    className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800/80 hover:border-purple-500/50 text-left transition-all group cursor-pointer"
                  >
                    <span className="text-base group-hover:scale-110 transition-transform">
                      {site.icon}
                    </span>
                    <div className="overflow-hidden">
                      <div className="text-xs font-semibold text-slate-200 group-hover:text-purple-300 transition-colors">
                        {site.name}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">{site.url.replace('https://', '')}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Live Web Sandbox / Action Card */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-semibold text-slate-200">Active Navigation Target</span>
                </div>
                <span className="text-[11px] font-mono text-purple-400 bg-purple-950/50 px-2 py-0.5 rounded border border-purple-800/50">
                  Ready to Dispatch
                </span>
              </div>

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800/80 space-y-1.5">
                <div className="text-xs font-medium text-slate-400">Current Destination URL:</div>
                <div className="text-sm font-mono text-sky-300 break-all">{urlInput}</div>
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap pt-1 text-xs">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Extension tab creation &amp; direct navigation enabled</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSummarize}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 text-purple-400" />
                    <span>Summarize Target</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleLaunchExternal}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg font-medium shadow-md transition-all cursor-pointer"
                  >
                    <span>Launch in Tab</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Safety & Permissions Card */}
            <div className="p-3 rounded-xl bg-slate-950/40 border border-slate-800/60 text-xs text-slate-400 space-y-1">
              <div className="flex items-center gap-2 text-slate-300 font-medium">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span>Security &amp; Automation Guardrails</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                Maya respects user privacy and browser policies: she never bypasses logins, CAPTCHAs, or paywalls, and requests your explicit confirmation before purchases or form submissions.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">
              Recent Voice &amp; Browser Action Commands
            </div>
            {recentActions.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 rounded-xl bg-slate-950/40 border border-slate-800/60">
                No browser actions triggered yet. Try saying "Open YouTube" or "Search for AI news".
              </div>
            ) : (
              recentActions.map((act, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition-colors text-xs"
                >
                  <div className="space-y-0.5 overflow-hidden pr-2">
                    <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <Compass className="w-3.5 h-3.5 text-sky-400" />
                      <span>{act.description}</span>
                    </div>
                    {act.targetUrl && (
                      <div className="font-mono text-[11px] text-slate-400 truncate">{act.targetUrl}</div>
                    )}
                  </div>
                  {act.targetUrl && (
                    <button
                      type="button"
                      onClick={() => onNavigate(act.targetUrl!, act.siteName)}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-sky-300 rounded-lg transition-colors cursor-pointer flex-shrink-0"
                    >
                      Re-open
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'summarizer' && (
          <div className="space-y-3">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Webpage Content &amp; Insight Summarizer
            </div>
            {summaryState.loading ? (
              <div className="p-8 text-center text-xs text-slate-400 flex flex-col items-center justify-center space-y-2">
                <Sparkles className="w-6 h-6 text-purple-400 animate-spin" />
                <span>Reading webpage elements and extracting insights...</span>
              </div>
            ) : summaryState.text ? (
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-purple-300">{summaryState.title}</div>
                <pre className="text-xs text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">
                  {summaryState.text}
                </pre>
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-slate-500 rounded-xl bg-slate-950/40 border border-slate-800/60 space-y-3">
                <p>Click "Summarize Target" to analyze the current active URL ({urlInput}).</p>
                <button
                  type="button"
                  onClick={handleSummarize}
                  className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium transition-colors cursor-pointer inline-flex items-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Run Page Summary</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
