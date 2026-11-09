/**
 * SAGE Autonomous Task Reasoning & Multi-Step Planner
 * Deconstructs natural human goals (e.g. "Find a video explaining neural networks, open a good one, and play it")
 * into ordered executable steps, tracking execution state and verifying completion.
 */

import { BrowserContextState, SearchResultItem } from './browserContextManager.ts';
import { parseBrowserCommand, BrowserAction } from './browserCommands.ts';

export interface TaskStep {
  id: string;
  order: number;
  title: string;
  actionType:
    | 'analyze_intent'
    | 'search_web'
    | 'filter_results'
    | 'inspect_results'
    | 'open_url'
    | 'select_result'
    | 'video_play'
    | 'video_control'
    | 'verify_state'
    | 'click'
    | 'type'
    | 'navigate'
    | 'ask_user'
    | 'complete';
  targetUrl?: string;
  query?: string;
  resultIndex?: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  feedback?: string;
  estimatedDurationMs?: number;
}

export interface TaskPlan {
  planId: string;
  originalGoal: string;
  intentSummary: string;
  steps: TaskStep[];
  currentStepIndex: number;
  isComplete: boolean;
  isCancelled: boolean;
  createdAt: number;
  completedAt?: number;
}

/**
 * Checks whether an input contains a multi-step goal or compound request.
 */
export function isMultiStepGoal(text: string): boolean {
  const clean = text.trim().toLowerCase();

  // Explicit compound connectors
  const hasConjunction = /(?:,\s*and\s+|\s+and\s+then\s+|\s+then\s+|,\s*then\s+|\s+and\s+(?:also\s+)?play|\s+and\s+search|\s+and\s+open|\s+and\s+make\s+it)/i.test(clean);

  // Common patterns
  const videoSearchAndPlay = /(?:find|search\s+for|look\s+up).+(?:video|tutorial|explanation).+(?:open|play|watch)/i.test(clean);
  const emailSearch = /(?:open\s+gmail|open\s+mail).+(?:inbox|search\s+for|look\s+for)/i.test(clean);
  const searchFilterOpen = /(?:search|google).+(?:go\s+to\s+videos?|videos?\s+tab).+(?:open|play)/i.test(clean);

  return hasConjunction || videoSearchAndPlay || emailSearch || searchFilterOpen;
}

/**
 * Builds an autonomous multi-step execution plan from user intent and current browser context.
 */
