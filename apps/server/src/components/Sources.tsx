'use client';

import { useState } from 'react';
import { ChevronRight, FileText, Quote } from 'lucide-react';
import type { Citation } from '@/lib/types';

/** The retrieved passages behind an answer, addressable by citation marker. */
export function Sources({
  citations,
  messageId,
  highlighted,
}: {
  citations: Citation[];
  messageId: string;
  highlighted: number | null;
}) {
  const [open, setOpen] = useState(false);
  if (!citations.length) return null;

  const isOpen = open || highlighted != null;

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text-title)]"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`}
        />
        <Quote className="h-3.5 w-3.5" />
        {citations.length} source{citations.length === 1 ? '' : 's'}
      </button>

      {isOpen && (
        <ul className="mt-2 space-y-2">
          {citations.map((citation) => (
            <li
              key={citation.marker}
              id={`source-${messageId}-${citation.marker}`}
              className={`rounded-xl border bg-[var(--bg-inner)] p-3 transition-colors ${
                highlighted === citation.marker
                  ? 'border-[var(--color-cyan)]'
                  : 'border-[var(--border-card)]'
              }`}
            >
              <div className="mb-1.5 flex items-center gap-2">
                <span className="flex h-5 min-w-5 items-center justify-center rounded-md bg-[var(--color-primary)]/15 px-1 font-mono text-[0.65rem] font-bold text-[var(--color-cyan)]">
                  {citation.marker}
                </span>
                <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                <span className="truncate text-xs font-semibold text-[var(--text-title)]">
                  {citation.filename}
                </span>
                {citation.page != null && (
                  <span className="shrink-0 rounded bg-[var(--bg-pill)] px-1.5 py-0.5 text-[0.65rem] text-[var(--text-muted)]">
                    p.{citation.page}
                  </span>
                )}
                <span className="ml-auto shrink-0 font-mono text-[0.65rem] text-[var(--color-emerald)]">
                  {citation.similarity.toFixed(2)}
                </span>
              </div>
              {citation.heading && (
                <p className="mb-1 text-[0.7rem] font-semibold text-[var(--text-sub)]">
                  {citation.heading}
                </p>
              )}
              <p className="line-clamp-4 text-xs leading-relaxed text-[var(--text-muted)]">
                {citation.snippet}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
