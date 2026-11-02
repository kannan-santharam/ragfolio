'use client';

import { useState, type ReactNode } from 'react';
import { Check, ClipboardPaste, FileUp, KeyRound, MessageCircleQuestion } from 'lucide-react';
import { KeyHowTo, ProviderToggle } from './KeyHowTo';
import type { VisitorProvider } from '@/lib/client';
import type { DocumentRecord, PublicConfig } from '@/lib/types';

const GENERIC_STARTERS = [
  'Summarise this document in five bullets.',
  'What are the key dates and deadlines?',
  'What does it say about pricing or cost?',
  'List every obligation or requirement it places on me.',
];

const ownerStarters = (ownerName: string) => [
  `What is ${ownerName}'s experience?`,
  `What projects has ${ownerName} worked on?`,
  `What skills does ${ownerName} have?`,
];

/**
 * Starter questions for the current corpus: the owner's configured ones first,
 * otherwise questions built from what is actually indexed (section headings
 * and filenames), otherwise generic.
 */
export function deriveStarters(config: PublicConfig, documents: DocumentRecord[], trusted: boolean): string[] {
  if (config.suggestions.length) return config.suggestions.slice(0, 4);

  const owned = documents.filter((doc) => !doc.is_public);
  const onlyPreloaded = documents.length > 0 && owned.length === 0;
  if (onlyPreloaded && trusted && config.ownerName) return ownerStarters(config.ownerName);

  if (documents.length) {
    const headings: string[] = [];
    for (const doc of documents) {
      for (const entry of doc.outline ?? []) {
        const heading = entry.heading?.trim();
        if (!heading || heading.startsWith('Not indexed') || headings.includes(heading)) continue;
        headings.push(heading);
        if (headings.length === 3) break;
      }
      if (headings.length === 3) break;
    }
    const out = headings.map((heading) => `What does “${heading}” cover?`);
    const first = owned[0] ?? documents[0];
    if (first) out.push(`Summarise ${first.filename}`);
    if (out.length) return out.slice(0, 4);
  }
  return GENERIC_STARTERS;
}

export interface GetStartedProps {
  config: PublicConfig;
  documents: DocumentRecord[];
  trusted: boolean;
  /** Step 1 is shown only when the visitor must bring a key. */
  keyRequired: boolean;
  hasKey: boolean;
  keyProvider: VisitorProvider;
  onKeyProviderChange: (provider: VisitorProvider) => void;
  onOpenKeyPanel: () => void;
  onOpenFilePicker: () => void;
  onOpenPaste: () => void;
  onAsk: (prompt: string) => void;
}

interface Step {
  id: string;
  icon: typeof KeyRound;
  title: string;
  done: boolean;
  doneLabel?: string;
  explain: string;
  body?: ReactNode;
}