export function planTask(goal: string, context?: BrowserContextState): TaskPlan {
  const cleanGoal = goal.trim();
  const lower = cleanGoal.toLowerCase();
  const planId = `plan-${Date.now()}`;

  // 1. Pattern: "Find a video explaining [topic], open a good one, and play it"
  const videoExplainMatch = lower.match(/(?:find|look\s+for|search\s+for)(?:\s+a)?\s+(?:video|explanation|tutorial)\s+(?:explaining|about|on|for)\s+(.+?)(?:,\s*open|\s+open|\s+and\s+play|\s+and\s+watch|$)/i);
  if (videoExplainMatch || (lower.includes('video') && (lower.includes('play') || lower.includes('open')) && lower.includes('neural networks'))) {
    const topic = videoExplainMatch ? videoExplainMatch[1].replace(/,\s*open.+$/i, '').trim() : 'how neural networks work';
    const cleanTopic = topic.replace(/[.!?,]+$/, '').trim();
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanTopic)}`;

    const steps: TaskStep[] = [
      {
        id: `${planId}-step-1`,
        order: 1,
        title: `Analyze user objective: find & play video on "${cleanTopic}"`,
        actionType: 'analyze_intent',
        status: 'completed',
        feedback: `Understood goal: locate high-quality video on ${cleanTopic}`,
      },
      {
        id: `${planId}-step-2`,
        order: 2,
        title: `Search YouTube for "${cleanTopic}"`,
        actionType: 'search_web',
        targetUrl: searchUrl,
        query: cleanTopic,
        status: 'running',
      },
      {
        id: `${planId}-step-3`,
        order: 3,
        title: 'Inspect available search results for best explanation',
        actionType: 'inspect_results',
        status: 'pending',
      },
      {
        id: `${planId}-step-4`,
        order: 4,
        title: 'Choose and open top-ranked video',
        actionType: 'select_result',
        resultIndex: 0,
        status: 'pending',
      },
      {
        id: `${planId}-step-5`,
        order: 5,
        title: 'Start video playback and verify player status',
        actionType: 'video_play',
        status: 'pending',
      },
      {
        id: `${planId}-step-6`,
        order: 6,
        title: 'Confirm playback & inform user',
        actionType: 'complete',
        status: 'pending',
      },
    ];

    return {
      planId,
      originalGoal: cleanGoal,
      intentSummary: `Locate top video for "${cleanTopic}", open player, and begin verified playback`,
      steps,
      currentStepIndex: 1,
      isComplete: false,
      isCancelled: false,
      createdAt: Date.now(),
    };
  }

  // 2. Pattern: "Search for [query], go to videos tab, and open second result"
  if (lower.includes('search') && lower.includes('video') && (lower.includes('tab') || lower.includes('second') || lower.includes('first'))) {
    const queryMatch = lower.match(/search(?:\s+for)?\s+(.+?)(?:,\s*go|\s+go\s+to|\s+and\s+go|$)/i);
    const query = queryMatch ? queryMatch[1].replace(/[.!?,]+$/, '').trim() : 'best Java tutorials';
    const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    const videosFilterUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=vid`;

    const steps: TaskStep[] = [
      {
        id: `${planId}-step-1`,
        order: 1,
        title: `Search Google for "${query}"`,
        actionType: 'search_web',
        targetUrl: googleSearchUrl,
        query,
        status: 'completed',
      },
      {
        id: `${planId}-step-2`,
        order: 2,
        title: 'Navigate to "Videos" search filter tab',
        actionType: 'filter_results',
        targetUrl: videosFilterUrl,
        status: 'running',
      },
      {
        id: `${planId}-step-3`,
        order: 3,
        title: 'Identify video results and select #2',
        actionType: 'select_result',
        resultIndex: 1,
        status: 'pending',
      },
      {
        id: `${planId}-step-4`,
        order: 4,
        title: 'Open chosen video tutorial in new tab',
        actionType: 'open_url',
        status: 'pending',
      },
      {
        id: `${planId}-step-5`,
        order: 5,
        title: 'Start playback and verify media state',
        actionType: 'video_play',
        status: 'pending',
      },
    ];

    return {
      planId,
      originalGoal: cleanGoal,
      intentSummary: `Search for "${query}", filter by Videos, and open result #2`,
      steps,
      currentStepIndex: 1,
      isComplete: false,
      isCancelled: false,
      createdAt: Date.now(),
    };
  }

  // 3. Pattern: "Open Gmail, go to my inbox, and search for emails from Google"
  if (lower.includes('gmail') || (lower.includes('mail') && lower.includes('inbox'))) {
    const fromMatch = lower.match(/(?:search|look)\s+for\s+(?:emails|messages)?\s*(?:from\s+)?(.+)/i);
    const sender = fromMatch ? fromMatch[1].replace(/[.!?,]+$/, '').trim() : 'Google';

    const steps: TaskStep[] = [
      {
        id: `${planId}-step-1`,
        order: 1,
        title: 'Open Google Gmail',
        actionType: 'open_url',
        targetUrl: 'https://mail.google.com',
        status: 'running',
      },
      {
        id: `${planId}-step-2`,
        order: 2,
        title: 'Check authentication status (prompt user if login required)',
        actionType: 'verify_state',
        status: 'pending',
      },
      {
        id: `${planId}-step-3`,
        order: 3,
        title: 'Navigate to Inbox',
        actionType: 'open_url',
        targetUrl: 'https://mail.google.com/mail/u/0/#inbox',
        status: 'pending',
      },
      {
        id: `${planId}-step-4`,
        order: 4,
        title: `Execute search for: "from:${sender}"`,
        actionType: 'search_web',
        targetUrl: `https://mail.google.com/mail/u/0/#search/from%3A${encodeURIComponent(sender)}`,
        query: `from:${sender}`,
        status: 'pending',
      },
      {
        id: `${planId}-step-5`,
        order: 5,
        title: 'Display matched email results to user',
        actionType: 'complete',
        status: 'pending',
      },
    ];

    return {
      planId,
      originalGoal: cleanGoal,
      intentSummary: `Open Gmail, navigate to inbox, and filter emails from "${sender}"`,
      steps,
      currentStepIndex: 0,
      isComplete: false,
      isCancelled: false,
      createdAt: Date.now(),
    };
  }

  // Generic 3-step task plan
  const steps: TaskStep[] = [
    {
      id: `${planId}-step-1`,
      order: 1,
      title: `Analyze intent: "${cleanGoal}"`,
      actionType: 'analyze_intent',
      status: 'completed',
    },
    {
      id: `${planId}-step-2`,
      order: 2,
      title: 'Execute target action',
      actionType: 'open_url',
      status: 'running',
    },
    {
      id: `${planId}-step-3`,
      order: 3,
      title: 'Verify execution result',
      actionType: 'verify_state',
      status: 'pending',
    },
  ];

  return {
    planId,
    originalGoal: cleanGoal,
    intentSummary: cleanGoal,
    steps,
    currentStepIndex: 1,
    isComplete: false,
    isCancelled: false,
    createdAt: Date.now(),
  };
}

/**
 * Advances the task plan to the next step and marks previous step completed.
 */
export function advanceTaskPlan(plan: TaskPlan, stepFeedback?: string): TaskPlan {
  const currentIdx = plan.currentStepIndex;
  const updatedSteps = [...plan.steps];

  if (updatedSteps[currentIdx]) {
    updatedSteps[currentIdx] = {
      ...updatedSteps[currentIdx],
      status: 'completed',
      feedback: stepFeedback || 'Step executed successfully',
    };
  }

  const nextIdx = currentIdx + 1;
  const isComplete = nextIdx >= updatedSteps.length;

  if (!isComplete && updatedSteps[nextIdx]) {
    updatedSteps[nextIdx] = {
      ...updatedSteps[nextIdx],
      status: 'running',
    };
  }

  return {
    ...plan,
    steps: updatedSteps,
    currentStepIndex: isComplete ? currentIdx : nextIdx,
    isComplete,
    completedAt: isComplete ? Date.now() : undefined,
  };
}
