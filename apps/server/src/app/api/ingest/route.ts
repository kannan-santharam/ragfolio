import { createHash } from 'node:crypto';
import { after, NextResponse, type NextRequest } from 'next/server';
import { ApiKeyRequiredError, OriginNotAllowedError, resolveApiKey } from '@/lib/apiKey';
import { browserAllowed, verifyBrowser } from '@/lib/botCheck';
import { chunkDocument } from '@/lib/chunk';
import { embedDocuments, EmbedQuotaError } from '@/lib/embed';
import { imageMimeFor, MAX_UPLOAD_BYTES, PAGE_BREAK, ParseError, parsePastedText, parseUpload } from '@/lib/parse';
import { describeImage, maxVisionPages, parseMode, SPARSE_PAGE_CHARS, transcribePdfPages } from '@/lib/vision';
import { redactApiKeys } from '@/lib/privacy';
import { checkRateLimit, LIMITS, rateLimitIdentity } from '@/lib/rateLimit';
import { canWriteSharedNamespace, requireSessionId, SEED_SESSION_ID, SessionError } from '@/lib/session';
import { supabase, toVectorLiteral } from '@/lib/supabase';
import { recordUsage } from '@/lib/telemetry';
import { startTrace } from '@/lib/tracing';
import { isSecureRequest, isVisitorSpend, ownerBudget, refusalMessage, releaseOwnerSpend, reserveOwnerSpend, trialCaps, visitorCookieHeader, visitorIdFor, type SpendTier } from '@/lib/trial';

export const runtime = 'nodejs';
/** 60s is the Vercel Hobby ceiling; the body cap and chunk cap keep real uploads inside it. */
export const maxDuration = 60;

/**
 * Sized against the free-tier embedding quota, not the clock: ~100 requests
 * per minute, one request per chunk on Gemini. 80 leaves headroom inside one
 * minute so a normal upload never parks waiting for a window it cannot afford.
 */
const MAX_CHUNKS = 80;

/**
 * Ceiling on extracted text, checked before chunking. The 4MB upload limit
 * bounds compressed input; DOCX and PDF streams can expand far beyond it.
 */
const MAX_TEXT_CHARS = 150_000;

/** Leave a margin under maxDuration so a quota wait fails loudly, not by timeout. */
const DEADLINE_MS = 50_000;

