import React from 'react';
import { X, Volume2, Globe, Sliders, Mic, Sparkles } from 'lucide-react';
import { AssistantSettings } from '../types.ts';
import { SupportedLanguage } from '../utils/conversationUtils.ts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AssistantSettings;
  onUpdateSettings: (newSettings: Partial<AssistantSettings>) => void;
  /** Opens the "Enable Browser Access" permission flow. */
  onEnableBrowserAccess?: () => void;
  browserAccessGranted?: boolean;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onEnableBrowserAccess,
  browserAccessGranted,
  settings,
  onUpdateSettings,
}) => {
  if (!isOpen) return null;

  const femaleVoices = [
    { id: 'Kore', name: 'Kore (Gemini Neural - Warm & Expressive)', provider: 'gemini' },
    { id: 'Aoede', name: 'Aoede (Gemini Neural - Bright & Melodic)', provider: 'gemini' },
    { id: 'Zephyr', name: 'Zephyr (Gemini Neural - Calm & Gentle)', provider: 'gemini' },
    { id: 'browser-default', name: 'Browser Native Female Voice', provider: 'browser' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-purple-950 border border-purple-800 text-purple-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">Assistant &amp; Voice Settings</h2>
              <p className="text-xs text-slate-400">Configure Maya's female voice, speech rate, and language.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Settings Body */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[75vh]">
          {/* Primary Language */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Globe className="w-4 h-4 text-purple-400" />
              <span>Conversational Language</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'en', label: 'English (US)', sub: 'Default' },
                { id: 'hi', label: 'हिंदी (Hindi)', sub: 'Native' },
                { id: 'bn', label: 'বাংলা (Bengali)', sub: 'Native' },
              ].map((lang) => (
                <button
                  key={lang.id}
                  type="button"
                  onClick={() => onUpdateSettings({ language: lang.id as SupportedLanguage })}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    settings.language === lang.id
                      ? 'bg-purple-600 border-purple-500 text-white shadow-md'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <div className="text-xs font-semibold">{lang.label}</div>
                  <div className={`text-[10px] ${settings.language === lang.id ? 'text-purple-200' : 'text-slate-500'}`}>
                    {lang.sub}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Voice Engine & Persona */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-rose-400" />
              <span>Female Voice Persona &amp; Engine</span>
            </label>
            <div className="space-y-2">
              {femaleVoices.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      femaleVoice: v.id,
                      voiceProvider: v.provider as 'gemini' | 'browser',
                    })
                  }
                  className={`w-full p-3 rounded-2xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                    settings.femaleVoice === v.id
                      ? 'bg-purple-950/60 border-purple-500 text-slate-100'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Volume2 className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-medium">{v.name}</span>
                  </div>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                      v.provider === 'gemini'
                        ? 'bg-purple-900/40 text-purple-300 border border-purple-800/60'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {v.provider === 'gemini' ? 'Gemini 3.8 TTS' : 'Web Speech'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Sliders: Rate, Pitch, Volume */}
          <div className="space-y-4 pt-2">
            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1.5">
                <span>Speaking Speed</span>
                <span className="font-mono text-purple-400">{settings.speakingRate}x</span>
              </div>
              <input
                type="range"
                min="0.8"
                max="1.4"
                step="0.05"
                value={settings.speakingRate}
                onChange={(e) => onUpdateSettings({ speakingRate: parseFloat(e.target.value) })}
                className="w-full accent-purple-500 bg-slate-950 rounded-lg cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1.5">
                <span>Voice Pitch / Modulation</span>
                <span className="font-mono text-purple-400">{settings.pitch}x</span>
              </div>
              <input
                type="range"
                min="0.9"
                max="1.3"
                step="0.05"
                value={settings.pitch}
                onChange={(e) => onUpdateSettings({ pitch: parseFloat(e.target.value) })}
                className="w-full accent-purple-500 bg-slate-950 rounded-lg cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1.5">
                <span>Volume</span>
                <span className="font-mono text-purple-400">{Math.round(settings.volume * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={settings.volume}
                onChange={(e) => onUpdateSettings({ volume: parseFloat(e.target.value) })}
                className="w-full accent-purple-500 bg-slate-950 rounded-lg cursor-pointer"
              />
            </div>
          </div>

          {/* Auto-Open Tabs Toggle */}
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Globe className="w-4 h-4 text-sky-400" />
                <span>Automatically Open in New Tabs</span>
              </div>
              <p className="text-[11px] text-slate-400">
                When the SAGE extension isn't connected, open search and site links in a new tab from this page.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoOpenTabs}
              onClick={() => onUpdateSettings({ autoOpenTabs: !settings.autoOpenTabs })}
              className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer ${
                settings.autoOpenTabs ? 'bg-purple-600' : 'bg-slate-800'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                  settings.autoOpenTabs ? 'left-7' : 'left-1'
                }`}
              />
            </button>
          </div>

          {/* Browser access (extension permissions) */}
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Globe className="w-4 h-4 text-sky-400" />
                <span>Browser Access</span>
              </div>
              <p className="text-[11px] text-slate-400">
                {browserAccessGranted
                  ? 'Granted: SAGE can read and act on the pages you ask about.'
                  : 'Lets SAGE read the current page, its search results and video, and act on them when you ask.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onEnableBrowserAccess}
              className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex-shrink-0 cursor-pointer"
            >
              {browserAccessGranted ? 'Manage' : 'Enable Browser Access'}
            </button>
          </div>

          {/* Visual observation */}
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Globe className="w-4 h-4 text-sky-400" />
                <span>Visual Observation</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Let SAGE screenshot the visible tab when you ask a visual question. Each capture is shown to you and not stored.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.allowScreenCapture}
              onClick={() => onUpdateSettings({ allowScreenCapture: !settings.allowScreenCapture })}
              className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer flex-shrink-0 ${
                settings.allowScreenCapture ? 'bg-purple-600' : 'bg-slate-800'
              }`}
            >
              <div className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${settings.allowScreenCapture ? 'left-7' : 'left-1'}`} />
            </button>
          </div>

          {/* Real Fullscreen Toggle */}
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Globe className="w-4 h-4 text-sky-400" />
                <span>Real Video Fullscreen</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Off: SAGE fills the screen with the player (no warnings). On: true fullscreen through Chrome's debugger. Also tick
                "Allow real video fullscreen" in the extension popup; Chrome briefly shows a debugging bar.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.useDebuggerFullscreen}
              onClick={() => onUpdateSettings({ useDebuggerFullscreen: !settings.useDebuggerFullscreen })}
              className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer flex-shrink-0 ${
                settings.useDebuggerFullscreen ? 'bg-purple-600' : 'bg-slate-800'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                  settings.useDebuggerFullscreen ? 'left-7' : 'left-1'
                }`}
              />
            </button>
          </div>

          {/* Continuous Listening Toggle */}
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Mic className="w-4 h-4 text-sky-400" />
                <span>Continuous Conversation Mode</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Automatically resumes listening after Maya finishes speaking.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.continuousListening}
              onClick={() => onUpdateSettings({ continuousListening: !settings.continuousListening })}
              className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer ${
                settings.continuousListening ? 'bg-purple-600' : 'bg-slate-800'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                  settings.continuousListening ? 'left-7' : 'left-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-medium transition-colors"
          >
            Save &amp; Close
          </button>
        </div>
      </div>
    </div>
  );
};
