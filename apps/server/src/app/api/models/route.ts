import { NextResponse, type NextRequest } from 'next/server';
import { chatModels } from '@/lib/models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The model picker's options: the allowlist, in cascade order. Deliberately no
 * live "available right now" badge — a stale badge is worse than none.
 */
export function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('provider');
  const providerId = raw === 'openai' || raw === 'gemini' ? raw : undefined;
  try {
    return NextResponse.json({ models: chatModels(providerId) });
  } catch {
    return NextResponse.json({ models: [] });
  }
}
