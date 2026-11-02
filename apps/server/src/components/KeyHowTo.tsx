'use client';

import { useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { PROVIDER_COPY } from './ApiKeyPanel';
import type { VisitorProvider } from '@/lib/client';

/**
 * How to obtain a key, per vendor. Shown in the key panel and in Step 1 of the
 * stepper, so the text is read from PROVIDER_COPY and lives in one place.
 */
export function KeyHowTo({
  provider,
  defaultOpen = false,
  compact = false,
}: {
  provider: VisitorProvider;
  defaultOpen?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const copy = PROVIDER_COPY[provider] ?? PROVIDER_COPY.gemini;

  return (
    <div className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-inner)]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold text-[var(--text-title)]"
      >
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform ${open ? '' : '-rotate-90'}`} />
        How to get a {copy.name} key
        <span className="ml-auto text-[0.65rem] font-semibold text-[var(--text-muted)]">{copy.sub}</span>
      </button>

      {open && (
        <div className={`space-y-2 border-t border-[var(--border-card)] px-3 ${compact ? 'py-2.5' : 'py-3'}`}>
          <ol className="space-y-1.5">
            {copy.steps.map((step, index) => (
              <li key={step.title} className="flex gap-2.5">
                <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[0.6rem] font-bold text-white">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-[0.72rem] font-bold text-[var(--text-title)]">{step.title}</p>
                  {!compact && <p className="text-[0.68rem] leading-relaxed text-[var(--text-muted)]">{step.body}</p>}
                </div>
              </li>
            ))}
          </ol>
          <a
            href={copy.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-[0.7rem] font-bold text-white transition-colors hover:bg-[var(--color-primary-hover)]"
          >
            {copy.urlLabel}
            <ExternalLink className="h-3 w-3" />
          </a>
          <p className="text-[0.65rem] leading-relaxed text-[var(--text-muted)]">
            Free Gemini tier is enough for this; keys stay in your browser.
          </p>
        </div>
      )}
    </div>
  );
}

/** Gemini / OpenAI segmented control, shared by the key panel and the stepper. */
export function ProviderToggle({
  value,
  onChange,
  size = 'md',
}: {
  value: VisitorProvider;
  onChange: (provider: VisitorProvider) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Provider"
      className="inline-flex rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-1"
    >
      {(['gemini', 'openai'] as const).map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={`rounded-lg font-bold transition-colors ${size === 'sm' ? 'px-3 py-1 text-[0.7rem]' : 'px-4 py-1.5 text-xs'} ${
            value === id ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-title)]'
          }`}
        >
          {PROVIDER_COPY[id].name}
        </button>
      ))}
    </div>
  );
}
