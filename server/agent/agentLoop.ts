/**
 * SAGE agent loop
 *
 *   USER INPUT → INTENT + CONTEXT (working memory + fresh page observation + long-term memory)
 *   → fast path for unambiguous follow-ups, otherwise the model plans and calls one tool at a time
 *   → each tool acts, re-observes and verifies → the model sees the verified outcome → … → reply.
 *
 * Without a model (no API key / API failure) it degrades to the deterministic parsers and the
 * template planner, still executed for real through the same verified tools.
 */

import type { Content, Part } from '@google/genai';
import type { BrowserAction } from '../../src/utils/browserCommands.ts';
import { parseBrowserCommand } from '../../src/utils/browserCommands.ts';
import { detectLanguage } from '../../src/utils/conversationUtils.ts';
import { detectMemoryIntent, findRelevantMemories } from '../../src/utils/memoryMatcher.ts';
import { isMultiStepGoal, planTask, type TaskPlan, type TaskStep } from '../../src/utils/taskPlanner.ts';
import type { MemoryItem } from '../memoryStore.ts';
import type { BrowserBridge } from './browserBridge.ts';
import { decideFastPath, isPronounPlay, normalizeCommand, parseResultQuestion, type FastDecision, type ToolCall } from './fastPath.ts';
import type { ModelClient } from './model.ts';
import { buildSystemPrompt } from './prompts.ts';
import { fmtClock, say, type Lang } from './replies.ts';
import { isAffirmative, isNegative } from './safety.ts';
import {
  describeToolCall,
  formatSnapshot,
  READ_ONLY_TOOLS,
  siteOf,
  TERMINAL_TOOLS,
  TOOL_DECLARATIONS,
  ToolExecutor,
  type ScreenCaptureNotice,
  type ToolResult,
} from './tools.ts';
import { truncate, type WorkingMemory } from './workingMemory.ts';

export interface ChatTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AgentRunInput {
  message: string;
  history?: ChatTurn[];
  language?: Lang;
  useDebuggerFullscreen?: boolean;
  /** User enabled visual observation (screenshots) in settings. */
  allowScreenCapture?: boolean;
}

export type AgentEmotion = 'friendly' | 'thoughtful' | 'happy' | 'empathetic' | 'curious' | 'neutral';

export interface AgentTurnResult {
  replyText: string;
  emotion: AgentEmotion;
  detectedLanguage: Lang;
  retrievedMemories: MemoryItem[];
  savedMemory: MemoryItem | null;
  taskPlan: TaskPlan | null;
  browserAction: BrowserAction | null;
  fallbackOpenUrl?: string;
  browserContext: ReturnType<WorkingMemory['toContext']>;
  reasoningPipeline: {
    intent: string;
    mode: 'fast' | 'llm' | 'offline' | 'confirmation';
    contextResolved: boolean;
    hasMultiStepPlan: boolean;
    steps: number;
  };
}

export interface MemoryPort {
  getAll(): MemoryItem[];
  add(m: Omit<MemoryItem, 'id' | 'timestamp'>): MemoryItem;
}

export interface AgentDeps {
  bridge: BrowserBridge;
  wm: WorkingMemory;
  model: ModelClient;
  memory: MemoryPort;
  limits?: { maxSteps?: number; totalMs?: number; perCallMs?: number };
}

interface RunHandle {
  cancelled: boolean;
  done: Promise<void>;
}

const OBSERVE_MAX_AGE_MS = 1500;

export class SageAgent {
  private running: RunHandle | null = null;
  private readonly maxSteps: number;
  private readonly totalMs: number;
  private readonly perCallMs: number;

  constructor(private readonly deps: AgentDeps) {
    this.maxSteps = deps.limits?.maxSteps ?? 8;
    this.totalMs = deps.limits?.totalMs ?? 75000;
    this.perCallMs = deps.limits?.perCallMs ?? 20000;
  }

  /** Re-read the working tab now (Browser panel "Refresh"). */
  async observeNow(): Promise<{ ok: boolean; error?: string }> {
    const { bridge, wm } = this.deps;
    wm.extensionConnected = bridge.isConnected();
    wm.extension = bridge.extensionInfo?.() || null;
    const r = await new ToolExecutor(bridge, wm).execute('get_current_page_context', {});
    bridge.broadcastUi('context', wm.toContext());
    return r.ok ? { ok: true } : { ok: false, error: r.message };
  }

