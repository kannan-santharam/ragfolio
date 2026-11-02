import type { NextRequest } from 'next/server';
import { env } from './config';

/**
 * Two faces, one deployment.
 *
 * Through a trusted origin (the owner's own site) the assistant is theirs:
 * the preloaded documents are in scope and the contact details inside them
 * may be shared. At its own public URL it is a blank document Q&A tool —
 * nothing preloaded, contact details stripped — because there it is an
 * endpoint anyone, and anything, can talk to.
 *
 * Redaction happens at retrieval, not in the prompt. A system instruction
 * saying "do not share the phone number" still puts the number in the model's
 * context, one clever question away from coming back out. Here the passage is
 * rewritten before it reaches the model and before it reaches the citation
 * panel, so there is nothing to extract.
 *
 * Be clear about what origin trust is: a disclosure PREFERENCE, not an access
 * control. `x-embed-origin` is derived from `document.referrer` and a determined
 * visitor can forge it. What it stops is casual scraping. The browser-enforced
 * control is the CSP `frame-ancestors` header built from the same list. Anyone
 * gating something that matters on this needs real authentication.
 */

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * Deliberately loose: a digit, then a run of digits and separators, then a
 * digit. `looksLikePhone` does the real filtering so years, spec counts and
 * version strings survive.
 */
const PHONE = /(?:\+\d{1,3}[ .-]?)?\d[\d .()-]{6,18}\d/g;

export const CONTACT_PLACEHOLDER = '[contact details shared via the owner\'s site]';

function looksLikePhone(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return false;
  return /[\s.+()-]/.test(candidate) || candidate.startsWith('+') || digits.length >= 11;
}

export function redactContactDetails(text: string): string {
  return text
    .replace(EMAIL, CONTACT_PLACEHOLDER)
    .replace(PHONE, (match) => (looksLikePhone(match) ? CONTACT_PLACEHOLDER : match));
}

/**
 * Provider API keys as they appear in pasted text.
 *
 * Google: `AIza` + 35 chars (legacy) or a short dotted prefix + long body
 * (current). OpenAI: `sk-` followed by a long token, project keys included.
 * Narrow on purpose — a generic "long random token" rule would mangle documents
 * full of hashes and commit ids. This exists to catch one accident: a visitor
 * pasting a config file containing their own key, which would otherwise be
 * chunked, embedded and stored permanently.
 */
const API_KEY = /\b(?:AIza[0-9A-Za-z_-]{35}|A[A-Za-z0-9]{1,3}\.[A-Za-z0-9_-]{30,120}|sk-[A-Za-z0-9_-]{20,200})\b/g;

const KEY_PLACEHOLDER = '[API key removed before indexing]';

/** Applied at ingest before chunking, and to everything on its way to a tracing sink. */
export function redactApiKeys(text: string): string {
  return text.replace(API_KEY, KEY_PLACEHOLDER);
}

/** Deep-scrubs a value bound for a third-party observability sink. Plain objects only. */
export function redactApiKeysDeep<T>(value: T): T {
  if (typeof value === 'string') return redactApiKeys(value) as unknown as T;
  if (Array.isArray(value)) return value.map(redactApiKeysDeep) as unknown as T;
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactApiKeysDeep(v)]),
    ) as unknown as T;
  }
  return value;
}

export function containsContactDetails(text: string): boolean {
  return redactContactDetails(text) !== text;
}

/**
 * The browser reports the top-level page it is running under — its own origin
 * normally, the parent's when embedded in an iframe. Matched against
 * TRUSTED_ORIGINS, which also builds the CSP frame-ancestors in next.config.ts.
 * One list, deliberately — two would drift. Unset means nothing is trusted.
 */
export function isTrustedOrigin(req: NextRequest): boolean {
  const allowed = env.trustedOrigins;
  if (!allowed.length) return false;
  const claimed = (req.headers.get('x-embed-origin') ?? '').trim().replace(/\/+$/, '').toLowerCase();
  return Boolean(claimed) && allowed.includes(claimed);
}

/** Passage text as the model and the citation panel may see it for this visitor. */
export function passageForVisitor(content: string, trusted: boolean): string {
  return trusted || !env.redactContacts ? content : redactContactDetails(content);
}
