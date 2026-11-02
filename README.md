# Ragfolio

An agentic RAG chat widget for your portfolio site. Visitors ask about you; a tool-calling model decides when to search your documents, retrieves from Postgres + pgvector, and cites the exact passage behind every claim. Runs entirely on free tiers you own.

**What you get:** a deployable Next.js app (this repo, one-click to Vercel), a CLI on npm (`npx ragfolio`) that configures and seeds it, and a one-line `<script>` tag that mounts the chat on any site.

> npm carries the CLI and nothing else. `npm install ragfolio` does not produce a chatbot; deploying this repo does. The CLI configures and seeds that deployment.

## Setup in four steps

Full walkthrough with screenshots-level detail (getting keys, Supabase, Vercel, troubleshooting): **[docs/SETUP.md](docs/SETUP.md)**.

You need a free [Supabase](https://supabase.com) project and a free [Gemini key](https://aistudio.google.com/apikey) (or an OpenAI key). About ten minutes.

**1. Initialise.** Answers a few questions, applies the database schema, generates secrets, and writes `.env.local`.

```bash
npx ragfolio init
```

**2. Deploy.** Click the button. When the project exists, open *Settings → Environment Variables*, paste the whole contents of your `.env.local` into the key field (Vercel splits it into variables), save, and redeploy.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/kannan-santharam/ragfolio&root-directory=apps/server&project-name=ragfolio)

Check it with `npx ragfolio doctor --url https://your-app.vercel.app`. If it reports `Browser check: unavailable`, enable *Settings → Security → Secure Backend Access with OIDC Federation* on the project and redeploy; until then requests on your key are refused.

**3. Seed.** Put your CV, bio, project notes (PDF, DOCX, Markdown, text) in a folder and ingest them.

```bash
npx ragfolio seed ./docs --url https://your-app.vercel.app
```

Re-running is safe: unchanged files are skipped. On the free Gemini tier a large first run may pause for a minute between documents; the CLI waits and retries.

**4. Embed.** Paste one line into your site.

```html
<script src="https://your-app.vercel.app/embed.js" defer data-theme="dark"></script>
```

That renders a floating "Ask me anything" button and a full-screen chat overlay. For an inline panel instead:

```html
<div id="chat" style="height:600px"></div>
<script src="https://your-app.vercel.app/embed.js" defer data-mode="inline" data-target="#chat"></script>
```

Optional JS API: `window.ragfolio.open()`, `.close()`, `.toggle()`, `.ask('What has she shipped?')`. No postMessage code needed; the script handles the handshake.

## How it behaves

**Two faces, one deployment.** Through your own site (`TRUSTED_ORIGINS`) the assistant is yours: seeded documents in scope, contact details readable, your key paying. At its bare Vercel URL it is a blank "upload a document and ask" tool: nothing preloaded, phone numbers and emails stripped from passages.

**A free trial, then their own key.** With `PUBLIC_ACCESS=trial` (`init` offers it), a visitor at the public URL gets a small daily allowance on your key (one document of up to 20k characters and ten questions, by default) before being asked for a key of their own, so nobody meets a key form first. Every unit of visitor spend on your key, from the trial or from your own site, is metered per address and against a daily ceiling, must come from a browser running the widget (Vercel BotID, free on all plans), and is counted in Postgres with a fail-closed posture. The trial has its own ceiling, so abuse of the public URL cannot switch the widget off on your site. Unset, the public URL is bring-your-own-key; `closed` turns it off.

**Agentic, visibly.** The model holds two tools, `search_document` and `list_sections`, and decides per turn whether to search, with what query, and how many times. The UI shows that trail live. Tools are withheld on the final turn so the agent must answer.

**Reports, tables, charts and images.** PDF pages are read by the model, not by a text extractor: each page is sent to the chat model and transcribed to Markdown with tables as tables and charts as `[Figure: …]` blocks naming axes, series, values and trend. Standalone images (PNG, JPEG, WebP) are indexed as a model-written description. The text layer is only a fallback for a page the model could not read. Everything is then embedded with the provider's embedding model; no hand-written heuristics decide what a document means. One model call per page; `PDF_PARSE_MODE=auto` is an economy mode, `text` disables it.

