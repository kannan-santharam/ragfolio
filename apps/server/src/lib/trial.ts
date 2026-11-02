import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';

import { bumpCounter, clientAddress, limitFromEnv, rateLimitIdentity, readCounter, releaseCounter, uuidShaped, type RateLimitVerdict, type Window } from './rateLimit';

/**
 * Spend on the owner's key by people who are not the owner.
 *
 * Two kinds of visitor spend it. Someone arriving through a trusted origin
 * (the owner's own site) is the audience the widget exists for. Someone at the
 * public URL with no key of their own gets a free trial, so the first
 * impression is not a form asking for an API key. Both are metered here;
 * neither is trusted with an unbounded key.
 *
 * Counters, all daily, all in Postgres, bumped narrowest first so one caller
 * over their own allowance never touches a shared one:
 *
 *   per address — the salted hash of the caller's network address. Both tiers.
 *   per visitor — a random id in an HttpOnly cookie. Trial tier only: the
 *                 trusted iframe is a third-party context where cookies are
 *                 unreliable, and the address layer covers it.
 *   per tier    — one ceiling for all trial spend together, a separate one
 *                 for all trusted spend together. Separate so that abuse of
 *                 the public URL can exhaust the trial without switching the
 *                 widget off on the owner's own site.
 *
 * Origin trust is a header the client sends, so the trusted tier is not
 * "unmetered"; it is metered by address and by its own ceiling, and must pass
 * the same browser check. A unit reserved for a request that is refused before
 * any model call is handed back.
 *
 * The browser check (lib/botCheck.ts) sits in front of all of this so a script
 * that is not a browser never reaches the counters at all.
 */

export type SpendTier = 'trusted' | 'trial';

export interface TrialCaps {
  /** Per visitor, per day. */
  chatsPerDay: number;
  docsPerDay: number;
  /** Characters of extracted text per trial document. */
  maxChars: number;
  /** PDF pages the vision model may read per trial upload. 0 disables vision for trials. */
  visionPages: number;
  /** Agent turns per trial question. Lower than the visitor-adjustable ceiling. */
  maxTurns: number;
}

export interface OwnerBudget {
  /** All trusted-origin visitor chats on the owner's key, per day. */
  chatsPerDay: number;
  ingestsPerDay: number;
  /** The same, per address. */
  chatsPerAddress: number;
  ingestsPerAddress: number;
  /** PDF pages the vision model may read per upload from a trusted-origin visitor. */
  visitorVisionPages: number;
  /** All trial spend together, per day. */
  trialChatsPerDay: number;
  trialIngestsPerDay: number;
}

export function trialCaps(): TrialCaps {
  return {
    chatsPerDay: limitFromEnv('TRIAL_CHATS_PER_DAY', 10),
    docsPerDay: limitFromEnv('TRIAL_DOCS_PER_DAY', 1),
    maxChars: limitFromEnv('TRIAL_MAX_CHARS', 20_000),
    visionPages: limitFromEnv('TRIAL_VISION_PAGES', 0),
    maxTurns: Math.max(2, limitFromEnv('TRIAL_MAX_TURNS', 3)),
  };
}

export function ownerBudget(): OwnerBudget {
  return {
    chatsPerDay: limitFromEnv('OWNER_DAILY_CHATS', 200),
    ingestsPerDay: limitFromEnv('OWNER_DAILY_INGESTS', 20),
    chatsPerAddress: limitFromEnv('OWNER_CHATS_PER_ADDRESS', 60),
    ingestsPerAddress: limitFromEnv('OWNER_INGESTS_PER_ADDRESS', 5),
    visitorVisionPages: limitFromEnv('VISITOR_VISION_PAGES', 4),
    trialChatsPerDay: limitFromEnv('TRIAL_DAILY_CHATS', 100),
    trialIngestsPerDay: limitFromEnv('TRIAL_DAILY_INGESTS', 10),
  };
}

const DAY: number = 86_400;

/** Fixed identity for the global counters. Uuid-shaped for the column. */
const GLOBAL_IDENTITY = '00000000-0000-4000-8000-00000000000a';

