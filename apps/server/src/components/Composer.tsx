'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, CircleHelp, Square, X } from 'lucide-react';
import { ModelPicker } from './ModelPicker';

const MAX_ROWS_PX = 200;

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  disabled,
  placeholder,
  model,
  models,
  onModelChange,
  tracing,
  ownKeyInUse,
  focusKey,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled: boolean;
  placeholder: string;
  model: string;
  models: string[];
  onModelChange: (model: string) => void;
  /** True when questions are sent to Langfuse — drives the disclosure below. */
  tracing: boolean;
  /** True when the visitor is running on their own provider key. */
  ownKeyInUse?: boolean;
  /** Bump to move keyboard focus into the textarea (e.g. after "Ask about it"). */
  focusKey?: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (!focusKey) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focusKey]);

  useEffect(() => {
    if (!helpOpen) return;
    const onKey = (event: globalThis.KeyboardEvent) => event.key === 'Escape' && setHelpOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [helpOpen]);

  // Grow with the content up to a cap, then scroll.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
  }, [value]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!disabled && !isStreaming) onSubmit();
    }
  };

  return (
    <div className="px-4 pb-4">
      <div className="mx-auto w-full max-w-3xl">
        <div className="relative rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-2 shadow-lg transition-colors focus-within:border-[var(--color-primary)]">
          {helpOpen && (
            <div
              role="dialog"
              aria-label="How this works"
              className="absolute right-2 bottom-full z-20 mb-2 w-72 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-3 text-left shadow-xl"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-[var(--text-title)]">How this works</p>
                <button
                  type="button"
                  onClick={() => setHelpOpen(false)}
                  aria-label="Close"
                  className="text-[var(--text-muted)] hover:text-[var(--text-title)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <ul className="mt-2 space-y-1.5 text-[0.7rem] leading-relaxed text-[var(--text-sub)]">
                <li className="flex gap-2">
                  <span className="text-[var(--color-cyan)]">1.</span>
                  Your documents are read by the model — tables, charts and images included — and indexed.
                </li>
                <li className="flex gap-2">
                  <span className="text-[var(--color-cyan)]">2.</span>
                  For each question the agent decides whether to search, and searches again if results are thin.
                </li>
                <li className="flex gap-2">
                  <span className="text-[var(--color-cyan)]">3.</span>
                  Every claim in the answer cites the passage it came from. Click a [1] to see it.
                </li>
              </ul>
              <p className="mt-2 border-t border-[var(--border-card)] pt-2 text-[0.65rem] leading-relaxed text-[var(--text-muted)]">
                Uploads are private to this browser session and deleted after 24 hours. Your API key, if you added one,
                never leaves your browser except in the request header to this server.
              </p>
            </div>
          )}

          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            className="no-scrollbar max-h-[200px] w-full resize-none bg-transparent px-2 py-2 text-[0.9375rem] leading-relaxed text-[var(--text-title)] outline-none placeholder:text-[var(--text-muted)] disabled:opacity-60"
          />

          {/* The model control sits with the message it affects. */}
          <div className="flex items-center gap-1 pt-1">
            <ModelPicker value={model} models={models} onChange={onModelChange} disabled={disabled} />

            <div className="flex-1" />

            <button
              type="button"
              onClick={() => setHelpOpen(!helpOpen)}
              aria-label="How this works"
              aria-expanded={helpOpen}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-title)]"
            >
              <CircleHelp className="h-4 w-4" />
            </button>

            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop generating"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-pill)] text-[var(--text-title)] transition-colors hover:bg-[var(--bg-card-hover)]"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onSubmit}
                disabled={disabled || !value.trim()}
                aria-label="Send message"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#0052ff] to-[#00d2ff] text-white transition-opacity disabled:opacity-35"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <p className="mt-2 text-center text-[0.7rem] text-[var(--text-muted)]">Enter to send · Shift+Enter for a new line</p>

        {/*
          What leaves this app, stated in one place. Tracing is optional and the
          sentence only appears when it is actually on. The key sentence appears
          only to visitors who supplied one — said unprompted to someone with no
          key, it would raise a worry rather than settle one.
        */}
        {(tracing || ownKeyInUse) && (
          <p className="mt-1 text-center text-[0.65rem] leading-relaxed text-[var(--text-muted)]/75">
            {tracing && (
              <>
                Your questions and the passages retrieved to answer them are sent to{' '}
                <a
                  href="https://langfuse.com"
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-dotted underline-offset-2 hover:text-[var(--text-title)]"
                >
                  Langfuse
                </a>
                , a third-party tracing service, so retrieval quality can be reviewed.{' '}
              </>
            )}
            {ownKeyInUse && 'Your API key is never logged, traced or stored server-side.'}
          </p>
        )}
      </div>
    </div>
  );
}
