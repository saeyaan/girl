import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserContextState } from '../utils/browserContextManager.ts';
import type { TaskPlan } from '../utils/taskPlanner.ts';
import { configuredExtensionId, rememberExtensionId, REQUIRED_PROTOCOL } from '../utils/extensionConfig.ts';

export interface ExtensionPermissions {
  browserAccess: boolean;
  screenCapture: boolean;
  realFullscreen: boolean;
}

export interface ExtensionInfo {
  id: string;
  version: string;
  protocol: number;
  capabilities: string[];
  permissions: ExtensionPermissions;
}

/** GREEN online · GREY online but page access not granted · YELLOW connecting · RED offline */
export type LinkStatus = 'online' | 'permissions' | 'connecting' | 'offline';

export type LinkProblem =
  | 'server_unreachable'
  | 'not_detected'
  | 'wrong_id'
  | 'handshake_timeout'
  | 'outdated'
  | 'heartbeat_lost'
  | 'disconnected'
  | null;

export interface LinkState {
  status: LinkStatus;
  problem: LinkProblem;
  message: string;
  detail?: string;
  extensionId: string;
  extension: ExtensionInfo | null;
  serverConnected: boolean;
  lastHeartbeatAt: number | null;
  origin: string;
}

export interface ScreenCapturedNotice {
  tabId: number;
  url: string;
  title: string;
  at: number;
}

interface Handlers {
  onContext?: (ctx: BrowserContextState) => void;
  onPlan?: (plan: TaskPlan) => void;
  onScreenCaptured?: (n: ScreenCapturedNotice) => void;
}

const HEARTBEAT_MS = 10000;
const HEARTBEAT_TIMEOUT_MS = 5000;
const HANDSHAKE_TIMEOUT_MS = 4000;

/**
 * Live link between this page, the SAGE Chrome extension and the SAGE server.
 *
 * - Connects to the extension with chrome.runtime.connect (the extension's externally_connectable
 *   allows this origin), performs a hello/hello_ack handshake and keeps a heartbeat.
 * - Relays the server's RPC calls to the extension and the extension's results/events back.
 * - Reconnects automatically (worker suspended or restarted, extension reloaded or re-enabled).
 * - Only reports ONLINE after a successful handshake, and explains every failure.
 */
