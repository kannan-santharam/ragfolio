'use client';

import { Fragment, type ReactNode } from 'react';

/**
 * A small streaming-safe markdown renderer.
 *
 * Deliberately not a library: the text arrives token by token, so the renderer
 * has to cope with a half-written `**bold` or an unclosed code fence on every
 * frame. It handles the subset a grounded answer actually uses — headings,
 * lists, code, emphasis, blockquotes — plus [1]-style citation markers.
 */

interface MarkdownProps {
  content: string;
  onCitationClick?: (marker: number) => void;
}

// Citations arrive as [1], [2][3], or — the model does this unprompted — [1, 5].
// Each bracket group becomes its own match; the digits inside become the chips.
const INLINE_RE = /(\*\*[^*]*\*\*?|`[^`]*`?|\*[^*\n]+\*|\[\d+(?:\s*,\s*\d+)*\])/g;

function renderCitationGroup(
  token: string,
  key: string,
  onCitationClick?: (marker: number) => void,
): ReactNode {
  const markers = token.match(/\d+/g)?.map(Number) ?? [];
  return (
    <Fragment key={key}>
      {markers.map((marker) => (
        <button
          key={marker}
          type="button"
          onClick={() => onCitationClick?.(marker)}
          title={`Jump to source ${marker}`}
          className="mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] translate-y-[-1px] items-center justify-center rounded-md border border-[var(--border-accent)] bg-[var(--color-primary)]/12 px-1 align-middle font-mono text-[0.65rem] font-bold text-[var(--color-cyan)] transition-colors hover:bg-[var(--color-primary)]/25"
        >
          {marker}
        </button>
      ))}
    </Fragment>
  );
}

function renderInline(text: string, onCitationClick?: (marker: number) => void): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;

  while ((match = INLINE_RE.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    const key = `${match.index}`;

    if (token.startsWith('[')) {
      nodes.push(renderCitationGroup(token, key, onCitationClick));
    } else if (token.startsWith('**')) {
      // An unclosed `**` mid-stream still renders bold rather than as literal stars.
      nodes.push(
        <strong key={key}>{token.replace(/^\*\*/, '').replace(/\*\*$/, '')}</strong>,
      );
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.replace(/^`/, '').replace(/`$/, '')}</code>);
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

type Block =
  | { kind: 'p' | 'h1' | 'h2' | 'h3' | 'quote'; lines: string[] }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'code'; lines: string[] };

function toBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index++;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const body: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        body.push(lines[index]);
        index++;
      }
      index++; // closing fence (may never arrive while streaming)
      blocks.push({ kind: 'code', lines: body });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = Math.min(heading[1].length, 3);
      blocks.push({ kind: `h${level}` as 'h1' | 'h2' | 'h3', lines: [heading[2]] });
      index++;
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
      const ordered = /^\d+[.)]\s+/.test(trimmed);
      const items: string[] = [];
      while (index < lines.length) {
        const candidate = lines[index].trim();
        const isBullet = ordered ? /^\d+[.)]\s+/.test(candidate) : /^[-*•]\s+/.test(candidate);
        if (!isBullet) break;
        items.push(candidate.replace(/^([-*•]|\d+[.)])\s+/, ''));
        index++;
      }
      blocks.push({ kind: ordered ? 'ol' : 'ul', items });
      continue;
    }

    if (trimmed.startsWith('> ')) {
      const body: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('> ')) {
        body.push(lines[index].trim().slice(2));
        index++;
      }
      blocks.push({ kind: 'quote', lines: body });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index].trim();
      if (
        !candidate ||
        candidate.startsWith('```') ||
        candidate.startsWith('> ') ||
        /^#{1,6}\s/.test(candidate) ||
        /^[-*•]\s+/.test(candidate) ||
        /^\d+[.)]\s+/.test(candidate)
      ) {
        break;
      }
      paragraph.push(candidate);
      index++;
    }
    blocks.push({ kind: 'p', lines: paragraph });
  }

  return blocks;
}

export function Markdown({ content, onCitationClick }: MarkdownProps) {
  const blocks = toBlocks(content);

  return (
    <div className="prose-answer">
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;

        if (block.kind === 'code') {
          return (
            <pre key={key}>
              <code>{block.lines.join('\n')}</code>
            </pre>
          );
        }

        if (block.kind === 'ul' || block.kind === 'ol') {
          const List = block.kind === 'ul' ? 'ul' : 'ol';
          const ordered = block.kind === 'ol';
          return (
            <List key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className="mt-[0.55em] shrink-0 font-mono text-[0.7rem] font-bold text-[var(--color-cyan)]"
                  >
                    {ordered ? `${itemIndex + 1}.` : '•'}
                  </span>
                  <span className="min-w-0 flex-1">{renderInline(item, onCitationClick)}</span>
                </li>
              ))}
            </List>
          );
        }

        if (block.kind === 'quote') {
          return (
            <blockquote key={key}>
              {renderInline(block.lines.join(' '), onCitationClick)}
            </blockquote>
          );
        }

        const text = 'lines' in block ? block.lines.join(' ') : '';
        if (block.kind === 'h1') return <h1 key={key}>{renderInline(text, onCitationClick)}</h1>;
        if (block.kind === 'h2') return <h2 key={key}>{renderInline(text, onCitationClick)}</h2>;
        if (block.kind === 'h3') return <h3 key={key}>{renderInline(text, onCitationClick)}</h3>;
        return <p key={key}>{renderInline(text, onCitationClick)}</p>;
      })}
    </div>
  );
}
