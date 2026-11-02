import { fetchJson, fetchSse } from './sse';
import {
  EMBED_DIM,
  type Credential,
  type GenerateOptions,
  type Message,
  type ProviderAdapter,
  type StreamTurnOptions,
  type StreamTurnResult,
  type TokenUsage,
  type ToolCall,
  type ToolDefinition,
} from './types';

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiPart {
  text?: string;
  thought?: boolean;
  /** Gemini 3 returns an opaque signature on tool calls; it must be echoed back. */
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: unknown };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/**
 * `x-goog-api-key` rather than `?key=`: a query string ends up in access logs,
 * error strings and proxy traces. When the key belongs to a visitor, keeping it
 * out of the URL is the difference between handling a credential carefully and
 * leaking it into infrastructure neither of us controls.
 */
function headers(credential: Credential): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-goog-api-key': credential.key };
}

/** Gemini's function declarations want upper-case schema type names. */
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema && typeof schema === 'object') {
    return Object.fromEntries(
      Object.entries(schema as Record<string, unknown>).map(([key, value]) => [
        key,
        key === 'type' && typeof value === 'string' ? value.toUpperCase() : toGeminiSchema(value),
      ]),
    );
  }
  return schema;
}

function toContents(messages: Message[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: message.content }] });
    } else if (message.role === 'assistant') {
      const raw = message.raw as GeminiContent | undefined;
      if (raw?.parts?.length) {
        contents.push(raw); // verbatim, thoughtSignature included
      } else {
        contents.push({ role: 'model', parts: [{ text: message.content }] });
      }
    } else {
      // Consecutive tool results belong in one user turn.
      const part: GeminiPart = {
        functionResponse: { id: message.callId, name: message.name, response: message.result },
      };
      const last = contents[contents.length - 1];
      if (last?.role === 'user' && last.parts.every((p) => p.functionResponse)) last.parts.push(part);
      else contents.push({ role: 'user', parts: [part] });
    }
  }
  return contents;
}

export const gemini: ProviderAdapter = {
  id: 'gemini',
  embedModel: 'gemini-embedding-001',
  /**
   * Capable first, most-generous free-tier quota last. Free-tier daily caps differ
   * per model by more than an order of magnitude; the point of a chain is that
   * each link has its own quota. Override with CHAT_MODELS.
   */
  defaultChatModels: ['gemini-flash-latest', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'],
  keyHelpUrl: 'https://aistudio.google.com/apikey',
  embedBatchSize: 1,

  /**
   * Google issues at least two key formats (`AIza…` and a newer dotted form), so
   * this checks header-safety, not a prefix. Pinning to `AIza` would reject keys
   * minted today.
   */
  isPlausibleKey(key) {
    return /^[A-Za-z0-9_.-]{20,120}$/.test(key);
  },

  async probeKey(key, signal) {
    const response = await fetch(`${API_ROOT}`, {
      headers: { 'x-goog-api-key': key },
      signal: signal ?? AbortSignal.timeout(10_000),
    });
    return response.status;
  },

  async embed(credential, text, kind, signal) {
    const json = await fetchJson<{ embedding?: { values: number[] } }>(
      `${API_ROOT}/${this.embedModel}:embedContent`,
      {
        method: 'POST',
        headers: headers(credential),
        body: JSON.stringify({
          model: `models/${this.embedModel}`,
          content: { parts: [{ text }] },
          taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
          // Matryoshka truncation: supported, lossy-but-fine, and the only way the
          // vector fits pgvector's 2000-dim HNSW ceiling without halfvec.
          outputDimensionality: EMBED_DIM,
        }),
      },
      { timeoutMs: 15_000, label: 'Embedding', signal },
    );
    const values = json.embedding?.values;
    if (!values?.length) throw new Error('Embedding response contained no vector.');
    return values;
  },

  async embedMany(credential, texts, kind, signal) {
    const out: number[][] = [];
    for (const text of texts) out.push(await this.embed(credential, text, kind, signal));
    return out;
  },

  async streamTurn(options: StreamTurnOptions): Promise<StreamTurnResult> {
    const { credential, model, system, messages, tools, signal, onText } = options;
    const parts: GeminiPart[] = [];
    let text = '';
    let usage: TokenUsage | undefined;

    await fetchSse(
      `${API_ROOT}/${model}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: headers(credential),
        body: JSON.stringify({
          contents: toContents(messages),
          systemInstruction: { parts: [{ text: system }] },
          ...(tools?.length
            ? { tools: [{ functionDeclarations: tools.map(toDeclaration) }] }
            : {}),
          // No temperature override: Google's Gemini 3 guidance is to leave it at
          // 1.0. Grounding comes from the retrieved passages, not from sampling.
          generationConfig: { maxOutputTokens: 2048 },
        }),
      },
      {
        signal,
        label: model,
        hasEmittedText: () => text.length > 0,
        onData(payload) {
          let chunk: {
            candidates?: { content?: GeminiContent }[];
            usageMetadata?: {
              promptTokenCount?: number;
              candidatesTokenCount?: number;
              totalTokenCount?: number;
              thoughtsTokenCount?: number;
            };
          };
          try {
            chunk = JSON.parse(payload);
          } catch {
            return;
          }
          if (chunk.usageMetadata) {
            const meta = chunk.usageMetadata;
            usage = {
              input: meta.promptTokenCount,
              output: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
              total: meta.totalTokenCount,
            };
          }
          for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
            if (part.thought) continue; // reasoning summaries are not answer text
            parts.push(part);
            if (part.text) {
              text += part.text;
              onText(part.text);
            }
          }
        },
      },
    );

    const toolCalls: ToolCall[] = parts
      .filter((p) => p.functionCall)
      .map((p, index) => ({
        id: p.functionCall!.id ?? `call-${index}`,
        name: p.functionCall!.name,
        args: p.functionCall!.args ?? {},
      }));

    return {
      text,
      toolCalls,
      assistant: { role: 'assistant', content: text, toolCalls, raw: { role: 'model', parts } },
      usage,
    };
  },

  generate,
};

async function generate(options: GenerateOptions): Promise<string> {
  const { credential, model, prompt, attachments, signal } = options;
  const json = await fetchJson<{ candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] }>(
    `${API_ROOT}/${model}:generateContent`,
    {
      method: 'POST',
      headers: headers(credential),
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              ...attachments.map((a) => ({ inlineData: { mimeType: a.mime, data: a.data } })),
              { text: prompt },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: options.maxOutputTokens ?? 4096 },
      }),
    },
    { timeoutMs: 45_000, label: model, signal },
  );
  return (json.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join('');
}

function toDeclaration(tool: ToolDefinition) {
  return { name: tool.name, description: tool.description, parameters: toGeminiSchema(tool.parameters) };
}
