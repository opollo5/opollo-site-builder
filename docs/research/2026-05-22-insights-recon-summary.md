# Insights module — recon summary

**Date:** 2026-05-22  
**Investigator:** Claude Code session  
**Hours spent:** ~1  
**Sections completed:** All (P0 + P1, four passes)

---

## Can it be standalone?

PARTIAL. The engagement data exists, the DB schema is live, and the codebase already contains a working analytics layer (lib/platform/social/analytics-ingest/) with two dashboard surfaces. The data pipeline works today. What does not exist is a lib/insights/ directory — the analytics code is spread across lib/platform/social/analytics-ingest/, lib/platform/social/analytics.ts, and components/analytics/, all co-deployed inside the Site Builder Next.js project. Extracting to a standalone module requires no new data infrastructure — only moving code to a named lib/insights/ namespace and deciding whether it stays in the same Vercel project (Option A, zero infra cost) or gets its own Vercel project (Option B, one Vercel config change by Steven). The data layer is decoupled enough from Site Builder that deletion of Site Builder leaves Insights intact. The key gap is forward-direction: Insights doesn't yet feed recommendations back into the composer or CAP.

---

## The one question that matters

Engagement data — bundle.social or Metricool?

**bundle.social, confirmed.** Metricool has zero implementation in this codebase (one design-comment reference only). bundle.social's SDK exposes `analyticsGetSocialAccountAnalytics` and `analyticsGetBulkPostAnalytics` returning impressions, views, likes, comments, shares, saves, followers, engagement_rate. A daily cron refreshes these into Supabase snapshot tables. The data pipeline is live in production as of migration 0121.

---

## Top 5 findings

1. **Analytics infrastructure already exists and is live.** Three Supabase tables (social_profile_analytics_snapshots, social_post_analytics_snapshots, social_post_history_imports), a daily 04:00 UTC refresh cron, and two dashboard surfaces (admin per-profile + company-scoped) are already deployed. bundle.social returns impressions, views, likes, comments, shares, saves, followers per platform per day. Citation: supabase/migrations/0121_social_analytics_tables.sql, lib/platform/social/analytics-ingest/refresh.ts.

2. **CAP is fully built in this repo and is already source-tagged.** lib/cap/ (22 files), five DB tables, two cron jobs — all live. CAP-generated posts write `source_type='cap'` on social_post_master, making CAP vs manual performance comparison a one-line Supabase query with no schema changes. Citation: supabase/migrations/0137_cap_phase_1_schema.sql, lib/platform/social/analytics.ts:62 (SOURCE_LABELS map).

3. **CAP prompt does not read engagement data — this is the highest-value gap.** lib/cap/prompts/campaign-post.ts takes voice_profile (tone, industry, audience, banned_words, reference_posts) and monthly_objective. It does not fetch top-performing posts or engagement benchmarks. Injecting the top-3 posts by engagement_rate from social_post_analytics_snapshots into the prompt context requires a single SELECT + 5-10 lines of prompt assembly code. Citation: lib/cap/prompts/campaign-post.ts:29-44.

4. **Optimiser is the working analog for module isolation.** lib/optimiser/ (65+ files) has zero imports from lib/social/ or lib/platform/social/ (grep confirmed). It communicates with Site Builder only via a named site-builder-bridge/ seam. lib/optimiser/ is the architectural pattern for lib/insights/. Citation: lib/optimiser/site-builder-bridge/submit-brief.ts, lib/optimiser/pattern-library/extractor.ts.

5. **X analytics are absent; LinkedIn and Facebook are the only real sources today.** bundle.social's analytics API does not cover X/Twitter. The platform-map only maps linkedin_personal, linkedin_company, facebook_page, and gbp. Instagram, TikTok, YouTube, Pinterest, Pinterest are in the SDK enum but not yet mapped in ANALYTICS_PLATFORM_MAP. Any "impressions by platform" dashboard is effectively a LinkedIn + Facebook dashboard for current customers. Citation: lib/platform/social/analytics-ingest/platform-map.ts:42-58.

---

