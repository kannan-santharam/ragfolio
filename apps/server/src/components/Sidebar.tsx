'use client';

import { ArrowRight, BookOpen, CheckCircle2, Info, TriangleAlert, FileText, KeyRound, Layers, PlusCircle, Trash2, X } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { UploadZone } from './UploadZone';
import type { UploadState } from './hooks/useDocuments';
import type { DocumentRecord, PublicConfig } from '@/lib/types';

const KIND_LABEL: Record<string, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  text: 'TXT',
  markdown: 'MD',
  paste: 'TEXT',
  image: 'Image',
};

export function Sidebar({
  config,
  documents,
  loaded,
  uploading,
  error,
  notices,
  onFile,
  onText,
  onDelete,
  onNewSession,
  onDismissError,
  onDismissNotices,
  trusted,
  apiKey,
  keyProviderName,
  onChangeKey,
  onRemoveKey,
  hideThemeToggle,
  onClose,
  justIndexed,
  onAskAbout,
  onDismissJustIndexed,
  pasteRequest,
}: {
  config: PublicConfig;
  documents: DocumentRecord[];
  /** False until the document list has arrived; see the knowledge-base block. */
  loaded?: boolean;
  uploading: UploadState | null;
  error: string | null;
  onFile: (file: File) => void;
  onText: (text: string, title: string) => void;
  onDelete: (id: string) => void;
  onNewSession: () => void;
  onDismissError: () => void;
  notices?: string[];
  onDismissNotices?: () => void;
  trusted?: boolean;
  /** The visitor's own key, when the public URL required one. */
  apiKey?: string;
  /** Vendor the stored key belongs to, for the label. */
  keyProviderName?: string;
  onChangeKey?: () => void;
  onRemoveKey?: () => void;
  /** Embedding pages pin the theme, so the toggle is hidden there. */
  hideThemeToggle?: boolean;
  onClose?: () => void;
  /** The most recent successful upload, for the "what next" row. */
  justIndexed?: { document: DocumentRecord; notes: string[] } | null;
  onAskAbout?: (document: DocumentRecord) => void;
  onDismissJustIndexed?: () => void;
  pasteRequest?: number;
}) {
  const totalPassages = documents.reduce((sum, doc) => sum + doc.chunk_count, 0);
  void notices;
  void onDismissNotices;

  return (
    <aside className="flex h-full w-full flex-col border-r border-[var(--border-card)] bg-[var(--bg-card)]">
      <div className="flex items-center gap-2.5 border-b border-[var(--border-card)] px-4 py-3.5">
        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl">
          <span className="tech-gradient-bg absolute inset-0" />
          <Layers className="relative h-4 w-4 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-brand-gradient text-sm font-extrabold">{config.assistantName}</h1>
          {/* Same gate as the landing copy: trust is unknown until the list arrives. */}
          {loaded === false ? (
            <div aria-hidden className="mt-1 h-2.5 w-32 animate-pulse rounded bg-[var(--bg-inner)]" />
          ) : (
            <p className="truncate text-[0.65rem] text-[var(--text-muted)]">
              {trusted && config.ownerName ? `Ask about ${config.ownerName}` : 'Agentic RAG · tool-calling retrieval'}
            </p>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)] lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
        <UploadZone onFile={onFile} onText={onText} uploading={uploading} pasteRequest={pasteRequest} />

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-2.5 py-2">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-danger)]" />
            <p className="min-w-0 flex-1 text-[0.7rem] leading-relaxed text-[var(--text-body)]">{error}</p>
            <button
              type="button"
              onClick={onDismissError}
              aria-label="Dismiss error"
              className="text-[var(--text-muted)] hover:text-[var(--text-title)]"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {justIndexed && (
          <div className="space-y-2 rounded-xl border border-[var(--color-emerald)]/40 bg-[var(--color-emerald)]/8 px-2.5 py-2">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-emerald)]" />
              <p className="min-w-0 flex-1 text-[0.7rem] leading-snug text-[var(--text-title)]">
                <span className="font-bold">{justIndexed.document.filename}</span> indexed ·{' '}
                {justIndexed.document.chunk_count} passages
              </p>
              <button
                type="button"
                onClick={onDismissJustIndexed}
                aria-label="Dismiss"
                className="text-[var(--text-muted)] hover:text-[var(--text-title)]"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            {onAskAbout && (
              <button
                type="button"
                onClick={() => onAskAbout(justIndexed.document)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[#0052ff] to-[#00d2ff] py-1.5 text-[0.7rem] font-bold text-white transition-opacity hover:opacity-90"
              >
                Ask about it
                <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        <div>
          <div className="mb-1.5 flex items-center justify-between px-1">
            <span className="text-[0.65rem] font-bold tracking-wider text-[var(--text-muted)] uppercase">
              Knowledge base
            </span>
            {totalPassages > 0 && (
              <span className="font-mono text-[0.65rem] text-[var(--color-emerald)]">{totalPassages} passages</span>
            )}
          </div>

          {/* An empty list and an unfetched list look identical from here, and
              "Nothing indexed yet" is wrong for anyone arriving through the
              owner's site. Placeholders until the count is real. */}
          {loaded === false ? (
            <div aria-hidden className="animate-pulse space-y-1">
              <div className="h-9 rounded-lg bg-[var(--bg-inner)]" />
              <div className="h-9 rounded-lg bg-[var(--bg-inner)]" />
            </div>
          ) : documents.length === 0 ? (
            <p className="px-1 text-[0.7rem] leading-relaxed text-[var(--text-muted)]">
              Nothing indexed yet. Upload a document and the agent will search it before answering.
            </p>
          ) : (
            <ul className="space-y-1">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="group flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 transition-colors hover:border-[var(--border-card)] hover:bg-[var(--bg-card-hover)]"
                >
                  {doc.is_public ? (
                    <BookOpen className="h-3.5 w-3.5 shrink-0 text-[var(--color-violet)]" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--color-cyan)]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-[var(--text-title)]">{doc.filename}</p>
                    <p className="text-[0.65rem] text-[var(--text-muted)]">
                      {doc.is_public ? 'Preloaded' : (KIND_LABEL[doc.source_kind] ?? doc.source_kind)}
                      {doc.page_count ? ` · ${doc.page_count}p` : ''} · {doc.chunk_count} passages
                    </p>
                    {justIndexed?.document.id === doc.id &&
                      justIndexed.notes.map((note) => (
                        <p key={note} className="mt-1 flex items-start gap-1 text-[0.62rem] leading-snug text-[var(--text-muted)]">
                          <Info className="mt-px h-3 w-3 shrink-0 text-[var(--color-cyan)]" />
                          <span>{note}</span>
                        </p>
                      ))}
                  </div>
                  {/* A preloaded document is shared, not the visitor's to delete. */}
                  {!doc.is_public && (
                    <button
                      type="button"
                      onClick={() => onDelete(doc.id)}
                      aria-label={`Remove ${doc.filename}`}
                      className="shrink-0 rounded p-1 text-[var(--text-muted)] opacity-0 transition-all group-hover:opacity-100 hover:text-[var(--color-danger)] focus-visible:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="space-y-2 border-t border-[var(--border-card)] px-3 py-3">
        <button
          type="button"
          onClick={onNewSession}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--border-card)] py-2 text-xs font-semibold text-[var(--text-sub)] transition-colors hover:border-[var(--border-accent)] hover:text-[var(--text-title)]"
        >
          <PlusCircle className="h-3.5 w-3.5" />
          New session
        </button>

        {apiKey && (
          /**
           * Only rendered when the visitor supplied a key. Through the owner's
           * site the app runs on the owner's key and there is nothing to manage.
           * Last four characters only: enough to tell two keys apart, not enough
           * to be worth reading off a shared screen.
           */
          <div className="flex items-center gap-2 rounded-xl border border-[var(--border-card)] px-2.5 py-2">
            <KeyRound className="h-3.5 w-3.5 shrink-0 text-[var(--color-cyan)]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.7rem] font-semibold text-[var(--text-title)]">
                Your {keyProviderName ?? 'API'} key
              </p>
              <p className="truncate font-mono text-[0.6rem] text-[var(--text-muted)]">••••{apiKey.slice(-4)}</p>
            </div>
            <button
              type="button"
              onClick={onChangeKey}
              className="rounded-lg px-1.5 py-1 text-[0.65rem] font-semibold text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-title)]"
            >
              Change
            </button>
            <button
              type="button"
              onClick={onRemoveKey}
              aria-label="Remove stored key"
              className="rounded-lg p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-card-hover)] hover:text-[var(--color-danger)]"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}

        {!hideThemeToggle && (
          <div className="flex items-center justify-end">
            <ThemeToggle />
          </div>
        )}
      </div>
    </aside>
  );
}