  /** Screenshot requested explicitly by the user from the Browser panel. */
  async captureNow(): Promise<{ ok: boolean; error?: string; image?: { mimeType: string; data: string }; title?: string; url?: string }> {
    const { bridge, wm } = this.deps;
    const exec = new ToolExecutor(bridge, wm, {
      allowScreenCapture: true,
      onScreenCapture: (n) => bridge.broadcastUi('screen_captured', n),
    });
    const r = await exec.execute('capture_visible_screen', {});
    bridge.broadcastUi('context', wm.toContext());
    if (!r.ok || !r.image) return { ok: false, error: r.message };
    return { ok: true, image: r.image, title: r.snapshot?.title, url: r.snapshot?.url };
  }

  /** Stop the in-flight task after its current step. */
  cancel(): boolean {
    if (!this.running) return false;
    this.running.cancelled = true;
    if (this.deps.wm.currentTask) {
      this.deps.wm.currentTask = { ...this.deps.wm.currentTask, isCancelled: true };
      this.deps.bridge.broadcastUi('plan', this.deps.wm.currentTask);
    }
    return true;
  }

  async run(input: AgentRunInput): Promise<AgentTurnResult> {
    // One task at a time: a new instruction ("actually, search for horror games") supersedes the old one.
    if (this.running) {
      this.running.cancelled = true;
      await Promise.race([this.running.done, sleep(8000)]);
    }
    let release!: () => void;
    const handle: RunHandle = { cancelled: false, done: new Promise<void>((r) => (release = r)) };
    this.running = handle;
    try {
      return await this.runInner(input, handle);
    } finally {
      release();
      if (this.running === handle) this.running = null;
    }
  }

  // ---------------------------------------------------------------------------

  private async runInner(input: AgentRunInput, handle: RunHandle): Promise<AgentTurnResult> {
    const { wm, bridge, model, memory } = this.deps;
    const message = input.message.trim();
    const detected = detectLanguage(message);
    const lang: Lang = detected !== 'en' ? detected : input.language || 'en';
    wm.extensionConnected = bridge.isConnected();
    wm.extension = bridge.extensionInfo?.() || null;

    // Long-term memory: retrieve, and honour explicit "remember that ..." requests.
    const relevantMemories = findRelevantMemories(message, memory.getAll(), 0.15, 6) as MemoryItem[];
    const turn = new TurnState(message, bridge, wm);
    const intent = detectMemoryIntent(message);
    if (intent.shouldRemember && intent.category && intent.suggestedKey && intent.extractedValue) {
      turn.savedMemory = memory.add({
        category: intent.category,
        key: intent.suggestedKey,
        value: intent.extractedValue,
        confidence: 1.0,
        tags: [intent.category, 'direct-intent'],
      });
    }

    const makeExecutor = (approvalGranted = false) =>
      new ToolExecutor(bridge, wm, {
        useDebuggerFullscreen: input.useDebuggerFullscreen,
        allowScreenCapture: input.allowScreenCapture,
        onScreenCapture: (n: ScreenCaptureNotice) => bridge.broadcastUi('screen_captured', n),
        approvalGranted,
        saveMemory: (m) => {
          const saved = memory.add({
            category: (['profile', 'preference', 'fact', 'task'].includes(m.category) ? m.category : 'fact') as MemoryItem['category'],
            key: m.key,
            value: m.value,
            confidence: 0.95,
            tags: m.tags,
          });
          turn.savedMemory = saved;
          return saved;
        },
      });

    // OBSERVE first: make sure the context reflects the real browser, including manual changes.
    if (bridge.isConnected()) {
      const s = wm.lastSnapshot;
      if (!s || s.at === 0 || Date.now() - s.at > OBSERVE_MAX_AGE_MS) {
        try {
          await makeExecutor().observe(null);
        } catch {}
      }
    }

    const previousQuestion = wm.pendingQuestion;
    wm.pendingQuestion = null;

    // ---- Pending confirmation ------------------------------------------------
    if (wm.pendingConfirmation) {
      const pending = wm.pendingConfirmation;
      if (isNegative(message)) {
        wm.pendingConfirmation = null;
        return this.finish(turn, say(lang, 'confirmCancelled'), lang, relevantMemories, 'confirmation');
      }
      if (isAffirmative(message)) {
        if (pending.tool) {
          const exec = makeExecutor(true);
          const result = await turn.runTool(exec, { name: pending.tool, args: pending.args });
          wm.pendingConfirmation = null;
          if (model.available() && !handle.cancelled) {
            const note = `The user approved "${pending.summary}". It was executed: ${result.ok ? 'OK' : 'FAILED'} — ${result.message}. Continue the original objective if anything remains, otherwise finish.`;
            const llm = await this.llmLoop(input, lang, relevantMemories, turn, handle, exec, note);
            if (llm) return this.finish(turn, llm.reply, lang, relevantMemories, 'confirmation');
          }
          return this.finish(turn, result.ok ? say(lang, 'done') : say(lang, 'failed', result.message), lang, relevantMemories, 'confirmation');
        }
        // The model asked for approval before attempting anything: let it proceed with approval granted.
        if (model.available()) {
          const exec = makeExecutor(true);
          const llm = await this.llmLoop(input, lang, relevantMemories, turn, handle, exec, `The user approved: "${pending.summary}". Go ahead with exactly that.`);
          wm.pendingConfirmation = null;
          if (llm) return this.finish(turn, llm.reply, lang, relevantMemories, 'confirmation');
        }
        wm.pendingConfirmation = null;
        return this.finish(turn, say(lang, 'needLlmForThat'), lang, relevantMemories, 'confirmation');
      }
      // Anything else: the user moved on.
      wm.pendingConfirmation = null;
    }

    // "Which is the first result?" → remember it for the next turn only, so "play it" means that result.
    const referenced = wm.referencedResult;
    wm.referencedResult = null;
    const asked = parseResultQuestion(message);
    if (asked) {
      const results = wm.currentResults();
      const idx = asked.position === -1 ? results.length - 1 : asked.position - 1;
      wm.referencedResult = results[idx] ? { position: idx + 1, url: results[idx].url } : null;
    }

    // ---- Fast path -------------------------------------------------------------
    const fast = previousQuestion ? null : decideFastPath(message, wm, { llmAvailable: model.available(), referenced });
    if (fast) {
      const reply = await this.runFast(fast, turn, makeExecutor(), lang, handle);
      return this.finish(turn, reply, lang, relevantMemories, 'fast', true);
    }

    // ---- Objective bookkeeping --------------------------------------------------
    const words = normalizeCommand(message).split(/\s+/).length;
    if (!wm.objective || isMultiStepGoal(message) || words > 5 || /^actually\b|^instead\b|^no,?\s/i.test(message)) {
      wm.replaceObjective(message);
    }

    // ---- Reasoning loop -----------------------------------------------------------
    if (model.available()) {
      const llm = await this.llmLoop(input, lang, relevantMemories, turn, handle, makeExecutor());
      if (llm) return this.finish(turn, llm.reply, lang, relevantMemories, 'llm');
    }

    // ---- Offline engine -----------------------------------------------------------
    const reply = await this.offline(message, lang, relevantMemories, turn, makeExecutor(), handle);
    return this.finish(turn, reply, lang, relevantMemories, 'offline');
  }

