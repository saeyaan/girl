/**
 * Browser Bridge: RPC between the SAGE server and the Chrome extension.
 *
 * The extension link is established by the SAGE web app itself: the page connects to the
 * extension with chrome.runtime.connect (externally_connectable), completes a handshake, and
 * relays messages over its WebSocket to this server:
 *
 *   server ──{kind:'rpc', id, method, params}──▶ app page ──port──▶ extension
 *   server ◀──{kind:'rpc_result', id, ok, result|error}── app page ◀── extension
 *   server ◀──{kind:'event', event, data}── app page ◀── extension   (tab / media / permission pushes)
 *   server ◀──{kind:'ext_hello' | 'ext_status' | 'ext_bye'}── app page (link up / changed / down)
 *   server ──{kind:'ui', type, data}──▶ every app page                (progress, context, status)
 *
 * The link only counts as connected after the page reports a successful handshake (ext_hello).
 */

import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';

export class BridgeError extends Error {
  constructor(public readonly code: 'EXTENSION_OFFLINE' | 'TIMEOUT' | 'REMOTE_ERROR', message: string) {
    super(message);
  }
}

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

export interface BridgeEvent {
  event: string;
  data: any;
}

/** What the agent needs from a browser connection. Implemented for real by WsBrowserBridge, faked in tests. */
export interface BrowserBridge {
  isConnected(): boolean;
  extensionInfo?(): ExtensionInfo | null;
  call<T = any>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  onEvent(handler: (e: BridgeEvent) => void): void;
  onStatus(handler: (connected: boolean, info: ExtensionInfo | null) => void): void;
  broadcastUi(type: string, data: unknown): void;
}

/** How long a call waits for an open SAGE page to re-establish its extension link. */
const RELINK_GRACE_MS = 6000;

interface PendingCall {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  relay: WebSocket;
}

interface Relay {
  ws: WebSocket;
  info: ExtensionInfo;
  since: number;
}

export class WsBrowserBridge implements BrowserBridge {
  private wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
  private uiClients = new Set<WebSocket>();
  /** App pages with a live, handshaked extension link; the most recent one is used. */
  private relays: Relay[] = [];
  private pending = new Map<string, PendingCall>();
  private nextId = 1;
  private eventHandlers: Array<(e: BridgeEvent) => void> = [];
  private statusHandlers: Array<(c: boolean, info: ExtensionInfo | null) => void> = [];
  private readonly relinkGraceMs: number;

  constructor(opts: { relinkGraceMs?: number } = {}) {
    this.relinkGraceMs = opts.relinkGraceMs ?? RELINK_GRACE_MS;
  }

