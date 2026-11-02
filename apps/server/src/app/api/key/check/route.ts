import { NextResponse, type NextRequest } from 'next/server';
import { ApiKeyRequiredError, OriginNotAllowedError, resolveApiKey } from '@/lib/apiKey';
import { adapterFor } from '@/lib/providers';
import { checkRateLimit, rateLimitIdentity } from '@/lib/rateLimit';
import { readSessionId } from '@/lib/session';

export const runtime = 'nodejs';

/** Stand-in identity for a key check that arrives before a session exists. Must be uuid-shaped. */
const NO_SESSION = '00000000-0000-4000-8000-0000000000ff';

/**
 * Does this key work? A cheap authenticated call that spends no tokens, so a
 * typo costs the visitor nothing. Rate-limited so the route is not a free
 * oracle for checking stolen keys in bulk. The provider's error body is never
 * forwarded.
 */
export async function POST(req: NextRequest) {
  const limit = await checkRateLimit(rateLimitIdentity(req, readSessionId(req) ?? NO_SESSION), 'keyCheck');
  if (!limit.allowed) {
    return NextResponse.json({ error: `Too many key checks. Try again after ${limit.resetsAt}.` }, { status: 429 });
  }

  let key: string;
  let providerId: 'gemini' | 'openai';
  try {
    const resolved = resolveApiKey(req);
    // Only a visitor-supplied key is ever probed. The owner's key is not a
    // thing this route checks, whichever path handed it over.
    if (resolved.source !== 'visitor') return NextResponse.json({ valid: true, source: 'owner' });
    key = resolved.key;
    providerId = resolved.provider;
  } catch (error) {
    if (error instanceof ApiKeyRequiredError) return NextResponse.json({ valid: false, error: error.message }, { status: 400 });
    if (error instanceof OriginNotAllowedError) return NextResponse.json({ valid: false, error: error.message }, { status: 403 });
    throw error;
  }

  let status: number;
  try {
    status = await adapterFor(providerId).probeKey(key);
  } catch {
    return NextResponse.json({ valid: false, error: 'Could not reach the provider to check the key. Try again in a moment.' }, { status: 502 });
  }

  if (status >= 200 && status < 300) return NextResponse.json({ valid: true, source: 'visitor' });

  const message =
    status === 400 || status === 401 || status === 403
      ? 'The provider rejected that key. Check you copied all of it and that the API is enabled for its project.'
      : status === 429
        ? 'That key is valid but currently rate-limited. It should work again shortly.'
        : `The provider returned an unexpected status (${status}) while checking the key.`;

  // 200 with valid:false — the check itself succeeded, the key is the problem.
  return NextResponse.json({ valid: status === 429, error: message });
}
