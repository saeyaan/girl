import React from 'react';
import { CheckCircle2, Circle, Loader2, XCircle, X, Zap } from 'lucide-react';
import { TaskPlan } from '../utils/taskPlanner.ts';

interface TaskPlannerWidgetProps {
  plan: TaskPlan;
  /** Stops a running task, or dismisses a finished one. */
  onCancelPlan: () => void;
}

/** Live view of the steps SAGE is actually executing, with statuses from verified results. */
export function TaskPlannerWidget({ plan, onCancelPlan }: TaskPlannerWidgetProps) {
  const total = Math.max(1, plan.steps.length);
  const settledCount = plan.steps.filter((s) => s.status === 'completed' || s.status === 'failed').length;
  const failedCount = plan.steps.filter((s) => s.status === 'failed').length;
  const progressPercent = plan.isComplete ? 100 : Math.round((settledCount / total) * 100);
  const running = !plan.isComplete && !plan.isCancelled;
  const statusLabel = plan.isCancelled
    ? 'Stopped'
    : plan.isComplete
    ? failedCount > 0
      ? `Finished with ${failedCount} failed step${failedCount > 1 ? 's' : ''}`
      : 'All steps verified'
    : `Step ${Math.min(plan.currentStepIndex + 1, total)} of ${total}`;

  return (
    <div className="w-full max-w-3xl bg-slate-900/95 border border-purple-500/50 rounded-2xl p-3.5 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-300">
      {/* Plan Header */}
      <div className="flex items-start justify-between gap-3 pb-2.5 border-b border-slate-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-purple-600/20 border border-purple-500/50 flex items-center justify-center text-purple-400 flex-shrink-0">
            <Zap className={`w-4 h-4 ${running ? 'animate-pulse' : ''}`} />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-purple-950 text-purple-300 border border-purple-800 px-1.5 py-0.5 rounded">
                SAGE Live Plan
              </span>
              <span className="text-[11px] font-medium text-slate-400">{statusLabel}</span>
            </div>
            <p className="text-xs font-semibold text-slate-100 truncate max-w-md mt-0.5">{plan.intentSummary}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onCancelPlan}
          aria-label={running ? 'Stop this task' : 'Dismiss plan'}
          title={running ? 'Stop this task' : 'Dismiss'}
          className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-slate-950 h-1.5 rounded-full my-2.5 overflow-hidden border border-slate-800/80">
        <div
          className="bg-gradient-to-r from-purple-500 to-indigo-500 h-full transition-all duration-500 rounded-full"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Ordered Steps List */}
      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
        {plan.steps.map((step) => {
          const isDone = step.status === 'completed';
          const isFailed = step.status === 'failed';
          const isCurrent = running && step.status === 'running';

          return (
            <div
              key={step.id}
              className={`flex items-start gap-2.5 p-2 rounded-xl text-xs transition-all ${
                isCurrent
                  ? 'bg-purple-950/40 border border-purple-500/40 text-slate-100'
                  : isDone || isFailed
                  ? 'bg-slate-950/40 border border-slate-800/50 text-slate-400'
                  : 'bg-slate-950/20 border border-transparent text-slate-500'
              }`}
            >
              {/* Status Indicator */}
              <div className="mt-0.5 flex-shrink-0">
                {isDone ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : isFailed ? (
                  <XCircle className="w-4 h-4 text-rose-400" />
                ) : isCurrent ? (
                  <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
                ) : (
                  <Circle className="w-4 h-4 text-slate-600" />
                )}
              </div>

              {/* Title & Feedback */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-medium ${isCurrent ? 'text-purple-200 font-semibold' : ''}`}>{step.title}</span>
                  <span className="text-[9px] uppercase tracking-wider text-slate-500 bg-slate-900 px-1 py-0.5 rounded border border-slate-800 flex-shrink-0">
                    {step.actionType.replace(/_/g, ' ')}
                  </span>
                </div>
                {step.feedback && (
                  <p className={`text-[10px] mt-0.5 ${isFailed ? 'text-rose-300/90' : 'text-emerald-400/90'}`}>{step.feedback}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
