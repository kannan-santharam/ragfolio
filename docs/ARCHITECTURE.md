# Ragfolio — Architecture

Written as questions, because the decisions matter more than the file list.

## What happens when a visitor asks a question?

1. The browser POSTs the conversation to `/api/chat` with three headers: a session id it generated, the origin of the page it is embedded in, and (at the public URL) the visitor's own provider key.
2. The route resolves trust (is the parent origin in `TRUSTED_ORIGINS`?), whose key pays, and the rate limit, then opens a Server-Sent Events stream.
3. The agent loop (`lib/agent.ts`) sends the system instruction, the history and two tool definitions to the model through the provider adapter. The model either writes prose or calls a tool.
4. `search_document` embeds the model's query, runs `match_chunks` once per readable namespace (the visitor's own, plus the seeded one when trusted), merges and re-ranks, reserves slots for the visitor's own uploads, redacts contact details for untrusted visitors, and returns numbered passages. `list_sections` returns documents and headings.
5. Each decision is streamed as a `trace` event so the UI shows the trail. Text streams as `text` deltas. On the final permitted turn tools are withheld so the model must answer.
6. When prose arrives, the loop scans it for `[n]` markers and emits only the cited passages (all of them if it cited none).

## Why an adapter per provider rather than a neutral message format alone?

Because a tidy neutral format silently degrades both providers. Gemini 3 attaches a `thoughtSignature` to tool calls and drops context if the model turn is not echoed verbatim. OpenAI needs the `tool_calls` array back with its ids. So each assistant message in the neutral history carries an opaque `raw` field the producing adapter reads back. Tool schemas are written once in JSON Schema; the Gemini adapter upper-cases the `type` values it wants.

OpenAI streams tool-call arguments as string fragments keyed by index; the adapter accumulates per index and parses JSON once at the end.

## Why 768 dimensions for both providers?

pgvector's `vector` type indexes up to 2000 dimensions with HNSW. `gemini-embedding-001` returns 3072 by default but is a Matryoshka model, so truncating to 768 and renormalising is supported. `text-embedding-3-small` accepts `dimensions: 768` natively. One table cannot hold two widths, so the schema pins 768 and both adapters request it. Renormalisation runs unconditionally; it is a no-op on an already-unit vector.

## Why is the embedding call gated and retried so carefully?

Gemini's free embedding tier is about 100 requests per minute, and one request embeds one passage. Seeding a modest corpus trips it. Every new install's first experience would be a half-loaded corpus. So: a sliding-window gate at 85 per minute shared across uploads on a warm instance; retries that honour the server's own `retry in Ns` hint; a deadline check so a wait never pushes past the function's time limit; an 80-passage cap per document sized to fit one minute; and a seeder that waits, retries and skips unchanged files by content hash.

## Why is the session filter inside the SQL function?

`match_chunks` takes the session id as a parameter and filters inside the body. If the filter lived in application code, one forgotten `.eq('session_id', …)` would leak one visitor's document into another's answers, and it would look like a retrieval-quality bug. Inside the function, no call site can omit it.

## Why redact contact details at retrieval instead of in the prompt?

A prompt rule puts the phone number in the model's context, one clever question away from coming back out. Rewriting the passage before the model and before the citation panel see it leaves nothing to extract. The same reasoning applies to `seed:exclude`: fenced sections are stripped before the ingest POST, so they are never chunked, never embedded, never reachable from the panel. A rule the panel can bypass is not a rule.

## What is origin trust, honestly?

`x-embed-origin` is derived from `document.referrer`, which the browser reports and a determined visitor can forge. It decides disclosure (seeded corpus, contact details, whose key) and nothing more. The browser-enforced control is the CSP `frame-ancestors` header, built from the same `TRUSTED_ORIGINS` list so the two cannot drift. The embed script pins `referrerpolicy="strict-origin"` on the iframe so a host page with `Referrer-Policy: no-referrer` does not silently land every visitor in restricted mode.

## Why does the system prompt refuse to say how the corpus was assembled?

Because the model cannot see what was withheld from it. Strip the sections explaining regional editions and the agent will confidently assert "No, the site does not tailor content" — a fabricated denial, worse than the disclosure. The rule: when asked whether content is selected or tailored for *this* visitor, neither confirm nor deny; say you answer from what is indexed and cite it. Any configurable-corpus system needs this.

## Why a model cascade, and why is the allowlist exact-match?

Free-tier daily caps differ per model by more than an order of magnitude, and one answer costs two to four model calls. A chain across several models gives each its own quota. The id is interpolated into the provider URL, so a browser-supplied model is accepted only by exact membership in the allowlist, never by pattern: a crafted id containing `?` or `#` could restructure the URL and leak the key into a query string.

Cooldowns for rate-limited or unresponsive models live in the `model_health` table keyed by key fingerprint and model, because serverless instances share no memory and a visitor exhausting their own key must not disable a model for everyone else.

## Why is a non-2xx from Postgres or a provider never forwarded?

PostgREST messages name tables and policies; undici messages echo the request that choked, header values included. Two real leaks of that kind were found in the project this was ported from. The server logs the detail and returns a sentence. Only errors this app authored (key required, quota exhausted, parse failed, limit reached) keep specific wording, because those are the ones the UI acts on.

## Why fail open on rate limiting?

A limiter that takes the whole site down when its RPC hiccups, or before the schema is applied, is worse than the abuse it prevents.

## Why the trace panel?

"Agentic" is otherwise an unverifiable claim. Showing the search query the model wrote, how many passages came back and the top score lets a visitor see the system do something intelligent rather than take it on faith. It costs one SSE event per tool call.

## What is deliberately not here?

Accounts, OCR, a pluggable vector store, a hosted configurator. See `DECISIONS.md`.
