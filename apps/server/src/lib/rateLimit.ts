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
  const address = clientAddress(req);
  if (!address) return sessionId;
  return uuidShaped(`${env.rateLimitSalt}:${address}`);
}

/**
 * The caller's network address, as far as it can be known.
 *
 * On Vercel, `x-vercel-forwarded-for` and `x-real-ip` are set by the platform
 * and cannot be supplied by the client. Elsewhere, the RIGHTMOST
 * `x-forwarded-for` entry is the one appended by the nearest proxy; the
 * leftmost is whatever the client chose to send. A bare dev server has none
 * of these, and the loopback stands in.
 *
 * IPv6 is folded to its /64: a home connection is handed a whole /64, so
 * counting individual addresses would count nothing.
 */
export function clientAddress(req: NextRequest): string | null {
  const raw =
    req.headers.get('x-vercel-forwarded-for')?.split(',')[0] ||
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',').pop() ||
    (process.env.NODE_ENV === 'development' ? '127.0.0.1' : '');
  const address = (raw ?? '').trim();
  if (!address) return null;
  return address.includes(':') ? ipv6Prefix(address) : address;
}

function ipv6Prefix(address: string): string {
  const bare = address.replace(/^\[|\]$/g, '').split('%')[0];
  // Expand `::` so the first four hextets can be read off positionally.
  const [head, tail = ''] = bare.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = Math.max(0, 8 - headParts.length - tailParts.length);
  const full = [...headParts, ...Array(missing).fill('0'), ...tailParts];
  return `${full.slice(0, 4).map((h) => h.toLowerCase()).join(':')}::/64`;
}

/** Hashes any string into something the uuid column accepts. */
export function uuidShaped(input: string): string {
  const digest = createHash('sha256').update(input).digest('hex');
  return [digest.slice(0, 8), digest.slice(8, 12), `4${digest.slice(13, 16)}`, `8${digest.slice(17, 20)}`, digest.slice(20, 32)].join('-');
}

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  resetsAt: string | null;
}

export interface Window {
  windowSecs: number;
  max: number;
}

/**
 * Fixed-window counter, enforced in Postgres because serverless instances
 * share no memory.
 *
 * Two failure postures, chosen by who pays. A visitor spending their own key
 * fails OPEN: a limiter that takes the site down when the RPC hiccups is worse
 * than the abuse it prevents. Spend on the owner's key fails CLOSED: if the
 * counter cannot be read, the allowance is treated as used up, because the
 * alternative is an unmetered key.
 */
export async function bumpCounter(identity: string, bucket: string, window: Window, posture: 'open' | 'closed'): Promise<RateLimitVerdict> {
  const onFailure: RateLimitVerdict = posture === 'open' ? { allowed: true, remaining: window.max, resetsAt: null } : { allowed: false, remaining: 0, resetsAt: null };
  try {
    const { data, error } = await supabase().rpc('bump_rate_limit', {
      p_session_id: identity,
      p_bucket: bucket,
      p_window_secs: window.windowSecs,
      p_limit: window.max,
    });
    if (error || !data?.[0]) {
      if (error) console.error('rate-limit:bump', bucket, error.message);
      return onFailure;
    }
    const row = data[0] as { allowed: boolean; remaining: number; resets_at: string };
    return { allowed: row.allowed, remaining: row.remaining, resetsAt: row.resets_at };
  } catch (error) {
    console.error('rate-limit:bump', bucket, error instanceof Error ? error.message : error);
    return onFailure;
  }
}

/** Gives one unit back. Best effort: a failed release leaves the allowance smaller, never larger. */
export async function releaseCounter(identity: string, bucket: string, window: Window): Promise<void> {
  try {
    await supabase().rpc('release_rate_limit', { p_session_id: identity, p_bucket: bucket, p_window_secs: window.windowSecs });
  } catch {
    /* the unit stays spent */
  }
}

/** Current count without incrementing. Unknown reads as fully used, for the same reason as above. */
export async function readCounter(identity: string, bucket: string, window: Window): Promise<number> {
  try {
    const { data, error } = await supabase().rpc('read_rate_limit', {
      p_session_id: identity,
      p_bucket: bucket,
      p_window_secs: window.windowSecs,
    });
    if (error || typeof data !== 'number') return window.max;
    return data;
  } catch {
    return window.max;
  }
}

export async function checkRateLimit(identity: string, bucket: keyof typeof LIMITS): Promise<RateLimitVerdict> {
  return bumpCounter(identity, bucket, LIMITS[bucket], 'open');
}

export function limitFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
}

export const LIMITS = {
  chat: { windowSecs: 600, max: limitFromEnv('RATE_LIMIT_CHAT_PER_10MIN', 25) },
  ingest: { windowSecs: 3600, max: limitFromEnv('RATE_LIMIT_INGEST_PER_HOUR', 10) },
  /** Tight enough that key/check is not a free oracle for testing stolen keys in bulk. */
  keyCheck: { windowSecs: 600, max: 12 },
} as const;
