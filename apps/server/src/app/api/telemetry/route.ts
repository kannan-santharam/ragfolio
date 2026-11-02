import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/config';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

/**
 * Telemetry RECEIVER. Off unless RAGFOLIO_TELEMETRY_RECEIVER=1, which only the
 * package maintainer's own deployment sets. Adopters' installs POST here (see
 * lib/telemetry.ts); this stores one counter per (day, origin hash, version,
 * event) and nothing else. No IPs, no bodies beyond the three short fields.
 */
export async function POST(req: NextRequest) {
  if (!env.telemetryReceiver) return NextResponse.json({ ok: false }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { v?: unknown; o?: unknown; e?: unknown } | null;
  const version = typeof body?.v === 'string' && /^[0-9A-Za-z.+-]{1,32}$/.test(body.v) ? body.v : null;
  const origin = typeof body?.o === 'string' && /^[0-9a-f]{16}$/.test(body.o) ? body.o : null;
  const event = body?.e === 'chat' || body?.e === 'ingest' ? body.e : null;
  if (!version || !origin || !event) return NextResponse.json({ ok: false }, { status: 400 });

  try {
    await supabase().rpc('bump_telemetry', { p_origin_hash: origin, p_version: version, p_event: event });
  } catch (error) {
    console.error('telemetry:receive', error);
  }
  return NextResponse.json({ ok: true });
}
