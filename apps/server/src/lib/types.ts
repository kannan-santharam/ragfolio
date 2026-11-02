export type SourceKind = 'pdf' | 'docx' | 'text' | 'markdown' | 'paste' | 'image';

export interface DocumentRecord {
  id: string;
  filename: string;
  mime: string;
  source_kind: SourceKind;
  page_count: number | null;
  char_count: number;
  chunk_count: number;
  outline: OutlineEntry[];
  created_at: string;
  /** Preloaded by the site owner and shared with every visitor; not the visitor's to delete. */
  is_public?: boolean;
}

export interface OutlineEntry {
  heading: string;
  ordinal: number;
  page?: number | null;
}

export interface RetrievedChunk {
  id: number;
  document_id: string;
  filename: string;
  ordinal: number;
  heading: string | null;
  page_from: number | null;
  page_to: number | null;
  content: string;
  similarity: number;
}

/** A citation as surfaced to the UI: one numbered marker the answer can reference. */
export interface Citation {
  marker: number;
  documentId: string;
  filename: string;
  heading: string | null;
  page: number | null;
  snippet: string;
  similarity: number;
}

/** One step of the agent's visible reasoning trail. */
export interface TraceStep {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
  summary?: string;
  resultCount?: number;
  topScore?: number;
  ms?: number;
}

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  trace?: TraceStep[];
  citations?: Citation[];
  model?: string;
  error?: boolean;
}

/** Server-sent event payloads streamed from /api/chat. */
export type ChatStreamEvent =
  /** Which model actually served this answer — the only way Auto mode is visible. */
  | { type: 'meta'; model: string }
  | { type: 'trace'; step: TraceStep }
  | { type: 'text'; delta: string }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'error'; message: string }
  | { type: 'done' };

/**
 * What the browser needs to know about this deployment before it renders a
 * word. Served by /api/status and /api/documents so landing copy, the key panel
 * and the model picker never flash a default that is wrong for this install.
 */
export interface PublicConfig {
  provider: 'gemini' | 'openai';
  assistantName: string;
  ownerName: string;
  welcome: string;
  /** Example questions the owner wants surfaced on the empty state. */
  suggestions: string[];
}
