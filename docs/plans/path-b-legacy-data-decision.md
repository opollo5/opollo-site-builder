# Path-B legacy data migration — decision (2026-04-29)

## Decision

**Leave-as-is dual-path.** Existing path-A rows in `pages.generated_html`, `posts.generated_html`, `brief_pages.draft_html`, and `brief_pages.generated_html` keep their full-document HTML. New runs (post-PR #194) emit path-B fragments. Both shapes coexist on disk indefinitely; the publish path forwards whatever the column holds, and the preview iframe handles both via the `claimsCompleteness` heuristic in `lib/preview-iframe-wrapper.ts` (PR #199).

## Why

Per the standing autonomous-run rule (lowest-risk default), the three options from the parent plan (`docs/plans/path-b-migration-parent.md` §PB-6) trade as:

| Option | Risk | Operator effort | Cost | Reversible? |
|---|---|---|---|---|
| 1. Regenerate-on-next-publish | Medium — adds `legacy_path_a boolean` column + runtime branch + operator-facing banner | High — every legacy page needs an explicit regen | Per-page Anthropic cost × N | Yes (drop the column) |
| 2. Lossy extraction backfill | High — jsdom-based extractor strips inline CSS; some pages will look wrong post-migration | None for the first batch (operator confirms) | One-time cron cost | No (original bytes overwritten) |
| 3. Leave-as-is dual-path (chosen) | Low — no migration writes; existing publishes keep working byte-identically | None | None up-front | Yes (run option 1 or 2 later) |

Option 3 is the only choice with zero data-loss risk, zero up-front cost, and zero operator action. The cost is permanent runtime branching — but that branching is already in place (PR #189 truncation banner + PR #199 preview wrapper both key off `claimsCompleteness`). Adding nothing is the cheapest way to satisfy PB-6.

## Implementation

**Code changes shipped this PR**: none. The publish path (`lib/wordpress.ts::wpCreatePage` etc.) already forwards `content` byte-identically to WP REST regardless of shape (verified by PB-7's regression suite, PR #196). The preview iframe (`components/BriefRunClient.tsx` → `lib/preview-iframe-wrapper.ts`) already detects path-A vs path-B and wraps appropriately.

**Code changes deliberately deferred**: a one-time row-count survey, a `legacy_path_a` boolean column, an operator-facing banner. All wait for the retire trigger.

## Retire trigger

Drop dual-path support when:

- All path-A rows are older than the customer's data-retention threshold (typically 90 days for unpublished drafts, indefinite for published pages — check current site retention policies before retiring), OR
- Operator complaint surfaces a published path-A page that's now visually inconsistent with the rest of the (now path-B) site, AND the operator wants Opollo to regen it for them.

When the retire trigger fires, run option 1 (regenerate-on-next-publish) — schema migration adds `legacy_path_a` column with backfill default true; new rows default false; publish path refuses path-A unless explicitly approved by the operator. The BACKLOG entry "Legacy path-A row retire trigger" tracks this.

## Row-count survey (deferred)

A row-count snapshot would inform retirement timing but is not required for the leave-as-is choice. When the retire trigger fires, run via `scripts/diagnose-prod.ts`:

```sh
# Sketch — actual subcommand to be added when survey runs:
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  npx tsx scripts/diagnose-prod.ts legacy-row-counts
```

Expected shape: per-table counts of rows whose `generated_html` / `draft_html` matches the path-A heuristic (`content LIKE '<!DOCTYPE%' OR content LIKE '<html%'`). A small `legacy-row-counts` subcommand can be added then; it's a 30-line addition to the read-only diagnostic CLI.

## Live evidence preserved

Page `dcbdf7d5-b867-443b-afdf-f60a28f968aa` (26,286-char path-A `draft_html`) stays untouched per the rescope directive. Operator can publish it as-is to validate the dual-path publish behaviour.