## Top 5 unknowns blocking the standalone decision

1. **bundle.social analytics rate limits per team** (resolves by: reading bundle.social API docs for analyticsGetSocialAccountAnalytics and analyticsGetBulkPostAnalytics rate limits — the code comment says "5/day per team per platform" but this is unverified). Critical if Insights becomes a separate Vercel project calling the same API key.

2. **Instagram, TikTok, YouTube analytics coverage** (resolves by: test analyticsGetSocialAccountAnalytics with INSTAGRAM/TIKTOK on a live connected account). The SDK enum includes these platforms; whether Opollo's bundle.social plan tier exposes the data is UNKNOWN.

3. **Whether the analytics UI is consumer-facing or operator-only** (resolves by: product decision from Steven). Current admin dashboard route requires is_opollo_staff(); current company route requires view_calendar permission. If Insights is a product feature clients pay for, the auth tier needs a new permission or subscription check.

4. **Cross-client social benchmarking — consent model** (resolves by: Steven's decision on opt-in model + a migration PR). No consent flag exists on platform_companies for cross-client social learning. Optimiser has `cross_client_learning_consent` on opt_clients as a working analog. Without this, "how does your engagement compare to similar MSP companies" is not possible.

5. **bundle.social SDK version and stability of analytics endpoints** (resolves by: reading node_modules/bundlesocial/package.json changelog). The SDK is present and working but whether analyticsGetBulkPostAnalytics is GA or beta-API is UNKNOWN.

---

## Coupling scorecard summary

| Integration point | Today's default | Lowest achievable | Effort to lower |
|---|---|---|---|
| Insights reading published-post identity | L1 (shared DB) | L1 (already stable) | None |
| Insights reading post content for feature extraction | L2 (direct query) | L1 (content in snapshot table) | Near-zero |
| Insights reading bundle.social engagement | L2 (cron in same deploy) | L2 (separate schedule) or L1 (webhook) | Medium |
| Insights reading Metricool | N/A | N/A | N/A — not implemented |
| Insights serving recommendations to composer | Not built | L2 (REST endpoint) | Low |
| Insights serving priors to CAP PAL | Not built | L2 (read snapshots in prompt) | Low |
| Insights dashboard auth | L3 (same Supabase session) | L2 (stable Supabase RLS functions) | Low |
| Cross-client pattern aggregation | Not built | L2 (service-role job, consent flag) | Medium |

---

## Failure-mode summary

| Concern | Direction | Severity |
|---|---|---|
| bundle.social outage | Insights stale (reads snapshots, can't refresh) | Low — historical data still served |
| Site Builder outage (same deploy) | Insights down if Option A | Medium — separating to Option B eliminates this |
| Insights outage | Zero impact on publishing, CAP, auth, approvals | Low — pure read consumer |
| CAP outage | Zero impact on analytics | Low |
| Supabase outage | All analytics unavailable | High — no mitigation; applies to all modules equally |
| Rate limit exceeded at bundle.social | Cron fails silently, data goes stale | Low — retry on next day's tick |

---

## Anti-coupling test result

All three deletion tests pass:

- **Delete Site Builder**: Insights survives. No analytics code imports from briefs, brief_runs, or Site Builder page tables.
- **Delete CAP**: Insights survives. No analytics code imports from lib/cap/. The source_type='cap' rows go stale over time but existing analytics data is intact.
- **Delete Insights**: Publishing, CAP, composer, approval, and auth all survive. The analytics pages 404; the refresh cron fails; no other workflow is affected.

---

## Next decision (not a design)

The data infrastructure is there. The two decisions Steven needs to make before writing a single line of Insights product code are: (1) Is this a customer-facing feature (requiring a subscription gate or permission tier) or an operator tool? That determines whether the auth model needs changing. (2) Should Insights stay co-deployed with Site Builder (Option A, zero infra work, ship in days) or get a separate Vercel project (Option B, one config step by Steven, better blast-radius isolation)? Everything else — feeding CAP prompts, cross-client benchmarks, recommendation surfaces — follows from those two decisions and has clear working analogs in the codebase.
