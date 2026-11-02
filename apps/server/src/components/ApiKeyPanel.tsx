'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, FileUp, KeyRound, LoaderCircle, Lock, ShieldCheck, TriangleAlert } from 'lucide-react';
import { KeyHowTo, ProviderToggle } from './KeyHowTo';
import { checkApiKey, getStoredProvider, storeApiKey, storeProvider, type VisitorProvider } from '@/lib/client';
import type { PublicConfig } from '@/lib/types';

interface ProviderCopy {
  name: string;
  url: string;
  urlLabel: string;
  heading: string;
  sub: string;
  steps: { title: string; body: string }[];
  placeholder: string;
  /** Where to revoke the key, for the "where your key goes" note. */
  console: string;
}

export const PROVIDER_COPY: Record<VisitorProvider, ProviderCopy> = {
  gemini: {
    name: 'Gemini',
    url: 'https://aistudio.google.com/apikey',
    urlLabel: 'Get a key at aistudio.google.com',
    heading: 'Add a free Gemini API key',
    sub: 'Takes about a minute · no billing details',
    steps: [
      { title: 'Open Google AI Studio', body: 'Sign in with any Google account. There is no billing step and no credit card.' },
      { title: 'Click "Create API key"', body: 'Pick an existing Google Cloud project or let it make one for you. The key appears immediately.' },
      { title: 'Copy it and paste it below', body: 'It is checked against Google before saving, so a half-copied key is caught here rather than by your first question.' },
    ],
    placeholder: 'Paste the key from AI Studio…',
    console: 'AI Studio',
  },
  openai: {
    name: 'OpenAI',
    url: 'https://platform.openai.com/api-keys',
    urlLabel: 'Get a key at platform.openai.com',
    heading: 'Add your OpenAI API key',
    sub: 'Takes about a minute · billed to your own OpenAI account',
    steps: [
      { title: 'Open the OpenAI platform', body: 'Sign in and go to API keys. Your account needs a small credit balance for requests to succeed.' },
      { title: 'Click "Create new secret key"', body: 'Name it anything. The key is shown once — copy it straight away.' },
      { title: 'Paste it below', body: 'It is checked against OpenAI before saving, so a half-copied key is caught here rather than by your first question.' },
    ],
    placeholder: 'Paste the key starting sk-…',
    console: 'the OpenAI dashboard',
  },
};

/**
 * Bring-your-own-key setup, shown to visitors at the public URL.
 *
 * One shared key cannot serve an unbounded audience: document upload is the
 * expensive half of a RAG app, and a handful of visitors indexing PDFs would
 * exhaust it for everyone, including the owner's own site. Asking for a key
 * that takes a minute is a better trade than a tool that is broken by mid-morning.
 */
