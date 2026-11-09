import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Send,
  Volume2,
  VolumeX,
  Compass,
  Brain,
  Layers,
  Sliders,
  Sparkles,
  Bot,
  Square,
  Globe,
  Radio,
  ExternalLink,
  X,
} from 'lucide-react';
import { AssistantOrb } from './components/AssistantOrb.tsx';
import { LiveTranscription } from './components/LiveTranscription.tsx';
import { ConversationStream } from './components/ConversationStream.tsx';
import { BrowserNavigator } from './components/BrowserNavigator.tsx';
import { MemoryVault } from './components/MemoryVault.tsx';
import { ChromeExtensionModal } from './components/ChromeExtensionModal.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { YouTubePlayerWidget, YouTubePlayerState } from './components/YouTubePlayerWidget.tsx';
import { TaskPlannerWidget } from './components/TaskPlannerWidget.tsx';
import { BrowserContextBar } from './components/BrowserContextBar.tsx';
import { useVoiceAssistant } from './hooks/useVoiceAssistant.ts';
import { useBrowserLink, type ScreenCapturedNotice } from './hooks/useBrowserLink.ts';
import { BrowserAccessPanel, BrowserStatusPill, EnableBrowserAccessModal } from './components/BrowserAccessPanel.tsx';
import { ChatMessageItem, AssistantSettings } from './types.ts';
import { MemoryItem } from './utils/memoryMatcher.ts';
import { BrowserAction, parseBrowserCommand } from './utils/browserCommands.ts';
import { BrowserContextState, initialBrowserContext } from './utils/browserContextManager.ts';
import { TaskPlan } from './utils/taskPlanner.ts';
import { AssistantEmotion, SupportedLanguage } from './utils/conversationUtils.ts';

// Spoken/typed phrases that stop a running task instead of starting a new one.
const CANCEL_RE = /^(?:(?:hey\s+)?sage[,\s]+)?(?:stop|cancel|stop it|stop that|cancel (?:that|it|the task)|never ?mind|forget it|रुको|बंद करो|रहने दो|থামো|বাদ দাও)[.!।]*$/i;

