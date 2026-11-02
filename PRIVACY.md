# Privacy

What a Ragfolio deployment does with data, written for the person deploying it and for anyone they embed it for.

## Visitors' questions and documents

- Documents a visitor uploads are parsed, split into passages, embedded and stored in **your** Supabase project under a random session id the browser generated. Nothing leaves your infrastructure except the passages sent to your chosen model provider for embedding and answering.
- Sessions older than 24 hours are deleted by `purge_expired()` if you schedule it (Supabase Cron). The owner's seeded documents are never purged.
- Questions, answers and retrieved passages are sent to Langfuse **only if** you set the Langfuse keys. API keys and contact details are scrubbed before anything leaves for Langfuse.

## Visitors' API keys (bring-your-own-key mode)

A visitor at your public URL who is not on a trusted origin supplies their own provider key. It travels in a request header, is used for that request, and is **never stored, logged or traced**. A short SHA-256 fingerprint is kept in process memory and in the `model_health` table only to keep one visitor's rate-limit state separate from another's. Keys pasted into documents or the chat box are removed before indexing.

## Contact details

Phone numbers and email addresses in passages are replaced with a placeholder before the model or the citation panel sees them, unless the visitor arrived through one of your `TRUSTED_ORIGINS`. This is a disclosure preference: the origin is reported by the browser and can be forged. The browser-enforced control is the `frame-ancestors` header built from the same list. Do not gate anything that matters on origin trust; use real authentication.

## Rate limiting

Requests are counted against a salted SHA-256 hash of the caller's IP address. The address itself is not stored.

## Anonymous usage counts (telemetry)

When a receiver URL is configured (the v0.1 default is empty, so nothing is sent yet), each deployment sends one small request per chat and per ingest to the Ragfolio maintainer:

```json
{ "v": "0.1.0", "o": "<16-hex salted hash of your deployment's hostname>", "e": "chat" }
```

That is the entire payload. **Never** the question, the answer, a document, a key, a session id, or a visitor's address. It is fire-and-forget with a 1.5 s timeout; if the receiver is down your site is unaffected.

Turn it off with:

```
RAGFOLIO_TELEMETRY_DISABLED=1
```

Point it at your own receiver with `RAGFOLIO_TELEMETRY_URL`. The receiver code is in this repo (`/api/telemetry`) and stores one counter per day, hashed host, version and event.
