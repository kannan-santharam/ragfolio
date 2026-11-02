# Projects

Fictional sample projects for the Ragfolio demo corpus.

## Tidewatch

A self-hosted uptime monitor written in TypeScript and Go. Probes run on Fly.io machines in six regions and report to a single Postgres instance. The dashboard renders 90-day heat maps with 1-minute resolution from a 2 GB table using materialised views refreshed every five minutes.

**What was hard:** keeping the probe scheduler drift-free across regions without a coordinator. The solution was deterministic jittered schedules derived from the monitor id, so every region agrees on the next probe time without talking to each other.

## Ledgerline

A double-entry bookkeeping library for Node with 100% branch coverage and a property-based test suite. Used in production by two small SaaS products for invoice reconciliation.

**Design decision:** amounts are integers in minor units, never floats. The API refuses a `number` with a fractional part at the boundary rather than rounding silently.

## Fieldnotes

A Progressive Web App for ecologists recording species sightings offline. Sync uses a last-writer-wins CRDT per record with a conflict log the user can review. Runs on three-year-old Android phones with no network for a week at a time.
