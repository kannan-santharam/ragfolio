# Ragfolio — Complete Setup Guide

Everything from zero to a chat widget on your site. Budget about 20 minutes the first time. All services used have free tiers.

Contents

1. [What you are setting up](#1-what-you-are-setting-up)
2. [Get an AI provider key](#2-get-an-ai-provider-key)
3. [Create the Supabase database](#3-create-the-supabase-database)
4. [Configure with `npx ragfolio init`](#4-configure-with-npx-ragfolio-init)
5. [Run locally](#5-run-locally)
6. [Deploy to Vercel](#6-deploy-to-vercel)
7. [Seed your documents](#7-seed-your-documents)
8. [Embed on your site](#8-embed-on-your-site)
9. [Every environment variable](#9-every-environment-variable)
10. [How visitors experience it](#10-how-visitors-experience-it)
11. [Troubleshooting](#11-troubleshooting)
12. [Updating](#12-updating)

---

## 1. What you are setting up

Three pieces, all yours:

| Piece | Where it runs | Cost |
|---|---|---|
| The Ragfolio app (this repo, `apps/server`) | Your Vercel project | Free (Hobby) |
| A Postgres database with pgvector | Your Supabase project | Free tier |
| An AI model for embeddings + answers | Google Gemini or OpenAI, on your key | Gemini free tier / OpenAI pay-as-you-go |

Plus the `ragfolio` CLI from npm, which you run on your laptop to configure and seed the deployment.

You need: Node.js 20 or newer (`node -v`), a GitHub account (for the Vercel deploy), and a browser.

---

## 2. Get an AI provider key

Pick one. Gemini is the easy default because it is free and needs no card. You can support both for visitors later (they choose in the widget); this key is **yours**, used for visitors arriving through your own site.

### Option A — Google Gemini (free, recommended)

1. Open <https://aistudio.google.com/apikey> and sign in with any Google account.
2. Click **Create API key**. If asked, pick an existing Google Cloud project or let it create one. No billing is required.
3. Copy the key. It looks like `AIza…` (39 characters) or a newer dotted form.
4. Keep it somewhere safe for step 4. Never commit it.
5. Recommended: in Google Cloud → **APIs & Services → Credentials**, open the key and restrict it to the *Generative Language API* only. The widget never needs anything else.

Free-tier limits that matter here (measured, not guessed; they change, so verify on your key):

- Embeddings: about 100 requests per minute. Ragfolio paces itself under this.
- Chat models: daily caps differ per model by more than 10×. The default model chain tries several so one exhausted quota does not stop answers. If you see constant "rate-limited" errors, set `CHAT_MODELS` to a model with headroom (see section 9).

### Option B — OpenAI

1. Open <https://platform.openai.com/api-keys> and sign in.
2. Add a small credit balance under **Billing** (a few dollars is plenty for a portfolio).
3. Click **Create new secret key**, name it, copy it. It starts with `sk-` and is shown once.
4. Keep it for step 4.

Models used: `text-embedding-3-small` at 768 dimensions for embeddings; chat defaults are small fast models that support function calling (`gpt-5.4-mini`, `gpt-5-mini`, `gpt-4.1-mini`). Override with `CHAT_MODELS`.

---

## 3. Create the Supabase database

1. Go to <https://supabase.com/dashboard>, sign in, **New project**. Pick any name and region, set a database password (save it; you may need it for the connection string).
2. Wait for the project to finish provisioning (about a minute).
3. Collect three values:
   - **Project URL** — *Settings → API → Project URL*, like `https://abcdefgh.supabase.co`. This is `SUPABASE_URL`.
   - **Service role key** — *Settings → API → Project API keys → `service_role`* (click reveal). This is `SUPABASE_SERVICE_ROLE_KEY`. It bypasses row-level security, so it only ever lives on the server. Never put it in a browser or a `NEXT_PUBLIC_` variable.
   - **Connection string** (optional, lets the CLI apply the schema for you) — *Connect* button at the top → *Connection string* → *URI* (use the "Session" or "Transaction" pooler form if offered). Replace `[YOUR-PASSWORD]` with your database password. This is `DATABASE_URL`; it is only used by `ragfolio init` and is not stored.
4. **Apply the schema.** Either let `npx ragfolio init` do it (step 4, needs the connection string), or paste it by hand: open *SQL Editor → New query*, paste the contents of `apps/server/supabase/schema.sql`, and **Run**. It is safe to run more than once.

   What it creates: `documents` and `chunks` tables (768-dim `vector` column with an HNSW index), the `match_chunks` search function (session-scoped inside the function so no caller can leak another visitor's data), `rate_limits`, `model_health`, `purge_expired()`, and row-level security on every table with no permissive policy.

5. **Optional, recommended — schedule cleanup.** Visitor sessions are disposable. In *Database → Cron* (enable the `pg_cron` extension if prompted) add a job that runs hourly:

   ```sql
   select purge_expired();
   ```

   It deletes visitor uploads older than 24 hours. Your seeded documents are never purged.

---

## 4. Configure with `npx ragfolio init`

From any folder (ideally a clone of this repo if you want to run locally):

```bash
npx ragfolio init
```

It asks, in order:

| Prompt | What to enter |
|---|---|
| Provider | `gemini` or `openai` |
| API key | The key from step 2 |
| Supabase URL / service role key | From step 3 |
| Database connection string | Optional. If given, the schema is applied now. If blank, it prints the SQL path to paste yourself |
| Owner name | Your name as visitors should hear it, e.g. `Priya Raman` |
| Assistant name | What the widget calls itself, e.g. `Priya's assistant` |
| Suggested questions | Up to four, comma-separated. Shown as starter buttons |
| Your site origin(s) | e.g. `https://priya.dev`. Apex and www forms plus localhost are added automatically |
| Telemetry | Anonymous counts only, opt-out any time. See PRIVACY.md |

It then generates `SEED_TOKEN` and `RATE_LIMIT_SALT`, writes `.env.local` (mode 0600, refuses to overwrite without `--force`), and prints the next steps. Every prompt has a flag for non-interactive use; `npx ragfolio init --help` lists them.

Keep `.env.local` out of git. The repo's `.gitignore` already excludes it.

---

## 5. Run locally

```bash
git clone https://github.com/kannan-santharam/ragfolio
cd ragfolio
pnpm install                       # or: corepack enable && pnpm install
cp /path/to/.env.local apps/server/.env.local   # from step 4, or run init with --out apps/server
pnpm dev                           # http://localhost:3000
```

Open <http://localhost:3000>. If anything is missing the page shows a setup card naming the variable. Confirm with:

```bash
npx ragfolio doctor --url http://localhost:3000
```

Tests and typecheck need no keys:

```bash
pnpm test
pnpm typecheck
```

---

## 6. Deploy to Vercel

1. Push this repo to your GitHub (or click the Deploy button in the README, which clones it for you). The Next.js app lives in `apps/server`, so set **Root Directory** to `apps/server` when importing (the button does this).
2. After the first deploy, open the project → **Settings → Environment Variables**.
3. Open your `.env.local`, copy its entire contents, and paste into the *Key* field. Vercel splits a pasted `.env` block into individual variables. Save.
4. **Deployments → Redeploy** (environment variables are read at build time for the CSP header, so a redeploy is required after changing `TRUSTED_ORIGINS`).
5. Check it:

   ```bash
   npx ragfolio doctor --url https://your-app.vercel.app
   ```

   `configured: true` and your provider listed means you are done.

Vercel limits to know: 4.5 MB request body (uploads are capped at 4 MB), 60 s per function on Hobby (ingestion and vision parsing are budgeted inside that).

**Browser check.** Every request that spends your key must come from a browser running the widget. This uses Vercel BotID in Basic mode, free on every plan, no setup beyond this repo. If the check cannot run the request is refused, not let through: `doctor` shows `Browser check: unavailable` and visitors see "could not be verified as coming from a browser". On Vercel the usual cause is OIDC being off: enable **Settings → Security → Secure Backend Access with OIDC Federation** and redeploy. On a host other than Vercel set `BOT_CHECK=off`; the counters below still apply, and they need the caller's address from your proxy (`x-real-ip`, or the rightmost `x-forwarded-for` entry), otherwise every request on your key is refused as "temporarily unavailable".

### 6a. The free trial and your daily ceilings

Unset, the bare URL asks visitors for their own key. `init` offers the trial; it is never switched on by an upgrade.

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_ACCESS` | `byok` | `byok` (own key only), `trial` or `closed` |
| `TRIAL_CHATS_PER_DAY` | 10 | Questions per trial visitor per day (an address gets three visitors' worth) |
| `TRIAL_DOCS_PER_DAY` | 1 | Uploads per trial visitor per day |
| `TRIAL_MAX_CHARS` | 20000 | Characters of text per trial document |
| `TRIAL_VISION_PAGES` | 0 | PDF pages the vision model reads per trial upload; images are refused at 0 |
| `TRIAL_MAX_TURNS` | 3 | Agent turns per trial question |
| `TRIAL_DAILY_CHATS` / `TRIAL_DAILY_INGESTS` | 100 / 10 | All trial spend together per day. Reached: trial visitors get the key form; your site is unaffected |
| `OWNER_DAILY_CHATS` / `OWNER_DAILY_INGESTS` | 200 / 20 | All spend by visitors on **your site** per day. Reached: "try again tomorrow" |
| `OWNER_CHATS_PER_ADDRESS` / `OWNER_INGESTS_PER_ADDRESS` | 60 / 5 | The same, per address per day |
| `VISITOR_VISION_PAGES` | 4 | Vision pages per upload for a visitor on your own site |

The two `*_DAILY_*` pairs are the ceiling on what one day can cost you, whoever the visitors are. Size them against your provider's daily quota and leave headroom for your own seeding. Counters live in Postgres; if the database cannot be reached they count as full, so an outage never turns into an unmetered key. A unit reserved for an upload that is refused before any model call (empty, malformed, over the size cap) is handed back.

Per-visitor trial counts use an HttpOnly cookie (`ragfolio_v`) and the hashed address (IPv6 by /64). Your own site's visitors are counted per address and against their own ceiling.

Do not list the deployment's own URL in `TRUSTED_ORIGINS`: that would make every public visitor a trusted one. `doctor` warns if you do.

---

## 7. Seed your documents

Put the files visitors should be able to ask about in a folder, e.g. `./docs`:

- Supported: `.pdf`, `.docx`, `.md`, `.markdown`, `.txt`, `.png`, `.jpg`, `.webp`.
- PDF pages are read by the model (tables → Markdown tables, charts → `[Figure: …]` descriptions). Images are indexed as a model-written description.
- Up to 80 passages (≈35 pages of prose) per file; split larger files.
- **Keep private details out of the index** by fencing them in Markdown:

  ```markdown
  <!-- seed:exclude -->
  Phone: +1 555 010 2030
  <!-- /seed:exclude -->
  ```

  Fenced sections are stripped before upload, so they are never embedded or citable. The widget tells visitors to reach you through your site instead.

Then:

```bash
npx ragfolio seed ./docs --url https://your-app.vercel.app
```

The token is read from `SEED_TOKEN` in `./.env.local` (or pass `--token`). Output per file: passages indexed, sections withheld, or `unchanged, skipped`. Re-running is safe; only changed files are re-embedded. On the free Gemini tier a large first run may pause for a minute between documents — the CLI waits and retries up to five times.

---

## 8. Embed on your site

Paste one line, ideally just before `</body>`:

```html
<script src="https://your-app.vercel.app/embed.js" defer data-theme="dark"></script>
```

That adds a floating "Ask me anything" button and a full-screen overlay. Options:

| Attribute | Effect |
|---|---|
| `data-theme="dark|light"` | Pin the widget theme (default follows the page) |
| `data-label="…"` | Button text |
| `data-position="left|right"` | Which corner |
| `data-color="#6366f1"` | Button colour |
| `data-mode="inline" data-target="#chat"` | Render inside an element instead of a floating button |

Inline example:

```html
<div id="chat" style="height:600px"></div>
<script src="https://your-app.vercel.app/embed.js" defer data-mode="inline" data-target="#chat"></script>
```

Optional JavaScript API, if your page has its own "ask" box:

```js
window.ragfolio.ask('What has she shipped?');  // opens the widget and submits
window.ragfolio.open(); window.ragfolio.close(); window.ragfolio.toggle();
```

You never write any postMessage code; the script owns the handshake with the iframe.

**Your site's origin must be in `TRUSTED_ORIGINS`** (step 4 added it). That list does two things: it builds the browser-enforced `frame-ancestors` header, so only your site can frame the widget, and it tells the server that visitors arriving from your site get your documents, your contact details and your key. From any other page the widget is a blank "upload and ask" tool on the visitor's own key.

`npx ragfolio snippet --url https://your-app.vercel.app` prints the tag with your options.

---

## 9. Every environment variable

Defined in `apps/server/.env.example`. Required ones in bold.

| Variable | Meaning |
|---|---|
| **`RAG_PROVIDER`** | `gemini` or `openai` |
| **`GEMINI_API_KEY`** / **`OPENAI_API_KEY`** | The key for the chosen provider (only one needed) |
| **`SUPABASE_URL`** | Project URL |
| **`SUPABASE_SERVICE_ROLE_KEY`** | Service role key, server-side only |
| `CHAT_MODELS` | Comma-separated allowlist tried in order, e.g. `gemini-flash-latest,gemini-3.1-flash-lite`. Unset = provider defaults |
| `OWNER_NAME` | Your name in the UI and prompts |
| `ASSISTANT_NAME` | The widget's name |
| `WELCOME_MESSAGE` | First-screen sentence |
| `SUGGESTED_QUESTIONS` | Up to four, comma-separated |
| `PERSONA` | Extra paragraph appended to the system prompt |
| **`TRUSTED_ORIGINS`** | Your site origins, comma-separated, apex and www. Build-time for CSP |
| `PUBLIC_ACCESS` | `byok` (default), `trial` or `closed`; see 6a. `ALLOW_VISITOR_KEYS=false` still means `closed` |
| `TRIAL_CHATS_PER_DAY`, `TRIAL_DOCS_PER_DAY`, `TRIAL_MAX_CHARS`, `TRIAL_VISION_PAGES`, `TRIAL_MAX_TURNS`, `TRIAL_DAILY_CHATS`, `TRIAL_DAILY_INGESTS` | Trial allowance per visitor and per day; see 6a |
| `OWNER_DAILY_CHATS`, `OWNER_DAILY_INGESTS`, `OWNER_CHATS_PER_ADDRESS`, `OWNER_INGESTS_PER_ADDRESS` | Ceilings on your own site's visitors spending your key; see 6a |
| `VISITOR_VISION_PAGES` | Vision pages per upload for visitors on your site (default 4) |
| `BOT_CHECK` | `off` disables the browser check on non-Vercel hosts |
| `REDACT_CONTACT_DETAILS` | `false` leaves phone/email visible to untrusted visitors (default `true`) |
| `PDF_PARSE_MODE` | `rich` (default, every page read by the model), `auto` (only pages with images/little text), `text` (text layer only) |
| `VISION_MAX_PAGES` | Vision calls per upload (default 20) |
| **`SEED_TOKEN`** | Needed for `ragfolio seed`; unset disables seeding |
| `RATE_LIMIT_SALT` | Salt for hashed-IP rate limits |
| `RATE_LIMIT_CHAT_PER_10MIN` / `RATE_LIMIT_INGEST_PER_HOUR` | Defaults 25 / 10 |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` | Optional tracing; keys and contact details are scrubbed before sending |
| `RAGFOLIO_TELEMETRY_DISABLED` | `1` opts out of anonymous usage counts |
| `RAGFOLIO_TELEMETRY_URL` | Point counts at your own receiver |

---

## 10. How visitors experience it

**On your site (trusted origin):** the widget opens with your name, your seeded documents, and starter questions. Visitors ask; the agent searches when needed and cites passages. They can also upload their own file (e.g. a job description) and ask how it compares. Your key pays; they never see a key prompt.

**At the bare Vercel URL (untrusted):** a "Get started" stepper. With `PUBLIC_ACCESS=trial`: (1) upload a document, (2) ask, with the day's allowance shown and a "use your own key" link for more. By default: (1) add their own Gemini or OpenAI key, with instructions on how to get one, (2) upload, (3) ask. Either way your documents are not visible, phone numbers and emails are stripped from any passage, and a visitor's own key stays in their browser (sent per request in a header, never stored or logged server-side). When a trial is used up, the key form appears with the reason.

Rate limits: 25 messages per 10 minutes and 10 uploads per hour per hashed IP, by default.

---

## 11. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Setup card says a variable is missing, but you set it | On Vercel: set for the right environment (Production) and **redeploy**. Locally: file must be `apps/server/.env.local`; restart `pnpm dev` |
| `ragfolio seed` → 401/403 "Not authorised to write to the shared namespace" | `SEED_TOKEN` on the server differs from the one the CLI sends. Use the same `.env.local`, or pass `--token` |
| `ragfolio seed` keeps pausing with 429 | Free embedding tier is ~100 req/min. The CLI waits and retries; let it run. For very large corpora seed in batches |
| "Every model in the fallback chain is rate-limited" | Daily quota hit on the free tier. Wait, or set `CHAT_MODELS` to models with headroom, or use OpenAI |
| Widget button appears but the overlay is blank / "refused to connect" | Your page's origin is not in `TRUSTED_ORIGINS` (CSP `frame-ancestors`). Add it, redeploy |
| Widget loads but shows the key stepper on your own site | The server did not recognise your origin. Check the exact form (https, www vs apex) is in `TRUSTED_ORIGINS`; the embed script pins `referrerpolicy=strict-origin` so a strict page policy is handled |
| "Could not save the document. Is the database schema applied?" | Run `schema.sql` in the Supabase SQL editor (step 3.4) |
| PDF indexed but a chart question gets "documents do not cover it" | Check the upload note: pages beyond `VISION_MAX_PAGES` fall back to the text layer. Raise the limit or split the file |
| Scanned PDF rejected | Needs `PDF_PARSE_MODE=rich` or `auto` (vision). `text` mode cannot read scans |
| Uploads fail at 4 MB | Vercel body limit. Compress or split the file |
| Visitors get "could not be verified as coming from a browser" | BotID could not run. On Vercel, enable OIDC federation (section 6) and redeploy. Elsewhere set `BOT_CHECK=off`. `doctor` shows the state |
| Visitors on your site see "reached its usage allowance for today" | `OWNER_DAILY_*` or `OWNER_*_PER_ADDRESS` hit. Raise them |
| "temporarily unavailable" on your site or the trial | The counters in Supabase could not be reached (they fail closed). Check the project is up and the schema is applied |
| Answers reveal phone/email on the public URL | `REDACT_CONTACT_DETAILS` must be `true` (default). Also fence them with `seed:exclude` so they are never indexed |

Diagnose any deployment with one command:

```bash
npx ragfolio doctor --url https://your-app.vercel.app
```

---

## 12. Updating

- **Documents:** edit the files and re-run `npx ragfolio seed ./docs --url …`. Changed files are replaced; unchanged ones are skipped.
- **Configuration:** change the variable in Vercel and redeploy.
- **The app:** pull the latest from this repo and push; Vercel redeploys. Re-run `schema.sql` after upgrades that mention schema changes — it is idempotent. **The free trial and the per-address ceilings (§6a) need the `read_rate_limit` and `release_rate_limit` functions**: re-run `schema.sql` once before setting `PUBLIC_ACCESS=trial` on a deployment created before them, or the allowance shows as zero.
- **Remove everything:** delete the Vercel project and the Supabase project; revoke the API key in AI Studio or the OpenAI dashboard.
