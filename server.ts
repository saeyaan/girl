import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { generateSpeechAudio, transcribeAudio, getAi } from './server/geminiService.ts';
import { memoryStore } from './server/memoryStore.ts';
import { WsBrowserBridge } from './server/agent/browserBridge.ts';
import { WorkingMemory, type WorkingMemoryEvent } from './server/agent/workingMemory.ts';
import { SageAgent, type ChatTurn } from './server/agent/agentLoop.ts';
import { GeminiModelClient } from './server/agent/model.ts';

// README points to .env.local; also accept a plain .env.
dotenv.config({ path: ['.env.local', '.env'] });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Increase JSON body limit for audio recording uploads (base64)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ==========================================
// AGENT WIRING
// ==========================================
// Browser bridge (WebSocket to the Chrome extension and the web UI), working memory (current task
// state, separate from long-term memories) and the reasoning agent.
const bridge = new WsBrowserBridge();
const isSageUrl = (url: string) => {
  try {
    const u = new URL(url);
    return ['localhost', '127.0.0.1'].includes(u.hostname) && u.port === String(PORT);
  } catch {
    return false;
  }
};
const workingMemory = new WorkingMemory(isSageUrl);
const agent = new SageAgent({
  bridge,
  wm: workingMemory,
  model: new GeminiModelClient(getAi),
  memory: memoryStore,
});

let contextBroadcastTimer: NodeJS.Timeout | null = null;
function scheduleContextBroadcast() {
  if (contextBroadcastTimer) return;
  contextBroadcastTimer = setTimeout(() => {
    contextBroadcastTimer = null;
    bridge.broadcastUi('context', workingMemory.toContext());
  }, 250);
}

bridge.onStatus((connected, info) => {
  workingMemory.extensionConnected = connected;
  workingMemory.extension = info;
  scheduleContextBroadcast();
});
bridge.onEvent(({ event, data }) => {
  // Pushed by the extension when tabs change, pages navigate or a video plays/pauses.
  if (['tab_activated', 'tab_updated', 'tab_removed', 'tabs', 'media_state', 'page_navigated'].includes(event)) {
    workingMemory.applyEvent({ event, data } as WorkingMemoryEvent);
    scheduleContextBroadcast();
  }
});

// ==========================================
// 1. CHAT & AI REASONING ENDPOINT
// ==========================================
app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { message, history, language, useDebuggerFullscreen, allowScreenCapture } = req.body as {
      message: string;
      history?: ChatTurn[];
      language?: 'en' | 'hi' | 'bn';
      useDebuggerFullscreen?: boolean;
      allowScreenCapture?: boolean;
    };

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message text is required' });
    }

    const result = await agent.run({ message, history: history || [], language, useDebuggerFullscreen, allowScreenCapture: Boolean(allowScreenCapture) });
    return res.json(result);
  } catch (error: any) {
    console.error('Chat endpoint error:', error);
    return res.status(500).json({
      error: 'Failed to process conversation',
      details: error?.message || String(error),
    });
  }
});

// ==========================================
// 1B. CONTEXT, TASK & BRIDGE STATUS
// ==========================================
app.get('/api/browser/context', (_req: Request, res: Response) => {
  workingMemory.extensionConnected = bridge.isConnected();
  return res.json({ context: workingMemory.toContext(), task: workingMemory.currentTask });
});

app.post('/api/task/cancel', (_req: Request, res: Response) => {
  const cancelled = agent.cancel();
  return res.json({ success: true, cancelled });
});

app.post('/api/session/reset', (_req: Request, res: Response) => {
  agent.cancel();
  workingMemory.reset();
  bridge.broadcastUi('context', workingMemory.toContext());
  return res.json({ success: true });
});

app.get('/api/bridge/status', (_req: Request, res: Response) => {
  return res.json({ extensionConnected: bridge.isConnected(), extension: bridge.extensionInfo() });
});

// Browser panel: re-read the working tab now.
app.post('/api/browser/refresh', async (_req: Request, res: Response) => {
  if (!bridge.isConnected()) return res.status(409).json({ ok: false, error: 'The SAGE extension is not connected.' });
  const r = await agent.observeNow();
  return res.json({ ...r, context: workingMemory.toContext() });
});

