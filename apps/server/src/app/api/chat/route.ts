import { NextResponse, type NextRequest } from 'next/server';
import { runAgent } from '@/lib/agent';
import { ApiKeyRequiredError, OriginNotAllowedError, resolveApiKey } from '@/lib/apiKey';
import { env } from '@/lib/config';
import { QuotaExhaustedError, resolveModels } from '@/lib/models';
import { isTrustedOrigin } from '@/lib/privacy';
import type { Message } from '@/lib/providers';
import { checkRateLimit, LIMITS, rateLimitIdentity } from '@/lib/rateLimit';
import { normaliseSettings } from '@/lib/settings';
import { requireSessionId, SessionError } from '@/lib/session';
import { recordUsage } from '@/lib/telemetry';
import { startTrace } from '@/lib/tracing';
import type { ChatStreamEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Turns kept in context. Older ones are dropped rather than summarised. */
const MAX_HISTORY_TURNS = 12;

interface IncomingMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(req: NextRequest) {
  let sessionId: string;
  try {
    sessionId = requireSessionId(req);
  } catch (error) {
    return NextResponse.json({ error: error instanceof SessionError ? error.message : 'Bad request.' }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { messages?: IncomingMessage[]; settings?: unknown } | null;
  const messages = (body?.messages ?? []).filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'));

  // Re-clamped server-side: the browser is not the authority, and an unvetted
  // model id would be interpolated straight into a provider URL.
  const settings = normaliseSettings(body?.settings);
  const trusted = isTrustedOrigin(req);

  let credential;
  try {
    credential = resolveApiKey(req);
  } catch (error) {
    if (error instanceof ApiKeyRequiredError) return NextResponse.json({ error: error.message, needsKey: true }, { status: 401 });
    if (error instanceof OriginNotAllowedError) return NextResponse.json({ error: error.message }, { status: 403 });
    throw error;
  }

  const models = resolveModels(settings.model, credential.provider);

  if (!messages.length || messages[messages.length - 1]?.role !== 'user') {
    return NextResponse.json({ error: 'The last message must come from the user.' }, { status: 400 });
  }

  const limit = await checkRateLimit(rateLimitIdentity(req, sessionId), 'chat');
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error:
          credential.source === 'visitor'
            ? `Message limit reached (${LIMITS.chat.max} per 10 minutes). That is this site's own cap, not a limit on your key — it resets at ${limit.resetsAt}.`
            : `Message limit reached (${LIMITS.chat.max} per 10 minutes). It resets at ${limit.resetsAt}.`,
      },
      { status: 429 },
    );
  }

  // Trim to a user boundary so the tail never starts on an orphaned answer.
  const recent = messages.slice(-MAX_HISTORY_TURNS).filter((m) => m.content.trim());
  while (recent.length && recent[0].role !== 'user') recent.shift();
  const history: Message[] = recent.map((m) =>
    m.role === 'user' ? { role: 'user', content: m.content } : { role: 'assistant', content: m.content },
  );

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener('abort', () => abort.abort());

  const question = messages[messages.length - 1].content;
  const trace = startTrace({
    name: 'chat',
    sessionId,
    input: question,
    metadata: {
      model: settings.model,
      maxTurns: settings.maxTurns,
      historyTurns: history.length,
      origin: trusted ? 'trusted' : 'direct',
      keySource: credential.source, // whose quota; never the key itself
    },
  });

  // Count only. Fire-and-forget; see lib/telemetry.ts.
  void recordUsage('chat', req.headers.get('host'));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: ChatStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        await runAgent({
          sessionId,
          history,
          emit,
          signal: abort.signal,
          settings,
          models,
          trace,
          trusted,
          contactsRedacted: !trusted && env.redactContacts,
          credential,
        });
        emit({ type: 'done' });
      } catch (error) {
        if (!abort.signal.aborted) {
          // Typed errors this app authored keep their wording — the UI acts on
          // them. Anything else is Postgres, undici or a provider describing the
          // request that failed, and that detail is for the log, not the visitor.
          const message = error instanceof QuotaExhaustedError ? error.message : 'Something went wrong answering that. Try asking again.';
          if (!(error instanceof QuotaExhaustedError)) console.error('chat:unhandled', error);
          trace.update({ metadata: { error: error instanceof Error ? error.message : 'unknown' } });
          emit({ type: 'error', message });
        }
      } finally {
        // A serverless function freezes the instant its response finishes;
        // anything still queued for Langfuse at that point is lost.
        await trace.flush();
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed by the client disconnecting */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
