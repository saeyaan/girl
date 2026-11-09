import React, { useEffect, useState } from 'react';
import { Camera, CheckCircle2, Circle, Globe, Link2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { LinkState, LinkStatus } from '../hooks/useBrowserLink.ts';
import type { BrowserContextState } from '../utils/browserContextManager.ts';

const STATUS_STYLE: Record<LinkStatus, { dot: string; text: string; label: string; ring: string }> = {
  online: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'Extension Online', ring: 'border-emerald-700/70 bg-emerald-950/50' },
  permissions: { dot: 'bg-slate-400', text: 'text-slate-300', label: 'Permissions Required', ring: 'border-slate-600 bg-slate-800/60' },
  connecting: { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-300', label: 'Connecting', ring: 'border-amber-700/70 bg-amber-950/40' },
  offline: { dot: 'bg-rose-500', text: 'text-rose-300', label: 'Extension Offline', ring: 'border-rose-800/70 bg-rose-950/50' },
};

/** Top-right status: GREEN online · GREY permissions required · YELLOW connecting · RED offline. */
export function BrowserStatusPill({ link, onClick }: { link: LinkState; onClick: () => void }) {
  const s = STATUS_STYLE[link.status];
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${link.message}${link.detail ? `\n${link.detail}` : ''}`}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${s.ring} ${s.text}`}
    >
      <span className={`w-2 h-2 rounded-full ${s.dot}`} aria-hidden="true" />
      <span className="hidden sm:inline">{s.label}</span>
    </button>
  );
}