export function GetStarted(props: GetStartedProps) {
  const { config, documents, trusted, keyRequired, hasKey, keyProvider, onKeyProviderChange } = props;
  const owner = config.ownerName;
  const owned = documents.filter((doc) => !doc.is_public);
  const preloaded = trusted && documents.length > 0 && owned.length === 0;
  const lastOwned = owned[0];
  const [howToProvider, setHowToProvider] = useState<VisitorProvider>(keyProvider);

  const steps: Step[] = [];

  if (keyRequired) {
    steps.push({
      id: 'key',
      icon: KeyRound,
      title: 'Add your API key',
      done: hasKey,
      doneLabel: `Using your ${howToProvider === 'openai' ? 'OpenAI' : 'Gemini'} key`,
      explain: 'Answers run on your own key, so nothing is shared with other visitors. It stays in this browser.',
      body: (
        <div className="space-y-2.5">
          <ProviderToggle
            value={howToProvider}
            size="sm"
            onChange={(provider) => {
              setHowToProvider(provider);
              onKeyProviderChange(provider);
            }}
          />
          <KeyHowTo provider={howToProvider} compact />
          <button type="button" onClick={props.onOpenKeyPanel} className={CTA}>
            <KeyRound className="h-3.5 w-3.5" />
            Paste my key
          </button>
        </div>
      ),
    });
  }

  steps.push({
    id: 'doc',
    icon: FileUp,
    title: 'Add a document',
    done: owned.length > 0 || preloaded,
    doneLabel: lastOwned
      ? `${lastOwned.filename} · ${lastOwned.chunk_count} passages`
      : owner
        ? `${owner}'s documents are loaded`
        : 'Documents are loaded',
    explain: preloaded
      ? 'Optional: add a job description or your own notes and the agent will search those too.'
      : 'PDF, DOCX, Markdown, text or an image — up to 4MB. Tables, charts and figures are read by the model.',
    body: (
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={props.onOpenFilePicker} className={CTA}>
          <FileUp className="h-3.5 w-3.5" />
          {preloaded ? 'Add your own (e.g. a job description)' : 'Choose a file'}
        </button>
        <button type="button" onClick={props.onOpenPaste} className={CTA_SECONDARY}>
          <ClipboardPaste className="h-3.5 w-3.5" />
          Paste text instead
        </button>
      </div>
    ),
  });

  const starters = deriveStarters(config, documents, trusted);
  steps.push({
    id: 'ask',
    icon: MessageCircleQuestion,
    title: 'Ask a question',
    done: false,
    explain:
      documents.length > 0
        ? 'Try one of these, or type your own below. Every answer cites the passage it came from.'
        : 'Once something is indexed, pick a starter here or type your own question below.',
    body: (
      <div className="grid gap-2 sm:grid-cols-2">
        {starters.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => props.onAsk(prompt)}
            className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] px-3.5 py-2.5 text-left text-xs leading-relaxed font-medium text-[var(--text-sub)] transition-all hover:border-[var(--color-primary)] hover:text-[var(--text-title)]"
          >
            {prompt}
          </button>
        ))}
      </div>
    ),
  });

  const currentIndex = steps.findIndex((step) => !step.done);

  return (
    <ol className="mt-7 w-full space-y-2 text-left" aria-label="Get started">
      {steps.map((step, index) => {
        const current = index === currentIndex;
        const number = index + 1;
        if (step.done) {
          return (
            <li
              key={step.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--color-emerald)]/30 bg-[var(--color-emerald)]/8 px-3.5 py-2.5"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-emerald)] text-white">
                <Check className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-bold text-[var(--text-title)]">{step.title}</span>
              <span className="min-w-0 truncate text-[0.7rem] text-[var(--text-muted)]">· {step.doneLabel}</span>
              {step.id === 'doc' && preloaded && (
                <button
                  type="button"
                  onClick={props.onOpenFilePicker}
                  className="ml-auto shrink-0 text-[0.7rem] font-semibold text-[var(--color-cyan)] hover:underline"
                >
                  Add your own
                </button>
              )}
            </li>
          );
        }
        return (
          <li
            key={step.id}
            aria-current={current ? 'step' : undefined}
            className={`rounded-xl border p-3.5 transition-colors ${
              current
                ? 'border-[var(--color-primary)] bg-[var(--bg-card)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-primary)_18%,transparent)]'
                : 'border-[var(--border-card)] bg-[var(--bg-card)] opacity-70'
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-bold ${
                  current ? 'tech-gradient-bg text-white' : 'bg-[var(--bg-pill)] text-[var(--text-muted)]'
                }`}
              >
                {number}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <step.icon className="h-3.5 w-3.5 text-[var(--color-cyan)]" />
                  <p className="text-xs font-bold text-[var(--text-title)]">{step.title}</p>
                  {current && (
                    <span className="rounded-full bg-[var(--color-primary)]/15 px-2 py-0.5 text-[0.6rem] font-bold tracking-wide text-[var(--color-cyan)] uppercase">
                      Next
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[0.72rem] leading-relaxed text-[var(--text-muted)]">{step.explain}</p>
                {current && step.body && <div className="mt-3">{step.body}</div>}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const CTA =
  'inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#0052ff] to-[#00d2ff] px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 sm:w-auto';
const CTA_SECONDARY =
  'inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] px-4 py-2 text-xs font-semibold text-[var(--text-sub)] transition-colors hover:border-[var(--border-accent)] hover:text-[var(--text-title)] sm:w-auto';