export async function POST(req: NextRequest) {
  const deadline = Date.now() + DEADLINE_MS;
  const trace = startTrace({ name: 'ingest' });

  try {
    const sessionId = requireSessionId(req);

    // The seed token is the control for shared-namespace writes; rate limiting
    // them adds nothing and breaks seeding.
    const seeding = sessionId === SEED_SESSION_ID;
    if (seeding && !canWriteSharedNamespace(req)) {
      return NextResponse.json({ error: 'Not authorised to write to the shared namespace.' }, { status: 403 });
    }

    let credential;
    try {
      credential = resolveApiKey(req);
    } catch (error) {
      if (error instanceof ApiKeyRequiredError) return NextResponse.json({ error: error.message, needsKey: true }, { status: 401 });
      if (error instanceof OriginNotAllowedError) return NextResponse.json({ error: error.message }, { status: 403 });
      throw error;
    }

    if (!seeding) {
      const limit = await checkRateLimit(rateLimitIdentity(req, sessionId), 'ingest');
      if (!limit.allowed) {
        return NextResponse.json({ error: `Upload limit reached (${LIMITS.ingest.max}/hour). Try again after ${limit.resetsAt}.` }, { status: 429 });
      }
    }

    // Spend on the owner's key by a visitor is reserved BEFORE the file is
    // opened: the vision pass costs model calls, and a refusal must come first.
    const tier = isVisitorSpend(credential.source, seeding);
    const responseHeaders: Record<string, string> = {};
    const visitor = visitorIdFor(req);
    /**
     * Until the first model call, a refusal hands the reserved unit back, so
     * a malformed or oversized upload does not spend a visitor's one try or
     * chip at the day's ceiling.
     */
    let refundable = false;
    const refund = async () => {
      if (!tier || !refundable) return;
      refundable = false;
      await releaseOwnerSpend(req, sessionId, 'ingest', tier, visitor.id);
    };
    const refuse = async (body: Record<string, unknown>, status: number) => {
      await refund();
      return NextResponse.json(body, { status, headers: responseHeaders });
    };

    if (tier) {
      if (!browserAllowed(await verifyBrowser())) {
        return NextResponse.json({ error: 'This request could not be verified as coming from a browser.', needsKey: tier === 'trial' }, { status: tier === 'trial' ? 401 : 403 });
      }
      if (tier === 'trial' && visitor.fresh) responseHeaders['Set-Cookie'] = visitorCookieHeader(visitor.id, isSecureRequest(req));
      const verdict = await reserveOwnerSpend(req, sessionId, 'ingest', tier, visitor.id);
      if (!verdict.allowed) {
        const message = refusalMessage(verdict, 'ingest', tier, credential.provider === 'openai' ? 'OpenAI' : 'Gemini');
        return NextResponse.json({ error: message, needsKey: tier === 'trial' }, { status: tier === 'trial' ? 401 : 429, headers: responseHeaders });
      }
      refundable = true;
    }
    const visionPages = visionPagesFor(tier);
    const maxChars = tier === 'trial' ? Math.min(trialCaps().maxChars, MAX_TEXT_CHARS) : MAX_TEXT_CHARS;

    const contentType = req.headers.get('content-type') ?? '';
    let filename: string;
    let mime: string;
    let parsed: Awaited<ReturnType<typeof parseUpload>>;

    try {
      if (contentType.includes('multipart/form-data')) {
        const form = await req.formData();
        const file = form.get('file');
        if (!(file instanceof File)) return await refuse({ error: 'No file was attached.' }, 400);
        filename = file.name;
        mime = file.type || 'application/octet-stream';
        parsed = await parseUpload(file, { allowVision: visionPages > 0 });
        // From here a model may be called; the unit is spent whatever happens next.
        if (visionPages > 0 && (parsed.sourceKind === 'pdf' || parsed.sourceKind === 'image')) refundable = false;
        parsed = await applyVision(parsed, filename, credential, deadline, req.signal, visionPages);
      } else {
        const body = (await req.json()) as { text?: string; title?: string };
        parsed = parsePastedText(body.text ?? '');
        filename = (body.title ?? '').trim() || 'Pasted text';
        mime = 'text/plain';
      }
    } catch (error) {
      await refund();
      throw error;
    }

    // Stripped before chunking, so a pasted key never reaches an embedding call
    // or a stored passage.
    parsed = { ...parsed, text: redactApiKeys(parsed.text) };

    if (parsed.text.length > maxChars) {
      return await refuse(
        {
          error:
            tier === 'trial'
              ? `That document is ${Math.round(parsed.text.length / 1000)}k characters of text; the free trial takes up to ${Math.round(maxChars / 1000)}k. Try a shorter one, or add your own key for the full ${MAX_TEXT_CHARS / 1000}k.`
              : `That file expands to ${Math.round(parsed.text.length / 1000)}k characters of text; the limit is ${MAX_TEXT_CHARS / 1000}k. Try a shorter document.`,
        },
        413,
      );
    }

    const contentHash = createHash('sha256').update(parsed.text).digest('hex');

    // Seed runs are idempotent: an unchanged document is reported, not re-embedded.
    // This is what makes a retried seed cheap after an embedding quota failure.
    if (seeding) {
      const { data: existing } = await supabase()
        .from('documents')
        .select('id, filename, source_kind, page_count, char_count, chunk_count, outline, created_at')
        .eq('session_id', SEED_SESSION_ID)
        .eq('filename', filename)
        .eq('content_hash', contentHash)
        .limit(1);
      if (existing?.[0]) return NextResponse.json({ document: existing[0], notes: [], unchanged: true });
    }

    const { chunks, outline: detected } = chunkDocument(parsed.text, { hasPages: parsed.sourceKind === 'pdf' });

    trace.update({
      output: { filename, chunks: chunks.length },
      metadata: { sourceKind: parsed.sourceKind, pages: parsed.pageCount, chars: parsed.text.length, chunks: chunks.length },
    });

    // Parser warnings ride in the outline so `list_sections` surfaces them.
    const outline = [
      ...parsed.notes.map((note, index) => ({ heading: `Not indexed — ${note}`, ordinal: index, page: null })),
      ...detected,
    ];

    if (!chunks.length) return await refuse({ error: 'Nothing indexable was found in that document.' }, 422);
    if (chunks.length > MAX_CHUNKS) {
      return await refuse(
        { error: `That document splits into ${chunks.length} passages; the limit is ${MAX_CHUNKS} per upload, which is what a free embedding tier allows inside one request. Split it into smaller files.` },
        413,
      );
    }
    // Embedding is a model call; the unit is spent from here.
    refundable = false;

    const db = supabase();
    const { data: doc, error: docError } = await db
      .from('documents')
      .insert({
        session_id: sessionId,
        filename,
        mime,
        source_kind: parsed.sourceKind,
        page_count: parsed.pageCount,
        char_count: parsed.text.length,
        chunk_count: chunks.length,
        outline,
        content_hash: contentHash,
      })
      .select('id, filename, source_kind, page_count, char_count, chunk_count, outline, created_at')
      .single();

    if (docError || !doc) {
      console.error('ingest:insert-document', docError);
      return NextResponse.json({ error: 'Could not save the document. Is the database schema applied?' }, { status: 500 });
    }

    try {
      const span = trace.span({ name: 'embed-passages', input: { passages: chunks.length, dimensions: 768 } });
      // Heading prepended before embedding so the vector carries section context;
      // the stored passage stays clean.
      const vectors = await embedDocuments(
        credential,
        chunks.map((c) => (c.heading ? `${c.heading}\n\n${c.content}` : c.content)),
        { deadline },
      );
      span.end({ output: { embedded: chunks.length } });

      const rows = chunks.map((chunk, index) => ({
        document_id: doc.id,
        session_id: sessionId,
        ordinal: chunk.ordinal,
        heading: chunk.heading,
        page_from: chunk.pageFrom,
        page_to: chunk.pageTo,
        content: chunk.content,
        token_est: chunk.tokenEst,
        embedding: toVectorLiteral(vectors[index]),
      }));

      for (let start = 0; start < rows.length; start += 40) {
        const { error: chunkError } = await db.from('chunks').insert(rows.slice(start, start + 40));
        if (chunkError) throw new Error(chunkError.message);
      }
    } catch (error) {
      // A document row with no vectors would show in the sidebar and answer nothing.
      await db.from('documents').delete().eq('id', doc.id);
      throw error;
    }

    // after(): the beacon runs once the response is sent, so a serverless freeze
    // cannot cut it short and it never delays the reply.
    const host = req.headers.get('host');
    after(() => recordUsage('ingest', host));
    await trace.flush();
    return NextResponse.json({ document: doc, notes: parsed.notes }, { headers: responseHeaders });
  } catch (error) {
    if (error instanceof SessionError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof ParseError) return NextResponse.json({ error: error.message }, { status: 422 });
    if (error instanceof EmbedQuotaError) return NextResponse.json({ error: error.message, retryable: true }, { status: 429 });
    // Typed errors above keep their wording. What reaches here did not come from
    // this app and may describe schema, headers or paths — log it, say little.
    console.error('ingest:unhandled', error);
    trace.update({ metadata: { error: error instanceof Error ? error.message : 'unknown' } });
    await trace.flush();
    return NextResponse.json({ error: 'Could not index that document. Try again in a moment.' }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ maxUploadBytes: MAX_UPLOAD_BYTES, maxChunks: MAX_CHUNKS, parseMode: parseMode() });
}

