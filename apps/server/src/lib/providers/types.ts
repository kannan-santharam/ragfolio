/**
 * The neutral shapes the agent loop speaks. Each provider converts to and from
 * its own wire format; nothing outside `providers/` imports a vendor payload.
 */

export interface Credential {
  key: string;
  /** Non-reversible label used to partition per-key state. Never the key. */
  fingerprint: string;
  /** Which vendor this key belongs to. The owner's is fixed by RAG_PROVIDER; a visitor picks in the UI. */
  provider: 'gemini' | 'openai';
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema (lower-case `type` values). Gemini's converter upper-cases them. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * One message in the neutral history.
 *
 * `raw` is the provider's own representation of an assistant turn, echoed back
 * verbatim on the next request. Gemini 3 attaches a `thoughtSignature` to tool
 * calls and silently drops context if the model turn is not returned exactly as
 * it was emitted; OpenAI needs the `tool_calls` array back with its ids. A tidy
 * neutral format that discards vendor parts degrades both. Each provider only
 * reads a `raw` it produced itself.
 */
export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[]; raw?: unknown }
  | { role: 'tool'; callId: string; name: string; result: unknown };

export interface TokenUsage {
  input?: number;
  output?: number;
  total?: number;
}

export interface StreamTurnOptions {
  credential: Credential;
  model: string;
  system: string;
  messages: Message[];
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  onText: (delta: string) => void;
}

export interface StreamTurnResult {
  text: string;
  toolCalls: ToolCall[];
  /** The assistant message to append to history, `raw` included. */
  assistant: Extract<Message, { role: 'assistant' }>;
  usage?: TokenUsage;
}

/** Thrown by a provider when the upstream returned a non-2xx. */
export class ProviderHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Server-suggested wait before retrying, when the body named one. */
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
}

export interface ProviderAdapter {
  readonly id: 'gemini' | 'openai';
  readonly embedModel: string;
  readonly defaultChatModels: readonly string[];
  /** Where an adopter gets a key; shown in the BYOK panel. */
  readonly keyHelpUrl: string;
  /** Loose shape check for a pasted key — must at least be header-safe. */
  isPlausibleKey(key: string): boolean;
  /** Cheapest authenticated call that spends no tokens. Resolves to the HTTP status. */
  probeKey(key: string, signal?: AbortSignal): Promise<number>;
  /** One text → one 768-dim vector. Not normalised; the caller does that. */
  embed(credential: Credential, text: string, kind: 'document' | 'query', signal?: AbortSignal): Promise<number[]>;
  /** Maximum inputs per embed call; 1 when the API has no batch endpoint. */
  readonly embedBatchSize: number;
  /** Batched variant; implementations without batching call `embed` in sequence. */
  embedMany(credential: Credential, texts: string[], kind: 'document' | 'query', signal?: AbortSignal): Promise<number[][]>;
  /** One streamed model turn. Must throw ProviderHttpError on non-2xx. */
  streamTurn(options: StreamTurnOptions): Promise<StreamTurnResult>;
  /**
   * One non-streaming multimodal call: a prompt plus binary attachments (a
   * single-page PDF or an image). Used to transcribe tables, charts and figures
   * that text extraction cannot see. Must throw ProviderHttpError on non-2xx.
   */
  generate(options: GenerateOptions): Promise<string>;
}

export interface Attachment {
  mime: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp';
  /** Base64, no data-URL prefix. */
  data: string;
  filename?: string;
}

export interface GenerateOptions {
  credential: Credential;
  model: string;
  prompt: string;
  attachments: Attachment[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export const EMBED_DIM = 768;
