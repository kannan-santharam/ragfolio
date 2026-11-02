import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { env, provider as ownerProvider, type Provider } from './config';
import { isTrustedOrigin } from './privacy';
import { adapterFor, type Credential } from './providers';
import { canWriteSharedNamespace } from './session';

/**
 * Whose quota pays for this request.
 *
 * Through a trusted origin the assistant runs on the owner's key — a visitor to
 * the owner's site should not need a credential. At the public URL the visitor
 * brings their own (BYOK), because one free-tier key cannot absorb an unbounded
 * audience. ALLOW_VISITOR_KEYS=false closes the public URL instead.
 *
 * The visitor's key never leaves the request it arrived on: not written to the
 * database, not logged, not traced. Only a non-reversible fingerprint is kept,
 * to partition per-key caches so two visitors' keys never share state.
 */
export type KeySource = 'owner' | 'visitor';

export interface ResolvedKey extends Credential {
  source: KeySource;
}

/** Thrown when a request needs a visitor key and did not carry one. Routes turn it into 401 + needsKey. */
export class ApiKeyRequiredError extends Error {}

/** Thrown when the public URL is closed to visitors without a trusted origin. */
export class OriginNotAllowedError extends Error {}

export const BYOK_HEADER = 'x-provider-key';
/** Which vendor a visitor's key is for. Only honoured on the visitor path. */
export const PROVIDER_HEADER = 'x-provider';

function visitorProvider(req: NextRequest): Provider {
  const raw = (req.headers.get(PROVIDER_HEADER) ?? '').trim().toLowerCase();
  return raw === 'openai' || raw === 'gemini' ? raw : ownerProvider();
}

function fingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

/** Trusted origins and authorised seed writes spend the owner's key. */
function useOwnerKey(req: NextRequest): boolean {
  return isTrustedOrigin(req) || canWriteSharedNamespace(req);
}

export function resolveApiKey(req: NextRequest): ResolvedKey {
  if (useOwnerKey(req)) {
    const key = env.ownerKey;
    return { key, source: 'owner', fingerprint: fingerprint(key), provider: ownerProvider() };
  }

  if (!env.allowVisitorKeys) {
    throw new OriginNotAllowedError('This assistant only answers from the site it belongs to.');
  }

  const providerId = visitorProvider(req);
  const provider = adapterFor(providerId);
  const supplied = (req.headers.get(BYOK_HEADER) ?? '').trim();
  const hint = `Get a key at ${provider.keyHelpUrl}, then add it here to start asking questions. It stays in your browser.`;
  if (!supplied) {
    throw new ApiKeyRequiredError(`This page runs on your own ${provider.id === 'openai' ? 'OpenAI' : 'Gemini'} key. ${hint}`);
  }
  // Header-safety first: undici throws on an interior newline with a message
  // that echoes the whole value, and that message would travel into responses.
  if (!provider.isPlausibleKey(supplied)) {
    throw new ApiKeyRequiredError(`That does not look like a valid API key. Copy it again straight from the provider. ${hint}`);
  }
  return { key: supplied, source: 'visitor', fingerprint: fingerprint(supplied), provider: providerId };
}
