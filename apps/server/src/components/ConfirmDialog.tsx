'use client';

import { useEffect, useRef } from 'react';
import { TriangleAlert } from 'lucide-react';

/**
 * Confirmation for an action that destroys data.
 *
 * Focus moves to the cancel button on open, so the safe choice is the one a
 * keyboard user activates by reflex — and Escape backs out.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="animate-fade-in relative w-full max-w-sm rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--color-danger)]/12">
            <TriangleAlert className="h-4 w-4 text-[var(--color-danger)]" />
          </div>
          <div className="min-w-0 pt-0.5">
            <h2 id="confirm-title" className="text-sm font-bold text-[var(--text-title)]">
              {title}
            </h2>
          </div>
        </div>

        <div className="mb-5 text-[0.8rem] leading-relaxed text-[var(--text-sub)]">{body}</div>

        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-[var(--border-card)] px-3.5 py-2 text-xs font-semibold text-[var(--text-sub)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-title)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-[var(--color-danger)] px-3.5 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
