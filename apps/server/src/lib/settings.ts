/**
 * Retrieval and agent settings the visitor can change.
 *
 * Shared by the browser and the route handler. The browser clamps so the UI
 * cannot express an invalid value; the server clamps again because the browser
 * is not a trustworthy source — an unbounded `maxTurns` would let one visitor
 * burn the whole day's model quota in a handful of requests.
 */

export interface ChatSettings {
  /** A model id, or 'auto' for the fallback chain. */
  model: string;
  /** Passages per search, or null to let the agent decide per search. */
  topK: number | null;
  /** Minimum cosine similarity for a passage to be returned at all. */
  threshold: number;
  /** How many model turns the agent may take before it must answer. */
  maxTurns: number;
}

export const DEFAULT_SETTINGS: ChatSettings = {
  model: 'auto',
  topK: null,
  threshold: 0.25,
  maxTurns: 5,
};

export const LIMITS = {
  topK: { min: 1, max: 12 },
  /** Measured top-match scores on real questions run 0.47–0.78; above 0.5 reads as "retrieval is broken". */
  threshold: { min: 0, max: 0.5, step: 0.05 },
  /** Floored at 2: the final turn is sent without tools, so 1 would mean the agent can never search. */
  maxTurns: { min: 2, max: 5 },
} as const;

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function normaliseSettings(input: unknown): ChatSettings {
  const raw = (input ?? {}) as Partial<ChatSettings>;
  return {
    model: typeof raw.model === 'string' ? raw.model : DEFAULT_SETTINGS.model,
    topK: raw.topK == null ? null : Math.round(clampNumber(raw.topK, LIMITS.topK.min, LIMITS.topK.max, 6)),
    threshold: clampNumber(raw.threshold, LIMITS.threshold.min, LIMITS.threshold.max, DEFAULT_SETTINGS.threshold),
    maxTurns: Math.round(clampNumber(raw.maxTurns, LIMITS.maxTurns.min, LIMITS.maxTurns.max, DEFAULT_SETTINGS.maxTurns)),
  };
}
