# Spec 05 — featured-image hybrid ranking — blockers

## OPENAI_API_KEY not provisioned in this checkout (2026-05-08)

PR A (schema + embed lib + ingest hook + backfill script) ships without
needing the key — the embed module no-ops gracefully when `OPENAI_API_KEY`
is unset. PR B's `/api/images/suggest` falls back to keyword-only ranking
when the key is unset OR when no rows have an embedding yet.

To activate semantic ranking end-to-end:

1. Add `OPENAI_API_KEY` to Vercel project env (`production`, `preview`,
   `development` scopes as needed).
2. Add the same key to local `.env.local` if working from this checkout.
3. Run `npm run backfill:image-embeddings` once against the production
   database. ~9k rows, ~$0.10 cost, ~5–10 minutes wall-clock at the
   default batch=100, delay=200ms.
4. After the run, the script reports the populated %. If >5% of the
   library still lacks an embedding (because they have no caption /
   alt / tags / title / filename), open Spec 05 PR C scope: a follow-up
   that uses iStock metadata or AI batch captioning to fill the gaps.

The ingest hooks (upload / PATCH / reextract) start populating embeddings
for any new caption changes immediately once the env var is set — no
backfill is needed for new uploads, only the historical library.

## Tracking

- Spec 05 PR A: schema + ingest pipeline + backfill script (this PR).
- Spec 05 PR B: search endpoint + UI wiring (follows PR A).
- Spec 05 PR C: caption-quality follow-up — only if PR A's backfill
  reports >5% missing.
