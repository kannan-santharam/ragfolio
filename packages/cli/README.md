# ragfolio

Set up and seed a self-hosted, agentic RAG chatbot for your portfolio site. The chatbot itself is a Next.js app you deploy to your own Vercel account with your own Supabase project and your own Gemini or OpenAI key. This package is the command-line companion: it writes your config, applies the database schema, loads your documents, and prints the one-line embed tag.

```
npx ragfolio <command>
```

No install needed. Node 20 or newer.

## The four steps

1. **Deploy** the app to Vercel (Deploy button in the main README).
2. `npx ragfolio init` — answers a few questions, writes `.env.local`, applies the schema if you give it a connection string, and lists the env var names to add in Vercel.
3. `npx ragfolio seed ./docs --url https://your-app.vercel.app` — ingests the folder into the shared corpus every visitor sees.
4. `npx ragfolio snippet --url https://your-app.vercel.app` — paste the printed `<script>` tag into your site.

## Commands

### `init`

Interactive wizard. Every answer can also be passed as a flag (`--provider`, `--key`, `--supabase-url`, `--supabase-key`, `--database-url`, `--owner`, `--assistant`, `--questions`, `--origins`, `--public-access trial|byok|closed`, `--telemetry on|off`); `--yes` skips prompts entirely. Refuses to overwrite an existing `.env.local` unless `--force` is given. Writes to `--out <dir>` (default: current directory).

### `seed <dir> --url <appUrl> [--token <seedToken>] [--env <file>]`

Uploads every `.pdf`, `.docx`, `.txt`, `.md` in the folder, one at a time. The seed token comes from `--token`, then `SEED_TOKEN`, then `--env` or `./.env.local`. Markdown sections fenced with `<!-- seed:exclude --> … <!-- /seed:exclude -->` are stripped before upload, so they are never embedded or citable. Re-running is safe: files whose content has not changed are skipped. On a free Gemini tier the first run may pause for about a minute between large documents while the embedding quota resets; the command waits and retries by itself.

### `doctor --url <appUrl>`

Prints the deployment's configuration status (provider, models, missing variables, tracing, telemetry). Exits non-zero if the app is not configured.

### `snippet --url <appUrl> [--theme dark|light] [--label "..."] [--inline]`

Prints the embed tag. `--inline` renders the chat into a `<div id="ragfolio">` instead of a floating launcher.

## Telemetry

The deployed app sends anonymous usage counts (package version, a hashed host name, an event name) — never content, keys or visitor addresses. `init` asks whether to keep it on; set `RAGFOLIO_TELEMETRY_DISABLED=1` to opt out at any time.
