#!/usr/bin/env node
import { doctor } from './doctor.js';
import { init } from './init.js';
import { seed } from './seed.js';
import { snippet } from './snippet.js';
import { CliError, bold, cyan, dim, log, parseArgs, red } from './util.js';

const USAGE = `${bold('ragfolio')} — set up and seed a self-hosted agentic RAG chatbot for your site.

${bold('Usage')}
  npx ragfolio init     [--out <dir>] [--force] [--yes] [--provider gemini|openai] [--public-access trial|byok|closed] [--key ...]
                        [--supabase-url ...] [--supabase-key ...] [--database-url ...]
                        [--owner ...] [--assistant ...] [--questions "a,b"] [--origins "https://a.com,https://b.dev"]
                        [--telemetry on|off]
  npx ragfolio seed <dir> --url <appUrl> [--token <seedToken>] [--env <file>]
  npx ragfolio doctor  --url <appUrl>
  npx ragfolio snippet --url <appUrl> [--theme dark|light] [--label "..."] [--inline]

${bold('Commands')}
  init      Interactive wizard. Writes .env.local, optionally applies the database schema,
            prints the Vercel env var names and the next steps. Every answer can be passed
            as a flag for non-interactive use (--yes skips all prompts).
  seed      Ingest every .pdf/.docx/.txt/.md in <dir> into the shared corpus every visitor
            of your site sees. Markdown sections fenced with <!-- seed:exclude --> …
            <!-- /seed:exclude --> are withheld before upload. Re-running is safe: unchanged
            files are skipped. On a free Gemini tier a first run may pause for about a
            minute between large documents while the embedding quota resets.
  doctor    Check a deployment: configuration, provider, models, missing variables.
  snippet   Print the <script> tag to paste into your site.

${bold('Adopter flow')}
  1. Deploy the app to Vercel        2. ${cyan('npx ragfolio init')}
  3. ${cyan('npx ragfolio seed ./docs --url …')}   4. ${cyan('npx ragfolio snippet --url …')} → paste
`;

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);

  if (!command || command === '--help' || command === '-h' || command === 'help' || args.flags.help) {
    log(USAGE);
    return;
  }

  switch (command) {
    case 'init':
      return init(args);
    case 'seed':
      return seed(args);
    case 'doctor':
      return doctor(args);
    case 'snippet':
      return snippet(args);
    default:
      throw new CliError(`Unknown command "${command}".\n\n${USAGE}`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof CliError) {
    log(red(error.message));
    process.exit(error.exitCode);
  }
  log(red(error instanceof Error ? error.message : String(error)));
  log(dim('Run with --help for usage.'));
  process.exit(1);
});
