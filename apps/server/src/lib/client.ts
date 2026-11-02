'use client';

import type { ChatSettings } from './settings';
import type { ChatStreamEvent, DocumentRecord, PublicConfig } from './types';

const SESSION_KEY = 'ragfolio-session-id';
const API_KEY_KEY = 'ragfolio-provider-key';
const PROVIDER_KEY = 'ragfolio-provider';

export type VisitorProvider = 'gemini' | 'openai';

/** The session id namespaces every row this visitor creates. Cleared by "New session". */
export function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function resetSessionId(): string {
  const id = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, id);
  return id;
}

/**
 * The page this app is actually being viewed under: the parent's origin when
 * embedded in an iframe, its own otherwise. Matched server-side against
 * TRUSTED_ORIGINS to decide whether contact details and the preloaded corpus
 * are in scope. Forgeable, and documented as such — a preference, not a control.
 */
export function embedOrigin(): string {
  if (typeof window === 'undefined') return '';
  try {
    const ancestors = window.location.ancestorOrigins;
    if (ancestors?.length) return ancestors[0];
    if (window.parent !== window && document.referrer) return new URL(document.referrer).origin;
  } catch {
    /* cross-origin access denied — fall through */
  }
  return window.location.origin;
}

/**
 * The visitor's own provider key, when they have supplied one. localStorage
 * rather than a cookie: a cookie rides on every request to this origin,
 * including ones with no business carrying a credential.
 */
export function getStoredApiKey(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(API_KEY_KEY) ?? '';
}

export function storeApiKey(key: string): void {
  localStorage.setItem(API_KEY_KEY, key.trim());
}

export function clearStoredApiKey(): void {
  localStorage.removeItem(API_KEY_KEY);
}

/** Which vendor the visitor's stored key belongs to. Chosen in the key panel. */
export function getStoredProvider(fallback: VisitorProvider): VisitorProvider {
  if (typeof window === 'undefined') return fallback;
  const raw = localStorage.getItem(PROVIDER_KEY);
  return raw === 'openai' || raw === 'gemini' ? raw : fallback;
}

export function storeProvider(provider: VisitorProvider): void {
  localStorage.setItem(PROVIDER_KEY, provider);
}

/** Raised when a request needs the visitor's own key and did not have a working one. */
export class ApiKeyNeededError extends Error {}

function sessionHeaders(sessionId: string): Record<string, string> {
  return { 'x-session-id': sessionId, 'x-embed-origin': embedOrigin() };
}

/** Session headers plus the visitor's key, only for the routes that spend quota. */
function keyedHeaders(sessionId: string): Record<string, string> {
  const headers = { ...sessionHeaders(sessionId) };
  const apiKey = getStoredApiKey();
  if (apiKey) {
    headers['x-provider-key'] = apiKey;
    const provider = localStorage.getItem(PROVIDER_KEY);
    if (provider) headers['x-provider'] = provider;
  }
  return headers;
}

function toError(payload: unknown, status: number, fallback: string): Error {
  const { error, needsKey } = (payload ?? {}) as { error?: string; needsKey?: boolean };
  const message = error ?? `${fallback} (${status}).`;
  return needsKey ? new ApiKeyNeededError(message) : new Error(message);
}

async function unwrap<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw toError(payload, response.status, 'Request failed');
  return payload as T;
}

export interface KeyCheck {
  valid: boolean;
  error?: string;
}

export async function checkApiKey(sessionId: string, key: string, provider: VisitorProvider): Promise<KeyCheck> {
  const response = await fetch('/api/key/check', {
    method: 'POST',
    headers: { ...sessionHeaders(sessionId), 'x-provider-key': key.trim(), 'x-provider': provider },
  });
  const payload = (await response.json().catch(() => ({}))) as KeyCheck;
  if (!response.ok && payload.valid === undefined) {
    return { valid: false, error: payload.error ?? `Could not check the key (${response.status}).` };
  }
  return payload;
}

export type PublicAccess = 'trial' | 'byok' | 'closed';

/** What a trial visitor has left today. Present only at the public URL in trial mode. */
export interface TrialAllowance {
  chatsLeft: number;
  docsLeft: number;
  chatsPerDay: number;
  docsPerDay: number;
  maxChars: number;
}

export interface DocumentList {
  documents: DocumentRecord[];
  /** True when this origin is trusted, so the preloaded documents are in scope. */
  trusted: boolean;
  /** The public URL's terms for visitors who are not on a trusted origin. */
  access: PublicAccess;
  trial?: TrialAllowance;
  /** False when the public URL is closed to visitors without a trusted origin. */
  visitorKeysAllowed: boolean;
  config: PublicConfig;
}

export async function fetchDocuments(sessionId: string): Promise<DocumentList> {
  const response = await fetch('/api/documents', { headers: sessionHeaders(sessionId) });
  const data = await unwrap<DocumentList>(response);
  const access: PublicAccess = data.access === 'trial' || data.access === 'closed' ? data.access : data.visitorKeysAllowed === false ? 'closed' : 'byok';
  return { ...data, access, trusted: Boolean(data.trusted), visitorKeysAllowed: access !== 'closed' };
}

export async function deleteDocument(sessionId: string, id?: string): Promise<void> {
  const response = await fetch(`/api/documents${id ? `?id=${id}` : ''}`, { method: 'DELETE', headers: sessionHeaders(sessionId) });
  await unwrap(response);
}

export interface IngestResult {
  document: DocumentRecord;
  notes: string[];
}

export async function uploadFile(sessionId: string, file: File): Promise<IngestResult> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/api/ingest', { method: 'POST', headers: keyedHeaders(sessionId), body: form });
  const { document, notes } = await unwrap<IngestResult>(response);
  return { document, notes: notes ?? [] };
}

export async function ingestText(sessionId: string, text: string, title: string): Promise<IngestResult> {
  const response = await fetch('/api/ingest', {
    method: 'POST',
    headers: { ...keyedHeaders(sessionId), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, title }),
  });
  const { document, notes } = await unwrap<IngestResult>(response);
  return { document, notes: notes ?? [] };
}

export async function fetchModels(provider?: VisitorProvider): Promise<string[]> {
  const response = await fetch(provider ? `/api/models?provider=${provider}` : '/api/models');
  const { models } = await unwrap<{ models: string[] }>(response);
  return models ?? [];
}

/** Parses one SSE `data:` line into an event, or null for blanks and partial frames. */
export function decodeSseLine(line: string): ChatStreamEvent | null {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (!payload) return null;
  try {
    return JSON.parse(payload) as ChatStreamEvent;
  } catch {
    return null;
  }
}

/**
 * Opens the chat stream and yields decoded SSE events. `fetch` + ReadableStream
 * rather than EventSource: the request is a POST with a body and headers.
 */
export async function* streamChat(
  sessionId: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  settings: ChatSettings,
  signal: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { ...keyedHeaders(sessionId), 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, settings }),
    signal,
  });

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    throw toError(payload, response.status, 'Chat failed');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const event = decodeSseLine(line);
      if (event) yield event;
    }
  }

  buffer += decoder.decode();
  const tail = decodeSseLine(buffer.trim());
  if (tail) yield tail;
}
