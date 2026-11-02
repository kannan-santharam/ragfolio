import { adapterFor, ProviderHttpError, type Credential } from './providers';

/**
 * Embedding with a rate gate, server-hinted retries and renormalisation.
 *
 * Gemini's free embedding tier is 100 requests per minute (measured: firing 220
 * at concurrency 5 produced a 429 on request 99 and then failed everything
 * behind it). Seeding a modest corpus trips it. This is the single most common
 * first-run failure for a new install, so the gate below is a product
 * requirement, not an edge case.
 */

const RPM_LIMIT = 100;
const RPM_BUDGET = 85; // headroom for anything else sharing the key
const WINDOW_MS = 60_000;

export class EmbedQuotaError extends Error {}

/** Call timestamps in the last minute, per key fingerprint, oldest first. */
const recentCalls = new Map<string, number[]>();

function pruneWindow(fingerprint: string, now: number): number[] {
  // Sweep every entry, not just the caller's: a visitor who uploads once and
  // leaves would otherwise keep their timestamps for as long as the instance
  // stays warm.
  for (const [key, calls] of recentCalls) {
    while (calls.length && now - calls[0] >= WINDOW_MS) calls.shift();
    if (!calls.length) recentCalls.delete(key);
  }
  const calls = recentCalls.get(fingerprint) ?? [];
  recentCalls.set(fingerprint, calls);
  return calls;
}

/**
 * Sliding-window gate. Warm serverless instances reuse this module, so
 * back-to-back ingests on the same instance share the window. `deadline`
 * stops the gate from parking a request past the function's own time limit.
 */
async function reserveSlot(fingerprint: string, deadline?: number) {
  for (;;) {
    const now = Date.now();
    const calls = pruneWindow(fingerprint, now);
    if (calls.length < RPM_BUDGET) {
      calls.push(now);
      return;
    }
    const waitMs = WINDOW_MS - (now - calls[0]) + 50;
    if (deadline && now + waitMs > deadline) {
      throw new EmbedQuotaError(
        `The embedding API allows about ${RPM_LIMIT} requests per minute and this key has just used them. Wait ${Math.ceil(waitMs / 1000)}s and try again.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

async function withRetry<T>(fn: () => Promise<T>, { attempts = 4, deadline }: { attempts?: number; deadline?: number } = {}): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = error instanceof ProviderHttpError ? error.status : undefined;
      // 429 = quota, 5xx = transient. Anything else is a real bug, not a retry.
      if (status && status !== 429 && status < 500) throw error;
      if (attempt === attempts - 1) break;

      // Prefer the server's own hint over blind backoff when it gave one.
      const serverWait = error instanceof ProviderHttpError ? error.retryAfterMs : null;
      const waitMs = serverWait ?? 400 * 2 ** attempt + Math.random() * 200;
      if (deadline && Date.now() + waitMs > deadline) {
        throw new EmbedQuotaError(
          serverWait
            ? `The embedding quota is exhausted; it frees up in about ${Math.ceil(serverWait / 1000)}s. Try again shortly.`
            : 'Embedding is taking longer than this request can wait. Try again.',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
}

/**
 * Truncating a Matryoshka embedding below its native size leaves it
 * un-normalised, which skews cosine distance. A no-op for unit vectors, so it
 * runs unconditionally for every provider.
 */
export function l2Normalise(vector: number[]): number[] {
  let sum = 0;
  for (const v of vector) sum += v * v;
  const norm = Math.sqrt(sum);
  return norm > 0 ? vector.map((v) => v / norm) : vector;
}

/**
 * One query embed per search. Not gated: a chat arriving on a warm instance
 * straight after a large upload must not park behind the upload's window inside
 * a 60s function. Retries still honour the server's hint.
 */
export async function embedQuery(credential: Credential, text: string): Promise<number[]> {
  const provider = adapterFor(credential.provider);
  return withRetry(() => provider.embed(credential, text, 'query'), { attempts: 3 }).then(l2Normalise);
}

/**
 * Embeds passages behind the gate with bounded concurrency. Providers with a
 * batch endpoint get `embedBatchSize` texts per call; Gemini gets one.
 */
export async function embedDocuments(
  credential: Credential,
  texts: string[],
  { concurrency = 4, deadline }: { concurrency?: number; deadline?: number } = {},
): Promise<number[][]> {
  const provider = adapterFor(credential.provider);
  const batch = Math.max(1, provider.embedBatchSize);
  const out = new Array<number[]>(texts.length);
  let cursor = 0;

  async function worker() {
    while (cursor < texts.length) {
      const start = cursor;
      cursor += batch;
      const slice = texts.slice(start, start + batch);
      await reserveSlot(credential.fingerprint, deadline);
      const vectors = await withRetry(() => provider.embedMany(credential, slice, 'document'), { deadline });
      vectors.forEach((vector, index) => {
        out[start + index] = l2Normalise(vector);
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.ceil(texts.length / batch)) }, worker));
  return out;
}
