import { PAGE_BREAK } from './parse';
import type { OutlineEntry } from './types';

export interface Chunk {
  ordinal: number;
  heading: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  content: string;
  tokenEst: number;
}

/** Gemini averages ~4 characters per token on English prose. Good enough for sizing. */
const CHARS_PER_TOKEN = 4;
const TARGET_CHARS = 1100;
const MAX_CHARS = 1800;
const OVERLAP_CHARS = 180;

const HEADING_RE = /^(#{1,6})\s+(.{1,120})$/;

interface Block {
  text: string;
  heading: string | null;
  page: number | null;
}

/**
 * Split into paragraph blocks while tracking the current markdown heading and
 * the page the block came from.
 */
function toBlocks(text: string, hasPages: boolean): Block[] {
  const blocks: Block[] = [];
  const pages = hasPages ? text.split(PAGE_BREAK) : [text];

  pages.forEach((pageText, pageIndex) => {
    const page = hasPages ? pageIndex + 1 : null;
    let heading: string | null = null;

    for (const paragraph of pageText.split(/\n\s*\n/)) {
      const trimmed = paragraph.trim();
      if (!trimmed) continue;

      const firstLine = trimmed.split('\n')[0].trim();
      const match = HEADING_RE.exec(firstLine);
      if (match) heading = match[2].trim();

      blocks.push({ text: trimmed, heading, page });
    }
  });

  return blocks;
}

/**
 * Hard-split a block that is on its own larger than MAX_CHARS, preferring
 * sentence boundaries so a chunk never ends mid-clause.
 */
function splitOversized(text: string): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?]*\s*/g) ?? [text];
  const out: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > MAX_CHARS && current) {
      out.push(current.trim());
      current = '';
    }
    // A single sentence longer than the cap: slice it bluntly.
    if (sentence.length > MAX_CHARS) {
      for (let i = 0; i < sentence.length; i += MAX_CHARS) {
        out.push(sentence.slice(i, i + MAX_CHARS).trim());
      }
      continue;
    }
    current += sentence;
  }

  if (current.trim()) out.push(current.trim());
  return out.filter(Boolean);
}

/**
 * Heading-aware chunking with a tail overlap.
 *
 * Blocks accumulate until the target size, then flush. The overlap carries the
 * last ~180 characters into the next chunk so a fact split across a boundary is
 * still retrievable from one side of it.
 */
export function chunkDocument(
  text: string,
  { hasPages }: { hasPages: boolean },
): { chunks: Chunk[]; outline: OutlineEntry[] } {
  const blocks = toBlocks(text, hasPages);
  const chunks: Chunk[] = [];
  const outline: OutlineEntry[] = [];
  const seenHeadings = new Set<string>();

  let buffer = '';
  let heading: string | null = null;
  let pageFrom: number | null = null;
  let pageTo: number | null = null;

  const flush = () => {
    const content = buffer.trim();
    if (!content) return;
    chunks.push({
      ordinal: chunks.length,
      heading,
      pageFrom,
      pageTo,
      content,
      tokenEst: Math.ceil(content.length / CHARS_PER_TOKEN),
    });
    // Carry a tail of the flushed chunk into the next one.
    buffer = content.length > OVERLAP_CHARS ? `${content.slice(-OVERLAP_CHARS)}\n\n` : '';
    pageFrom = pageTo;
  };

  for (const block of blocks) {
    if (block.heading && !seenHeadings.has(block.heading)) {
      seenHeadings.add(block.heading);
      outline.push({
        heading: block.heading,
        ordinal: chunks.length,
        page: block.page,
      });
    }

    // A new heading is a natural boundary — do not blend two sections together.
    if (block.heading !== heading && buffer.trim().length > TARGET_CHARS / 2) flush();
    heading = block.heading;

    if (pageFrom === null) pageFrom = block.page;
    pageTo = block.page;

    const pieces =
      block.text.length > MAX_CHARS ? splitOversized(block.text) : [block.text];

    for (const piece of pieces) {
      if (buffer.length + piece.length > TARGET_CHARS && buffer.trim()) flush();
      buffer += `${piece}\n\n`;
      if (buffer.length >= MAX_CHARS) flush();
    }
  }

  flush();

  // The overlap tail can leave a final chunk that is nothing but duplicated text.
  const last = chunks[chunks.length - 1];
  if (chunks.length > 1 && last && last.content.length <= OVERLAP_CHARS + 8) {
    chunks.pop();
  }

  return { chunks, outline: outline.slice(0, 60) };
}
