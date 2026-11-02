'use client';

import { Lightbulb, X } from 'lucide-react';

export const COACH_SEEN_KEY = 'ragfolio-coach-seen';

export function coachSeen(): boolean {
  try {
    return localStorage.getItem(COACH_SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markCoachSeen(): void {
  try {
    localStorage.setItem(COACH_SEEN_KEY, '1');
  } catch {
    /* private browsing */
  }
}

/** One-line dismissible hint shown around the first answer. */
export function CoachMark({ text, onDismiss, className = '' }: { text: string; onDismiss: () => void; className?: string }) {
  return (
    <div
      role="note"
      className={`flex items-start gap-2 rounded-lg border border-[var(--border-gold)] bg-[var(--color-cyan)]/8 px-2.5 py-1.5 ${className}`}
    >
      <Lightbulb className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--color-cyan)]" />
      <p className="min-w-0 flex-1 text-[0.7rem] leading-relaxed text-[var(--text-sub)]">{text}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss hint"
        className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-title)]"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