  // ---------------------------------------------------------------------------
  // Fast path
  // ---------------------------------------------------------------------------

  private async runFast(fast: FastDecision, turn: TurnState, exec: ToolExecutor, lang: Lang, handle: RunHandle): Promise<string> {
    if (fast.kind === 'ask') return say(lang, fast.key, fast.count);
    const done: Array<{ call: ToolCall; result: ToolResult }> = [];
    for (const call of fast.calls) {
      if (handle.cancelled) return say(lang, 'cancelled');
      const result = await turn.runTool(exec, call);
      done.push({ call, result });
      if (!result.ok) break;
    }
    return replyFromResults(done, lang, this.deps.wm);
  }

  // ---------------------------------------------------------------------------
  // Reasoning loop (Gemini function calling, one verified step at a time)
  // ---------------------------------------------------------------------------

  private async llmLoop(
    input: AgentRunInput,
    lang: Lang,
    memories: MemoryItem[],
    turn: TurnState,
    handle: RunHandle,
    exec: ToolExecutor,
    note?: string
  ): Promise<{ reply: string } | null> {
    const { wm, model } = this.deps;
    const system = buildSystemPrompt({ language: lang, memories });
    const contents: Content[] = buildHistory(input.history || []);
    contents.push({ role: 'user', parts: [{ text: buildUserTurn(input.message, wm, note) }] });

    const deadline = Date.now() + this.totalMs;
    for (let step = 0; step < this.maxSteps; step++) {
      if (handle.cancelled) return { reply: say(lang, 'cancelled') };
      const remaining = deadline - Date.now();
      if (remaining < 1500) break;

      let resp;
      try {
        resp = await model.generate({ systemInstruction: system, contents, tools: TOOL_DECLARATIONS, timeoutMs: Math.min(this.perCallMs, remaining) });
      } catch (err) {
        console.warn('[SAGE agent] model call failed:', err instanceof Error ? err.message : err);
        if (turn.actionCount === 0) return null; // nothing done yet → offline engine takes over
        break;
      }

      if (resp.functionCalls.length === 0) {
        if (resp.text.trim()) return { reply: resp.text.trim() };
        break;
      }

      contents.push(resp.content);
      const responseParts: Part[] = [];
      let terminal: ToolResult | null = null;

      for (const call of resp.functionCalls) {
        if (terminal || handle.cancelled) {
          responseParts.push(functionResponse(call, { ok: false, message: 'skipped: turn already ended' }));
          continue;
        }
        const result = await turn.runTool(exec, call);
        if (TERMINAL_TOOLS.has(call.name)) {
          terminal = result;
          responseParts.push(functionResponse(call, { ok: true }));
        } else {
          responseParts.push(functionResponse(call, toModelPayload(result), result.image));
        }
      }
      contents.push({ role: 'user', parts: responseParts });

      if (terminal) {
        const reply = terminal.reply?.trim() || replyFromResults(turn.results, lang, wm);
        return { reply: enforceHonesty(reply, wm, lang) };
      }
    }

    // Ran out of steps or time without a final answer.
    if (turn.actionCount === 0) return null;
    const lastOk = [...turn.results].reverse().find((r) => r.result.ok);
    return { reply: lastOk ? say(lang, 'partial', lastOk.result.message) : replyFromResults(turn.results, lang, wm) };
  }

