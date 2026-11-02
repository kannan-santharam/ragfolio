import { NextResponse } from 'next/server';
import { isConfigured, missingConfig, provider, publicConfig } from '@/lib/config';
import { chatModels } from '@/lib/models';
import { PACKAGE_VERSION, telemetryEnabled } from '@/lib/telemetry';
import { isTracingEnabled } from '@/lib/tracing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Present or absent only. Never the value — this endpoint is public. */
function present(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

/**
 * Lets the UI show a real setup message instead of a generic 500, lets
 * `npx ragfolio doctor` diagnose a deploy with one request, and tells the
 * browser what this install calls itself before it renders a word.
 */
export function GET() {
  let providerId: string;
  let configured = false;
  let missing: string[] = [];
  try {
    providerId = provider();
    configured = isConfigured();
    missing = missingConfig();
  } catch (error) {
    providerId = 'invalid';
    missing = ['RAG_PROVIDER'];
    console.error('status:provider', error);
  }

  return NextResponse.json({
    version: PACKAGE_VERSION,
    configured,
    provider: providerId,
    models: configured ? chatModels() : [],
    missing,
    tracing: isTracingEnabled(),
    telemetry: telemetryEnabled(),
    optional: {
      TRUSTED_ORIGINS: present('TRUSTED_ORIGINS'),
      SEED_TOKEN: present('SEED_TOKEN'),
      RATE_LIMIT_SALT: present('RATE_LIMIT_SALT'),
      LANGFUSE_PUBLIC_KEY: present('LANGFUSE_PUBLIC_KEY'),
      LANGFUSE_SECRET_KEY: present('LANGFUSE_SECRET_KEY'),
    },
    config: publicConfig(),
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
  });
}
