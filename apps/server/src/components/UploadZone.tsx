'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { ClipboardPaste, LoaderCircle, Upload, X } from 'lucide-react';
import type { UploadState } from './hooks/useDocuments';

export const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp';

const VISION_RE = /\.(pdf|png|jpe?g|webp)$/i;

export function UploadZone({
  onFile,
  onText,
  uploading,
  compact,
  pasteRequest,
}: {
  onFile: (file: File) => void;
  onText: (text: string, title: string) => void;
  uploading: UploadState | null;
  compact?: boolean;
  /** Bump to open the paste box from elsewhere (the stepper's "Paste text instead"). */
  pasteRequest?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');

  useEffect(() => {
    if (pasteRequest) setPasteOpen(true);
  }, [pasteRequest]);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  const submitPaste = () => {
    if (!pasteText.trim()) return;
    onText(pasteText, pasteTitle.trim() || 'Pasted text');
    setPasteText('');
    setPasteTitle('');
    setPasteOpen(false);
  };

  if (uploading) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-[var(--border-accent)] bg-[var(--bg-inner)] px-3 py-3">
        <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-[var(--color-cyan)]" />
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-[var(--text-title)]">{uploading.filename}</p>
          <p className="gemini-gradient-text text-[0.7rem] font-semibold">
            {uploading.stage === 'parsing' ? 'Reading the document…' : 'Embedding passages…'}
          </p>
          {VISION_RE.test(uploading.filename) && (
            <p className="text-[0.65rem] leading-relaxed text-[var(--text-muted)]">
              Pages with tables, charts or images are transcribed by the model — a few seconds per page.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => event.key === 'Enter' && inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border border-dashed text-center transition-colors ${
          compact ? 'px-3 py-4' : 'px-4 py-7'
        } ${
          dragging
            ? 'border-[var(--color-cyan)] bg-[var(--color-primary)]/8'
            : 'border-[var(--border-card)] bg-[var(--bg-inner)] hover:border-[var(--border-accent)] hover:bg-[var(--bg-card-hover)]'
        }`}
      >
        <Upload className="mx-auto mb-1.5 h-4 w-4 text-[var(--color-cyan)]" />
        <p className="text-xs font-semibold text-[var(--text-title)]">Drop a file or click to browse</p>
        <p className="mt-0.5 text-[0.7rem] text-[var(--text-muted)]">PDF · DOCX · TXT · MD · PNG · JPG — 4MB max</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = '';
          }}
        />
      </div>

      {pasteOpen ? (
        <div className="space-y-2 rounded-xl border border-[var(--border-card)] bg-[var(--bg-inner)] p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[0.7rem] font-bold tracking-wide text-[var(--text-muted)] uppercase">Paste text</span>
            <button
              type="button"
              onClick={() => setPasteOpen(false)}
              aria-label="Cancel paste"
              className="text-[var(--text-muted)] hover:text-[var(--text-title)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <input
            value={pasteTitle}
            onChange={(event) => setPasteTitle(event.target.value)}
            placeholder="Title (optional)"
            className="w-full rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-title)] outline-none focus:border-[var(--color-primary)]"
          />
          <textarea
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            rows={5}
            placeholder="Paste notes, an article, meeting minutes…"
            className="w-full resize-none rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs leading-relaxed text-[var(--text-title)] outline-none focus:border-[var(--color-primary)]"
          />
          <button
            type="button"
            onClick={submitPaste}
            disabled={!pasteText.trim()}
            className="w-full rounded-lg bg-gradient-to-r from-[#0052ff] to-[#00d2ff] py-1.5 text-xs font-bold text-white disabled:opacity-40"
          >
            Ingest text
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPasteOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] py-2 text-xs font-semibold text-[var(--text-sub)] transition-colors hover:border-[var(--border-accent)] hover:text-[var(--text-title)]"
        >
          <ClipboardPaste className="h-3.5 w-3.5" />
          Paste text instead
        </button>
      )}
    </div>
  );
}
