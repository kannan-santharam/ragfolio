'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiKeyNeededError, deleteDocument, fetchDocuments, ingestText, uploadFile } from '@/lib/client';
import type { DocumentRecord, PublicConfig } from '@/lib/types';

export interface UploadState {
  filename: string;
  stage: 'parsing' | 'embedding';
}

export function useDocuments(
  sessionId: string,
  /** Server-rendered config for first paint; replaced by the live value once the list arrives. */
  initialConfig: PublicConfig,
  /** See the same parameter on `useChat` — uploads need the key just as answers do. */
  onKeyRequired?: (message: string) => void,
) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [uploading, setUploading] = useState<UploadState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Non-fatal parser warnings from the last upload: what could not be read. */
  const [notices, setNotices] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** Whether this origin gets the preloaded documents at all. */
  const [trusted, setTrusted] = useState(false);
  /** False when the public URL is closed to visitors without a trusted origin. */
  const [visitorKeysAllowed, setVisitorKeysAllowed] = useState(true);
  const [config, setConfig] = useState<PublicConfig>(initialConfig);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const list = await fetchDocuments(sessionId);
      setDocuments(list.documents);
      setTrusted(list.trusted);
      setVisitorKeysAllowed(list.visitorKeysAllowed);
      if (list.config) setConfig(list.config);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load documents.');
    } finally {
      setLoaded(true);
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ingest = useCallback(
    async (input: File | { text: string; title: string }): Promise<{ document?: DocumentRecord; notes?: string[]; error?: string }> => {
      if (!sessionId) return { error: 'No session yet.' };
      const filename = input instanceof File ? input.name : input.title || 'Pasted text';
      setError(null);
      setNotices([]);
      setUploading({ filename, stage: 'parsing' });

      // The server does parse -> embed in one request; this is a coarse UI hint.
      const toEmbedding = setTimeout(() => setUploading((s) => (s ? { ...s, stage: 'embedding' } : s)), 900);

      try {
        const result =
          input instanceof File ? await uploadFile(sessionId, input) : await ingestText(sessionId, input.text, input.title);
        setDocuments((previous) => [result.document, ...previous]);
        setNotices(result.notes);
        return { document: result.document, notes: result.notes };
      } catch (cause) {
        if (cause instanceof ApiKeyNeededError) onKeyRequired?.(cause.message);
        const message = cause instanceof Error ? cause.message : 'Upload failed.';
        setError(message);
        return { error: message };
      } finally {
        clearTimeout(toEmbedding);
        setUploading(null);
      }
    },
    [onKeyRequired, sessionId],
  );

  const remove = useCallback(
    async (id: string) => {
      const snapshot = documents;
      setDocuments((previous) => previous.filter((d) => d.id !== id));
      try {
        await deleteDocument(sessionId, id);
      } catch (cause) {
        setDocuments(snapshot); // put it back; the delete did not happen
        setError(cause instanceof Error ? cause.message : 'Delete failed.');
      }
    },
    [documents, sessionId],
  );

  return {
    documents,
    trusted,
    visitorKeysAllowed,
    config,
    uploading,
    error,
    notices,
    loaded,
    ingest,
    remove,
    refresh,
    setError,
    dismissNotices: () => setNotices([]),
  };
}