/** One address may be a household or a small office; three visitors' worth before it is cut off. */
const ADDRESS_MULTIPLIER = 3;

// --- The visitor cookie -------------------------------------------------------

export const VISITOR_COOKIE = 'ragfolio_v';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The visitor id from the Cookie header, or null when absent or malformed. */
export function readVisitorId(headers: Headers): string | null {
  const cookie = headers.get('cookie') ?? '';
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== VISITOR_COOKIE) continue;
    const value = rest.join('=').trim();
    return UUID_RE.test(value) ? value.toLowerCase() : null;
  }
  return null;
}

export function mintVisitorId(): string {
  return randomUUID();
}

/**
 * Set-Cookie value for the visitor id. HttpOnly so page scripts cannot read
 * it; Lax so it rides on same-site API calls and nothing else; scoped to /api.
 * `Secure` only over https — a local dev server is plain http.
 */
export function visitorCookieHeader(id: string, secure: boolean): string {
  const attributes = [`${VISITOR_COOKIE}=${id}`, 'Path=/api', `Max-Age=${30 * DAY}`, 'HttpOnly', 'SameSite=Lax'];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function isSecureRequest(req: NextRequest): boolean {
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');
  return proto === 'https';
}

/** The visitor id the request carried, or a fresh one the response must set. */
export function visitorIdFor(req: NextRequest): { id: string; fresh: boolean } {
  const existing = readVisitorId(req.headers);
  return existing ? { id: existing, fresh: false } : { id: mintVisitorId(), fresh: true };
}

// --- Counters ------------------------------------------------------------------

function visitorIdentity(visitorId: string): string {
  return uuidShaped(`visitor:${visitorId}`);
}

export type SpendKind = 'chat' | 'ingest';

export interface SpendVerdict {
  allowed: boolean;
  /** Which layer refused, so the route can word the refusal. */
  refusedBy?: 'visitor' | 'address' | 'global';
  /** The counter could not be read or written; the refusal is a posture, not a quota. */
  unavailable?: boolean;
  resetsAt: string | null;
}

interface Layer {
  identity: string;
  bucket: string;
  window: Window;
  name: NonNullable<SpendVerdict['refusedBy']>;
}

/** The counters a request of this kind and tier is charged against, narrowest first. */
function layersFor(req: NextRequest, sessionId: string, kind: SpendKind, tier: SpendTier, visitorId: string): Layer[] | null {
  const caps = trialCaps();
  const budget = ownerBudget();
  const address = clientAddress(req);
  // No address means no way to meter the caller; owner-key spend needs one.
  if (!address) return null;
  const addressIdentity = rateLimitIdentity(req, sessionId);

  if (tier === 'trial') {
    const perVisitor = kind === 'chat' ? caps.chatsPerDay : caps.docsPerDay;
    return [
      { name: 'address', identity: addressIdentity, bucket: `trial-${kind}-day`, window: { windowSecs: DAY, max: perVisitor * ADDRESS_MULTIPLIER } },
      { name: 'visitor', identity: visitorIdentity(visitorId), bucket: `trial-${kind}-day`, window: { windowSecs: DAY, max: perVisitor } },
      { name: 'global', identity: GLOBAL_IDENTITY, bucket: `trial-${kind}-day`, window: { windowSecs: DAY, max: kind === 'chat' ? budget.trialChatsPerDay : budget.trialIngestsPerDay } },
    ];
  }
  return [
    { name: 'address', identity: addressIdentity, bucket: `owner-${kind}-day`, window: { windowSecs: DAY, max: kind === 'chat' ? budget.chatsPerAddress : budget.ingestsPerAddress } },
    { name: 'global', identity: GLOBAL_IDENTITY, bucket: `owner-${kind}-day`, window: { windowSecs: DAY, max: kind === 'chat' ? budget.chatsPerDay : budget.ingestsPerDay } },
  ];
}

/**
 * Reserves one unit of owner-key spend. Layers are bumped narrowest first, so
 * a caller over their own allowance never touches a shared one. A layer that
 * refuses leaves the earlier, narrower ones charged: that is the price of
 * asking, and it is bounded by those layers' own caps.
 */
export async function reserveOwnerSpend(req: NextRequest, sessionId: string, kind: SpendKind, tier: SpendTier, visitorId: string): Promise<SpendVerdict> {
  const layers = layersFor(req, sessionId, kind, tier, visitorId);
  if (!layers) return { allowed: false, refusedBy: 'address', unavailable: true, resetsAt: null };

  for (const layer of layers) {
    const verdict: RateLimitVerdict = await bumpCounter(layer.identity, layer.bucket, layer.window, 'closed');
    if (!verdict.allowed) {
      return { allowed: false, refusedBy: layer.name, unavailable: verdict.resetsAt === null, resetsAt: verdict.resetsAt };
    }
  }
  return { allowed: true, resetsAt: null };
}

/** Hands a reserved unit back on every layer. For requests refused before any model call. */
export async function releaseOwnerSpend(req: NextRequest, sessionId: string, kind: SpendKind, tier: SpendTier, visitorId: string): Promise<void> {
  const layers = layersFor(req, sessionId, kind, tier, visitorId);
  if (!layers) return;
  await Promise.all(layers.map((layer) => releaseCounter(layer.identity, layer.bucket, layer.window)));
}

export interface TrialAllowance {
  chatsLeft: number;
  docsLeft: number;
  chatsPerDay: number;
  docsPerDay: number;
  maxChars: number;
}

/** What a trial visitor has left today, without spending any of it. */
export async function trialAllowance(visitorId: string): Promise<TrialAllowance> {
  const caps = trialCaps();
  const budget = ownerBudget();
  const identity = visitorIdentity(visitorId);
  const [chats, docs, globalChats, globalIngests] = await Promise.all([
    readCounter(identity, 'trial-chat-day', { windowSecs: DAY, max: caps.chatsPerDay }),
    readCounter(identity, 'trial-ingest-day', { windowSecs: DAY, max: caps.docsPerDay }),
    readCounter(GLOBAL_IDENTITY, 'trial-chat-day', { windowSecs: DAY, max: budget.trialChatsPerDay }),
    readCounter(GLOBAL_IDENTITY, 'trial-ingest-day', { windowSecs: DAY, max: budget.trialIngestsPerDay }),
  ]);
  return {
    chatsLeft: Math.max(0, Math.min(caps.chatsPerDay - chats, budget.trialChatsPerDay - globalChats)),
    docsLeft: Math.max(0, Math.min(caps.docsPerDay - docs, budget.trialIngestsPerDay - globalIngests)),
    chatsPerDay: caps.chatsPerDay,
    docsPerDay: caps.docsPerDay,
    maxChars: caps.maxChars,
  };
}

/** Wording for a refusal. Trial visitors are pointed at their own key; trusted visitors are asked to wait. */
export function refusalMessage(verdict: SpendVerdict, kind: SpendKind, tier: SpendTier, providerName: string): string {
  const unit = kind === 'chat' ? 'questions' : 'uploads';
  const own = `Add your own ${providerName} key to keep going; it stays in your browser.`;
  if (verdict.unavailable) {
    return tier === 'trusted'
      ? 'The assistant is temporarily unavailable. Please try again in a few minutes.'
      : `The free trial is temporarily unavailable. ${own}`;
  }
  if (tier === 'trusted') {
    return `This assistant has reached its usage allowance for today. Please try again tomorrow.`;
  }
  if (verdict.refusedBy === 'global') return `Today's free allowance on this site is used up. ${own}`;
  return `Your free trial ${unit} for today are used up. ${own}`;
}

/** True when this request is paying with the owner's key but is not the owner. */
export function isVisitorSpend(source: 'owner' | 'visitor' | 'trial', seeding: boolean): SpendTier | null {
  if (seeding || source === 'visitor') return null;
  return source === 'trial' ? 'trial' : 'trusted';
}