  attach(server: Server): void {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname !== '/ws') return; // leave other upgrades (e.g. Vite HMR) alone
      const role = url.searchParams.get('role');
      const origin = String(req.headers.origin || '');
      // Only the SAGE app's own pages may relay the extension or listen to progress.
      if (role !== 'ui' || !isSameHostOrigin(origin, String(req.headers.host || ''))) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.acceptUi(ws));
    });
  }

  isConnected(): boolean {
    return this.currentRelay() !== null;
  }

  extensionInfo(): ExtensionInfo | null {
    return this.currentRelay()?.info || null;
  }

  async call<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> {
    let relay = this.currentRelay();
    if (!relay && this.uiClients.size > 0) {
      // A SAGE page is open: its link may just be re-handshaking (service worker woke up). Give it a moment.
      relay = await this.waitForRelay(Math.min(this.relinkGraceMs, timeoutMs));
    }
    if (!relay) {
      throw new BridgeError('EXTENSION_OFFLINE', 'The SAGE Chrome extension is not connected.');
    }
    return this.send<T>(relay, method, params, timeoutMs);
  }

  private waitForRelay(ms: number): Promise<Relay | null> {
    return new Promise((resolve) => {
      const started = Date.now();
      const check = () => {
        const r = this.currentRelay();
        if (r || Date.now() - started >= ms) resolve(r);
        else setTimeout(check, 100);
      };
      check();
    });
  }

  private send<T>(relay: Relay, method: string, params: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const id = String(this.nextId++);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError('TIMEOUT', `Browser did not respond to "${method}" within ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, relay: relay.ws });
      relay.ws.send(JSON.stringify({ kind: 'rpc', id, method, params }));
    });
  }

  onEvent(handler: (e: BridgeEvent) => void): void {
    this.eventHandlers.push(handler);
  }

  onStatus(handler: (connected: boolean, info: ExtensionInfo | null) => void): void {
    this.statusHandlers.push(handler);
  }

  broadcastUi(type: string, data: unknown): void {
    const msg = JSON.stringify({ kind: 'ui', type, data });
    for (const c of this.uiClients) {
      if (c.readyState === WebSocket.OPEN) c.send(msg);
    }
  }

  // ---------------------------------------------------------------------------

  private currentRelay(): Relay | null {
    for (let i = this.relays.length - 1; i >= 0; i--) {
      if (this.relays[i].ws.readyState === WebSocket.OPEN) return this.relays[i];
    }
    return null;
  }

  private acceptUi(ws: WebSocket): void {
    this.uiClients.add(ws);
    ws.send(JSON.stringify({ kind: 'ui', type: 'status', data: this.statusPayload() }));

    ws.on('message', (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      switch (msg?.kind) {
        case 'ping':
          ws.send(JSON.stringify({ kind: 'pong', at: Date.now() }));
          break;
        case 'ext_hello':
        case 'ext_status': {
          if (!isExtensionInfo(msg.info)) return;
          const wasConnected = this.isConnected();
          const existing = this.relays.find((r) => r.ws === ws);
          if (existing && msg.kind === 'ext_status') existing.info = msg.info;
          else {
            this.relays = this.relays.filter((r) => r.ws !== ws);
            this.relays.push({ ws, info: msg.info, since: Date.now() });
          }
          if (!wasConnected) console.log(`[SAGE bridge] extension ${msg.info.id} v${msg.info.version} linked via app page`);
          this.emitStatus();
          break;
        }
        case 'ext_bye':
          this.dropRelay(ws, String(msg.reason || 'extension link closed'));
          break;
        case 'rpc_result': {
          const p = this.pending.get(String(msg.id));
          if (!p) return;
          this.pending.delete(String(msg.id));
          clearTimeout(p.timer);
          if (msg.ok) p.resolve(msg.result);
          else p.reject(new BridgeError('REMOTE_ERROR', String(msg.error || 'Browser action failed')));
          break;
        }
        case 'event': {
          if (!msg.event) return;
          if (msg.event === 'permissions' && msg.data?.permissions) {
            const r = this.relays.find((x) => x.ws === ws);
            if (r) {
              r.info = { ...r.info, permissions: msg.data.permissions };
              this.emitStatus();
            }
          }
          for (const h of this.eventHandlers) {
            try {
              h({ event: msg.event, data: msg.data });
            } catch (err) {
              console.warn('[SAGE bridge] event handler error:', err);
            }
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      this.uiClients.delete(ws);
      this.dropRelay(ws, 'SAGE app page closed');
    });
  }

  private dropRelay(ws: WebSocket, reason: string): void {
    const had = this.relays.some((r) => r.ws === ws);
    if (!had) return;
    this.relays = this.relays.filter((r) => r.ws !== ws);
    for (const [id, p] of this.pending) {
      if (p.relay !== ws) continue;
      clearTimeout(p.timer);
      p.reject(new BridgeError('EXTENSION_OFFLINE', `The SAGE Chrome extension disconnected (${reason}).`));
      this.pending.delete(id);
    }
    if (!this.isConnected()) console.log(`[SAGE bridge] extension link lost: ${reason}`);
    this.emitStatus();
  }

  private statusPayload() {
    return { extensionConnected: this.isConnected(), extension: this.extensionInfo() };
  }

  private emitStatus(): void {
    const connected = this.isConnected();
    const info = this.extensionInfo();
    for (const h of this.statusHandlers) h(connected, info);
    this.broadcastUi('status', this.statusPayload());
  }
}

function isExtensionInfo(x: any): x is ExtensionInfo {
  return Boolean(x && typeof x.id === 'string' && typeof x.version === 'string' && x.permissions && typeof x.permissions === 'object');
}

function isSameHostOrigin(origin: string, host: string): boolean {
  if (!origin) return false;
  try {
    const o = new URL(origin);
    if (o.host === host) return true;
    // localhost and 127.0.0.1 are the same machine; allow either spelling on the same port
    const [, hostPort] = host.split(':');
    return ['localhost', '127.0.0.1'].includes(o.hostname) && o.port === (hostPort || '');
  } catch {
    return false;
  }
}
