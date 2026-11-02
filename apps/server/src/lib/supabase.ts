import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './config';

let cached: SupabaseClient | null = null;

/**
 * Service-role Supabase client. Server-side only.
 *
 * Cached across warm serverless invocations — supabase-js is HTTP-based
 * (PostgREST), so there is no connection pool to exhaust the way a direct
 * Postgres driver would.
 */
export function supabase(): SupabaseClient {
  if (!cached) {
    cached = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/**
 * pgvector's text input format. supabase-js serialises a JS number array as a
 * JSON array, which PostgREST does not reliably cast to `vector`. The bracketed
 * string is pgvector's own literal syntax and casts cleanly everywhere.
 */
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}
