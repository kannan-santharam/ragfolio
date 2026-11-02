import { NextResponse, type NextRequest } from 'next/server';
import { env, publicConfig } from '@/lib/config';
import { isTrustedOrigin } from '@/lib/privacy';
import { canWriteSharedNamespace, readableSessions, requireReadableSessionId, requireSessionId, SEED_SESSION_ID, SessionError } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { isSecureRequest, trialAllowance, visitorCookieHeader, visitorIdFor } from '@/lib/trial';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const sessionId = requireReadableSessionId(req);
    const trusted = isTrustedOrigin(req);

    const { data, error } = await supabase()
      .from('documents')
      .select('id, filename, mime, source_kind, page_count, char_count, chunk_count, outline, created_at, session_id')
      .in('session_id', readableSessions(sessionId, trusted))
      .order('created_at', { ascending: false });

    // Postgres speaks in table, column and policy names. That goes to the log;
    // the client gets a sentence.
    if (error) {
      console.error('documents:list', error);
      return NextResponse.json({ error: 'Could not load documents.' }, { status: 500 });
    }

    // Preloaded documents sort last so the visitor's own uploads stay on top.
    const documents = (data ?? [])
      .map(({ session_id, ...doc }) => ({ ...doc, is_public: session_id === SEED_SESSION_ID }))
      .sort((a, b) => Number(a.is_public) - Number(b.is_public));

    // The public URL's terms for this visitor: what the trial has left, if
    // there is one. The visitor cookie is minted here, on the first call the
    // page makes, so later spend is counted against a stable id.
    const access = env.publicAccess;
    const headers: Record<string, string> = {};
    let trial: Awaited<ReturnType<typeof trialAllowance>> | undefined;
    if (!trusted && access === 'trial') {
      const visitor = visitorIdFor(req);
      if (visitor.fresh) headers['Set-Cookie'] = visitorCookieHeader(visitor.id, isSecureRequest(req));
      trial = await trialAllowance(visitor.id);
    }

    return NextResponse.json(
      {
        documents,
        trusted,
        access,
        trial,
        visitorKeysAllowed: env.allowVisitorKeys,
        config: publicConfig(),
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof SessionError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('documents:list', error);
    return NextResponse.json({ error: 'Could not load documents.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sessionId = requireSessionId(req);
    if (sessionId === SEED_SESSION_ID && !canWriteSharedNamespace(req)) {
      return NextResponse.json({ error: 'Not authorised to modify the shared namespace.' }, { status: 403 });
    }

    const id = req.nextUrl.searchParams.get('id');
    // Scoped to the caller's own session, so preloaded documents are not theirs to delete.
    const query = supabase().from('documents').delete().eq('session_id', sessionId);
    const { error } = id ? await query.eq('id', id) : await query;
    if (error) {
      console.error('documents:delete', error);
      return NextResponse.json({ error: 'Could not delete.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SessionError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: 'Could not delete.' }, { status: 500 });
  }
}
