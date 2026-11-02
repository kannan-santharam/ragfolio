import { env, provider as ownerProvider, type Provider } from './config';
import { adapterFor, ProviderHttpError, ProviderTimeoutError, type GenerateOptions, type StreamTurnOptions, type StreamTurnResult } from './providers';
import { supabase } from './supabase';

/**
 * The models this deployment is allowed to call.
 *
 * This list is an allowlist, not a suggestion. The model id is interpolated into
 * the provider request URL (Gemini) or body, so a value arriving from the
 * browser is checked by exact membership here — never sanitised, never
 * pattern-matched. A crafted id containing `?` or `#` could otherwise
 * restructure the URL and leak the API key into someone else's query string.
 *
 * Sourced from CHAT_MODELS when set, else the provider's defaults. Free-tier
 * quotas differ per model by more than an order of magnitude and are the real
 * constraint on a public deployment; adopters should verify against their key.
 */
export function chatModels(providerId: Provider = ownerProvider()): string[] {
  // CHAT_MODELS describes the owner's provider; a visitor on the other vendor
  // gets that vendor's defaults.
  const configured = providerId === ownerProvider() ? env.chatModels.filter((id) => /^[A-Za-z0-9._-]{3,80}$/.test(id)) : [];
  return configured.length ? configured : [...adapterFor(providerId).defaultChatModels];
}

export function isAllowedModel(value: unknown, providerId: Provider = ownerProvider()): value is string {
  return typeof value === 'string' && chatModels(providerId).includes(value);
}

/**
 * Which models a request may use. An explicit pick is honoured on its own — no
 * silent substitution. Auto gets the full chain.
 */
export function resolveModels(requested: unknown, providerId: Provider = ownerProvider()): string[] {
  return isAllowedModel(requested, providerId) ? [requested] : chatModels(providerId);
}

export class QuotaExhaustedError extends Error {}

/**
 * Ceiling on the whole cascade, leaving room under the 60s function limit.
 * Once this passes, remaining candidates are skipped and the caller gets a
 * real error instead of a platform 504 with nothing streamed.
 */
const CASCADE_BUDGET_MS = 40_000;

// --- Cooldowns (Postgres-backed, with a short in-process cache) --------------

/**
 * Cooldowns are read once per request and cached for a few seconds in process,
 * so an agent loop of four turns costs one Postgres read, not four. The
 * authoritative copy is the `model_health` table, which every instance shares.
 */
const localCache = new Map<string, { until: number; fetchedAt: number }>();
const LOCAL_CACHE_MS = 5_000;

async function loadCooldowns(fingerprint: string): Promise<Map<string, number>> {
  const now = Date.now();
  const cached = [...localCache.entries()].filter(([key, value]) => key.startsWith(`${fingerprint}:`) && now - value.fetchedAt < LOCAL_CACHE_MS);
  if (cached.length) return new Map(cached.map(([key, value]) => [key.slice(fingerprint.length + 1), value.until]));

  const out = new Map<string, number>();
  try {
    const { data } = await supabase()
      .from('model_health')
      .select('model, cooldown_until')
      .eq('fingerprint', fingerprint)
      .gt('cooldown_until', new Date(now).toISOString());
    for (const row of data ?? []) {
      const until = Date.parse(row.cooldown_until as string);
      out.set(row.model as string, until);
      localCache.set(`${fingerprint}:${row.model}`, { until, fetchedAt: now });
    }
  } catch {
    /* health is an optimisation; a failed read must never block an answer */
  }
  return out;
}

async function setCooldown(fingerprint: string, model: string, ms: number, reason: string) {
  const until = Date.now() + ms;
  localCache.set(`${fingerprint}:${model}`, { until, fetchedAt: Date.now() });
  try {
    await supabase()
      .from('model_health')
      .upsert({ fingerprint, model, cooldown_until: new Date(until).toISOString(), reason });
  } catch {
    /* ignored */
  }
}

async function clearCooldown(fingerprint: string, model: string) {
  localCache.delete(`${fingerprint}:${model}`);
  try {
    await supabase().from('model_health').delete().eq('fingerprint', fingerprint).eq('model', model);
  } catch {
    /* ignored */
  }
}