// Browser panel: user-requested screenshot of the visible tab (shown back to the user).
app.post('/api/browser/capture', async (_req: Request, res: Response) => {
  if (!bridge.isConnected()) return res.status(409).json({ ok: false, error: 'The SAGE extension is not connected.' });
  const r = await agent.captureNow();
  if (!r.ok || !r.image) return res.json({ ok: false, error: r.error });
  return res.json({ ok: true, dataUrl: `data:${r.image.mimeType};base64,${r.image.data}`, title: r.title, url: r.url });
});

// ==========================================
// 2. TEXT-TO-SPEECH (GEMINI TTS)
// ==========================================
app.post('/api/tts', async (req: Request, res: Response) => {
  try {
    const { text, voiceName } = req.body as {
      text: string;
      voiceName?: 'Kore' | 'Aoede' | 'Zephyr' | 'Puck';
    };

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required for TTS' });
    }

    const { audioBase64, mimeType } = await generateSpeechAudio(text, voiceName || 'Kore');

    return res.json({ audioBase64, mimeType });
  } catch (error: any) {
    console.error('TTS endpoint error:', error);
    return res.status(500).json({
      error: 'TTS generation failed',
      details: error?.message || String(error),
    });
  }
});

// ==========================================
// 3. AUDIO TRANSCRIBE (SPEECH-TO-TEXT)
// ==========================================
app.post('/api/transcribe', async (req: Request, res: Response) => {
  try {
    const { audioBase64, mimeType } = req.body as {
      audioBase64: string;
      mimeType?: string;
    };

    if (!audioBase64) {
      return res.status(400).json({ error: 'Audio data is required' });
    }

    const result = await transcribeAudio(audioBase64, mimeType || 'audio/webm');
    return res.json(result);
  } catch (error: any) {
    console.error('Transcribe endpoint error:', error);
    return res.status(500).json({
      error: 'Audio transcription failed',
      details: error?.message || String(error),
    });
  }
});

// ==========================================
// 4. MEMORY MANAGEMENT (CRUD)
// ==========================================
app.get('/api/memories', (_req: Request, res: Response) => {
  const memories = memoryStore.getAll();
  return res.json({ memories });
});

app.post('/api/memories', (req: Request, res: Response) => {
  try {
    const { category, key, value, tags, confidence } = req.body;
    if (!category || !key || !value) {
      return res.status(400).json({ error: 'Category, key, and value are required' });
    }
    const memory = memoryStore.add({
      category,
      key,
      value,
      tags: tags || [],
      confidence: confidence ?? 0.9,
    });
    return res.json({ memory });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.put('/api/memories/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const updated = memoryStore.update(id, req.body);
  if (!updated) {
    return res.status(404).json({ error: 'Memory not found' });
  }
  return res.json({ memory: updated });
});

app.delete('/api/memories/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const deleted = memoryStore.delete(id);
  if (!deleted) {
    return res.status(404).json({ error: 'Memory not found' });
  }
  return res.json({ success: true, id });
});

app.post('/api/memories/clear', (_req: Request, res: Response) => {
  memoryStore.clearAll();
  return res.json({ success: true, message: 'All memories cleared' });
});

// ==========================================
// 6. CHROME EXTENSION ASSETS & CODE VIEWER
// ==========================================
app.get('/api/extension/files', (_req: Request, res: Response) => {
  try {
    const extDir = path.resolve(__dirname, 'chrome-extension');
    const files: Record<string, string> = {};

    const fileNames = ['manifest.json', 'background.js', 'content.js', 'announce.js', 'permissions.html', 'permissions.js', 'popup.html', 'popup.js', 'README.md'];
    for (const name of fileNames) {
      const filePath = path.join(extDir, name);
      if (fs.existsSync(filePath)) {
        files[name] = fs.readFileSync(filePath, 'utf-8');
      }
    }
    return res.json({ files });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to read extension files', details: err.message });
  }
});

// ==========================================
// 7. VITE DEV SERVER OR STATIC ASSETS
// ==========================================
async function startServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SAGE] Server running on http://localhost:${PORT} (extension bridge: ws://localhost:${PORT}/ws)`);
  });
  bridge.attach(server);
}

startServer().catch((err) => {
  console.error('[Maya Assistant] Failed to start server:', err);
});
