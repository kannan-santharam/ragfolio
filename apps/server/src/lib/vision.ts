import { chatModels, generateWithFallback } from './models';
import type { Attachment, Credential } from './providers';

/**
 * Vision parsing: what text extraction cannot see.
 *
 * `unpdf` returns the text layer of a PDF. Tables come out as a soup of cell
 * values in reading order, charts and figures come out as nothing, and a page
 * that is one big image comes out blank. For reports, decks and anything with
 * a graph, that is most of the document.
 *
 * So pages that need it are sent to the chat model one page at a time (as a
 * single-page PDF; both providers accept PDFs natively, so there is no
 * rasteriser and no native canvas dependency in the serverless bundle). The
 * model returns Markdown: tables as Markdown tables, charts and figures as a
 * `[Figure: …]` block that names the axes, series, key values and trend. That
 * Markdown is what gets chunked and embedded, so a question about "Q3 revenue
 * in the bar chart" can match a passage.
 *
 * No hand-written rules decide what a page means: by default (`rich`) every
 * PDF page is read by the model, and the text layer is only a fallback for a
 * page the model could not transcribe. `auto` is an opt-in economy mode that
 * sends only pages with images or little text; `text` disables vision.
 * Cost: one model call per transcribed page.
 */

export type ParseMode = 'auto' | 'rich' | 'text';

export function parseMode(): ParseMode {
  const raw = (process.env.PDF_PARSE_MODE ?? 'rich').trim().toLowerCase();
  return raw === 'auto' || raw === 'text' ? raw : 'rich';
}

/** Ceiling on vision calls per upload; each is a model request against the key's quota. */
export function maxVisionPages(): number {
  const parsed = Number(process.env.VISION_MAX_PAGES);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 20;
}

/** Below this many characters of text, a page is probably a figure, a scan, or a slide. */
export const SPARSE_PAGE_CHARS = 200;

const PAGE_PROMPT = `Transcribe this document page to Markdown, faithfully and completely.

Rules:
- Keep headings as Markdown headings and preserve reading order.
- Reproduce every table as a Markdown table with a header row. Keep all cell values exactly, including units and footnote markers.
- For every chart, graph or diagram, write a block starting with "[Figure:" that states its title, the axes and units, each series, the notable values (highest, lowest, latest, totals) and the trend in one or two sentences. Close the block with "]".
- For photographs or illustrations, write "[Image: ...]" with a one-sentence description and any visible text.
- Transcribe captions, labels and footnotes.
- Do not summarise, interpret beyond what is shown, or add commentary. If the page is blank, output "[blank page]".`;

const IMAGE_PROMPT = `Describe this image for a search index. Start with "[Image:" and end with "]". If it contains a table, reproduce it as a Markdown table. If it is a chart or graph, name the title, axes and units, each series, the notable values and the trend. Transcribe any visible text verbatim. Do not add commentary.`;

export interface VisionOptions {
  credential: Credential;
  signal?: AbortSignal;
  deadline?: number;
}

/** Splits one PDF into single-page PDFs for the given page numbers (1-based). */
async function singlePagePdfs(bytes: Uint8Array, pages: number[]): Promise<Map<number, string>> {
  const { PDFDocument } = await import('pdf-lib');
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = new Map<number, string>();
  for (const page of pages) {
    const doc = await PDFDocument.create();
    const [copied] = await doc.copyPages(source, [page - 1]);
    doc.addPage(copied);
    const saved = await doc.save({ useObjectStreams: true });
    out.set(page, Buffer.from(saved).toString('base64'));
  }
  return out;
}

/**
 * Transcribes the requested pages with the vision model, a few at a time.
 * Returns Markdown per page; a page whose call failed is absent so the caller
 * can fall back to its text layer.
 */
export async function transcribePdfPages(
  bytes: Uint8Array,
  pages: number[],
  { credential, signal, deadline }: VisionOptions,
): Promise<{ text: Map<number, string>; failed: number[] }> {
  const models = chatModels(credential.provider);
  const encoded = await singlePagePdfs(bytes, pages);
  const text = new Map<number, string>();
  const failed: number[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < pages.length) {
      const page = pages[cursor++];
      if (deadline && Date.now() > deadline) {
        failed.push(page);
        continue;
      }
      const attachment: Attachment = { mime: 'application/pdf', data: encoded.get(page)!, filename: `page-${page}.pdf` };
      try {
        const markdown = await generateWithFallback({ credential, models, prompt: PAGE_PROMPT, attachments: [attachment], signal });
        if (markdown.trim()) text.set(page, markdown.trim());
        else failed.push(page);
      } catch (error) {
        console.error('vision:page-failed', page, error instanceof Error ? error.message : error);
        failed.push(page);
      }
    }
  }

  // Three in flight: enough to finish a 20-page report inside a function
  // timeout, few enough to stay under free-tier per-minute request caps.
  await Promise.all(Array.from({ length: Math.min(3, pages.length) }, worker));
  return { text, failed };
}

export async function describeImage(
  bytes: Uint8Array,
  mime: Attachment['mime'],
  { credential, signal }: VisionOptions,
): Promise<string> {
  const models = chatModels(credential.provider);
  const description = await generateWithFallback({
    credential,
    models,
    prompt: IMAGE_PROMPT,
    attachments: [{ mime, data: Buffer.from(bytes).toString('base64') }],
    maxOutputTokens: 2048,
    signal,
  });
  return description.trim();
}
