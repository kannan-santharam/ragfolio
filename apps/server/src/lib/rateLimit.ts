import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { env } from './config';
import { supabase } from './supabase';

/**
 * The identity a rate limit is counted against: a salted hash of the caller's
 * address, not the session id. The session id is a UUID the browser generates,
 * so counting against it lets anyone reset their quota with crypto.randomUUID().
 * The address is hashed because an IP is personal data and counting requests
 * does not require keeping it in plaintext. Visitors behind one NAT share a
 * budget; for a portfolio widget that is the right side of the trade.
 */
export function rateLimitIdentity(req: NextRequest, sessionId: string): string {
  const forwarded = req.headers.get('x-forwarded-for') ?? '';
  const address = (forwarded.split(',')[0] || req.headers.get('x-real-ip') || '').trim();
  if (!address) return sessionId;

  const digest = createHash('sha256').update(`${env.rateLimitSalt}:${address}`).digest('hex');
  // Shaped as a UUID so it fits the uuid column.
  return [digest.slice(0, 8), digest.slice(8, 12), `4${digest.slice(13, 16)}`, `8${digest.slice(17, 20)}`, digest.slice(20, 32)].join('-');
}

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  resetsAt: string | null;
}

/**
 * Fixed-window rate limit, enforced in Postgres because serverless instances
 * share no memory. Fails OPEN: a limiter that takes the whole site down when
 * the RPC hiccups is worse than the abuse it prevents.
 */
export async function checkRateLimit(identity: string, bucket: keyof typeof LIMITS): Promise<RateLimitVerdict> {
  const { windowSecs, max } = LIMITS[bucket];
  try {
    const { data, error } = await supabase().rpc('bump_rate_limit', {
      p_session_id: identity,
      p_bucket: bucket,
      p_window_secs: windowSecs,
      p_limit: max,
    });
    if (error || !data?.[0]) return { allowed: true, remaining: max, resetsAt: null };
    const row = data[0] as { allowed: boolean; remaining: number; resets_at: string };
    return { allowed: row.allowed, remaining: row.remaining, resetsAt: row.resets_at };
  } catch {
    return { allowed: true, remaining: max, resetsAt: null };
  }
}

function limit(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

export const LIMITS = {
  chat: { windowSecs: 600, max: limit('RATE_LIMIT_CHAT_PER_10MIN', 25) },
  ingest: { windowSecs: 3600, max: limit('RATE_LIMIT_INGEST_PER_HOUR', 10) },
  /** Tight enough that key/check is not a free oracle for testing stolen keys in bulk. */
  keyCheck: { windowSecs: 600, max: 12 },
} as const;
