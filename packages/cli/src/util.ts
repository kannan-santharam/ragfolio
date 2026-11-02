import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export const SEED_SESSION_ID = '00000000-0000-4000-8000-000000000001';

// --- Output ------------------------------------------------------------------

const useColor = stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
export const bold = paint('1');
export const dim = paint('2');
export const green = paint('32');
export const yellow = paint('33');
export const red = paint('31');
export const cyan = paint('36');

export function log(line = ''): void {
  stdout.write(`${line}\n`);
}

export class CliError extends Error {
  constructor(message: string, public readonly exitCode = 1) {
    super(message);
  }
}

// --- Arguments ---------------------------------------------------------------

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

/** `--key value`, `--key=value`, `--flag`. Anything else is positional. */
export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[body] = next;
      i++;
    } else {
      flags[body] = true;
    }
  }
  return { positional, flags };
}

export function flagString(flags: ParsedArgs['flags'], name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

export function flagBool(flags: ParsedArgs['flags'], name: string): boolean {
  const value = flags[name];
  if (value === true) return true;
  if (typeof value === 'string') return !['false', '0', 'no'].includes(value.toLowerCase());
  return false;
}

/** Trailing slashes stripped, scheme required. */
export function normaliseUrl(raw: string | undefined, flagName = '--url'): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(value)) {
    throw new CliError(`${flagName} must be a full URL such as https://your-app.vercel.app`);
  }
  return value;
}

// --- Prompts -----------------------------------------------------------------

export interface Prompter {
  ask(question: string, options?: { defaultValue?: string; required?: boolean }): Promise<string>;
  confirm(question: string, defaultYes?: boolean): Promise<boolean>;
  close(): void;
}

export function createPrompter(): Prompter {
  const rl = createInterface({ input: stdin, output: stdout });
  return {
    async ask(question, { defaultValue, required } = {}) {
      for (;;) {
        const suffix = defaultValue ? dim(` (${defaultValue})`) : '';
        const answer = (await rl.question(`${question}${suffix}: `)).trim();
        if (answer) return answer;
        if (defaultValue !== undefined) return defaultValue;
        if (!required) return '';
        log(yellow('  This one is required.'));
      }
    },
    async confirm(question, defaultYes = true) {
      const hint = defaultYes ? 'Y/n' : 'y/N';
      const answer = (await rl.question(`${question} ${dim(`[${hint}]`)} `)).trim().toLowerCase();
      if (!answer) return defaultYes;
      return answer === 'y' || answer === 'yes';
    },
    close() {
      rl.close();
    },
  };
}

// --- Env files ---------------------------------------------------------------

/**
 * Parses KEY=VALUE lines. Comments and blanks are skipped, surrounding quotes
 * are removed, `export KEY=...` is accepted. Later keys win.
 */
export function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      // Strip a trailing unquoted comment.
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out[match[1]] = value;
  }
  return out;
}

export async function readEnvFile(path: string): Promise<Record<string, string> | null> {
  try {
    return parseEnvFile(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Serialises values for an env file, quoting anything with spaces or `#`. */
export function formatEnvValue(value: string): string {
  if (value === '') return '';
  return /[\s#"'$]/.test(value) ? JSON.stringify(value) : value;
}

// --- Seed helpers ------------------------------------------------------------

/**
 * Sections fenced off from the shared corpus:
 *
 *   <!-- seed:exclude -->  …prose…  <!-- /seed:exclude -->
 *
 * Stripped before the POST so the text is never chunked, embedded or reachable
 * from the citation panel. A rule the panel can bypass is not a rule.
 */
const EXCLUDED_SECTION = /^[^\S\n]*<!--\s*seed:exclude\s*-->[\s\S]*?^[^\S\n]*<!--\s*\/seed:exclude\s*-->[^\S\n]*\n?/gm;

export function stripExcluded(text: string): { text: string; removed: number } {
  const matches = text.match(EXCLUDED_SECTION) ?? [];
  if (!matches.length) return { text, removed: 0 };
  return { text: text.replace(EXCLUDED_SECTION, ''), removed: matches.length };
}

/** Reads a wait hint such as "retry in 42s" or "wait 60 seconds" out of error text. */
export function retrySeconds(message: string | undefined, fallback = 65): number {
  if (!message) return fallback;
  const match = /(\d+(?:\.\d+)?)\s*(?:s\b|sec|second)/i.exec(message);
  if (!match) return fallback;
  const seconds = Math.ceil(Number(match[1]));
  return seconds > 0 && seconds <= 600 ? seconds : fallback;
}

/**
 * Both apex and www forms of a custom domain belong in TRUSTED_ORIGINS: the
 * browser reports whichever the visitor actually loaded, and which one is
 * canonical can change. Localhost origins stay as typed.
 */
export function expandOrigins(inputs: string[]): string[] {
  const out = new Set<string>();
  for (const raw of inputs) {
    let value = raw.trim().replace(/\/+$/, '').toLowerCase();
    if (!value) continue;
    if (!/^https?:\/\//.test(value)) value = `https://${value}`;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      continue;
    }
    const origin = url.origin;
    out.add(origin);
    const host = url.hostname;
    if (host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) continue;
    if (host.startsWith('www.')) out.add(`${url.protocol}//${host.slice(4)}${url.port ? `:${url.port}` : ''}`);
    else if (host.split('.').length === 2) out.add(`${url.protocol}//www.${host}${url.port ? `:${url.port}` : ''}`);
  }
  return [...out];
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