export function ApiKeyPanel({
  sessionId,
  config,
  reason,
  onSaved,
  onCancel,
  stepLabel,
  onAddDocument,
  initialProvider,
}: {
  sessionId: string;
  config: PublicConfig;
  /** Server-supplied explanation when a stored key stopped working. */
  reason?: string | null;
  onSaved: (key: string, provider: VisitorProvider) => void;
  /** Present only when a working key is already stored and the visitor opened this to replace it. */
  onCancel?: () => void;
  /** e.g. "Step 1 of 3" when reached from the stepper. */
  stepLabel?: string;
  /** Opens the file picker from the post-save success state. */
  onAddDocument?: () => void;
  /** Vendor preselected in the stepper, if the visitor picked one there. */
  initialProvider?: VisitorProvider;
}) {
  // The visitor picks the vendor their key belongs to; the deployment's own
  // provider is only the starting selection.
  const [provider, setProvider] = useState<VisitorProvider>(initialProvider ?? config.provider);
  useEffect(() => {
    setProvider(initialProvider ?? getStoredProvider(config.provider));
  }, [config.provider, initialProvider]);
  /** Set after a verified save; the panel then shows "what next" instead of closing instantly. */
  const [saved, setSaved] = useState<{ key: string; provider: VisitorProvider } | null>(null);

  const copy = PROVIDER_COPY[provider] ?? PROVIDER_COPY.gemini;
  const [value, setValue] = useState('');
  const [reveal, setReveal] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const key = value.trim();
    if (!key || checking) return;

    setChecking(true);
    setError(null);
    try {
      // Verified before it is stored, so a truncated paste is caught here.
      const result = await checkApiKey(sessionId, key, provider);
      if (!result.valid) {
        setError(result.error ?? 'That key was rejected.');
        return;
      }
      storeProvider(provider);
      storeApiKey(key);
      // A replacement key goes straight back to the chat; a first key gets the
      // "next: add a document" beat so the visitor knows what to do now.
      if (onCancel || !onAddDocument) onSaved(key, provider);
      else setSaved({ key, provider });
    } catch {
      setError('Could not reach the server to check the key. Try again in a moment.');
    } finally {
      setChecking(false);
    }
  }

  if (saved) {
    const finish = () => onSaved(saved.key, saved.provider);
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-16 text-center">
        <CheckCircle2 className="mb-4 h-10 w-10 text-[var(--color-emerald)]" />
        <h2 className="text-brand-gradient text-xl font-extrabold sm:text-2xl">Key verified</h2>
        <p className="mt-2 text-sm text-[var(--text-sub)]">
          Next: add a document. A PDF, DOCX, Markdown file, text or an image — then ask about it.
        </p>
        <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button
            type="button"
            onClick={() => {
              finish();
              onAddDocument?.();
            }}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#0052ff] to-[#00d2ff] px-5 py-2.5 text-xs font-bold text-white"
          >
            <FileUp className="h-3.5 w-3.5" />
            Add a document
          </button>
          <button
            type="button"
            onClick={finish}
            className="rounded-xl border border-[var(--border-card)] px-5 py-2.5 text-xs font-semibold text-[var(--text-sub)] hover:text-[var(--text-title)]"
          >
            Continue to chat
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col px-4 py-10">
      {stepLabel && (
        <p className="mb-3 text-[0.65rem] font-bold tracking-wider text-[var(--color-cyan)] uppercase">{stepLabel}</p>
      )}
      <div className="mb-5 flex items-center gap-3">
        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl">
          <span className="tech-gradient-bg absolute inset-0" />
          <KeyRound className="relative h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <h2 className="text-brand-gradient text-xl font-extrabold sm:text-2xl">{copy.heading}</h2>
          <p className="text-xs text-[var(--text-muted)]">{copy.sub}</p>
        </div>
      </div>

      <div className="mb-5 self-start">
        <ProviderToggle
          value={provider}
          onChange={(id) => {
            setProvider(id);
            setError(null);
          }}
        />
      </div>

      <p className="text-sm leading-relaxed text-[var(--text-sub)]">
        {config.assistantName} can run on the {copy.name} API, and every key comes with its own allowance. On a public page
        one shared key means every visitor draws from the same pool — a handful of uploads and there is nothing left for
        whoever arrives next.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-[var(--text-sub)]">
        On <strong className="text-[var(--text-title)]">your</strong> key the allowance is yours alone: indexing a document
        costs at most 80 embedding requests plus one model call per page read, and asking a question costs one or two model
        calls. Yours to revoke whenever you like.
      </p>

      {reason && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-3 text-xs leading-relaxed text-[var(--text-body)]">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--color-danger)]" />
          <span>{reason}</span>
        </div>
      )}

      <div className="mt-6">
        <KeyHowTo provider={provider} defaultOpen />
      </div>

      {/*
        A real <form>: native Enter-to-submit and proper semantics. `preventDefault`
        is load-bearing — a native submit performs a GET and puts the key in the
        URL, the one place a credential must never go.
      */}
      <form
        className="mt-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label htmlFor="provider-key" className="mb-1.5 block text-[0.7rem] font-bold text-[var(--text-title)]">
          Paste your key
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            {/*
              A text input masked with CSS, not type="password": an API key is not
              a password, and saying it is invites password-manager heuristics.
              spellCheck off matters — Chrome's enhanced spell check uploads field contents.
            */}
            <input
              id="provider-key"
              type="text"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={copy.placeholder}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              className={`w-full rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] px-3 py-2.5 pr-10 font-mono text-xs text-[var(--text-title)] outline-none transition-colors focus:border-[var(--color-primary)] ${
                reveal ? '' : '[-webkit-text-security:disc]'
              }`}
            />
            <button
              type="button"
              onClick={() => setReveal(!reveal)}
              aria-label={reveal ? 'Hide key' : 'Show key'}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-[var(--text-muted)] transition-colors hover:text-[var(--text-title)]"
            >
              {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <button
            type="submit"
            disabled={!value.trim() || checking}
            className="flex items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {checking ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
            {checking ? 'Checking…' : 'Verify & save'}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl border border-[var(--border-card)] px-3 py-2.5 text-xs font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text-title)]"
            >
              Cancel
            </button>
          )}
        </div>

        {error && <p className="mt-2 text-[0.7rem] leading-relaxed text-[var(--color-danger)]">{error}</p>}
      </form>

      <div className="mt-5 flex items-start gap-2 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-3.5">
        <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-[var(--color-cyan)]" />
        <div className="text-[0.7rem] leading-relaxed text-[var(--text-muted)]">
          <p className="font-bold text-[var(--text-title)]">Where your key goes</p>
          <p className="mt-1">
            It stays in your browser&apos;s local storage and is sent with each question, in a request header rather than a
            URL, so it stays out of server logs. It is never stored server-side, never written to the database and never
            attached to a trace. Remove it any time from the sidebar, or revoke it in {copy.console} — that revokes it
            everywhere.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Shown when the public URL is closed to visitors without a trusted origin. */
export function ClosedPanel({ config }: { config: PublicConfig }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 py-16 text-center">
      <div className="relative mb-5 flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl">
        <span className="tech-gradient-bg absolute inset-0" />
        <Lock className="relative h-5 w-5 text-white" />
      </div>
      <h2 className="text-brand-gradient text-xl font-extrabold">{config.assistantName} lives on another site</h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--text-sub)]">
        This assistant only answers from the site it belongs to
        {config.ownerName ? ` — ${config.ownerName}'s own page` : ''}. Open it there to ask a question.
      </p>
    </div>
  );
}