  // ---------------------------------------------------------------------------
  // Offline engine (no model available)
  // ---------------------------------------------------------------------------

  private async offline(
    message: string,
    lang: Lang,
    memories: MemoryItem[],
    turn: TurnState,
    exec: ToolExecutor,
    handle: RunHandle
  ): Promise<string> {
    const { wm } = this.deps;
    const t = normalizeCommand(message);

    if (turn.savedMemory) return say(lang, 'remembered', turn.savedMemory.value);

    // "What is currently open in my browser?"
    if (/\bwhat(?:'s| is)\s+(?:currently\s+|now\s+)?(?:open|on)\b.*\b(?:browser|tab|screen)\b|\bwhich (?:tab|page|site|website)\b.*\b(?:open|on)\b/i.test(t)) {
      const result = await turn.runTool(exec, { name: 'get_active_tab', args: {} });
      if (!result.ok) return replyFromResults([{ call: { name: 'get_active_tab', args: {} }, result }], lang, wm);
      const tab = wm.tabs.find((x) => x.id === wm.workingTabId) || wm.lastSnapshot;
      return tab ? say(lang, 'currentlyOpen', tab.title, siteOf(tab.url)) : say(lang, 'nothingOpen');
    }
    // "Which is the first result?"
    const askedResult = parseResultQuestion(message);
    if (askedResult) {
      const results = wm.currentResults();
      const idx = askedResult.position === -1 ? results.length - 1 : askedResult.position - 1;
      const r = results[idx];
      if (!r) return results.length ? say(lang, 'outOfRange', results.length) : say(lang, 'noResults');
      return say(lang, 'resultIs', idx + 1, r.title, r.channel || r.source || siteOf(r.url));
    }
    if (/^(?:hello|hi|hey|namaste|नमस्ते|নমস্কার|হ্যালো)(?:\s+sage)?(?:[,!\s]|$)/i.test(t) && t.split(/\s+/).length <= 6) return say(lang, 'greeting');
    if (memories.length > 0 && /\b(who am i|what(?:'s| is) my|do you remember|my favou?rite|what do i)\b/i.test(t)) {
      return say(lang, 'recall', memories[0].key, memories[0].value);
    }

    // Multi-step goal → template plan, executed step by step with real verification.
    if (isMultiStepGoal(message)) {
      const template = planTask(message, wm.toContext());
      const calls = templateToCalls(template);
      if (calls.length > 0) {
        turn.adoptTemplate(template);
        const done: Array<{ call: ToolCall; result: ToolResult }> = [];
        for (let i = 0; i < calls.length; i++) {
          if (handle.cancelled) return say(lang, 'cancelled');
          const { call, stepIndex } = calls[i];
          const result = await turn.runTool(exec, call, stepIndex);
          done.push({ call, result });
          if (!result.ok) break;
          if (result.snapshot?.auth.needsLogin) {
            return say(lang, 'signIn', siteName(result.snapshot.url));
          }
        }
        return replyFromResults(done, lang, wm);
      }
    }

    // Single deterministic commands.
    const cmd = parseBrowserCommand(message);
    let calls: ToolCall[] = [];
    if (cmd && (cmd.type === 'youtube_play' || cmd.type === 'youtube_change') && isPronounPlay(`play ${cmd.trackName || ''}`)) {
      // "play that video" refers to context, it is not a song called "that video".
      const results = wm.currentResults().length;
      return results > 1 ? say(lang, 'whichResult', results) : say(lang, 'noVideo');
    }
    if (cmd) {
      if (cmd.type === 'youtube_play' || cmd.type === 'youtube_change') {
        calls = [
          { name: 'web_search', args: { query: cmd.trackName || cmd.query || 'music', engine: 'youtube' } },
          { name: 'open_result', args: { position: 1 } },
          { name: 'media_control', args: { action: 'play' } },
        ];
      } else if (cmd.type === 'youtube_pause') calls = [{ name: 'media_control', args: { action: 'pause' } }];
      else if (cmd.type === 'youtube_resume') calls = [{ name: 'media_control', args: { action: 'play' } }];
      else if (cmd.type === 'youtube_next') calls = [{ name: 'media_control', args: { action: 'next' } }];
      else if (cmd.type === 'go_back') calls = [{ name: 'navigate', args: { direction: 'back' } }];
      else if (cmd.type === 'go_forward') calls = [{ name: 'navigate', args: { direction: 'forward' } }];
      else if (cmd.type === 'search' && cmd.query) calls = [{ name: 'web_search', args: offlineSearchArgs(cmd.query) }];
      else if (cmd.type === 'open_url' && cmd.targetUrl) calls = [{ name: 'open_url', args: { url: cmd.targetUrl } }];
    }
    if (calls.length === 0) {
      const m = message.match(/^(?:find|search(?:\s+for)?|look\s+up|show\s+me|who\s+is|what\s+is|tell\s+me\s+about|explain)\s+(.+?)[.?!]*$/i);
      if (m) calls = [{ name: 'web_search', args: offlineSearchArgs(m[1]) }];
    }
    if (calls.length > 0) {
      const done: Array<{ call: ToolCall; result: ToolResult }> = [];
      for (const call of calls) {
        if (handle.cancelled) return say(lang, 'cancelled');
        const result = await turn.runTool(exec, call);
        done.push({ call, result });
        if (!result.ok) break;
      }
      return replyFromResults(done, lang, wm);
    }

    return this.deps.model.available() ? say(lang, 'help') : say(lang, 'needLlmForThat');
  }

  // ---------------------------------------------------------------------------

  private finish(
    turn: TurnState,
    reply: string,
    lang: Lang,
    memories: MemoryItem[],
    mode: AgentTurnResult['reasoningPipeline']['mode'],
    contextResolved = false
  ): AgentTurnResult {
    const { wm, bridge } = this.deps;
    const plan = turn.finishPlan();
    wm.currentTask = plan;
    const context = wm.toContext();
    bridge.broadcastUi('context', context);
    if (plan) bridge.broadcastUi('plan', plan);
    return {
      replyText: reply,
      emotion: detectEmotion(reply, turn),
      detectedLanguage: lang,
      retrievedMemories: memories,
      savedMemory: turn.savedMemory,
      taskPlan: plan,
      browserAction: turn.lastNav,
      fallbackOpenUrl: turn.fallbackOpenUrl,
      browserContext: context,
      reasoningPipeline: {
        intent: wm.objective || turn.message,
        mode,
        contextResolved,
        hasMultiStepPlan: Boolean(plan),
        steps: turn.actionCount,
      },
    };
  }
}

// =============================================================================
// Per-turn bookkeeping: live plan steps, navigation summary, fallback URL
// =============================================================================

class TurnState {
  results: Array<{ call: ToolCall; result: ToolResult }> = [];
  actionCount = 0;
  savedMemory: MemoryItem | null = null;
  fallbackOpenUrl?: string;
  lastNav: BrowserAction | null = null;
  private plan: TaskPlan;
  private templateMode = false;

  constructor(
    readonly message: string,
    private readonly bridge: BrowserBridge,
    private readonly wm: WorkingMemory
  ) {
    this.plan = {
      planId: `plan-${Date.now()}`,
      originalGoal: message,
      intentSummary: message,
      steps: [],
      currentStepIndex: 0,
      isComplete: false,
      isCancelled: false,
      createdAt: Date.now(),
    };
  }

  adoptTemplate(template: TaskPlan): void {
    this.templateMode = true;
    this.plan = {
      ...template,
      steps: template.steps.map((s) => ({ ...s, status: s.actionType === 'analyze_intent' ? 'completed' : 'pending', feedback: s.actionType === 'analyze_intent' ? s.feedback : undefined })),
      currentStepIndex: 0,
      isComplete: false,
    };
    this.publish();
  }

  async runTool(exec: ToolExecutor, call: ToolCall, templateStepIndex?: number): Promise<ToolResult> {
    const visible = !TERMINAL_TOOLS.has(call.name) && !READ_ONLY_TOOLS.has(call.name);
    let step: TaskStep | null = null;
    if (visible) {
      if (this.templateMode && templateStepIndex !== undefined && this.plan.steps[templateStepIndex]) {
        step = this.plan.steps[templateStepIndex];
        step.status = 'running';
        this.plan.currentStepIndex = templateStepIndex;
      } else if (!this.templateMode) {
        step = {
          id: `${this.plan.planId}-step-${this.plan.steps.length + 1}`,
          order: this.plan.steps.length + 1,
          title: describeToolCall(call.name, call.args),
          actionType: actionTypeFor(call),
          status: 'running',
        };
        this.plan.steps.push(step);
        this.plan.currentStepIndex = this.plan.steps.length - 1;
      }
      if (this.plan.steps.length >= 2) this.publish();
    }

    const result = await exec.execute(call.name, call.args);
    this.results.push({ call, result });
    if (visible) this.actionCount++;

    if (step) {
      step.status = result.ok ? 'completed' : 'failed';
      step.feedback = truncate(result.message, 160);
      if (this.plan.steps.length >= 2) this.publish();
    }
    if (result.fallbackOpenUrl) this.fallbackOpenUrl = result.fallbackOpenUrl;
    if (result.ok && ['web_search', 'open_url', 'open_result', 'switch_search_filter'].includes(call.name)) {
      const url = result.snapshot?.url || result.fallbackOpenUrl;
      this.lastNav = {
        type: call.name === 'web_search' ? 'search' : 'open_url',
        targetUrl: url,
        siteName: result.snapshot?.title || (url ? siteName(url) : undefined),
        query: call.name === 'web_search' ? String(call.args.query || '') : undefined,
        description: result.message,
      };
    }
    this.bridge.broadcastUi('context', this.wm.toContext());
    return result;
  }

  /** The plan is only surfaced when the turn really involved several steps. */
  finishPlan(): TaskPlan | null {
    const steps = this.plan.steps.filter((s) => s.actionType !== 'analyze_intent');
    if (steps.length < 2) return null;
    if (this.templateMode) {
      for (const s of this.plan.steps) if (s.status === 'pending' && s.actionType === 'complete') s.status = 'completed';
    }
    this.plan.isComplete = true;
    this.plan.completedAt = Date.now();
    return this.plan;
  }

  private publish(): void {
    this.wm.currentTask = this.plan;
    this.bridge.broadcastUi('plan', this.plan);
  }
}

// =============================================================================
// Helpers
// =============================================================================

function actionTypeFor(call: ToolCall): TaskStep['actionType'] {
  switch (call.name) {
    case 'web_search':
      return 'search_web';
    case 'open_url':
    case 'create_new_tab':
      return 'open_url';
    case 'search_current_website':
      return 'search_web';
    case 'play_video':
      return 'video_play';
    case 'pause_video':
      return 'video_control';
    case 'navigate_back':
    case 'navigate_forward':
    case 'scroll_page':
      return 'navigate';
    case 'open_result':
      return 'select_result';
    case 'switch_search_filter':
      return 'filter_results';
    case 'click_element':
      return 'click';
    case 'type_text':
      return 'type';
    case 'navigate':
    case 'switch_tab':
    case 'scroll':
      return 'navigate';
    case 'media_control':
      return call.args.action === 'play' ? 'video_play' : 'video_control';
    default:
      return 'verify_state';
  }
}

/**
 * Without a model: "find me a video about machine learning" → YouTube search for "machine learning".
 * Video-type requests go to YouTube, everything else to Google.
 */
export function offlineSearchArgs(raw: string): { query: string; engine: 'google' | 'youtube' } {
  // Only explicit video words; "search for Java tutorials" stays on Google (it has a Videos tab).
  const VIDEOISH = /\b(videos?|songs?|music|trailers?|clips?|watch)\b/i;
  const engine = VIDEOISH.test(raw) ? 'youtube' : 'google';
  let q = raw
    .trim()
    .replace(/[.?!]+$/, '')
    .replace(/^(?:me\s+)?(?:a|an|some|the|good|nice)\s+/i, '')
    .replace(/^(?:a|an|some|the|good|nice)\s+/i, '');
  if (engine === 'youtube') {
    q = q
      .replace(/^(?:videos?|clips?)\s+(?:about|on|of|explaining|for|showing)\s+/i, '')
      .replace(/\s+(?:videos?|clips?)$/i, '')
      .replace(/\s+on\s+youtube$/i, '')
      .trim();
  }
  return { query: q || raw.trim(), engine };
}

/** Map a template plan (offline mode) onto real tool calls. */
function templateToCalls(plan: TaskPlan): Array<{ call: ToolCall; stepIndex: number }> {
  const out: Array<{ call: ToolCall; stepIndex: number }> = [];
  plan.steps.forEach((s, i) => {
    switch (s.actionType) {
      case 'search_web': {
        const url = s.targetUrl || '';
        if (/youtube\.com\/results/.test(url)) out.push({ call: { name: 'web_search', args: { query: s.query, engine: 'youtube' } }, stepIndex: i });
        else if (/google\.[a-z.]+\/search/.test(url)) out.push({ call: { name: 'web_search', args: { query: s.query, engine: 'google' } }, stepIndex: i });
        else if (url) out.push({ call: { name: 'open_url', args: { url } }, stepIndex: i });
        break;
      }
      case 'filter_results':
        out.push({ call: { name: 'switch_search_filter', args: { name: 'Videos' } }, stepIndex: i });
        break;
      case 'select_result':
        out.push({ call: { name: 'open_result', args: { position: (s.resultIndex ?? 0) + 1 } }, stepIndex: i });
        break;
      case 'open_url':
        if (s.targetUrl) out.push({ call: { name: 'open_url', args: { url: s.targetUrl } }, stepIndex: i });
        break;
      case 'video_play':
        out.push({ call: { name: 'media_control', args: { action: 'play' } }, stepIndex: i });
        break;
      case 'inspect_results':
      case 'verify_state':
        out.push({ call: { name: 'observe_page', args: {} }, stepIndex: i });
        break;
    }
  });
  // A generic template with nothing concrete to do is not a plan.
  return out.some((c) => c.call.name !== 'observe_page') ? out : [];
}

function buildHistory(history: ChatTurn[]): Content[] {
  const out: Content[] = [];
  for (const h of history.slice(-8)) {
    if (h.role === 'system' || !h.content?.trim()) continue;
    const role = h.role === 'assistant' ? 'model' : 'user';
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.parts = [...(last.parts || []), { text: h.content }];
    } else {
      out.push({ role, parts: [{ text: h.content }] });
    }
  }
  while (out.length > 0 && out[0].role === 'model') out.shift();
  return out;
}

function buildUserTurn(message: string, wm: WorkingMemory, note?: string): string {
  const snap = wm.lastSnapshot && wm.lastSnapshot.tabId === wm.workingTabId ? wm.lastSnapshot : null;
  return [
    'CONTEXT (working memory)',
    wm.summarizeForPrompt(),
    '',
    'CURRENT PAGE',
    snap ? formatSnapshot(snap) : '(no page observed yet)',
    note ? `\nNOTE\n${note}` : '',
    '',
    `USER: ${message}`,
  ].join('\n');
}

function functionResponse(call: { id?: string; name: string }, response: Record<string, unknown>, image?: { mimeType: string; data: string }): Part {
  // Screenshots travel as a multimodal function response so the model sees them with the DOM data.
  const parts = image ? [{ inlineData: { mimeType: image.mimeType, data: image.data } }] : undefined;
  return { functionResponse: { id: call.id, name: call.name, response, ...(parts ? { parts } : {}) } };
}

function toModelPayload(r: ToolResult): Record<string, unknown> {
  const payload: Record<string, unknown> = { ok: r.ok, verified: Boolean(r.verified), message: r.message };
  if (r.errorCode) payload.error = r.errorCode;
  if (r.snapshot) payload.page = formatSnapshot(r.snapshot);
  if (r.fallbackOpenUrl) payload.opened_in_new_tab_by_app = r.fallbackOpenUrl;
  return payload;
}

/** Deterministic spoken reply describing the verified outcome of a sequence of tool calls. */
export function replyFromResults(done: Array<{ call: ToolCall; result: ToolResult }>, lang: Lang, wm: WorkingMemory): string {
  if (done.length === 0) return say(lang, 'help');
  const failed = done.find((d) => !d.result.ok);
  const target = failed || done[done.length - 1];
  const { call, result } = target;
  const code = result.errorCode;
  const fallback = done.find((d) => d.result.fallbackOpenUrl)?.result.fallbackOpenUrl;

  if (code === 'extension_offline') return fallback ? say(lang, 'openedFallback', siteName(fallback)) : say(lang, 'extensionOffline');
  if (code === 'no_video') return wm.currentResults().length > 1 ? say(lang, 'whichResult', wm.currentResults().length) : say(lang, 'noVideo');
  if (code === 'no_results') return say(lang, 'noResults');
  if (code === 'permission_required') return say(lang, 'permissionRequired');
  if (code === 'captcha') return say(lang, 'captcha', siteName(result.snapshot?.url || ''));
  if (code === 'screen_capture_disabled' || code === 'screen_permission_required') return say(lang, 'screenDisabled');
  if (code === 'out_of_range') return say(lang, 'outOfRange', wm.currentResults().length);
  if (code === 'blocked_by_autoplay') return say(lang, 'autoplayBlocked');
  if (code === 'needs_confirmation' && wm.pendingConfirmation) return say(lang, 'confirmAgain', wm.pendingConfirmation.summary);
  if (failed) return say(lang, 'failed', result.message);

  if (result.fallbackOpenUrl) return say(lang, 'openedFallback', siteName(result.fallbackOpenUrl));
  if (result.snapshot?.auth.needsLogin) return say(lang, 'signIn', siteName(result.snapshot.url));

  switch (call.name) {
    case 'web_search':
      return say(lang, 'searched', String(call.args.query || ''), call.args.engine === 'youtube' ? 'YouTube' : 'Google', result.snapshot?.results.length || 0);
    case 'open_url':
      return say(lang, 'opened', result.snapshot?.title || siteName(String(call.args.url)));
    case 'open_result':
      return say(lang, 'openedResult', (wm.selectedResult?.index ?? 0) + 1, wm.selectedResult?.title || result.snapshot?.title || '');
    case 'switch_search_filter':
      return say(lang, 'switchedFilter', String(call.args.name), result.snapshot?.results.length || 0);
    case 'navigate':
      if (call.args.direction === 'forward') return say(lang, 'wentForward');
      if (call.args.direction === 'reload') return say(lang, 'reloaded');
      return say(lang, 'wentBack', result.snapshot?.title || '');
    case 'media_control': {
      const m = result.media || wm.media;
      switch (call.args.action) {
        case 'play':
          return result.verified && m && !m.paused ? say(lang, 'playing', m.title || wm.selectedResult?.title || '') : say(lang, 'playNotConfirmed');
        case 'pause':
          return say(lang, 'paused');
        case 'seek':
          return say(lang, 'seeked', Number(call.args.value) || 0, fmtClock(m?.currentTime));
        case 'seek_to':
          return say(lang, 'seekedTo', fmtClock(m?.currentTime));
        case 'speed':
          return say(lang, 'speed', m?.playbackRate ?? Number(call.args.value));
        case 'volume_up':
        case 'volume_down':
        case 'volume_set':
          return say(lang, 'volume', Math.round((m?.volume ?? 1) * 100));
        case 'mute':
          return say(lang, 'muted');
        case 'unmute':
          return say(lang, 'unmuted');
        case 'fullscreen':
          return say(lang, 'fullscreenOn');
        case 'exit_fullscreen':
          return say(lang, 'fullscreenOff');
        case 'next':
          return say(lang, 'nextVideo', result.snapshot?.media?.title || result.snapshot?.title || '');
        case 'prev':
          return say(lang, 'prevVideo');
      }
      return say(lang, 'done');
    }
    default:
      return say(lang, 'done');
  }
}

/** Safety net: never let a reply claim playback that the player didn't confirm. */
export function enforceHonesty(reply: string, wm: WorkingMemory, lang: Lang): string {
  const claimsPlaying = /\b(?:is|now|it's|it is|started|starting|begun)\s+playing\b|\bplaying (?:it |the video )?now\b|अब चल रहा|এখন চলছে/i.test(reply);
  if (!claimsPlaying) return reply;
  const m = wm.media;
  const reallyPlaying = Boolean(m && m.present && !m.paused && !m.ended);
  if (reallyPlaying) return reply;
  return m && m.present ? say(lang, 'playNotConfirmed') : say(lang, 'noVideo');
}

function detectEmotion(reply: string, turn: TurnState): AgentEmotion {
  if (turn.results.some((r) => !r.result.ok)) return 'empathetic';
  if (/\?\s*$/.test(reply)) return 'curious';
  if (/sorry|couldn't|can't|unable|माफ़|দুঃখিত/i.test(reply)) return 'empathetic';
  if (/great|awesome|wonderful|enjoy|love|here (?:it is|you go)|playing/i.test(reply)) return 'happy';
  if (turn.actionCount > 0) return 'happy';
  return 'friendly';
}

function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
