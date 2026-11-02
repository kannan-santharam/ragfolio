/**
 * Server-only configuration, read from the environment.
 *
 * Nothing here is NEXT_PUBLIC_-prefixed on purpose: the provider key and the
 * Supabase service-role key must never reach the browser bundle. Anything the
 * browser needs is handed over by /api/status as `PublicConfig`.
 */

import type { PublicConfig } from './types';

export type Provider = 'gemini' | 'openai';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  }
  return value;
}

function list(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Trimmed, and rejected outright if it is not header-safe.
 *
 * The key goes in an outbound header, and undici throws on an interior newline
 * with a message that echoes the whole value — a message that would then travel
 * into a 500 body and a trace, carrying the key with it. A multi-line paste
 * into a dashboard is all it takes.
 */
function headerSafe(name: string): string {
  const value = required(name).trim();
  if (/[\s]/.test(value)) {
    throw new Error(`${name} contains whitespace, so it cannot be sent as a request header. Re-paste it as a single line.`);
  }
  return value;
}

export function provider(): Provider {
  const raw = (process.env.RAG_PROVIDER ?? 'gemini').trim().toLowerCase();
  if (raw === 'gemini' || raw === 'openai') return raw;
  throw new Error(`RAG_PROVIDER must be "gemini" or "openai", got "${raw}".`);
}

/** Name of the env var holding the owner's key for the configured provider. */
export function providerKeyVar(): string {
  return provider() === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
}

export const env = {
  get ownerKey(): string {
    return headerSafe(providerKeyVar());
  },
  get supabaseUrl(): string {
    // The dashboard shows the REST endpoint next to the project URL, so
    // `.../rest/v1/` is an easy thing to paste. supabase-js wants the bare origin.
    return required('SUPABASE_URL').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  },
  get supabaseServiceRoleKey(): string {
    return required('SUPABASE_SERVICE_ROLE_KEY').trim();
  },
  get trustedOrigins(): string[] {
    return list('TRUSTED_ORIGINS').map((origin) => origin.replace(/\/+$/, '').toLowerCase());
  },
  /** Explicit model allowlist, or the provider default when unset. */
  get chatModels(): string[] {
    return list('CHAT_MODELS');
  },
  get seedToken(): string | undefined {
    return process.env.SEED_TOKEN?.trim() || undefined;
  },
  get rateLimitSalt(): string {
    return process.env.RATE_LIMIT_SALT ?? 'ragfolio';
  },
  /**
   * Whether visitors arriving directly (not through a trusted origin) may use
   * the app with their own key. Off means the public URL is a closed door:
   * only trusted origins get answers. On means the public
   * URL becomes a generic "upload and ask" demo on the visitor's own key.
   */
  get allowVisitorKeys(): boolean {
    return (process.env.ALLOW_VISITOR_KEYS ?? 'true').trim().toLowerCase() !== 'false';
  },
  get redactContacts(): boolean {
    return (process.env.REDACT_CONTACT_DETAILS ?? 'true').trim().toLowerCase() !== 'false';
  },
  get telemetryDisabled(): boolean {
    const value = (process.env.RAGFOLIO_TELEMETRY_DISABLED ?? '').trim().toLowerCase();
    return value === '1' || value === 'true';
  },
  get telemetryUrl(): string {
    return process.env.RAGFOLIO_TELEMETRY_URL?.trim() || DEFAULT_TELEMETRY_URL;
  },
  get telemetryReceiver(): boolean {
    const value = (process.env.RAGFOLIO_TELEMETRY_RECEIVER ?? '').trim().toLowerCase();
    return value === '1' || value === 'true';
  },
};

/**
 * Where anonymous usage counts are sent. See PRIVACY.md and lib/telemetry.ts.
 *
 * Empty in v0.1, which makes telemetry a no-op: a default pointing at a
 * hostname nobody has claimed yet would beacon every install to whoever claims
 * it first. The maintainer sets this to their deployed receiver in a release;
 * adopters can point it anywhere with RAGFOLIO_TELEMETRY_URL or opt out.
 */
export const DEFAULT_TELEMETRY_URL = '';

/** The personalisation layer: who this assistant is for, in the adopter's words. */
export function publicConfig(): PublicConfig {
  const ownerName = (process.env.OWNER_NAME ?? '').trim();
  const assistantName = (process.env.ASSISTANT_NAME ?? '').trim() || 'Assistant';
  return {
    provider: provider(),
    ownerName,
    assistantName,
    welcome:
      (process.env.WELCOME_MESSAGE ?? '').trim() ||
      (ownerName
        ? `Ask me anything about ${ownerName} — experience, projects, skills. Every answer cites the document it came from.`
        : 'Upload a document and ask questions about it. Every answer cites the passage it came from.'),
    suggestions: list('SUGGESTED_QUESTIONS').slice(0, 4),
  };
}

/** True when every service the app depends on is configured. */
export function isConfigured(): boolean {
  return Boolean(
    process.env[providerKeyVar()] && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function missingConfig(): string[] {
  return [providerKeyVar(), 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter(
    (name) => !process.env[name]?.trim(),
  );
}