// --- The cascade --------------------------------------------------------------

export interface CascadeOptions extends Omit<StreamTurnOptions, 'model'> {
  /** Candidate models, tried in order. One entry means no fallback. */
  models: readonly string[];
}

/**
 * Try each candidate in turn until one answers.
 *
 * Quota (429) and hangs are both remembered as cooldowns, keyed by key
 * fingerprint and model, so the next request skips straight past a dead model.
 * A model that was pinned explicitly is always tried, and the truth reported,
 * rather than refused on the strength of a stale timestamp.
 */
export async function streamWithFallback(options: CascadeOptions): Promise<StreamTurnResult & { model: string }> {
  const { models, credential } = options;
  const provider = adapterFor(credential.provider);
  const cooldowns = await loadCooldowns(credential.fingerprint);
  const deadline = Date.now() + CASCADE_BUDGET_MS;

  let lastError: unknown;
  let quotaHit = false;
  let unresponsive = false;

  for (const model of models) {
    if (Date.now() > deadline && lastError) break;

    const until = cooldowns.get(model);
    if (models.length > 1 && until && until > Date.now()) {
      quotaHit = true;
      continue;
    }

    try {
      const result = await provider.streamTurn({ ...options, model });
      // Keyed the same way it was set, so a recovered model stops being skipped.
      if (until) await clearCooldown(credential.fingerprint, model);
      return { ...result, model };
    } catch (error) {
      if (options.signal?.aborted) throw error;

      if (error instanceof ProviderTimeoutError) {
        await setCooldown(credential.fingerprint, model, 60_000, 'unresponsive');
        unresponsive = true;
        // Tokens already on screen: switching models would splice two answers.
        if (error.partial) throw error;
        lastError = error;
        continue;
      }
      if (error instanceof ProviderHttpError) {
        if (error.status === 429) {
          quotaHit = true;
          await setCooldown(credential.fingerprint, model, error.retryAfterMs ?? 60_000, 'quota');
        }
        // 401/403 on a pinned model is the caller's key, not the model — but on
        // a chain the next model may be entitled where this one is not.
        lastError = error;
        continue;
      }
      lastError = error;
      continue;
    }
  }

  if (unresponsive && !quotaHit) {
    throw new Error(
      models.length === 1
        ? `${models[0]} is not responding right now. Switch the model to Auto to try the others.`
        : 'The model provider is not responding at the moment — every model in the fallback chain timed out. Please try again shortly.',
    );
  }
  if (quotaHit) {
    throw new QuotaExhaustedError(
      models.length === 1
        ? `${models[0]} has hit its rate limit for now. Switch the model to Auto to fall back to another one.`
        : 'Every model in the fallback chain is rate-limited right now. Free tiers reset daily — try again shortly.',
    );
  }
  throw lastError instanceof Error ? lastError : new Error('Every model in the cascade failed.');
}

/**
 * Non-streaming variant of the cascade for one-shot multimodal calls (page
 * transcription). Same cooldown bookkeeping, same typed errors.
 */
export async function generateWithFallback(options: Omit<GenerateOptions, 'model'> & { models: readonly string[] }): Promise<string> {
  const { models, credential } = options;
  const provider = adapterFor(credential.provider);
  const cooldowns = await loadCooldowns(credential.fingerprint);
  let lastError: unknown;
  let quotaHit = false;

  for (const model of models) {
    const until = cooldowns.get(model);
    if (models.length > 1 && until && until > Date.now()) {
      quotaHit = true;
      continue;
    }
    try {
      const text = await provider.generate({ ...options, model });
      if (until) await clearCooldown(credential.fingerprint, model);
      return text;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (error instanceof ProviderHttpError && error.status === 429) {
        quotaHit = true;
        await setCooldown(credential.fingerprint, model, error.retryAfterMs ?? 60_000, 'quota');
      }
      lastError = error;
    }
  }
  if (quotaHit) throw new QuotaExhaustedError('Every model in the fallback chain is rate-limited right now. Try again shortly.');
  throw lastError instanceof Error ? lastError : new Error('Every model in the cascade failed.');
}