**Citations.** Every retrieved passage gets a marker; the answer cites `[1]`, `[2][3]`; the sources panel shows filename, section, page and the passage text.

**Things that will not be recited.** Fence sections of a Markdown file with `<!-- seed:exclude --> … <!-- /seed:exclude -->` and the seeder strips them before upload, so they are never chunked, embedded or reachable from the citation panel. Use it for contact details.

**The corpus-construction rule.** A retrieval agent cannot see what was withheld from it. Asked "is this tailored to me?", it will confidently invent an answer either way. The system prompt tells it to neither confirm nor deny and to answer from what is indexed. Keep that rule if you edit the prompt.

## Configuration

See [`apps/server/.env.example`](apps/server/.env.example). Highlights:

| Variable | Purpose |
|---|---|
| `RAG_PROVIDER` | `gemini` or `openai` |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | Only the chosen provider's key is required |
| `CHAT_MODELS` | Optional allowlist, tried in order. Verify free-tier quotas against your key |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server-side only; the browser never holds a Supabase key |
| `OWNER_NAME`, `ASSISTANT_NAME`, `WELCOME_MESSAGE`, `SUGGESTED_QUESTIONS`, `PERSONA` | The personalisation layer |
| `TRUSTED_ORIGINS` | Your site's origins (apex and www). Also builds the CSP `frame-ancestors` header at build time, so changing it needs a redeploy |
| `PUBLIC_ACCESS` | `byok` (default), `trial` or `closed`: what the bare URL offers visitors |
| `OWNER_DAILY_CHATS`, `OWNER_DAILY_INGESTS`, `OWNER_*_PER_ADDRESS` | Ceilings on your own site's visitors spending your key (defaults 200 / 20 a day, 60 / 5 per address) |
| `TRIAL_*` | Trial allowance per visitor and per day; see docs/SETUP.md §6a |
| `SEED_TOKEN` | Required for `ragfolio seed`; unset disables seeding |
| `RAGFOLIO_TELEMETRY_DISABLED=1` | Opt out of anonymous usage counts (see below) |
| `LANGFUSE_*` | Optional tracing; a no-op when unset |

## Anonymous usage counts

Each deployment can send `{version, hashed hostname, "chat" | "ingest"}` to the maintainer once per request. Nothing else, ever: no questions, answers, documents, keys, session ids or visitor addresses. It is fire-and-forget and cannot slow or break your site. Opt out with `RAGFOLIO_TELEMETRY_DISABLED=1`.

In v0.1 the default receiver URL is empty, so nothing is sent until a release sets one. Full details in [PRIVACY.md](PRIVACY.md).

## Known limits

- 4 MB per upload (Vercel request body cap), 80 passages per document (one free-tier embedding minute), 150k characters of extracted text.
- 20 vision pages per upload by default (`VISION_MAX_PAGES`); further pages fall back to the text layer. DOCX images are not described in v0.1.
- Origin trust is a disclosure preference, not access control. See PRIVACY.md.
- Rate limits are per hashed IP, so an office behind one NAT shares a budget.

## Development

```bash
pnpm install
cp apps/server/.env.example apps/server/.env.local   # fill in
pnpm dev                                             # http://localhost:3000
pnpm test                                            # unit tests, no keys needed
pnpm typecheck
```

To try the embed locally: `npx serve -l 5173 examples` and open `http://localhost:5173/embed-test.html?app=http://localhost:3000` with `http://localhost:5173` in `TRUSTED_ORIGINS`.

Repo layout: `apps/server` (the Next.js app), `packages/cli` (the npm package), `examples/sample-docs` (a fictional corpus to try seeding with), `docs/ARCHITECTURE.md` (why each decision was made), `DECISIONS.md` (defaults chosen for v0.1).

## License

MIT.
