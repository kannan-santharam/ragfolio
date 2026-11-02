import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import {
  CliError,
  SEED_SESSION_ID,
  bold,
  dim,
  flagString,
  green,
  log,
  normaliseUrl,
  readEnvFile,
  red,
  retrySeconds,
  sleep,
  stripExcluded,
  yellow,
  type ParsedArgs,
} from './util.js';

const SUPPORTED = new Set(['.pdf', '.docx', '.txt', '.md', '.markdown']);
const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
};
const MAX_ATTEMPTS = 5;

interface IngestResponse {
  document?: { id: string; filename: string; chunk_count: number };
  notes?: string[];
  unchanged?: boolean;
  error?: string;
  retryable?: boolean;
}

async function resolveToken(args: ParsedArgs): Promise<string> {
  const direct = flagString(args.flags, 'token');
  if (direct) return direct;
  if (process.env.SEED_TOKEN?.trim()) return process.env.SEED_TOKEN.trim();

  const envPath = flagString(args.flags, 'env') ?? resolve('.env.local');
  const env = await readEnvFile(envPath);
  if (env?.SEED_TOKEN) return env.SEED_TOKEN;

  throw new CliError(
    'No seed token found. Pass --token, set SEED_TOKEN, or point --env at a file that defines it. ' +
      'It must match the SEED_TOKEN configured on the deployment.',
  );
}

async function collect(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    throw new CliError(`Cannot read folder ${dir}.`);
  }
  return entries
    .filter((entry) => !entry.startsWith('.') && entry !== 'README.md' && SUPPORTED.has(extname(entry).toLowerCase()))
    .sort()
    .map((entry) => join(dir, entry));
}

async function listSeeded(appUrl: string, headers: Record<string, string>) {
  try {
    const response = await fetch(`${appUrl}/api/documents`, { headers, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return [] as { id: string; filename: string }[];
    const payload = (await response.json()) as { documents?: { id: string; filename: string }[] };
    return payload.documents ?? [];
  } catch {
    return [] as { id: string; filename: string }[];
  }
}

async function removeById(appUrl: string, headers: Record<string, string>, id: string): Promise<boolean> {
  try {
    const response = await fetch(`${appUrl}/api/documents?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function countdown(seconds: number, reason: string) {
  for (let left = seconds; left > 0; left--) {
    process.stdout.write(`\r  ${yellow('⏳')} ${reason} — retrying in ${String(left).padStart(3)}s `);
    await sleep(1000);
  }
  process.stdout.write('\r' + ' '.repeat(80) + '\r');
}

type Outcome = 'seeded' | 'unchanged' | 'failed' | 'stop';

async function ingestOne(
  appUrl: string,
  headers: Record<string, string>,
  path: string,
  existing: { id: string; filename: string }[],
): Promise<Outcome> {
  const title = basename(path);
  const ext = extname(title).toLowerCase();
  const name = title.replace(/\.(md|markdown)$/i, '');

  let bytes: Uint8Array = await readFile(path);
  let removed = 0;
  if (ext === '.md' || ext === '.markdown') {
    const stripped = stripExcluded(Buffer.from(bytes).toString('utf8'));
    removed = stripped.removed;
    bytes = Buffer.from(stripped.text, 'utf8');
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const form = new FormData();
    form.append('file', new File([bytes as BlobPart], title, { type: MIME[ext] ?? 'application/octet-stream' }));

    let response: Response;
    try {
      response = await fetch(`${appUrl}/api/ingest`, {
        method: 'POST',
        headers,
        body: form,
        signal: AbortSignal.timeout(90_000),
      });
    } catch {
      log(`  ${red('✗')} ${name} — network error reaching ${appUrl}`);
      if (attempt === MAX_ATTEMPTS) return 'failed';
      await countdown(10, 'network error');
      continue;
    }

    const payload = (await response.json().catch(() => ({}))) as IngestResponse;

    if (response.ok && payload.unchanged) {
      log(`  ${dim('=')} ${name} — unchanged, skipped`);
      return 'unchanged';
    }

    if (response.ok && payload.document) {
      const doc = payload.document;
      const superseded = existing.filter((d) => d.filename === title && d.id !== doc.id);
      let replaced = 0;
      for (const old of superseded) if (await removeById(appUrl, headers, old.id)) replaced++;
      log(
        `  ${green('✓')} ${name} — ${doc.chunk_count} passages` +
          (replaced ? ' (replaced previous copy)' : '') +
          (removed ? `, ${removed} section${removed === 1 ? '' : 's'} withheld` : ''),
      );
      for (const note of payload.notes ?? []) log(`      ${dim('note:')} ${note}`);
      return 'seeded';
    }

    if (response.status === 401 || response.status === 403) {
      log(`  ${red('✗')} ${name} — ${payload.error ?? `HTTP ${response.status}`}`);
      return 'stop';
    }

    if (response.status === 429) {
      const wait = retrySeconds(payload.error);
      if (attempt === MAX_ATTEMPTS) {
        log(`  ${red('✗')} ${name} — still rate-limited after ${MAX_ATTEMPTS} attempts. Re-run later; seeded files are skipped.`);
        return 'failed';
      }
      await countdown(wait, 'embedding rate limit');
      continue;
    }

    log(`  ${red('✗')} ${name} — ${payload.error ?? `HTTP ${response.status}`}`);
    return 'failed';
  }
  return 'failed';
}

export async function seed(args: ParsedArgs): Promise<void> {
  const dir = resolve(args.positional[0] ?? 'docs');
  const appUrl = normaliseUrl(flagString(args.flags, 'url'));
  const token = await resolveToken(args);
  const headers = { 'x-session-id': SEED_SESSION_ID, 'x-seed-token': token };

  const files = await collect(dir);
  if (!files.length) {
    throw new CliError(`No .pdf, .docx, .txt or .md files found in ${dir}.`);
  }

  log(bold(`Seeding ${files.length} document${files.length === 1 ? '' : 's'} → ${appUrl}`));
  log(dim('  One at a time; the server paces embedding under the provider\'s per-minute quota.'));
  log();

  // Documents are left in place until their replacements are indexed, so a
  // failed run never leaves visitors with an empty corpus.
  const existing = await listSeeded(appUrl, headers);

  let seeded = 0;
  let unchanged = 0;
  let failed = 0;
  let stopped = false;

  for (const file of files) {
    const outcome = await ingestOne(appUrl, headers, file, existing);
    if (outcome === 'seeded') seeded++;
    else if (outcome === 'unchanged') unchanged++;
    else if (outcome === 'failed') failed++;
    else {
      stopped = true;
      break;
    }
  }

  log();
  if (stopped) {
    throw new CliError(
      'Stopped: the deployment rejected the seed token. Make sure SEED_TOKEN is set on the deployment ' +
        'and that the same value is passed here via --token, SEED_TOKEN or your .env.local.',
    );
  }
  const summary = `${seeded} seeded, ${unchanged} unchanged, ${failed} failed.`;
  if (failed) throw new CliError(`${summary} Re-run to retry the failures; unchanged files are skipped.`);
  log(green(`✓ ${summary}`));
}
