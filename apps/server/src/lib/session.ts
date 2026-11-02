import type { NextRequest } from 'next/server';
import { env } from './config';
import { isTrustedOrigin } from './privacy';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Every row in the database is namespaced by session id: a v4 UUID the browser
 * generates once and keeps in localStorage. Unguessable in practice, which is
 * the only property this needs — it keeps visitor A's upload out of visitor B's
 * answers. It is explicitly not an authorisation boundary.
 */
export function readSessionId(req: NextRequest): string | null {
  const id = req.headers.get('x-session-id');
  return id && UUID_RE.test(id) ? id.toLowerCase() : null;
}

/**
 * The namespace holding the owner's preloaded documents, visible to every
 * trusted-origin visitor. Identified by a fixed session id rather than a
 * column, which keeps `match_chunks` single-purpose: retrieval runs once per
 * readable namespace and merges.
 */
export const SEED_SESSION_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Namespaces a visitor may read from. Their own always; the preloaded one only
 * through a trusted origin. Order matters: the caller's own namespace is first
 * because retrieval reserves result slots for it by position.
 */
export function readableSessions(sessionId: string, includePreloaded: boolean): string[] {
  if (sessionId === SEED_SESSION_ID) return [sessionId];
  return includePreloaded ? [sessionId, SEED_SESSION_ID] : [sessionId];
}

/**
 * Writes to the shared namespace require a secret. SEED_SESSION_ID is a public
 * constant, so without this anyone could POST a document that every visitor
 * then sees cited as part of the owner's profile. No token configured means
 * seeding is disabled, not open.
 */
export function canWriteSharedNamespace(req: NextRequest): boolean {
  const expected = env.seedToken;
  if (!expected) return false;
  const provided = req.headers.get('x-seed-token') ?? '';
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class SessionError extends Error {}

export function requireSessionId(req: NextRequest): string {
  const id = readSessionId(req);
  if (!id) throw new SessionError('Missing or malformed x-session-id header.');
  return id;
}

/**
 * The session a read or a chat may run as. The shared namespace is reachable
 * by every trusted-origin visitor through `readableSessions`, so nobody has a
 * reason to name it directly; a request that does, from anywhere else, is
 * refused rather than served the owner's corpus on the owner's key.
 */
export function requireReadableSessionId(req: NextRequest): string {
  const id = requireSessionId(req);
  if (id === SEED_SESSION_ID && !isTrustedOrigin(req) && !canWriteSharedNamespace(req)) {
    throw new SessionError('That session is not available here.');
  }
  return id;
}