export default function App() {
  // Navigation View State
  const [activeView, setActiveView] = useState<'assistant' | 'browser' | 'memory'>('assistant');
  const [isExtensionModalOpen, setIsExtensionModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [activeTabToast, setActiveTabToast] = useState<{
    url: string;
    siteName: string;
    blocked: boolean;
  } | null>(null);

  // Settings State
  const [settings, setSettings] = useState<AssistantSettings>({
    voiceProvider: 'gemini',
    femaleVoice: 'Kore',
    speakingRate: 1.0,
    pitch: 1.05,
    volume: 1.0,
    language: 'en',
    continuousListening: false,
    autoSpeak: true,
    autoOpenTabs: true,
    soundEffects: true,
    useDebuggerFullscreen: false,
    allowScreenCapture: false,
  });

  // Conversation & Memory State
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [textInput, setTextInput] = useState('');
  const [currentBrowserUrl, setCurrentBrowserUrl] = useState('https://www.youtube.com');
  const [recentBrowserActions, setRecentBrowserActions] = useState<Array<BrowserAction & { timestamp: number }>>([]);
  const [dismissedMediaUrl, setDismissedMediaUrl] = useState<string | null>(null);
  const [browserContext, setBrowserContext] = useState<BrowserContextState>(initialBrowserContext);
  const [activePlan, setActivePlan] = useState<TaskPlan | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = useRef(false);
  const queuedMessageRef = useRef<string | null>(null);

  // Live link to the Chrome extension (handshake + heartbeat) and to the server (context, plan progress).
  const [isBrowserAccessOpen, setIsBrowserAccessOpen] = useState(false);
  const [captureToast, setCaptureToast] = useState<ScreenCapturedNotice | null>(null);
  const { link, requestPermission, reconnect } = useBrowserLink({
    onContext: (ctx) => setBrowserContext(ctx),
    onPlan: (plan) => setActivePlan(plan),
    onScreenCaptured: (n) => setCaptureToast(n),
  });
  const extensionConnected = link.status === 'online' || link.status === 'permissions';
  useEffect(() => {
    if (!captureToast) return;
    const t = setTimeout(() => setCaptureToast(null), 6000);
    return () => clearTimeout(t);
  }, [captureToast]);

  // The media widget shows only what the extension actually verified in the browser.
  const media = browserContext.activeMedia;
  const youtubeState: YouTubePlayerState | null =
    media.hasVideo && media.verified && media.url !== dismissedMediaUrl
      ? { trackName: media.title || 'Video', isPlaying: media.isPlaying, targetUrl: media.url, history: [] }
      : null;

  // Load Memories and Browser Context from Backend on mount
  const loadMemories = useCallback(async () => {
    try {
      const res = await fetch('/api/memories');
      if (res.ok) {
        const data = await res.json();
        if (data.memories) {
          setMemories(data.memories);
        }
      }
    } catch (err) {
      console.warn('Failed to load initial memories from server:', err);
    }
  }, []);

  useEffect(() => {
    loadMemories();
    fetch('/api/browser/context')
      .then((res) => res.json())
      .then((data) => {
        if (data.context) setBrowserContext(data.context);
        if (data.task && !data.task.isComplete && !data.task.isCancelled) setActivePlan(data.task);
      })
      .catch(() => {});
  }, [loadMemories]);

  // Voice Assistant Hook. Goes through a ref so speech always uses the latest state
  // (conversation history, settings), not the values from the first render.
  const sendMessageRef = useRef<(text: string) => void>(() => {});
  const handleFinalSpeech = useCallback((transcript: string) => {
    if (transcript.trim()) {
      sendMessageRef.current(transcript.trim());
    }
  }, []);

  const {
    state,
    setState,
    interimTranscript,
    audioLevel,
    errorMessage,
    setErrorMessage,
    startListening,
    stopListening,
    speakText,
    interrupt,
  } = useVoiceAssistant(settings, handleFinalSpeech);

  // Send a message to SAGE. The server observes the browser, plans, acts through the extension,
  // verifies each step and replies; live progress arrives over the agent socket.
  const handleSendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (isProcessingRef.current) {
      // A task is running: "stop" cancels it; any other instruction cancels it and runs next.
      fetch('/api/task/cancel', { method: 'POST' }).catch(() => {});
      if (!CANCEL_RE.test(trimmed)) queuedMessageRef.current = trimmed;
      setTextInput('');
      return;
    }

    interrupt();
    setTextInput('');
    setIsProcessing(true);
    isProcessingRef.current = true;
    setState('thinking');

    // Without the extension the page itself must open tabs, and only synchronously with the user's
    // action (popup blocker), so reserve a tab now when the request looks like navigation.
    const quickBrowserAction = parseBrowserCommand(trimmed);
    const looksLikeNavigation =
      Boolean(quickBrowserAction?.targetUrl) || /^(?:find|search|look\s+up|show\s+me|tell\s+me\s+about|who\s+is|what\s+is|open|play)\b/i.test(trimmed);
    let preOpenedTab: Window | null = null;
    if (!extensionConnected && settings.autoOpenTabs && looksLikeNavigation) {
      try {
        preOpenedTab = window.open('about:blank', '_blank');
      } catch (e) {
        console.warn('Could not prime browser tab:', e);
      }
    }

    const userMessage: ChatMessageItem = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);

    try {
      const historyPayload = messages.slice(-8).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          history: historyPayload,
          language: settings.language,
          useDebuggerFullscreen: settings.useDebuggerFullscreen,
          allowScreenCapture: settings.allowScreenCapture,
        }),
      });

      if (!res.ok) {
        throw new Error(`Chat API error: ${res.statusText}`);
      }

      const data = await res.json();

      const assistantMessage: ChatMessageItem = {
        id: `ast-${Date.now()}`,
        role: 'assistant',
        content: data.replyText,
        timestamp: Date.now(),
        emotion: data.emotion as AssistantEmotion,
        detectedLanguage: data.detectedLanguage as SupportedLanguage,
        browserAction: data.browserAction,
        savedMemory: data.savedMemory,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      if (data.browserContext) setBrowserContext(data.browserContext);
      setActivePlan((prev) => (data.taskPlan ? data.taskPlan : prev && !prev.isComplete && !prev.isCancelled ? prev : null));

      if (data.browserAction?.targetUrl) {
        setCurrentBrowserUrl(data.browserAction.targetUrl);
        setRecentBrowserActions((prev) => [{ ...data.browserAction, timestamp: Date.now() }, ...prev.slice(0, 20)]);
      }

      // Extension offline: open the page from here so the request still does something useful.
      if (data.fallbackOpenUrl) {
        const url: string = data.fallbackOpenUrl;
        let opened = false;
        if (preOpenedTab && !preOpenedTab.closed) {
          try {
            preOpenedTab.location.href = url;
            opened = true;
          } catch (e) {
            console.warn('Redirecting primed tab failed:', e);
          }
        }
        if (!opened && settings.autoOpenTabs) {
          const win = window.open(url, '_blank');
          if (win) {
            win.opener = null;
            opened = true;
          }
        }
        let siteName = data.browserAction?.siteName || url;
        try {
          siteName = data.browserAction?.siteName || new URL(url).hostname;
        } catch {}
        setActiveTabToast({ url, siteName, blocked: !opened });
      } else if (preOpenedTab && !preOpenedTab.closed) {
        try {
          preOpenedTab.close();
        } catch {}
      }

      if (data.savedMemory) {
        setMemories((prev) => [data.savedMemory, ...prev.filter((m) => m.id !== data.savedMemory.id)]);
      }

      // A newer instruction is waiting: don't read out the reply of the task it superseded.
      if (settings.autoSpeak && !queuedMessageRef.current) {
        await speakText(data.replyText, data.emotion);
      } else {
        setState('idle');
      }
    } catch (err: any) {
      console.error('Error sending message:', err);
      if (preOpenedTab && !preOpenedTab.closed) {
        try {
          preOpenedTab.close();
        } catch {}
      }
      setErrorMessage(err.message || 'Could not communicate with assistant backend');
      setState('error');
    } finally {
      setIsProcessing(false);
      isProcessingRef.current = false;
      const queued = queuedMessageRef.current;
      queuedMessageRef.current = null;
      if (queued) setTimeout(() => sendMessageRef.current(queued), 0);
    }
  };
  sendMessageRef.current = handleSendMessage;

  // Keyboard shortcut: Spacebar outside inputs triggers mic
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
        e.preventDefault();
        if (state === 'speaking') {
          interrupt();
        } else if (state === 'listening') {
          stopListening();
        } else if (state === 'idle') {
          startListening();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state, interrupt, stopListening, startListening]);

  // Memory CRUD handlers
  const handleAddMemory = async (item: Omit<MemoryItem, 'id' | 'timestamp'>) => {
    try {
      const res = await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      if (res.ok) {
        const data = await res.json();
        setMemories((prev) => [data.memory, ...prev]);
      }
    } catch (err) {
      console.error('Failed to add memory:', err);
    }
  };

  const handleUpdateMemory = async (id: string, updates: Partial<MemoryItem>) => {
    try {
      const res = await fetch(`/api/memories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setMemories((prev) => prev.map((m) => (m.id === id ? data.memory : m)));
      }
    } catch (err) {
      console.error('Failed to update memory:', err);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    try {
      const res = await fetch(`/api/memories/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setMemories((prev) => prev.filter((m) => m.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete memory:', err);
    }
  };

  const handleClearAllMemories = async () => {
    try {
      const res = await fetch('/api/memories/clear', { method: 'POST' });
      if (res.ok) {
        setMemories([]);
      }
    } catch (err) {
      console.error('Failed to clear memories:', err);
    }
  };

  const handleNavigateUrl = (url: string, siteName?: string) => {
    setCurrentBrowserUrl(url);
    window.open(url, '_blank', 'noopener,noreferrer');
    setRecentBrowserActions((prev) => [
      {
        type: 'open_url',
        targetUrl: url,
        siteName: siteName || url,
        description: `Opened ${siteName || url}`,
        timestamp: Date.now(),
      },
      ...prev,
    ]);
  };

  // Video buttons go through SAGE like voice commands, so the result is verified in the browser
  // (no optimistic state changes here).
  const handleVideoCommand = (action: string, value?: any) => {
    const textMsg = action === 'fullscreen' ? 'make it full screen'
      : action === 'exit_fullscreen' ? 'exit fullscreen'
      : action === 'speed' ? `play at ${value}x speed`
      : action === 'seek' ? (value > 0 ? `skip forward ${value} seconds` : `go back ${Math.abs(value)} seconds`)
      : action === 'mute' ? 'mute the video'
      : action === 'unmute' ? 'unmute the video'
      : action;
    handleSendMessage(textMsg);
  };

  const handleOpenSearchResult = (url: string, title: string) => {
    const idx = browserContext.searchResults.findIndex((r) => r.url === url);
    if (extensionConnected && idx >= 0) handleSendMessage(`open result ${idx + 1}`);
    else handleNavigateUrl(url, title);
  };

  const handleSwitchFilterTab = (filterUrl: string) => {
    if (extensionConnected) handleSendMessage('go to the videos tab');
    else handleNavigateUrl(filterUrl, 'Google Videos');
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 font-sans overflow-hidden select-none">
      {/* Top Navigation Header */}
      <header className="min-h-14 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-xl px-3 sm:px-4 py-2 flex items-center justify-between gap-2 sm:gap-4 flex-wrap flex-shrink-0 z-20">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-500 via-pink-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-purple-500/20 flex-shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-bold tracking-tight text-slate-100">SAGE</h1>
              <span className="text-[9px] font-medium bg-purple-950/80 text-purple-300 border border-purple-800/50 px-1.5 py-0.5 rounded-full">
                Autonomous AI Agent
              </span>
            </div>
            <div className="text-[10px] text-slate-400 hidden sm:block">
              Female Voice &bull; Context Awareness &bull; Task Planner &bull; Browser Control
            </div>
          </div>
        </div>

        {/* View Tabs */}
        <nav className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-2xl border border-slate-800/80 shadow-inner order-last sm:order-none w-full sm:w-auto justify-center">
          <button
            type="button"
            onClick={() => setActiveView('assistant')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
              activeView === 'assistant'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span>Assistant</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveView('browser')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
              activeView === 'browser'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Browser</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveView('memory')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
              activeView === 'memory'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            <span>Vault ({memories.length})</span>
          </button>
        </nav>

        {/* Right Action Tools */}
        <div className="flex items-center gap-1.5">
          {/* Extension link status (opens the Browser panel) */}
          <BrowserStatusPill link={link} onClick={() => setActiveView('browser')} />

          {/* Chrome Extension files / setup */}
          <button
            type="button"
            onClick={() => setIsExtensionModalOpen(true)}
            aria-label="Chrome extension setup"
            className="p-1.5 sm:p-2 rounded-xl text-sky-300 bg-sky-950/60 hover:bg-sky-900/60 border border-sky-800/60 transition-colors cursor-pointer"
            title="Chrome extension files and setup"
          >
            <Layers className="w-4 h-4 text-sky-400" />
          </button>

          {/* Settings Button */}
          <button
            type="button"
            onClick={() => setIsSettingsModalOpen(true)}
            aria-label="Assistant Settings"
            className="p-1.5 sm:p-2 rounded-xl text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 transition-colors cursor-pointer"
            title="Settings & Voice Customization"
          >
            <Sliders className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main App Workspace */}
      <main className="flex-1 overflow-hidden relative flex">
        {/* VIEW 1: VOICE ASSISTANT */}
        {activeView === 'assistant' && (
          <div className="flex-1 flex flex-col items-center justify-between p-4 max-w-5xl mx-auto w-full relative z-10">
            {/* Upper Stage: Animated Orb */}
            <div className="py-2 flex flex-col items-center justify-center flex-shrink-0">
              <AssistantOrb
                state={state}
                audioLevel={audioLevel}
                onClick={() => {
                  if (state === 'speaking') {
                    interrupt();
                  } else if (state === 'listening') {
                    stopListening();
                  } else {
                    startListening();
                  }
                }}
              />

              {errorMessage && (
                <div className="mt-2 text-xs text-rose-300 bg-rose-950/70 border border-rose-800/70 px-3 py-1 rounded-full animate-bounce">
                  {errorMessage}
                </div>
              )}
            </div>

            {/* Middle Stage: Conversation Timeline */}
            <div className="flex-1 w-full flex flex-col items-center overflow-hidden min-h-0">
              <ConversationStream
                messages={messages}
                onReplaySpeech={(text, emotion) => speakText(text, emotion)}
                onOpenBrowserUrl={handleNavigateUrl}
              />
            </div>

            {/* Lower Stage: Task Planner, Context Bar, YouTube Controller, Live Transcription & Input Dock */}
            <div className="w-full max-w-3xl flex flex-col items-center space-y-2.5 pt-2 flex-shrink-0">
              {/* Active Task Plan Progression Widget */}
              {activePlan && (
                <TaskPlannerWidget
                  plan={activePlan}
                  onCancelPlan={() => {
                    if (!activePlan.isComplete && !activePlan.isCancelled) {
                      fetch('/api/task/cancel', { method: 'POST' }).catch(() => {});
                    } else {
                      setActivePlan(null);
                    }
                  }}
                />
              )}

              {/* Context-Aware Browser Bar & Intelligent Video Controls */}
              <BrowserContextBar
                context={browserContext}
                onVideoCommand={handleVideoCommand}
                onOpenResult={handleOpenSearchResult}
                onSwitchFilterTab={handleSwitchFilterTab}
              />

              {/* Active YouTube Controller Widget */}
              {youtubeState && (
                <YouTubePlayerWidget
                  playerState={youtubeState}
                  onPlay={() => handleSendMessage('play')}
                  onPause={() => handleSendMessage('pause')}
                  onNext={() => handleSendMessage('play the next video')}
                  onChangeTrack={(newTrack) => handleSendMessage(`play ${newTrack}`)}
                  onOpenTab={handleNavigateUrl}
                  onClose={() => setDismissedMediaUrl(media.url)}
                />
              )}

              {/* Live Speech Transcription Feedback */}
              <LiveTranscription
                isListening={state === 'listening'}
                interimTranscript={interimTranscript}
                audioLevel={audioLevel}
                language={settings.language}
              />

              {/* Text Input & Voice Controls */}
              <div className="w-full flex items-center gap-2">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendMessage(textInput);
                  }}
                  className="flex-1 flex items-center bg-slate-900/90 border border-slate-800 rounded-2xl px-3 py-1.5 shadow-xl backdrop-blur-xl focus-within:border-purple-500 transition-all"
                >
                  <input
                    type="text"
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    placeholder={`Ask SAGE anything, or say "Find a video explaining how neural networks work, open a good one, and play it"...`}
                    className="flex-1 bg-transparent border-none text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none px-2"
                  />

                  {/* Send Button */}
                  <button
                    type="submit"
                    disabled={!textInput.trim() || isProcessing}
                    aria-label="Send message"
                    className="p-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-30 disabled:hover:bg-purple-600 text-white transition-all cursor-pointer shadow-md"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>

                {/* Primary Mic Button */}
                <button
                  type="button"
                  onClick={() => {
                    if (state === 'speaking') {
                      interrupt();
                    } else if (state === 'listening') {
                      stopListening();
                    } else {
                      startListening();
                    }
                  }}
                  aria-label={
                    state === 'speaking'
                      ? 'Interrupt speech'
                      : state === 'listening'
                      ? 'Stop listening'
                      : 'Start voice listening'
                  }
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer shadow-xl flex items-center justify-center ${
                    state === 'listening'
                      ? 'bg-sky-500 border-sky-400 text-white animate-pulse shadow-sky-500/30'
                      : state === 'speaking'
                      ? 'bg-rose-600 border-rose-500 text-white shadow-rose-600/30'
                      : 'bg-slate-900 border-slate-800 text-purple-400 hover:bg-purple-600 hover:text-white hover:border-purple-500'
                  }`}
                  title={state === 'speaking' ? 'Interrupt SAGE' : 'Click to Speak (or press Space)'}
                >
                  {state === 'speaking' ? (
                    <Square className="w-5 h-5 fill-current" />
                  ) : state === 'listening' ? (
                    <Mic className="w-5 h-5" />
                  ) : (
                    <Mic className="w-5 h-5" />
                  )}
                </button>
              </div>

              {/* Quick Prompt Suggestions */}
              <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 text-[11px] text-slate-400">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider flex-shrink-0">Try:</span>
                {[
                  'Find a video explaining how neural networks work, open a good one, and play it',
                  'Search for best Java tutorials',
                  'Go to the Videos tab',
                  'Play the first one',
                  'Now make it full screen',
                  'Skip forward 30 seconds',
                  'Play the video at 2x speed',
                  'Open Gmail, go to my inbox, and search for emails from Google',
                  'Play this music: Kesariya',
                  'Change to Bohemian Rhapsody',
                  'Pause YouTube',
                  'नमस्ते SAGE',
                ].map((sug, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSendMessage(sug)}
                    className="px-2.5 py-1 rounded-lg bg-slate-900/60 hover:bg-slate-800 border border-slate-800/80 hover:border-purple-500/50 text-slate-300 hover:text-purple-300 whitespace-nowrap transition-colors cursor-pointer"
                  >
                    "{sug}"
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: BROWSER CONTROL */}
        {activeView === 'browser' && (
          <div className="flex-1 p-4 max-w-5xl mx-auto w-full h-full overflow-y-auto space-y-4">
            <BrowserAccessPanel
              link={link}
              context={browserContext}
              allowScreenCapture={settings.allowScreenCapture}
              onToggleScreenCapture={(v) => setSettings((prev) => ({ ...prev, allowScreenCapture: v }))}
              onEnableBrowserAccess={() => setIsBrowserAccessOpen(true)}
              onRequestPermission={requestPermission}
              onReconnect={reconnect}
            />
            <BrowserNavigator
              currentUrl={currentBrowserUrl}
              onNavigate={handleNavigateUrl}
              recentActions={recentBrowserActions}
              onOpenExtensionModal={() => setIsExtensionModalOpen(true)}
            />
          </div>
        )}

        {/* VIEW 3: MEMORY VAULT */}
        {activeView === 'memory' && (
          <div className="flex-1 p-4 max-w-5xl mx-auto w-full h-full">
            <MemoryVault
              memories={memories}
              onAddMemory={handleAddMemory}
              onUpdateMemory={handleUpdateMemory}
              onDeleteMemory={handleDeleteMemory}
              onClearAll={handleClearAllMemories}
            />
          </div>
        )}
      </main>

      <EnableBrowserAccessModal
        open={isBrowserAccessOpen}
        onClose={() => setIsBrowserAccessOpen(false)}
        link={link}
        onRequest={() => requestPermission('browser')}
      />

      {/* Every screenshot is announced to the user */}
      {captureToast && (
        <div role="status" className="fixed top-16 right-4 z-50 max-w-xs bg-slate-900/95 border border-sky-600/70 rounded-xl px-3 py-2 text-xs text-slate-200 shadow-2xl">
          SAGE captured your screen to answer: “{captureToast.title || captureToast.url}”. The image is not stored.
        </div>
      )}

      {/* Floating Active New Tab Launcher Toast */}
      {activeTabToast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm w-[90vw] bg-slate-900/95 border border-purple-500/80 rounded-2xl p-4 shadow-2xl backdrop-blur-xl animate-in slide-in-from-bottom duration-300">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-purple-600/30 border border-purple-500/50 flex items-center justify-center text-purple-300 flex-shrink-0">
                <ExternalLink className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
                  <span>{activeTabToast.blocked ? 'Tab Dispatched (Click to Open)' : 'Opened in New Tab!'}</span>
                  <span className="text-[10px] bg-purple-950 text-purple-300 px-1.5 py-0.5 rounded border border-purple-800">
                    Chrome Task
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 truncate max-w-[200px]">
                  {activeTabToast.siteName}: {activeTabToast.url}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveTabToast(null)}
              aria-label="Dismiss toast"
              className="text-slate-400 hover:text-white p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
            <span className="text-[10px] text-slate-400">
              {activeTabToast.blocked ? 'Popup blocked by browser policy' : 'Tab opened in browser'}
            </span>
            <button
              type="button"
              onClick={() => {
                window.open(activeTabToast.url, '_blank', 'noopener,noreferrer');
                setActiveTabToast(null);
              }}
              className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-md"
            >
              <span>{activeTabToast.blocked ? 'Open Tab Now' : 'Switch / Re-open'}</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Chrome Extension Modal */}
      <ChromeExtensionModal
        isOpen={isExtensionModalOpen}
        onClose={() => setIsExtensionModalOpen(false)}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={settings}
        onUpdateSettings={(newVals) => setSettings((prev) => ({ ...prev, ...newVals }))}
        onEnableBrowserAccess={() => {
          setIsSettingsModalOpen(false);
          setIsBrowserAccessOpen(true);
        }}
        browserAccessGranted={Boolean(link.extension?.permissions.browserAccess)}
      />
    </div>
  );
}
