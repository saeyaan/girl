/**
 * Model client used by the agent loop. Kept behind an interface so the loop can be tested with a
 * scripted fake and so the provider/model can be swapped without touching the loop.
 */

import { FunctionCallingConfigMode, GoogleGenAI, type Content, type FunctionDeclaration } from '@google/genai';

export interface ModelFunctionCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ModelResponse {
  /** The model turn exactly as returned (keeps thought signatures intact for the next request). */
  content: Content;
  functionCalls: ModelFunctionCall[];
  text: string;
}

export interface ModelRequest {
  systemInstruction: string;
  contents: Content[];
  tools: FunctionDeclaration[];
  timeoutMs: number;
}

export interface ModelClient {
  available(): boolean;
  generate(req: ModelRequest): Promise<ModelResponse>;
}

/** Models tried in order. A model that is over quota / overloaded / gone is skipped for a while. */
export const DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];
const COOLDOWN_MS = 5 * 60_000;

export class GeminiModelClient implements ModelClient {
  private readonly models: string[];
  private readonly coolingUntil = new Map<string, number>();

  constructor(private readonly getAi: () => GoogleGenAI | null, models?: string[]) {
    const primary = process.env.GEMINI_MODEL?.trim();
    this.models = (models || [primary || DEFAULT_MODELS[0], ...DEFAULT_MODELS]).filter((m, i, a) => m && a.indexOf(m) === i);
  }

  available(): boolean {
    return Boolean(this.getAi());
  }

  async generate(req: ModelRequest): Promise<ModelResponse> {
    const ai = this.getAi();
    if (!ai) throw new Error('Gemini client not configured');
    const now = Date.now();
    const ready = this.models.filter((m) => (this.coolingUntil.get(m) || 0) <= now);
    const order = ready.length ? ready : this.models; // everything cooling: try anyway
    const deadline = now + req.timeoutMs;
    let lastErr: unknown = null;
    for (let i = 0; i < order.length; i++) {
      const model = order[i];
      const remaining = deadline - Date.now();
      if (remaining < 1000) break;
      // Leave time for the fallback models if this one hangs (overloaded models can stall).
      const left = i < order.length - 1 ? Math.min(remaining, Math.max(6000, remaining / 2)) : remaining;
      try {
        const response = await withTimeout(
          ai.models.generateContent({
            model,
            contents: req.contents,
            config: {
              systemInstruction: req.systemInstruction,
              temperature: 0.4,
              tools: [{ functionDeclarations: req.tools }],
              // Always answer with a tool call; the loop ends on finish / ask_user / request_confirmation.
              toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } },
            },
          }),
          left
        );
        const content: Content = response.candidates?.[0]?.content || { role: 'model', parts: [] };
        if (!content.role) content.role = 'model';
        const parts = content.parts || [];
        const functionCalls = parts
          .filter((p) => p.functionCall)
          .map((p) => ({ id: p.functionCall!.id, name: p.functionCall!.name || '', args: (p.functionCall!.args as Record<string, unknown>) || {} }));
        const text = parts.map((p) => (p.text && !p.thought ? p.text : '')).join('');
        return { content, functionCalls, text };
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (/"code":\s*(429|503|404)|RESOURCE_EXHAUSTED|UNAVAILABLE|NOT_FOUND|no longer available|timed out/i.test(msg)) {
          this.coolingUntil.set(model, Date.now() + COOLDOWN_MS);
          console.warn(`[SAGE model] ${model} unavailable (${msg.match(/"code":\s*\d+/)?.[0] || 'error'}); using the next model for 5 minutes`);
        } else {
          console.warn(`[SAGE model] ${model} failed: ${msg.slice(0, 160)}`);
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('All Gemini models failed');
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Model call timed out after ${ms}ms`)), ms);
    }),
  ]);
}