/**
 * How many PDF pages the vision model may read for this upload. The owner's
 * own seeding gets the full VISION_MAX_PAGES; a visitor spending the owner's
 * key gets a small number (trusted) or, by default, none (trial). A visitor on
 * their own key spends their own quota and gets the full allowance.
 */
function visionPagesFor(tier: SpendTier | null): number {
  if (parseMode() === 'text') return 0;
  if (tier === 'trial') return Math.min(trialCaps().visionPages, maxVisionPages());
  if (tier === 'trusted') return Math.min(ownerBudget().visitorVisionPages, maxVisionPages());
  return maxVisionPages();
}

/**
 * The vision pass. Pages text extraction could not read properly (tables,
 * charts, figures, scans) are transcribed by the model into Markdown and
 * spliced back in place of their text layer; images become a description.
 * Any page the model fails on keeps its text layer, so an upload never fails
 * because vision did.
 */
async function applyVision(
  parsed: Awaited<ReturnType<typeof parseUpload>>,
  filename: string,
  credential: Parameters<typeof transcribePdfPages>[2]['credential'],
  deadline: number,
  signal: AbortSignal,
  visionPages: number,
): Promise<Awaited<ReturnType<typeof parseUpload>>> {
  const mode = parseMode();
  if (mode === 'text' || visionPages === 0) {
    if (parsed.sourceKind === 'image') {
      throw new ParseError('Images are read by the vision model, which is not part of the free trial here. Add your own key to index images, or upload a text document.');
    }
    return parsed;
  }

  if (parsed.sourceKind === 'image' && parsed.bytes) {
    const mimeType = imageMimeFor(filename);
    if (!mimeType) throw new ParseError('Unsupported image type. Accepted: PNG, JPEG, WebP.');
    const description = await describeImage(parsed.bytes, mimeType, { credential, signal, deadline });
    if (!description) throw new ParseError('The model could not describe that image.');
    return { ...parsed, text: description, bytes: undefined, notes: ['Indexed as a model-written description of the image.'] };
  }

  if (parsed.sourceKind !== 'pdf' || !parsed.bytes || !parsed.pages) return parsed;

  const allPages = parsed.pages.map((_, index) => index + 1);
  const wanted = (mode === 'rich' ? allPages : parsed.visionCandidates ?? []).slice(0, visionPages);
  if (!wanted.length) return { ...parsed, bytes: undefined };

  const { text, failed } = await transcribePdfPages(parsed.bytes, wanted, { credential, signal, deadline });
  const pages = parsed.pages.map((layer, index) => text.get(index + 1) ?? layer);
  const notes = [...parsed.notes.filter((note) => !/no extractable text/.test(note))];

  if (text.size) notes.push(`${text.size} page${text.size === 1 ? '' : 's'} transcribed with the vision model so tables, charts and figures are searchable.`);
  const stillBlank = failed.filter((page) => (parsed.pages?.[page - 1]?.length ?? 0) < SPARSE_PAGE_CHARS);
  if (stillBlank.length) notes.push(`${stillBlank.length} page${stillBlank.length === 1 ? '' : 's'} could not be transcribed (page ${stillBlank.join(', ')}) and ${stillBlank.length === 1 ? 'is' : 'are'} not indexed.`);
  const skipped = (mode === 'rich' ? allPages : parsed.visionCandidates ?? []).length - wanted.length;
  if (skipped > 0) notes.push(`${skipped} further page${skipped === 1 ? '' : 's'} with figures were left to text extraction (limit ${visionPages} vision pages per upload).`);

  return { ...parsed, text: pages.join(PAGE_BREAK), notes, bytes: undefined, pages: undefined };
}
