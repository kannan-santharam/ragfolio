# Decisions

Defaults chosen for v0.1 of Ragfolio. Each is a one-line change if you want it the other way.

| Question | Decision | Why |
|---|---|---|
| Language / registry | TypeScript. The deployable is a Next.js app (GitHub template + Deploy-to-Vercel button). The npm package `ragfolio` is the CLI (`init`, `seed`, `doctor`, `snippet`). | Vercel's Node runtime is first-class and free; the embed is JavaScript regardless; nothing in a RAG pipeline that calls HTTPS APIs needs Python. |
| Hosting | Self-hosted only. Every adopter runs their own Vercel project, Supabase project and provider key. | Any hosted piece scales the maintainer's bill with other people's traffic. |
| Providers | Gemini and OpenAI, selected by `RAG_PROVIDER`. One adapter interface, two implementations. | Asked for both. |
| Vector width | Pinned to 768 for both providers (`vector(768)`). | pgvector HNSW caps at 2000 dims; Gemini supports Matryoshka truncation; OpenAI `text-embedding-3-small` accepts `dimensions: 768`. One table cannot serve two widths. |
| Vector store | Supabase pgvector only. | Vercel is serverless, so an embedded store (SQLite, Chroma) cannot persist. Pluggable stores are a lot of surface for v0.1. |
| Embed form factor | iframe, mounted by a one-line `<script>` served from the deployment itself. Launcher or inline mode. | Only an iframe keeps the adopter's CSS and the widget's CSS apart. The script owns the postMessage handshake so adopters write zero integration code. |
| Telemetry | On by default, count-only, disclosed in README and PRIVACY.md, opt out with `RAGFOLIO_TELEMETRY_DISABLED=1`. Receiver is a route in the same app, enabled only by the maintainer with `RAGFOLIO_TELEMETRY_RECEIVER=1`. **Dormant in v0.1**: the default receiver URL is empty until the maintainer deploys one, so nothing is sent yet. | The maintainer wants traffic numbers; opt-in telemetry returns none. Next.js, Astro and Homebrew ship the same model. |
| Region editions | Dropped. | Owner-specific. Document tagging / variants can come back as an opt-in feature if someone asks. |
| Model health | Postgres table `model_health`, keyed by key fingerprint and model. | In-process cooldowns do not survive serverless instances; this was a known weakness of the original. |
| Original DocMind deployment | Untouched and stays in production for the portfolio. This repo is a separate artifact until proven. | A live portfolio should not be the testbed. |

## Not done in v0.1

- No React/Vue wrapper component (the script tag works in any framework; a wrapper would only call `window.ragfolio.*`).
- No OCR for scanned PDFs.
- No accounts; the session id is an isolation mechanism, not an authorisation boundary.
- Telemetry receiver URL (`DEFAULT_TELEMETRY_URL` in `apps/server/src/lib/config.ts`) is empty until the maintainer deploys a receiver; telemetry is a no-op until then.
- The Deploy button and `envLink` in README need the real GitHub repo slug.
