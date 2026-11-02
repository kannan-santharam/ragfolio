import { Langfuse } from 'langfuse';
import { redactApiKeysDeep } from './privacy';

/**
 * Langfuse tracing.
 *
 * Optional by construction: with no credentials configured, every call here is a
 * no-op and the app behaves exactly as before. Observability that can take the
 * product down when the observability vendor has a bad day is a liability, so
 * nothing in this file is allowed to throw into a request path.
 *
 * The null-object pattern keeps the agent loop free of `if (trace)` noise — call
 * sites always get an object, it just may do nothing.
 */

export const TRACE_NAME = 'Ragfolio';

let client: Langfuse | null = null;
let initialised = false;

function langfuse(): Langfuse | null {
  if (initialised) return client;
  initialised = true;

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) return null;

  try {
    client = new Langfuse({
      publicKey,
      secretKey,
      baseUrl: process.env.LANGFUSE_BASE_URL || undefined,
      // Serverless functions freeze the moment a response finishes, so batching
      // on a timer loses events. Send eagerly and flush explicitly instead.
      flushAt: 1,
      requestTimeout: 5_000,
    });
  } catch {
    client = null;
  }
  return client;
}

export function isTracingEnabled(): boolean {
  return langfuse() !== null;
}

// --- The shapes call sites see ----------------------------------------------

export interface TracedGeneration {
  end(result: {
    /** The model that actually served — known only after the cascade resolves. */
    model?: string;
    output?: unknown;
    usage?: { input?: number; output?: number; total?: number };
    level?: 'ERROR';
    statusMessage?: string;
  }): void;
}

export interface TracedSpan {
  end(result?: { output?: unknown; level?: 'ERROR'; statusMessage?: string }): void;
}

export interface Trace {
  generation(body: {
    name: string;
    model: string;
    input?: unknown;
    modelParameters?: Record<string, string | number | boolean | null>;
  }): TracedGeneration;
  span(body: { name: string; input?: unknown; metadata?: Record<string, unknown> }): TracedSpan;
  update(body: { output?: unknown; metadata?: Record<string, unknown> }): void;
  /** Must be awaited before the serverless response ends or events are lost. */
  flush(): Promise<void>;
}

const NOOP_SPAN: TracedSpan = { end: () => undefined };
const NOOP_GENERATION: TracedGeneration = { end: () => undefined };

const NOOP_TRACE: Trace = {
  generation: () => NOOP_GENERATION,
  span: () => NOOP_SPAN,
  update: () => undefined,
  flush: async () => undefined,
};

/**
 * Everything leaving for Langfuse passes through here first.
 *
 * The credential itself never reaches a trace — only `keySource` does. But the
 * *content* channels carry text the visitor typed and text retrieved from
 * documents they uploaded, and a key can arrive through either: pasted into the
 * chat box by someone who missed the key panel, or sitting in a config snippet
 * inside an uploaded file that retrieval then feeds back into the model input.
 *
 * Scrubbing at this one boundary rather than at each of a dozen call sites is the
 * point. A rule applied per call site is a rule that the next call site forgets,
 * and the promise shown to visitors — never stored, never traced — has to hold for
 * the whole surface, not just the header it was designed around.
 */
function scrub<T>(value: T): T {
  return redactApiKeysDeep(value);
}

/**
 * Opens a trace for one unit of work.
 *
 * `sessionId` is the visitor's session, so Langfuse groups a whole conversation
 * together — which is the view worth having: not one question, but how someone
 * explored a document.
 */
export function startTrace(body: {
  name: string;
  sessionId?: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
  tags?: string[];
}): Trace {
  const lf = langfuse();
  if (!lf) return NOOP_TRACE;

  try {
    const trace = lf.trace({
      name: TRACE_NAME,
      sessionId: body.sessionId,
      input: scrub(body.input),
      metadata: scrub({ operation: body.name, ...body.metadata }),
      tags: [body.name, ...(body.tags ?? [])],
    });

    return {
      generation(gen) {
        try {
          const observation = trace.generation({
            name: gen.name,
            model: gen.model,
            input: scrub(gen.input),
            modelParameters: gen.modelParameters,
          });
          return {
            end(result) {
              try {
                observation.end({
                  model: result.model,
                  output: scrub(result.output),
                  usage: result.usage,
                  level: result.level,
                  statusMessage: scrub(result.statusMessage),
                });
              } catch {
                /* tracing must never break a request */
              }
            },
          };
        } catch {
          return NOOP_GENERATION;
        }
      },

      span(spanBody) {
        try {
          const observation = trace.span(scrub(spanBody));
          return {
            end(result) {
              try {
                observation.end(scrub(result));
              } catch {
                /* ignored */
              }
            },
          };
        } catch {
          return NOOP_SPAN;
        }
      },

      update(update) {
        try {
          trace.update(scrub(update));
        } catch {
          /* ignored */
        }
      },

      async flush() {
        try {
          await lf.flushAsync();
        } catch {
          /* a lost trace is not worth a failed answer */
        }
      },
    };
  } catch {
    return NOOP_TRACE;
  }
}