export function useBrowserLink(handlers: Handlers) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const [state, setState] = useState<LinkState>(() => ({
    status: 'connecting',
    problem: null,
    message: 'Connecting to the SAGE extension…',
    extensionId: configuredExtensionId(),
    extension: null,
    serverConnected: false,
    lastHeartbeatAt: null,
    origin,
  }));

  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const wsRef = useRef<WebSocket | null>(null);
  const portRef = useRef<any>(null);
  const infoRef = useRef<ExtensionInfo | null>(null);
  const extIdRef = useRef(configuredExtensionId());
  const timers = useRef<{ heartbeat?: any; pongWait?: any; handshake?: any; reconnect?: any }>({});
  const attemptRef = useRef(0);
  const handshakedRef = useRef(false);
  const disposedRef = useRef(false);
  /** Server RPCs that arrived while the extension link was down; sent after the next handshake. */
  const queueRef = useRef<Array<{ msg: any; at: number }>>([]);

  const patch = useCallback((p: Partial<LinkState>) => setState((s) => ({ ...s, ...p })), []);

  const sendServer = useCallback((msg: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const statusFor = (info: ExtensionInfo): Pick<LinkState, 'status' | 'message'> =>
    info.permissions.browserAccess
      ? { status: 'online', message: `Extension online (v${info.version})` }
      : { status: 'permissions', message: 'Extension online, but page access is not granted yet. Click "Enable Browser Access".' };

  // ---------------------------------------------------------------------------
  // Extension port
  // ---------------------------------------------------------------------------

  const clearExtTimers = () => {
    clearInterval(timers.current.heartbeat);
    clearTimeout(timers.current.pongWait);
    clearTimeout(timers.current.handshake);
  };

  const scheduleReconnect = useCallback((delay?: number) => {
    if (disposedRef.current) return;
    clearTimeout(timers.current.reconnect);
    const wait = delay ?? Math.min(500 * 2 ** attemptRef.current, 5000);
    attemptRef.current = Math.min(attemptRef.current + 1, 6);
    timers.current.reconnect = setTimeout(() => connectExtension(), wait);
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
  }, []);

  const dropLink = useCallback(
    (problem: Exclude<LinkProblem, null>, message: string, detail?: string) => {
      clearExtTimers();
      const port = portRef.current;
      portRef.current = null;
      if (port) {
        try {
          port.disconnect();
        } catch {}
      }
      if (infoRef.current) sendServer({ kind: 'ext_bye', reason: message });
      infoRef.current = null;
      handshakedRef.current = false;
      patch({ status: 'offline', problem, message, detail, extension: null });
      scheduleReconnect();
    },
    [patch, scheduleReconnect, sendServer]
  );

  const connectExtension = useCallback(() => {
    if (disposedRef.current) return;
    clearTimeout(timers.current.reconnect);
    const rt = (window as any).chrome?.runtime;
    // Ask the extension's announcer (if installed) for its id, in case it differs from ours.
    window.postMessage({ source: 'sage-app', type: 'discover' }, origin);

    if (!rt || typeof rt.connect !== 'function') {
      patch({
        status: 'offline',
        problem: 'not_detected',
        message: 'SAGE extension not detected in this browser.',
        detail: `Chrome only exposes extensions to pages they allow. Install or enable the SAGE extension (chrome://extensions → Developer mode → Load unpacked → the chrome-extension folder), then reload this page. If it is installed, ${origin} must be listed in its externally_connectable matches.`,
        extension: null,
      });
      scheduleReconnect(5000);
      return;
    }

    const extId = extIdRef.current;
    patch({ status: 'connecting', message: 'Connecting to the SAGE extension…', extensionId: extId });
    let port: any;
    try {
      port = rt.connect(extId, { name: 'sage-app' });
    } catch (err: any) {
      patch({
        status: 'offline',
        problem: 'wrong_id',
        message: `Cannot connect to extension id ${extId}.`,
        detail: String(err?.message || err),
      });
      scheduleReconnect();
      return;
    }
    portRef.current = port;
    handshakedRef.current = false;

    port.onDisconnect.addListener(() => {
      if (portRef.current !== port) return;
      const err = rt.lastError?.message || '';
      if (!handshakedRef.current) {
        dropLink(
          'wrong_id',
          `No SAGE extension answered at id ${extId}.`,
          `${err ? `Chrome: "${err}". ` : ''}The extension is not installed, is disabled, or has a different id. After updating the extension files, click Reload on it in chrome://extensions (version 3 has a fixed id).`
        );
      } else {
        dropLink('disconnected', 'Extension disconnected: reconnecting…', err || 'The extension was reloaded or disabled, or Chrome restarted its service worker.');
      }
    });

    port.onMessage.addListener((msg: any) => {
      if (portRef.current !== port || !msg) return;
      switch (msg.type) {
        case 'hello_ack': {
          clearTimeout(timers.current.handshake);
          const info = msg.info as ExtensionInfo;
          if (!info || (info.protocol || 0) < REQUIRED_PROTOCOL) {
            dropLink('outdated', `The installed SAGE extension (v${info?.version || '?'}) is outdated.`, 'Click Reload on SAGE in chrome://extensions so it picks up the new version.');
            return;
          }
          handshakedRef.current = true;
          attemptRef.current = 0;
          infoRef.current = info;
          rememberExtensionId(info.id);
          patch({ ...statusFor(info), problem: null, detail: undefined, extension: info, extensionId: info.id, lastHeartbeatAt: Date.now() });
          sendServer({ kind: 'ext_hello', info });
          for (const { msg: q } of queueRef.current.splice(0)) {
            try {
              port.postMessage({ type: 'rpc', id: q.id, method: q.method, params: q.params });
            } catch {}
          }
          clearInterval(timers.current.heartbeat);
          timers.current.heartbeat = setInterval(() => {
            try {
              port.postMessage({ type: 'ping', t: Date.now() });
            } catch {
              return;
            }
            clearTimeout(timers.current.pongWait);
            timers.current.pongWait = setTimeout(
              () => dropLink('heartbeat_lost', 'Extension stopped responding: reconnecting…', 'No heartbeat reply within 5 seconds.'),
              HEARTBEAT_TIMEOUT_MS
            );
          }, HEARTBEAT_MS);
          break;
        }
        case 'pong':
          clearTimeout(timers.current.pongWait);
          patch({ lastHeartbeatAt: Date.now() });
          break;
        case 'rpc_result':
          sendServer({ kind: 'rpc_result', id: msg.id, ok: msg.ok, result: msg.result, error: msg.error });
          break;
        case 'event':
          if (msg.event === 'permissions' && infoRef.current && msg.data?.permissions) {
            infoRef.current = { ...infoRef.current, permissions: msg.data.permissions };
            patch({ ...statusFor(infoRef.current), extension: infoRef.current });
            sendServer({ kind: 'ext_status', info: infoRef.current });
          }
          sendServer({ kind: 'event', event: msg.event, data: msg.data });
          break;
      }
    });

    timers.current.handshake = setTimeout(() => {
      if (portRef.current === port && !handshakedRef.current) {
        dropLink(
          'handshake_timeout',
          'The SAGE extension did not answer the handshake.',
          'Open chrome://extensions, find SAGE and check "Errors" or click "service worker" to inspect it, then click Reload.'
        );
      }
    }, HANDSHAKE_TIMEOUT_MS);
    try {
      port.postMessage({ type: 'hello', nonce: Math.random().toString(36).slice(2), app: 'sage', origin });
    } catch {}
  }, [dropLink, origin, patch, sendServer]);

  // ---------------------------------------------------------------------------
  // Server socket (progress + relay)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    disposedRef.current = false;
    let retry: any = null;
    let delay = 1000;
    let ws: WebSocket | null = null;

    const connectServer = () => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${window.location.host}/ws?role=ui`);
      wsRef.current = ws;
      ws.onopen = () => {
        delay = 1000;
        patch({ serverConnected: true });
        if (infoRef.current) ws!.send(JSON.stringify({ kind: 'ext_hello', info: infoRef.current }));
      };
      ws.onmessage = (ev) => {
        let msg: any;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg?.kind === 'rpc') {
          const port = portRef.current;
          if (port && handshakedRef.current) {
            try {
              port.postMessage({ type: 'rpc', id: msg.id, method: msg.method, params: msg.params });
              return;
            } catch {}
          }
          // The worker may have been suspended (e.g. this tab is in the background and its heartbeat
          // is throttled). Reconnecting wakes it; deliver the call once the handshake completes.
          queueRef.current.push({ msg, at: Date.now() });
          attemptRef.current = 0;
          if (!portRef.current) connectExtension();
          setTimeout(() => {
            const i = queueRef.current.findIndex((q) => q.msg.id === msg.id);
            if (i >= 0) {
              queueRef.current.splice(i, 1);
              sendServer({ kind: 'rpc_result', id: msg.id, ok: false, error: 'extension_offline' });
            }
          }, HANDSHAKE_TIMEOUT_MS + 2000);
          return;
        }
        if (msg?.kind !== 'ui') return;
        if (msg.type === 'context' && msg.data) handlersRef.current.onContext?.(msg.data);
        else if (msg.type === 'plan' && msg.data) handlersRef.current.onPlan?.(msg.data);
        else if (msg.type === 'screen_captured' && msg.data) handlersRef.current.onScreenCaptured?.(msg.data);
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        patch({ serverConnected: false });
        if (disposedRef.current) return;
        retry = setTimeout(connectServer, delay);
        delay = Math.min(delay * 2, 10000);
      };
    };

    connectServer();
    connectExtension();

    // The extension announces its real id on SAGE pages (covers repacked builds / changed ids).
    const onAnnounce = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== 'sage-extension' || e.data?.type !== 'announce') return;
      const id = String(e.data.id || '');
      if (/^[a-p]{32}$/.test(id) && id !== extIdRef.current && !handshakedRef.current) {
        extIdRef.current = id;
        rememberExtensionId(id);
        attemptRef.current = 0;
        connectExtension();
      }
    };
    // Coming back to the tab (or Chrome waking up) is a good moment to retry immediately.
    const onWake = () => {
      if (!handshakedRef.current && document.visibilityState === 'visible') {
        attemptRef.current = 0;
        connectExtension();
      }
    };
    window.addEventListener('message', onAnnounce);
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);

    return () => {
      disposedRef.current = true;
      window.removeEventListener('message', onAnnounce);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      clearExtTimers();
      clearTimeout(timers.current.reconnect);
      if (retry) clearTimeout(retry);
      try {
        portRef.current?.disconnect();
      } catch {}
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The server being unreachable overrides everything else.
  const effective: LinkState = state.serverConnected
    ? state
    : {
        ...state,
        status: state.status === 'connecting' ? 'connecting' : 'offline',
        problem: 'server_unreachable',
        message: 'SAGE server unreachable: reconnecting…',
        detail: 'The page cannot reach its own server. Make sure "npm run dev" is running.',
      };

  const requestPermission = useCallback((want: 'browser' | 'screen' | 'fullscreen') => {
    const port = portRef.current;
    if (!port || !handshakedRef.current) return false;
    try {
      port.postMessage({ type: 'request_permission', want });
      return true;
    } catch {
      return false;
    }
  }, []);

  const reconnect = useCallback(() => {
    attemptRef.current = 0;
    if (portRef.current && handshakedRef.current) return;
    connectExtension();
  }, [connectExtension]);

  return { link: effective, requestPermission, reconnect };
}
