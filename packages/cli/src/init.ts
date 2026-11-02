import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CliError,
  bold,
  createPrompter,
  cyan,
  dim,
  expandOrigins,
  flagBool,
  flagString,
  formatEnvValue,
  green,
  log,
  yellow,
  type ParsedArgs,
  type Prompter,
} from './util.js';

type Provider = 'gemini' | 'openai';

const KEY_HELP: Record<Provider, string> = {
  gemini: 'https://aistudio.google.com/apikey',
  openai: 'https://platform.openai.com/api-keys',
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Ships at the package root; in-repo dev falls back to the server's copy. */
export async function schemaPath(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', 'schema.sql'),
    resolve(here, '..', '..', '..', 'apps', 'server', 'supabase', 'schema.sql'),
    resolve(here, '..', '..', 'apps', 'server', 'supabase', 'schema.sql'),
  ];
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  throw new CliError('schema.sql not found alongside the package.');
}

async function applySchema(connectionString: string): Promise<void> {
  const sql = await readFile(await schemaPath(), 'utf8');
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString,
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    await client.query(sql);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Flag value if given, otherwise prompt. Lets CI run `init` without a TTY. */
async function answer(
  prompter: Prompter | null,
  args: ParsedArgs,
  flag: string,
  question: string,
  options: { defaultValue?: string; required?: boolean } = {},
): Promise<string> {
  const given = flagString(args.flags, flag);
  if (given !== undefined) return given.trim();
  if (!prompter) {
    if (options.defaultValue !== undefined) return options.defaultValue;
    if (options.required) throw new CliError(`--${flag} is required when running non-interactively.`);
    return '';
  }
  return prompter.ask(question, options);
}

export async function init(args: ParsedArgs): Promise<void> {
  const outDir = resolve(flagString(args.flags, 'out') ?? '.');
  const outFile = join(outDir, '.env.local');
  const force = flagBool(args.flags, 'force');
  const interactive = !flagBool(args.flags, 'yes') && process.stdin.isTTY === true;

  if ((await exists(outFile)) && !force) {
    throw new CliError(`${outFile} already exists. Re-run with --force to overwrite it.`);
  }

  const prompter = interactive ? createPrompter() : null;
  try {
    log(bold('Ragfolio setup'));
    log(dim('  Answers are written to .env.local only. Nothing is sent anywhere.'));
    log();

    // (a) provider
    let provider = (await answer(prompter, args, 'provider', 'Provider — gemini (free tier) or openai', { defaultValue: 'gemini' })).toLowerCase();
    if (provider !== 'gemini' && provider !== 'openai') throw new CliError('Provider must be "gemini" or "openai".');
    const chosen = provider as Provider;

    // (b) key
    log(dim(`  Get a key at ${KEY_HELP[chosen]}`));
    const apiKey = await answer(prompter, args, 'key', `${chosen === 'gemini' ? 'Gemini' : 'OpenAI'} API key`, { required: true });
    if (/\s/.test(apiKey)) throw new CliError('The API key contains whitespace. Paste it as a single line.');

    // (c) supabase
    log();
    log(dim('  Supabase → Project Settings → API'));
    const supabaseUrl = (await answer(prompter, args, 'supabase-url', 'SUPABASE_URL', { required: true }))
      .replace(/\/+$/, '')
      .replace(/\/rest\/v1$/, '');
    const serviceKey = await answer(prompter, args, 'supabase-key', 'SUPABASE_SERVICE_ROLE_KEY (service_role, not anon)', { required: true });

    // (d) schema
    log();
    log(dim('  Optional: a Postgres connection string lets this command apply the schema for you.'));
    log(dim('  Supabase → Connect → Session pooler / Direct connection URI.'));
    const databaseUrl = await answer(prompter, args, 'database-url', 'DATABASE_URL (leave blank to skip)');
    let schemaApplied = false;
    if (databaseUrl) {
      process.stdout.write('  Applying schema… ');
      try {
        await applySchema(databaseUrl);
        schemaApplied = true;
        log(green('done'));
      } catch (error) {
        log(yellow('failed'));
        log(yellow(`  ${error instanceof Error ? error.message : String(error)}`));
        log(yellow('  Paste the SQL manually instead (path printed below).'));
      }
    }

    // (e) names
    log();
    const ownerName = await answer(prompter, args, 'owner', 'Your name, as the assistant should refer to you');
    const assistantName = await answer(prompter, args, 'assistant', 'Assistant name', { defaultValue: 'Assistant' });
    const questions = (await answer(prompter, args, 'questions', 'Up to 4 suggested questions, comma-separated (optional)'))
      .split(',')
      .map((q) => q.trim())
      .filter(Boolean)
      .slice(0, 4);

    // (f) origins
    log();
    log(dim('  The site(s) that will embed the widget. Apex and www are both added automatically.'));
    const siteInput = await answer(prompter, args, 'origins', 'Your site origin(s), comma-separated (e.g. https://jane.dev)');
    const origins = expandOrigins([
      ...siteInput.split(',').map((s) => s.trim()).filter(Boolean),
      'http://localhost:5173',
      'http://localhost:3000',
    ]);

    // (g) the public URL
    log();
    log(dim('  At its own URL the widget can give visitors a small free trial on your key'));
    log(dim('  (default: 1 document and 10 questions a day each, 100 questions a day in total)'));
    log(dim('  before asking for their own key. Metered, and only from a real browser.'));
    const accessFlag = flagString(args.flags, 'public-access');
    const publicAccess =
      accessFlag !== undefined
        ? accessFlag.trim().toLowerCase()
        : prompter
          ? (await prompter.confirm('  Offer visitors a free trial on your key?', true))
            ? 'trial'
            : 'byok'
          : 'trial';
    if (!['trial', 'byok', 'closed'].includes(publicAccess)) throw new CliError('--public-access must be trial, byok or closed.');

    // (h) secrets
    const seedToken = randomBytes(32).toString('base64url');
    const rateLimitSalt = randomBytes(32).toString('base64url');

    // (i) telemetry
    log();
    log(dim('  Ragfolio counts usage anonymously: package version, a hashed host name and an event name.'));
    log(dim('  Never questions, answers, documents, keys or visitor addresses. Opt out any time with RAGFOLIO_TELEMETRY_DISABLED=1.'));
    const telemetryFlag = flagString(args.flags, 'telemetry');
    const telemetry =
      telemetryFlag !== undefined ? !['false', '0', 'no', 'off'].includes(telemetryFlag.toLowerCase()) : prompter ? await prompter.confirm('  Keep anonymous usage counts on?', true) : true;

    const lines: [string, string][] = [
      ['RAG_PROVIDER', chosen],
      ['GEMINI_API_KEY', chosen === 'gemini' ? apiKey : ''],
      ['OPENAI_API_KEY', chosen === 'openai' ? apiKey : ''],
      ['SUPABASE_URL', supabaseUrl],
      ['SUPABASE_SERVICE_ROLE_KEY', serviceKey],
      ['OWNER_NAME', ownerName],
      ['ASSISTANT_NAME', assistantName],
      ['SUGGESTED_QUESTIONS', questions.join(',')],
      ['TRUSTED_ORIGINS', origins.join(',')],
      ['PUBLIC_ACCESS', publicAccess],
      ['SEED_TOKEN', seedToken],
      ['RATE_LIMIT_SALT', rateLimitSalt],
      ['RAGFOLIO_TELEMETRY_DISABLED', telemetry ? '' : '1'],
    ];

    const body =
      `# Generated by \`npx ragfolio init\` on ${new Date().toISOString()}\n` +
      '# Keep this file out of git. Add the same values to your Vercel project.\n\n' +
      lines.map(([key, value]) => `${key}=${formatEnvValue(value)}`).join('\n') +
      '\n';

    await mkdir(outDir, { recursive: true });
    await writeFile(outFile, body, { mode: 0o600 });

    log();
    log(green(`✓ Wrote ${outFile}`));
    log();
    if (!schemaApplied) {
      log(bold('Database schema'));
      log(`  Paste ${cyan(await schemaPath())}`);
      log('  into Supabase → SQL Editor → New query, and run it once.');
      log();
    }
    if (publicAccess === 'trial') {
      log(bold('Free trial'));
      log('  Trial ceiling: TRIAL_DAILY_CHATS=100, TRIAL_DAILY_INGESTS=10. Your own site: OWNER_DAILY_CHATS=200,');
      log('  OWNER_DAILY_INGESTS=20. Adjust in .env.local; see docs/SETUP.md §6a.');
      log();
    }
    log(bold('Environment variables to add in Vercel (Project → Settings → Environment Variables):'));
    for (const [key, value] of lines) if (value) log(`  ${key}`);
    log();
    log(bold('Next steps'));
    log(`  1. Deploy the app (Deploy button in the README, or ${cyan('vercel')} from apps/server).`);
    log(`  2. ${cyan('npx ragfolio seed ./docs --url https://your-app.vercel.app')}`);
    log(`  3. ${cyan('npx ragfolio snippet --url https://your-app.vercel.app')} and paste the tag into your site.`);
  } finally {
    prompter?.close();
  }
}
