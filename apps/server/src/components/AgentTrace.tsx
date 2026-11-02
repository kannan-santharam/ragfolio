'use client';

import { useState } from 'react';
import { TriangleAlert, Check, ChevronRight, ListTree, LoaderCircle, Search } from 'lucide-react';
import type { TraceStep } from '@/lib/types';

const TOOL_META: Record<string, { icon: typeof Search; label: string }> = {
  search_document: { icon: Search, label: 'Searched' },
  list_sections: { icon: ListTree, label: 'Listed sections' },
};

function describeArgs(step: TraceStep): string | null {
  if (step.tool !== 'search_document') return null;
  const query = String(step.args.query ?? '');
  return query ? `“${query}”` : null;
}

/**
 * The visible reasoning trail.
 *
 * The whole point of a tool-calling agent over one-shot RAG is that the model
 * chooses when and how to retrieve — so the choices are rendered rather than
 * hidden behind a spinner.
 */
export function AgentTrace({ steps, streaming }: { steps: TraceStep[]; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;

  const running = steps.some((s) => s.status === 'running');
  const searches = steps.filter((s) => s.tool === 'search_document').length;
  const totalMs = steps.reduce((sum, s) => sum + (s.ms ?? 0), 0);

  const headline = running
    ? (describeArgs(steps[steps.length - 1]) ?? 'Working…')
    : `${searches || steps.length} ${searches === 1 ? 'retrieval' : 'retrievals'} · ${(totalMs / 1000).toFixed(1)}s`;

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-[var(--border-card)] bg-[var(--bg-inner)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-card-hover)]"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform ${open ? 'rotate-90' : ''}`}
        />
        {running && !streaming ? (
          <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--color-cyan)]" />
        ) : (
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--color-cyan)]" />
        )}
        <span className="truncate text-xs font-semibold text-[var(--text-sub)]">
          {running ? (
            <span className="gemini-gradient-text">{headline}</span>
          ) : (
            <>
              Agent trace
              <span className="ml-2 font-normal text-[var(--text-muted)]">{headline}</span>
            </>
          )}
        </span>
      </button>

      {open && (
        <ol className="space-y-1.5 border-t border-[var(--border-card)] px-3 py-2.5">
          {steps.map((step, index) => {
            const meta = TOOL_META[step.tool] ?? { icon: Search, label: step.tool };
            const Icon = meta.icon;
            return (
              <li key={step.id} className="flex items-start gap-2.5 text-xs">
                <span className="mt-0.5 font-mono text-[0.65rem] text-[var(--text-muted)]">
                  {index + 1}
                </span>
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-violet)]" />
                <div className="min-w-0 flex-1">
                  <p className="text-[var(--text-body)]">
                    <span className="font-semibold text-[var(--text-title)]">{meta.label}</span>
                    {describeArgs(step) && (
                      <span className="ml-1 font-mono text-[0.7rem] text-[var(--color-cyan)]">
                        {describeArgs(step)}
                      </span>
                    )}
                  </p>
                  {step.summary && (
                    <p className="mt-0.5 text-[0.7rem] text-[var(--text-muted)]">
                      {step.summary}
                      {step.ms != null && ` · ${step.ms}ms`}
                    </p>
                  )}
                </div>
                {step.status === 'running' && (
                  <LoaderCircle className="h-3 w-3 shrink-0 animate-spin text-[var(--text-muted)]" />
                )}
                {step.status === 'done' && (
                  <Check className="h-3 w-3 shrink-0 text-[var(--color-emerald)]" />
                )}
                {step.status === 'error' && (
                  <TriangleAlert className="h-3 w-3 shrink-0 text-[var(--color-danger)]" />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