function timeAgo(ts?: number | null): string {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)} min ago`;
}

interface PanelProps {
  link: LinkState;
  context: BrowserContextState;
  allowScreenCapture: boolean;
  onToggleScreenCapture: (v: boolean) => void;
  onEnableBrowserAccess: () => void;
  onRequestPermission: (want: 'browser' | 'screen' | 'fullscreen') => boolean;
  onReconnect: () => void;
}

/** Browser panel: live link status, active tab, sync time, and permission controls. */
export function BrowserAccessPanel({
  link,
  context,
  allowScreenCapture,
  onToggleScreenCapture,
  onEnableBrowserAccess,
  onRequestPermission,
  onReconnect,
}: PanelProps) {
  const [busy, setBusy] = useState<'refresh' | 'capture' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shot, setShot] = useState<{ dataUrl: string; title?: string } | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const linked = link.status === 'online' || link.status === 'permissions';
  const perms = link.extension?.permissions;
  const s = STATUS_STYLE[link.status];

  const refresh = async () => {
    setBusy('refresh');
    setNotice(null);
    try {
      const res = await fetch('/api/browser/refresh', { method: 'POST' });
      const data = await res.json();
      setNotice(data.ok ? 'Browser context refreshed.' : data.error || 'Refresh failed.');
    } catch {
      setNotice('Could not reach the SAGE server.');
    } finally {
      setBusy(null);
    }
  };

  const capture = async () => {
    if (!perms?.screenCapture) {
      const sent = onRequestPermission('screen');
      setNotice(sent ? 'A SAGE window opened: click "Grant access" there to allow screen capture, then press Capture again.' : 'Connect the extension first.');
      return;
    }
    setBusy('capture');
    setNotice(null);
    try {
      const res = await fetch('/api/browser/capture', { method: 'POST' });
      const data = await res.json();
      if (data.ok) setShot({ dataUrl: data.dataUrl, title: data.title });
      else setNotice(data.error || 'Capture failed.');
    } catch {
      setNotice('Could not reach the SAGE server.');
    } finally {
      setBusy(null);
    }
  };

  const permRow = (granted: boolean | undefined, label: string, want: 'browser' | 'screen' | 'fullscreen') => (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className={`flex items-center gap-1.5 ${granted ? 'text-emerald-300' : 'text-slate-400'}`}>
        {granted ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
        {label}
      </span>
      {!granted && linked && (
        <button
          type="button"
          onClick={() => (want === 'browser' ? onEnableBrowserAccess() : onRequestPermission(want))}
          className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-200 cursor-pointer"
        >
          Allow
        </button>
      )}
    </div>
  );

  const tab = context.activeTab;
  return (
    <section className="w-full bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl text-xs space-y-3" aria-label="Browser connection">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${s.dot}`} aria-hidden="true" />
            <h2 className={`text-sm font-bold ${s.text}`}>{s.label.toUpperCase()}</h2>
          </div>
          <p className="text-slate-300 mt-1">{link.message}</p>
          {link.detail && <p className="text-slate-400 mt-0.5 max-w-xl">{link.detail}</p>}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {!linked && (
            <button type="button" onClick={onReconnect} className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer">
              <Link2 className="w-3.5 h-3.5" /> Retry now
            </button>
          )}
          <button
            type="button"
            onClick={onEnableBrowserAccess}
            disabled={!linked}
            className="px-2.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold flex items-center gap-1 cursor-pointer"
          >
            <ShieldCheck className="w-3.5 h-3.5" /> Enable Browser Access
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-2.5 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Active tab</div>
          <div className="text-slate-100 font-medium truncate">{tab?.title || (linked ? 'No tab yet' : '—')}</div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-1.5">Current URL</div>
          <div className="text-slate-300 truncate" title={tab?.url}>
            {tab?.url || '—'}
          </div>
          {context.pageAccess && context.pageAccess !== 'full' && (
            <div className="text-amber-300/90 mt-1">
              {context.pageAccess === 'permission_required'
                ? 'Only the title and address are visible: grant browser access to read the page.'
                : context.pageAccess === 'restricted'
                ? 'Browser-internal page: extensions cannot read it.'
                : 'This site does not allow extensions to read it.'}
            </div>
          )}
        </div>
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-2.5">
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">Connection</span>
            <span className={s.text}>{s.label}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">Extension</span>
            <span className="text-slate-300 font-mono text-[10px] truncate">{link.extension ? `v${link.extension.version} · ${link.extension.id}` : link.extensionId}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">Last heartbeat</span>
            <span className="text-slate-300">{timeAgo(link.lastHeartbeatAt)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">Last successful sync</span>
            <span className="text-slate-300">{timeAgo(context.lastSyncAt)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={refresh}
          disabled={!linked || busy !== null}
          className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`} /> Refresh browser context
        </button>
        <button
          type="button"
          onClick={capture}
          disabled={!linked || busy !== null}
          className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
        >
          <Camera className="w-3.5 h-3.5" /> Capture visible screen
        </button>
        {notice && <span className="text-slate-400">{notice}</span>}
      </div>

      <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-2.5">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Browser permissions</div>
        {permRow(perms?.browserAccess, 'Browser access: read and act on web pages', 'browser')}
        {permRow(perms?.screenCapture, 'Screen capture: let SAGE look at the visible tab', 'screen')}
        {permRow(perms?.realFullscreen, 'Real video fullscreen (debugger)', 'fullscreen')}
        <label className="flex items-center justify-between gap-2 pt-1.5 mt-1 border-t border-slate-800 cursor-pointer">
          <span className="text-slate-300">
            Visual observation
            <span className="block text-[10px] text-slate-500">Allow SAGE to take a screenshot when you ask a visual question. You are shown each capture.</span>
          </span>
          <input type="checkbox" checked={allowScreenCapture} onChange={(e) => onToggleScreenCapture(e.target.checked)} className="accent-purple-500 w-4 h-4" />
        </label>
      </div>

      {shot && (
        <figure className="relative bg-slate-950/60 border border-slate-800 rounded-xl p-2">
          <button type="button" onClick={() => setShot(null)} aria-label="Close screenshot" className="absolute top-2 right-2 p-1 rounded bg-slate-900/80 text-slate-300 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
          <img src={shot.dataUrl} alt={`Screenshot of ${shot.title || 'the visible tab'}`} className="w-full rounded-lg" />
          <figcaption className="text-[10px] text-slate-500 mt-1">Visible area of “{shot.title}”, captured just now (not stored).</figcaption>
        </figure>
      )}
    </section>
  );
}

/** Step 1 of "Enable Browser Access": explain, then hand off to the extension's permission window. */
export function EnableBrowserAccessModal({
  open,
  onClose,
  link,
  onRequest,
}: {
  open: boolean;
  onClose: () => void;
  link: LinkState;
  onRequest: () => boolean;
}) {
  const [stage, setStage] = useState<'explain' | 'waiting' | 'failed'>('explain');
  useEffect(() => {
    if (open) setStage('explain');
  }, [open]);
  if (!open) return null;
  const perms = link.extension?.permissions;
  const granted = Boolean(perms?.browserAccess);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Enable Browser Access">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5 text-sm text-slate-200 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-base flex items-center gap-2">
            <Globe className="w-4 h-4 text-sky-400" /> Enable Browser Access
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-slate-800 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {granted ? (
          <div className="space-y-2">
            <p className="text-emerald-300 font-semibold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> Browser access is enabled.
            </p>
            <ul className="text-xs space-y-1">
              <li>✓ Read pages (text, results, links, buttons, video state)</li>
              <li>✓ Act on pages (open results, switch tabs, play/pause, scroll)</li>
              <li>{perms?.screenCapture ? '✓' : '○'} Screen capture {perms?.screenCapture ? '' : '(optional, enable from the Browser panel)'}</li>
              <li>{perms?.realFullscreen ? '✓' : '○'} Real video fullscreen {perms?.realFullscreen ? '' : '(optional)'}</li>
            </ul>
            <button type="button" onClick={onClose} className="mt-2 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold cursor-pointer">
              Done
            </button>
          </div>
        ) : stage === 'explain' ? (
          <div className="space-y-2 text-xs">
            <p>So Maya can see and work in your browser, the SAGE extension will ask Chrome for permission to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <b>Read the pages you ask about</b>: title, address, visible text, search results, links, buttons, selected text and video state.
              </li>
              <li>
                <b>Act on them when you ask</b>: open results, switch to the Videos tab, scroll, type into search boxes, play and pause videos.
              </li>
            </ul>
            <p className="text-slate-400">
              SAGE never reads passwords, cookies or hidden form fields, never signs in for you, and asks before buying, sending or deleting anything. Chrome-internal pages stay off limits.
            </p>
            <button
              type="button"
              onClick={() => setStage(onRequest() ? 'waiting' : 'failed')}
              className="mt-1 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold cursor-pointer"
            >
              Continue
            </button>
          </div>
        ) : stage === 'waiting' ? (
          <div className="space-y-2 text-xs">
            <p>A small SAGE window opened. Click <b>Grant access</b> there, then <b>Allow</b> in Chrome’s prompt.</p>
            <p className="text-slate-400">This dialog updates automatically when Chrome confirms the permission.</p>
          </div>
        ) : (
          <p className="text-rose-300 text-xs">The extension is not connected, so it cannot ask Chrome for permission. {link.message}</p>
        )}
      </div>
    </div>
  );
}
