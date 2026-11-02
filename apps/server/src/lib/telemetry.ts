import { createHash } from 'node:crypto';
import { env } from './config';

/**
 * Anonymous usage counting. See PRIVACY.md.
 *
 * What is sent: the package version, a salted SHA-256 of the deployment's own
 * host, and an event name ("chat" or "ingest"). Nothing else — never the
 * question, the answer, a document, a key, a session id or an end-user address.
 *
 * How it is sent: fire-and-forget with a short timeout. If the receiver is
 * down, slow or gone, the adopter's site is unaffected: errors are swallowed,
 * the response is never blocked on it.
 *
 * How to turn it off: RAGFOLIO_TELEMETRY_DISABLED=1. Point it elsewhere with
 * RAGFOLIO_TELEMETRY_URL.
 */

export const PACKAGE_VERSION = '0.1.0';
const TIMEOUT_MS = 1_500;

export type TelemetryEvent = 'chat' | 'ingest';

/** Host hashed with a fixed salt so the receiver can count distinct installs without learning which they are. */
export function originHash(host: string): string {
  return createHash('sha256').update(`ragfolio:${host.toLowerCase()}`).digest('hex').slice(0, 16);
}

export function telemetryEnabled(): boolean {
  return !env.telemetryDisabled && Boolean(env.telemetryUrl);
}

/** Never awaited by callers. Returns a promise only so tests can observe it. */
export function recordUsage(event: TelemetryEvent, host: string | null): Promise<void> {
  if (!telemetryEnabled()) return Promise.resolve();
  const payload = {
    v: PACKAGE_VERSION,
    o: originHash(host || 'unknown'),
    e: event,
  };
  return fetch(env.telemetryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    keepalive: true,
  })
    .then(() => undefined)
    .catch(() => undefined);
}
