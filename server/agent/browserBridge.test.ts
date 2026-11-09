import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { WebSocket } from 'ws';
import { WsBrowserBridge } from './browserBridge.ts';

const info = { id: 'abc', version: '3.0.0', protocol: 3, capabilities: ['observe'], permissions: { browserAccess: true, screenCapture: false, realFullscreen: false } };

async function start() {
  const server = http.createServer();
  const bridge = new WsBrowserBridge({ relinkGraceMs: 300 });
  bridge.attach(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port as number;
  return { server, bridge, port };
}

function connect(port: number, origin: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?role=ui`, { headers: { Origin: origin } });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    ws.on('unexpected-response', () => reject(new Error('rejected')));
  });
}

const until = async (fn: () => boolean, ms = 2000) => {
  const t = Date.now();
  while (!fn() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 10));
  return fn();
};

test('relay bridge: online only after handshake; RPC round trip; drop on bye/close', async () => {
  const { server, bridge, port } = await start();
  const statuses: boolean[] = [];
  bridge.onStatus((c) => statuses.push(c));

  await assert.rejects(connect(port, 'https://evil.example'), 'foreign origins are refused');

  const page = await connect(port, `http://127.0.0.1:${port}`);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(bridge.isConnected(), false, 'a page without an extension handshake is not "online"');
  await assert.rejects(bridge.call('observe'), /not connected/);

  // The page completed its handshake with the extension.
  page.send(JSON.stringify({ kind: 'ext_hello', info }));
  assert.ok(await until(() => bridge.isConnected()));
  assert.equal(bridge.extensionInfo()?.id, 'abc');

  // RPC goes to the page, which answers on behalf of the extension.
  page.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.kind === 'rpc') page.send(JSON.stringify({ kind: 'rpc_result', id: msg.id, ok: true, result: { echo: msg.method, params: msg.params } }));
  });
  assert.deepEqual(await bridge.call('observe', { tabId: 5 }), { echo: 'observe', params: { tabId: 5 } });

  // Permission change pushed as an event updates the info.
  page.send(JSON.stringify({ kind: 'event', event: 'permissions', data: { permissions: { ...info.permissions, screenCapture: true } } }));
  assert.ok(await until(() => bridge.extensionInfo()?.permissions.screenCapture === true));

  // Extension link lost (disabled, removed, worker died): pending calls fail fast.
  page.removeAllListeners('message');
  const pending = bridge.call('observe', {}, 5000);
  page.send(JSON.stringify({ kind: 'ext_bye', reason: 'extension disabled' }));
  await assert.rejects(pending, /disconnected \(extension disabled\)/);
  assert.equal(bridge.isConnected(), false);

  // Reconnected, then the page itself goes away.
  page.send(JSON.stringify({ kind: 'ext_hello', info }));
  assert.ok(await until(() => bridge.isConnected()));
  page.close();
  assert.ok(await until(() => !bridge.isConnected()));
  assert.deepEqual(statuses.filter((s, i) => i === 0 || s !== statuses[i - 1]), [true, false, true, false]);
  server.close();
});
