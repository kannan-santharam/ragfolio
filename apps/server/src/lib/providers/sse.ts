import { ProviderHttpError } from './types';

/**
 * How long one model gets to start responding before the cascade moves on.
 *
 * A fallback chain written for models that *fail* (429, 5xx) does not cover a
 * model that accepts the request and never answers. Observed live on Gemini:
 * two models hung indefinitely while the others answered in 1.5–4s. Bounding
 * time-to-first-byte keeps the cost of discovering a dead model low. The timer
 * is cleared once headers arrive, so a long reply streams for as long as it needs.
 */
export const RESPONSE_TIMEOUT_MS = 8_000;

/** How long a stream may go silent mid-answer before the model is written off. */
export const STREAM_IDLE_TIMEOUT_MS = 20_000;

export class ProviderTimeoutError extends Error {
  constructor(
    message: string,
    /** True when text already reached the visitor, so switching models would splice answers. */
    public readonly partial: boolean,
  ) {
    super(message);
  }
}

/** Reads `retry in 12.3s` / `retryDelay: "12s"` style hints out of an error body. */
export function retryDelayMs(body: string): number | null {
  const match = /retry(?:Delay"?\s*:\s*"?|\s+in\s+|\s+after\s+)([\d.]+)\s*s/i.exec(body);
  return match ? Math.ceil(Number(match[1]) * 1000) : null;
}

export interface SseOptions {
  signal?: AbortSignal;
  /** Called once per complete `data:` payload. */
  onData: (payload: string) => void;
  /** Lets the idle handler know whether any answer text has been shown yet. */
  hasEmittedText: () => boolean;
  label: string;
}

/**
 * POST, then consume an SSE body line by line with the two timeouts above.
 *
 * Non-2xx becomes ProviderHttpError carrying the status and any retry hint, but
 * never the upstream body text: that body can echo request details, and on a
 * visitor's key those details are theirs. The caller gets a status to act on.
 */
export async function fetchSse(url: string, init: RequestInit, options: SseOptions): Promise<void> {
  const attempt = new AbortController();
  const timeout = setTimeout(() => attempt.abort(), RESPONSE_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, attempt.signal]) : attempt.signal;

  let response: Response;
  try {
    response = await fetch(url, { ...init, signal });
  } catch (error) {
    clearTimeout(timeout);
    if (options.signal?.aborted) throw error;
    if (attempt.signal.aborted) {
      throw new ProviderTimeoutError(
        `${options.label} did not respond within ${RESPONSE_TIMEOUT_MS / 1000}s.`,
        false,
      );
    }
    throw error;
  }
  clearTimeout(timeout);

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => '');
    throw new ProviderHttpError(
      `${options.label} responded ${response.status}.`,
      response.status,
      response.status === 429 ? retryDelayMs(body) : null,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    options.onData(payload);
  };

  let stalled = false;
  try {
    for (;;) {
      let idle: ReturnType<typeof setTimeout> | undefined;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<'stalled'>((resolve) => {
          idle = setTimeout(() => resolve('stalled'), STREAM_IDLE_TIMEOUT_MS);
        }),
      ]);
      clearTimeout(idle);

      if (chunk === 'stalled') {
        stalled = true;
        break;
      }
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    }
  } finally {
    if (stalled) await reader.cancel().catch(() => undefined);
  }

  if (stalled) {
    throw new ProviderTimeoutError(
      options.hasEmittedText()
        ? `${options.label} stopped streaming part-way through the answer. Please ask again.`
        : `${options.label} opened a stream and then stopped responding.`,
      options.hasEmittedText(),
    );
  }

  // The last frame often arrives without a trailing newline; do not strand it.
  buffer += decoder.decode();
  if (buffer.trim()) handleLine(buffer.trim());
}

/** Non-streaming JSON POST with a total timeout and the same error discipline. */
export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  { timeoutMs, label, signal }: { timeoutMs: number; label: string; signal?: AbortSignal },
): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, {
    ...init,
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ProviderHttpError(
      `${label} failed (${response.status}).`,
      response.status,
      response.status === 429 ? retryDelayMs(body) : null,
    );
  }
  return (await response.json()) as T;
}
