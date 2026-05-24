# Investigation: PR-09 CAP Insights-Priors Wiring

**Date**: 2026-05-24
**Branch at time of audit**: `feat/backlog-closure-m1-rate-limit`
**Investigator**: Claude Code (read-only audit — no changes made)

---

## What was PR-09 supposed to do

PR-09 wired the CAP post-generator (`lib/cap/generation/post-generator.ts`) to consume the
Insights module's richer `/api/insights/generation-priors` endpoint instead of issuing a raw
two-query DB lookup via `fetchPerformancePriors`. The intent is a migration path:

- **Before PR-09**: CAP calls `fetchPerformancePriors(companyId)` directly and formats a plain
  "top 3 by engagement" block.
- **After PR-09 (flag ON)**: CAP calls `/api/insights/generation-priors?...` which assembles a
  richer priors block that includes insights recommendations (length band, posting window,
  question lift, editing preferences, dismissed types) in addition to the raw top-3 posts.
- A feature flag (`INSIGHTS_PRIORS_VIA_API`) gates the switch so the old path remains available
  as a fallback.

The back-compat endpoint `/api/insights/priors` (PR #997 per the comment in its route file)
is a thin wrapper that was presumably shipped first so existing consumers could get `priors_text`
without adopting the full v1 response shape.

---

## Current feature flag state

`lib/cap/generation/post-generator.ts` lines 18–20:

```ts
function isInsightsPriorsViaApiEnabled(): boolean {
  return process.env.INSIGHTS_PRIORS_VIA_API === "true";
}
```

**When flag is `"true"` (ON)**:

1. Constructs the URL:
   `${base}/api/insights/generation-priors?company_id=...&platform=LINKEDIN&arc_phase=...`
   using `VERCEL_URL` for the base in deployed environments, `http://localhost:3000` otherwise.
2. Sends `X-Cron-Secret` in the request header (authorised as a cron caller).
3. Uses `AbortSignal.timeout(250)` — a **250 ms hard timeout**.
4. On success reads `data.priors_text` from the JSON response.
5. On any failure (non-2xx, timeout, network error) logs `cap.priors.api_fallback` and falls
   through to the direct DB path.

**When flag is `"false"` or unset (OFF)**:

Skips the API call entirely. Calls `fetchPerformancePriors(companyId)` then
`formatPerformancePriorsBlock(priors)` directly.

---

## Default behavior

`INSIGHTS_PRIORS_VIA_API` is **not set anywhere** in the codebase or Vercel environment:

- Not in `.env.example`
- Not in `.env.local.example`
- Not in `vercel.json`
- Not in any CI workflow file under `.github/workflows/`
- Not in `.env.local`, `.env.production.local`, `.env.staging.local`
- `vercel env ls production` shows 48 environment variables; `INSIGHTS_PRIORS_VIA_API` is
  absent from the list.

**Result**: `process.env.INSIGHTS_PRIORS_VIA_API` is `undefined` at runtime.
`undefined === "true"` is `false`, so `isInsightsPriorsViaApiEnabled()` returns `false`.

**Default behavior = direct DB path, always.**

The API path is currently unreachable in any deployed environment.

---

## The direct DB path (`fetchPerformancePriors`)

**File**: `lib/cap/performance-priors.ts` (entire file)

Two-step query:

1. `platform_social_profiles` — resolves all profile IDs for `company_id`.
2. `social_post_analytics_snapshots` — top 20 rows for those profiles where:
   - `engagement_rate IS NOT NULL`
   - `impressions >= 50`
   - `posted_at >= now() - 90 days`
   - ordered by `engagement_rate DESC`, `impressions DESC`

Returns up to 3 deduplicated (by `bundle_post_id`) `PerformancePrior` objects
(`{ engagementRate, content }`).

Formatted output (`formatPerformancePriorsBlock`) is a plain-text block headed
`PERFORMANCE PRIORS — TOP-PERFORMING POSTS FOR THIS CLIENT (last 90 days)` listing
up to 3 posts as `N. [X.X%] — <truncated content>` (content capped at 400 chars).

Returns `""` when no qualifying posts exist (soft degradation).

---

## The API path (`/api/insights/generation-priors`)

**File**: `app/api/insights/generation-priors/route.ts`

Same auth gate: `authorisedCronRequest` (checks `X-Cron-Secret`).

Four parallel queries:

| Query | Table | Purpose |
|---|---|---|
| Recommendations | `ins_recommendations` | Active, non-suppressed recs with `confidence_band IN ('strong','moderate')` and not expired |
| Client memory | `ins_client_memory` | Dismissals and edit patterns per company |
| Post features | `ins_post_features` | Up to 200 most recent posts — day/hour/media/topic metadata |
| Performance priors | `fetchPerformancePriors(companyId)` | Same function as the direct path |

Assembles `priors_text` via `buildPriorsText()` (lines 285–328) which combines:
- Platform and post count header
- Preferred length band (from `BEST_LENGTH_BAND` recommendation)
- Best posting window (from `BEST_POSTING_WINDOW` recommendation, confidence >= 0.75)
- Question lift multiplier (from `QUESTION_PATTERN_LIFT` recommendation)
- Client editing preferences (from `edit_pattern` memory entries, up to 3)
- The same `formatPerformancePriorsBlock(topPosts)` output appended at the end

Also queries suppressed recommendations for `dismissed_recommendation_types`.

**Returns a `priors_text` that is strictly richer than the direct DB path** — it includes the
insights recommendations and edit-pattern context on top of the same raw top-posts block.

Note: `arc_phase` is accepted and validated but **not used to filter any query**. It is only
echoed in the response body (`arc_phase` field) and passed to the logger. This means the API
does not yet produce arc-phase-specific priors; it returns the same data regardless of whether
`arcPhase` is `"awareness"`, `"offer"`, etc.

Note: `include_industry_signal` defaults to `false` (the query param is not sent by the
post-generator). Industry signal (cross-client learning via `ins_pattern_library`) is
therefore never included when CAP calls this endpoint.

---

## The back-compat wrapper (`/api/insights/priors`)

**File**: `app/api/insights/priors/route.ts`

Proxies to `/api/insights/generation-priors` and returns only `{ ok, priors_text }`.
Uses a 240 ms timeout — shorter than the 250 ms the post-generator would use when calling
`generation-priors` directly. Not called by `post-generator.ts` at all; exists for other
consumers (comment cites PR #997).

---

## Test coverage

### Direct DB path — well covered

`lib/cap/__tests__/performance-priors.unit.test.ts` covers `fetchPerformancePriors` and
`formatPerformancePriorsBlock` with 8 cases:
- Happy path (top 3 posts)
- Deduplication by `bundle_post_id`
- Null `engagement_rate` filtered
- Low-impressions filtered
- Empty result set
- No social profiles for company
- Profiles query error (soft degradation)
- Analytics query error (soft degradation)

### Feature flag branch — covered

`lib/__tests__/cap-priors-migration.unit.test.ts` covers `getPerformancePriorsBlock` indirectly
via `generatePost` with 4 cases:
- Flag OFF → `fetchPerformancePriors` called, `fetch` not called
- Flag ON → `fetch` called with correct URL and `X-Cron-Secret` header, `fetchPerformancePriors` not called
- Flag ON + API returns non-2xx → falls back to `fetchPerformancePriors`
- Flag ON + `fetch` throws → falls back to `fetchPerformancePriors`

**Gap**: The test for "flag OFF" sets `process.env.INSIGHTS_PRIORS_VIA_API = "false"` explicitly.
There is no test case for the most common real-world condition: env var **not set at all**
(`undefined`). Given `undefined === "true"` is `false`, this works correctly, but the test gap
means the "unset = off" behavior is not formally asserted.

### API route — no dedicated unit test found

`app/api/insights/generation-priors/route.ts` has no corresponding test file in
`lib/__tests__/` or `app/`. The route's `buildPriorsText` function is untested in isolation.

---

## Environment verification needed

| Env var | Where used | Current state | Action needed |
|---|---|---|---|
| `INSIGHTS_PRIORS_VIA_API` | `post-generator.ts:19` — gates API path | **Not set anywhere** (absent from Vercel production, all `.env*` files, CI) | Add to `.env.example` + `.env.local.example` with value `false`. Set to `"true"` in Vercel when ready to enable. |
| `VERCEL_URL` | `post-generator.ts:29-31` — builds base URL for API call | Set automatically by Vercel (system var) | No action needed; local fallback to `http://localhost:3000` is correct. |
| `CRON_SECRET` | `post-generator.ts:34` — `X-Cron-Secret` header | Present in Vercel Production + Preview (confirmed in `vercel env ls`) | No action needed. |

---

## Verdict

**Is the feature flag wired correctly?** Yes. The code at `post-generator.ts:18–49` is correct:
flag check, API call with auth header and timeout, `priors_text` extraction, and fallback to the
direct DB path are all implemented properly and tested.

**Does the code work in both paths?** Yes, with one caveat:

- **Direct DB path**: fully functional in production today.
- **API path**: functional in code and tested, but the 250 ms `AbortSignal.timeout` is tight.
  The `generation-priors` route runs four parallel DB queries and in a cold-function or
  busy-DB scenario 250 ms may not be sufficient — it would silently fall back to the direct
  path and log `cap.priors.api_fallback`. There is no monitoring/alerting on that warning log.

**What's missing?**

1. `INSIGHTS_PRIORS_VIA_API` is not documented in `.env.example` or `.env.local.example` —
   any developer or deploy that doesn't know the flag exists cannot enable it.
2. `INSIGHTS_PRIORS_VIA_API` is not set in Vercel production, meaning the richer API path
   (Insights recommendations + edit patterns) has **never run in production for CAP**.
3. `arc_phase` is sent by `post-generator.ts:32` but ignored by the `generation-priors` route —
   the richer priors are not phase-differentiated. This is a silent accuracy gap: `"offer"` and
   `"awareness"` posts receive identical priors.
4. `industry_signal` is never requested (no `include_industry_signal=true` in the CAP call).
5. No unit test for "env var not set at all" as distinct from "env var set to false".
6. No test file for `app/api/insights/generation-priors/route.ts` itself.
