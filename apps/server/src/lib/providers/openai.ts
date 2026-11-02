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

const API_ROOT = 'https://api.openai.com/v1';

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

type OpenAiMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

function headers(credential: Credential): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${credential.key}` };
}

function toMessages(system: string, messages: Message[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: 'system', content: system }];
  for (const message of messages) {
    if (message.role === 'user') out.push({ role: 'user', content: message.content });
    else if (message.role === 'assistant') {
      const raw = message.raw as OpenAiMessage | undefined;
      if (raw && raw.role === 'assistant') out.push(raw);
      else out.push({ role: 'assistant', content: message.content });
    } else {
      out.push({ role: 'tool', tool_call_id: message.callId, content: JSON.stringify(message.result) });
    }
  }
  return out;
}

function toTool(tool: ToolDefinition) {
  return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}

async function generate(options: GenerateOptions): Promise<string> {
  const { credential, model, prompt, attachments, signal } = options;
  const content = [
    ...attachments.map((a) =>
      a.mime === 'application/pdf'
        ? { type: 'file', file: { filename: a.filename ?? 'page.pdf', file_data: `data:application/pdf;base64,${a.data}` } }
        : { type: 'image_url', image_url: { url: `data:${a.mime};base64,${a.data}` } },
    ),
    { type: 'text', text: prompt },
  ];
  const json = await fetchJson<{ choices?: { message?: { content?: string | null } }[] }>(
    `${API_ROOT}/chat/completions`,
    {
      method: 'POST',
      headers: headers(credential),
      body: JSON.stringify({ model, messages: [{ role: 'user', content }], max_completion_tokens: options.maxOutputTokens ?? 4096 }),
    },
    { timeoutMs: 45_000, label: model, signal },
  );
  return json.choices?.[0]?.message?.content ?? '';
}

export const openai: ProviderAdapter = {
  id: 'openai',
  embedModel: 'text-embedding-3-small',
  /**
   * Small, fast models that support function calling on Chat Completions.
   * OpenAI has no free tier, so the chain here is about availability rather
   * than quota; most adopters will pin one with CHAT_MODELS.
   */
  defaultChatModels: ['gpt-5.4-mini', 'gpt-5-mini', 'gpt-4.1-mini'],
  keyHelpUrl: 'https://platform.openai.com/api-keys',
  embedBatchSize: 64,

  isPlausibleKey(key) {
    return /^sk-[A-Za-z0-9_-]{20,200}$/.test(key);
  },

  async probeKey(key, signal) {
    const response = await fetch(`${API_ROOT}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: signal ?? AbortSignal.timeout(10_000),
    });
    return response.status;
  },

  async embed(credential, text, kind, signal) {
    const [vector] = await this.embedMany(credential, [text], kind, signal);
    return vector;
  },

  async embedMany(credential, texts, kind, signal) {
    const json = await fetchJson<{ data?: { index: number; embedding: number[] }[] }>(
      `${API_ROOT}/embeddings`,
      {
        method: 'POST',
        headers: headers(credential),
        body: JSON.stringify({
          model: this.embedModel,
          input: texts,
          // Same 768 the schema is built on. text-embedding-3 models support
          // shortening natively; the caller renormalises regardless.
          dimensions: EMBED_DIM,
          encoding_format: 'float',
        }),
      },
      { timeoutMs: 30_000, label: 'Embedding', signal },
    );
    const rows = json.data ?? [];
    if (rows.length !== texts.length) throw new Error('Embedding response was incomplete.');
    return rows.sort((a, b) => a.index - b.index).map((row) => row.embedding);
  },

  async streamTurn(options: StreamTurnOptions): Promise<StreamTurnResult> {
    const { credential, model, system, messages, tools, signal, onText } = options;
    let text = '';
    let usage: TokenUsage | undefined;
    // Tool-call arguments arrive as fragmented string deltas keyed by index;
    // accumulate per index and parse once at the end.
    const pending = new Map<number, { id: string; name: string; args: string }>();

    await fetchSse(
      `${API_ROOT}/chat/completions`,
      {
        method: 'POST',
        headers: headers(credential),
        body: JSON.stringify({
          model,
          messages: toMessages(system, messages),
          ...(tools?.length ? { tools: tools.map(toTool), tool_choice: 'auto' } : {}),
          stream: true,
          stream_options: { include_usage: true },
          max_completion_tokens: 2048,
        }),
      },
      {
        signal,
        label: model,
        hasEmittedText: () => text.length > 0,
        onData(payload) {
          let chunk: {
            choices?: {
              delta?: {
                content?: string | null;
                tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
              };
            }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
          };
          try {
            chunk = JSON.parse(payload);
          } catch {
            return;
          }
          if (chunk.usage) {
            usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens, total: chunk.usage.total_tokens };
          }
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) return;
          if (delta.content) {
            text += delta.content;
            onText(delta.content);
          }
          for (const call of delta.tool_calls ?? []) {
            const entry = pending.get(call.index) ?? { id: '', name: '', args: '' };
            if (call.id) entry.id = call.id;
            if (call.function?.name) entry.name += call.function.name;
            if (call.function?.arguments) entry.args += call.function.arguments;
            pending.set(call.index, entry);
          }
        },
      },
    );

    const rawCalls: OpenAiToolCall[] = [...pending.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => ({
        id: call.id || `call-${index}`,
        type: 'function',
        function: { name: call.name, arguments: call.args || '{}' },
      }));

    const toolCalls: ToolCall[] = rawCalls.map((call) => {
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(call.function.arguments);
        if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>;
      } catch {
        /* the model does not always emit valid JSON; the tool reports the missing field */
      }
      return { id: call.id, name: call.function.name, args };
    });

    return {
      text,
      toolCalls,
      assistant: {
        role: 'assistant',
        content: text,
        toolCalls,
        raw: { role: 'assistant', content: text || null, ...(rawCalls.length ? { tool_calls: rawCalls } : {}) },
      },
      usage,
    };
  },

  generate,
};
