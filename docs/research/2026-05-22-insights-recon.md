# Insights module — standalone viability recon

**Date:** 2026-05-22  
**Investigator:** Claude Code session  
**Branch:** research/insights-recon-20260522  
**Sections completed:** P0 + P1 (full four-pass)

---

## Executive Findings

- **Final standalone verdict:** PARTIAL
- **Dominant blocker:** No lib/insights/ directory exists. The engagement-data layer (ingest + dashboard) is built into lib/platform/social/analytics-ingest/ and served via Opollo-staff-only admin routes, making it currently inseparable from the Site Builder deploy unit without deliberate extraction work.
- **Highest-risk coupling point:** The daily analytics-refresh cron (social-analytics-refresh at 04:00 UTC in vercel.json) calls `refreshAnalyticsForAllProfiles()` which requires BUNDLE_SOCIAL_API and reads from platform_social_profiles — coupling the analytics data pipeline to the bundle.social provisioning model and the Vercel cron runner inside the same deploy unit. Citation: lib/platform/social/analytics-ingest/refresh.ts:74-118, vercel.json:106-109.
- **Highest-confidence evidence:** bundle.social SDK exposes `analyticsGetSocialAccountAnalytics` and `analyticsGetBulkPostAnalytics` endpoints that return impressions, views, likes, comments, shares, saves, followers, post_count (confirmed live in production via migration 0121 schema and refresh.ts:196-248). The data is actually flowing; the question is only architectural location.
- **Lowest-confidence evidence:** Whether bundle.social's analytics API is rate-limited per-team at a level that would affect a separate Insights microservice polling the same endpoints. The current code notes "rate-limited at the SDK side by bundle.social: 5/day per team per platform" (analytics-ingest/refresh.ts:26) but this is a code comment, not a confirmed API spec citation. Resolves by: reading bundle.social API documentation for analytics endpoint rate limits.
- **Sections completed:** P0 + P1 (all four passes)

---

## §1 — Engagement Data

### §1.1 bundle.social engagement data

**Confirmed: bundle.social returns rich engagement metrics.**

The SDK client is at `lib/social/publishing/bundle-social-client.ts`. It exposes two analytics surfaces:

1. `fetchAnalytics(externalPostId)` — per-post analytics called by the legacy V1 analytics route. Returns: `impressions`, `engagement_rate`, `reactions`, `shares`, `comments`, `clicks`, `platform_specific`, `fetched_at`. (bundle-social-client.ts:21-30, 65-86)

2. SDK methods called via the bundlesocial npm package (node_modules/bundlesocial confirmed present):
   - `client.analytics.analyticsGetSocialAccountAnalytics({ teamId, platformType })` — account-level: followers, following, postCount, impressions, impressionsUnique, views, viewsUnique, likes, comments. (refresh.ts:196-248)
   - `client.analytics.analyticsGetBulkPostAnalytics({ platformType, postIds })` — post-level bulk: impressions, impressionsUnique, views, viewsUnique, likes, dislikes, comments, shares, saves. (refresh.ts:371-414)
   - `client.postImport.postImportGetImportedPosts({ teamId, socialAccountType, limit })` — fetches up to 200 imported posts with id, title, description, permalink, thumbnail, publishedAt. (refresh.ts:328-344)

**Platform coverage gaps (confirmed from platform-map.ts:42-58):**
- X / Twitter: bundle.social analytics surface intentionally does not cover X. The platform-map returns null; UI renders "no analytics available."
- Google Business Profile: account analytics yes, post-history import no (bundle.social limitation).
- Instagram, Pinterest, TikTok, YouTube: mapped but not yet provisioned in ANALYTICS_PLATFORM_MAP (only linkedin_personal, linkedin_company, facebook_page, and gbp are in the map). This is a code gap — the SDK enum includes these platforms (platform-map.ts:17-28).

**Storage schema (migration 0121):**
- `social_profile_analytics_snapshots` — daily per-account: followers, following, post_count, impressions, impressions_unique, views, views_unique, likes, comments, raw JSONB
- `social_post_analytics_snapshots` — daily per-post: title/content/media_urls (captured on first insert, preserved past bundle.social's 30-day raw retention), plus impressions, impressions_unique, views, views_unique, likes, dislikes, comments, shares, saves. Computed column: engagement_rate = (likes + comments + shares) / impressions.
- `social_post_history_imports` — import job audit trail

Both tables have RLS: company members can SELECT their own profile's data; only opollo_staff can write.

**Refresh pipeline:**
Daily cron at 04:00 UTC (`social-analytics-refresh` in vercel.json:106-109) calls `refreshAnalyticsForAllProfiles()`. A manual per-profile refresh is available via the dashboard. The code note says bundle.social rate-limits at 5/day per team per platform — UNKNOWN whether this is a hard API spec or a code-author estimate.

### §1.2 Metricool

**No Metricool integration exists in this codebase.**

The only file referencing "metricool" (case-insensitive) is `components/analytics/HeroImpressionsBar.tsx:15` which contains a comment: "The Metricool aesthetic in one component." This is a UI design reference only — no API calls, no env vars, no SDK. The .env.example contains no METRICOOL_ entries. Metricool is design inspiration, not a data source.

### §1.3 Native platform APIs

**Not implemented in codebase. External knowledge summary for planning purposes (UNKNOWN = not verified against current API docs):**

- **LinkedIn Marketing API**: Organic post analytics require the Marketing Developer Platform (MDP) partner program. Community Management API for organic impressions is available at Partner tier. UNKNOWN: whether bundle.social's analytics already abstracts this.
- **Facebook Graph API**: Page post insights (impressions, reach, engagement) available with `pages_read_engagement` permission + page token. Limited to 90-day lookback on some metrics.
- **Instagram Graph API**: Media insights available for Business/Creator accounts. Reach, impressions, likes, comments, saves, shares accessible at media level.
- **X API v2**: Tweet metrics (impressions, engagements) available on Basic tier ($100/mo) via the Tweets/timelines endpoint. Free tier excludes analytics.
- **Google Business Profile API**: Post-level metrics UNKNOWN — GBP API does not expose post-level insights in the same way; the bundle.social platform-map.ts already marks GBP as analytics-only with no post-history import support.

The codebase has made a deliberate architectural choice: route all analytics through bundle.social as the aggregation layer rather than calling native APIs directly. This is sound for a v1 but creates a single vendor dependency for the entire analytics surface.

---

## §2 — Publish Seam

### §2.1 UI publish entry point

The publish flow originates in the social composer. The V2 composer is mounted at `app/(platform)/company/social/` via `ComposerOverlay`. Publish actions call `POST /api/platform/social/posts/[id]/schedule` or similar schedule/submit routes under `lib/platform/social/scheduling/`.

The QStash publish job is the actual executor: `POST /api/webhooks/qstash/social-publish` (app/api/webhooks/qstash/social-publish/route.ts). It fires at scheduled_at, calls `fireScheduledPublish({ scheduleEntryId })`, which internally calls the bundle.social `publishPost()` function. (qstash/social-publish/route.ts:69-83)

### §2.2 Fields available at publish seam

The publish payload sent to bundle.social includes:
- `external_id` (our post ID used for analytics correlation)
- `content` (master_text)
- `media_urls`
- `profile_ids` (bundle.social profile IDs)
- `scheduled_at`
- `platform_variants` (per-platform overrides)

The `social_post_master.source_type` column (enum: 'manual', 'csv', 'cap', 'api') is available in the DB at publish time, making CAP vs composer provenance queryable. (migration 0070 defines the enum; analytics.ts:62 uses it for postsBySource chart data)

### §2.3 Webhook confirmation

bundle.social fires `post.published` / `post.failed` events to `POST /api/webhooks/bundlesocial/route.ts`. Events carry `postId` / `bundlePostId` (bundle.social's ID) and optionally `platformPostUrl`. No engagement metrics are carried in webhook events — the webhook only confirms publication state. Engagement data comes from separate polling via the analytics cron. (webhooks/types.ts:39-53)

### §2.4 Analytics per-draft route (legacy)

A per-draft analytics fetch exists at `GET /api/platform/social/drafts/[id]/analytics`. This calls `fetchAnalytics(externalPostId)` from bundle-social-client.ts, using the draft's ID as the bundle.social external_id. It uses a Redis hot cache (60s TTL) with Postgres cold fallback. This is a different data path from the newer BSP snapshot tables. (drafts/[id]/analytics/route.ts)

---

## §3 — CAP Reality

### §3.1 CAP is fully built in this repo

CAP (Content Automation Platform) is not a brief or external system. It is a fully implemented module within this repo. Evidence:

- `lib/cap/` directory contains 22 files (confirmed by glob).
- Migration `0137_cap_phase_1_schema.sql` defines: cap_subscriptions, cap_voice_profiles, cap_campaigns, cap_campaign_posts, cap_generation_runs — all live in Supabase production.
- CAP cron jobs are in vercel.json: cap-monthly-generation at `0 4 1 * *` and cap-generation-runs-cleanup at `0 2 * * *`.
- PAL (Provider Abstraction Layer) at `lib/cap/pal/` wraps Anthropic (text) and Ideogram (image) providers.
- `lib/cap/push-to-composer.ts` creates social_post_drafts from CAP-generated content, writing `social_draft_id` back to cap_campaign_posts.

### §3.2 n8n, serpapi, firecrawl — absent

Searches for n8n, serpapi, and firecrawl returned zero results in application code (only n8n appeared in docs/briefs as planning references). These tools are NOT implemented. CAP's content pipeline is Anthropic (Claude) for text and Ideogram for images, called directly from Next.js server functions.

### §3.3 CAP prompt structure

The CAP post-generation prompt (lib/cap/prompts/campaign-post.ts) does NOT currently read from engagement analytics. It takes: weekNumber, arcPhase, monthlyObjective, month, tone, industry, targetAudience, bannedWords, onBrandPhrases, languagePatterns, referencePosts. There is no "top performing posts" context injection. This is the highest near-term value connection between Insights and CAP — feeding engagement priors into the prompt.

### §3.4 CAP-to-composer seam

CAP posts have `source_type = 'cap'` on social_post_master (set via push-to-composer.ts). The social analytics page's `postsBySource` breakdown already identifies CAP-generated vs manual posts, giving an immediate analytics slice with no new code required.

---

## §4 — Coupling Audit

### §4.1 Coupling scorecard

| Integration point | Today's default | Lowest achievable | Cost to lower | Evidence |
|---|---|---|---|---|
| Insights reading published-post identity | L1 — shared DB tables (social_post_master, social_post_drafts) | L1 — stable; these are the canonical post records | None — already event-contract-shaped | migration 0070, social_post_master |
| Insights reading post content for feature extraction | L2 — direct Supabase query from analytics code | L1 — query social_post_analytics_snapshots (content already captured on first import) | Near-zero; content already snapshotted | migration 0121:87-109 |
| Insights reading bundle.social engagement | L2 — daily cron inside Site Builder deploy, same Vercel project | L2 on separate schedule; L1 if webhook-driven | Medium — extracting cron to separate service | refresh.ts:74, vercel.json:106 |
| Insights reading Metricool engagement (CAP path) | N/A — Metricool not implemented | N/A | N/A — no integration exists | HeroImpressionsBar.tsx:15 (design ref only) |
| Insights serving recommendations to composer | Not implemented | L2 — REST endpoint Composer polls | Low — read from snapshot tables, expose API route | No existing code — new pattern needed |
| Insights serving priors to CAP PAL prompt assembler | Not implemented | L2 — lib/cap/prompts/ reads from snapshot tables | Low — read top-N posts by engagement from social_post_analytics_snapshots | cap/prompts/campaign-post.ts:29-44 |
| Insights dashboard auth | L3 — Supabase session + is_opollo_staff() gate on admin route; is_company_member() on company route | L2 — stable shared auth functions; extractable | Low — auth functions are defined at DB RLS level, callable from any service hitting same Supabase | dashboard/route.ts:31-32; analytics/page.tsx:65 |
| Insights cross-client pattern aggregation | Not implemented (Optimiser has a working analog) | L2 — opt_pattern_library model, consent flag, anonymisation | Medium — requires replicating Optimiser's pattern-extractor shape for social data | optimiser/pattern-library/extractor.ts:51-229 |

**L0** = same process/function. **L1** = stable shared contract (DB schema, typed API). **L2** = service-boundary (REST/RPC call). **L3** = same-deploy coupling (shared env, shared auth). **L4** = hard-coded dependency with no abstraction.

### §4.2 Inherited dependencies if lib/insights/ inside this repo

| Dependency | Safe to share? | Blast-radius note |
|---|---|---|
| Supabase project (SUPABASE_URL, SERVICE_ROLE_KEY) | Yes — sharing is the point; same tables, RLS enforces tenant isolation | A compromised service key affects all modules; no additional risk vs current state |
| Supabase Auth (is_company_member, is_opollo_staff RLS functions) | Yes — stable, DB-level, already versioned via migrations | Adding a new caller does not change the functions |
| lib/logger | Yes — stateless, no side effects | None |
| lib/http error types | Yes — pure types | None |
| Cron runner (vercel.json) | Partial — sharing vercel.json means all crons in same Vercel project, same timeout budget (300s max for analytics refresh) | Analytics refresh at 300s maxDuration already uses the max; adding more crons in same project increases cold-start contention. Separate project avoids this. |
| BUNDLE_SOCIAL_API env var | Yes if shared project; requires duplication if separate Vercel project | bundle.social rate limit (5 analytics calls/day/team/platform) must be tracked across callers if multiple services poll independently |
| ANTHROPIC_API_KEY | Insights doesn't need Anthropic for the analytics read path; only needed if building NL summaries | Low risk to share; don't add unless building generation features |
| CI pipeline | Yes — same GitHub Actions workflow | No blast radius from sharing |
| Deploy target | Partial — same Vercel project simplifies env var management but ties Insights uptime to Next.js deploy health | See §6 for topology options |

### §4.3 Optimiser as precedent for module isolation

The Optimiser module (lib/optimiser/, 65+ files) is the most mature example of a module living inside this repo. Key findings:

1. **lib/optimiser/ does not import from lib/social/ or lib/platform/social/** (grep confirmed zero results). The modules are fully isolated at the code level.
2. **lib/optimiser/ is imported from outside**: app/(platform)/optimiser/ pages, lib/full-page-output.ts, and lib/__tests__/ files import from lib/optimiser/. These are all read-path imports (UI pages + tests).
3. **Site Builder bridge is explicit**: lib/optimiser/site-builder-bridge/ is the only coupling point between Optimiser and Site Builder. It writes to `briefs`, `brief_pages`, `brief_runs` tables via getServiceRoleClient(). This is a deliberate, named seam.
4. **Shared env vars**: Optimiser uses its own env prefix (OPT_*, GOOGLE_ADS_*, PSI_API_KEY, VERCEL_API_TOKEN) distinct from other modules.
5. **Shared cron runner**: All 18 optimiser cron jobs run in the same vercel.json. This is where Optimiser pays the most coupling cost.
6. **Cross-client aggregation**: Optimiser's pattern library (lib/optimiser/pattern-library/extractor.ts) is the working analog for cross-client social analytics aggregation. It uses a consent flag (`cross_client_learning_consent` on opt_clients), anonymises at aggregation time, and requires ≥2 contributing clients before persisting a pattern.

**Conclusion for Insights**: Optimiser proves the model works. An Insights module can follow the same pattern: lib/insights/ imports lib/supabase, lib/logger, and reads social_post_analytics_snapshots directly. It does not need to import lib/social/ or lib/platform/social/ at all — the snapshot tables are its stable contract with the publishing layer.

---

## §5 — Failure Mode Analysis

### §5.1 Outage matrix — what Insights can still do

| Dependency down | Insights can still do | Insights cannot do | Recovery on restore |
|---|---|---|---|
| bundle.social | Read existing snapshots; serve all historical dashboard data; serve top-posts; serve trends up to last refresh | Refresh engagement metrics; import new post history | Next cron tick refreshes; no manual intervention |
| Site Builder Next.js | Serve analytics API routes (if Insights is a separate deploy) | Nothing if co-deployed — both go down together | Isolate by deploying as separate Vercel project (§6 option B/C) |
| CAP (generation pipeline) | All analytics read paths — CAP and analytics don't interact at runtime yet | Feed priors to CAP (if that integration were built) | No impact; CAP writes posts to social_post_drafts which eventually appear in analytics |
| Supabase | Nothing — all data lives in Supabase | Everything | On restore, data is intact; cron re-runs on next tick |
| Upstash Redis | Read from Postgres cold cache (social_post_analytics_cache); slower response on per-draft analytics | 60s Redis hot-cache benefit | Transparent — code falls through gracefully (drafts/[id]/analytics/route.ts:53-76) |
| QStash | Analytics dashboards unaffected — no QStash dependency in analytics path | Scheduling and publishing of new posts | Analytics reads are synchronous Postgres queries; no queue dependency |
| Anthropic API | All analytics read paths — no Anthropic calls in analytics | Only if NL summarisation were added | N/A for current analytics scope |
| Vercel (cron host) | Historical data remains queryable | Daily refresh doesn't run; data goes stale after 24h | On restore, next cron tick refreshes |

### §5.2 Reverse direction — does Insights being down break other modules?

| Affected workflow | Impact if Insights down 24h | Reason |
|---|---|---|
| Composer publishing | None | Publish path (QStash → fireScheduledPublish → bundle.social) has no analytics dependency. The per-draft analytics GET is an enhancement only. |
| CAP weekly/monthly generation | None | cap/generation/campaign-runner.ts and cap/prompts/campaign-post.ts have no import from analytics code. CAP operates on voice profiles + objectives only. |
| Approval magic-link flow | None | Approval flow (platform_session_grants, social_post_approval_decisions) is independent. |
| Customer dashboard/login | None | Auth path reads platform_company_users, platform_users. No analytics tables in auth path. |
| social-analytics-refresh cron | The cron IS the data writer; if the analytics module is down, data goes stale | The cron is the only writer; it must stay healthy | |

Verdict: Insights is a pure read consumer. Its downtime does not cascade to any other workflow.

---

## §6 — Deployment Topology Options

### Option A: lib/insights/ inside this repo, same Vercel project

**What it means:** Create lib/insights/ alongside lib/cap/, lib/optimiser/, lib/social/. Analytics API routes live under app/api/insights/ or app/(platform)/company/social/analytics/ (already exists).

**Evidence this is viable:** The current analytics layer already works this way. Admin analytics at /admin/companies/[id]/social-profiles/[profileId]/analytics/page.tsx and company-scoped at /company/social/analytics/page.tsx are already live.

**Pros:** Shared Supabase client, shared auth, shared env vars, no cross-service latency. Zero infra changes. Optimiser proves the pattern is maintainable.

**Cons:** Analytics outage = Next.js deploy issue affects analytics UI. Cron contention in vercel.json (already at 36 cron jobs). Cannot independently scale analytics reads.

**Current state cost:** Zero — this is already the architecture.

### Option B: lib/insights/ in repo, separate Vercel project, same Supabase

**What it means:** Deploy a second Vercel project from the same GitHub repo (monorepo-style or via path filter) serving only analytics routes. Shares SUPABASE_URL + SERVICE_ROLE_KEY.

**Pros:** Independent deploy, independent scale, analytics cron isolated from Site Builder crashing. bundle.social API key shared cleanly.

**Cons:** Requires Vercel project setup (external config — hard stop #2 if Steven doesn't have this configured). Shared service-role key means blast radius on compromise affects both. Need to document separate env var sets.

**Effort:** Medium — 1 PR + Vercel dashboard config by Steven.

### Option C: Fully separate stack (separate Supabase project)

**What it means:** New Supabase project with its own DB, new Vercel project, cross-project data sync via Supabase Realtime or periodic API sync.

**Pros:** True blast-radius isolation. Insights team can evolve schema independently.

**Cons:** Data sync complexity (which events flow?), analytics lag, separate billing. Cross-tenant isolation must be re-implemented. No working analog in codebase.

**Effort:** High — architectural change, new DB schema, sync pipeline. Not recommended for current maturity.

**Recommendation:** Start with Option A (already there), extract to Option B when the analytics refresh cron needs independent scaling or when the 36-cron vercel.json becomes a constraint.

---

## §7 — Anti-Coupling Test

### "Delete Site Builder tomorrow" (brief generation, WP publishing, page rendering)

**What survives in Insights:** Everything. The analytics snapshot tables (social_profile_analytics_snapshots, social_post_analytics_snapshots) contain captured content and engagement data. The refresh cron reads from social_connections (not Site Builder tables). The dashboard API reads snapshots only.

**What breaks:** The Optimiser site-builder-bridge (lib/optimiser/site-builder-bridge/) breaks — this is the only place Optimiser directly calls Site Builder tables (briefs, brief_pages, brief_runs). Insights has no equivalent bridge.

**Verdict:** Analytics / Insights survives Site Builder deletion cleanly.

### "Delete CAP tomorrow"

**What survives in Insights:** Everything. There is no runtime import from lib/cap/ in any analytics code path. The source_type='cap' rows in social_post_master would become orphaned (no new CAP posts) but existing analytics data is unchanged.

**What breaks in the product:** New content generation stops. Posts stop flowing into the composer from CAP. Analytics would show a drop in 'AI generated' posts in the postsBySource breakdown over time — observable but not a system break.

**Verdict:** Analytics survives CAP deletion cleanly.

### "Delete Insights tomorrow"

**What breaks:** The /company/social/analytics page returns 404. The /admin/companies/[id]/social-profiles/[profileId]/analytics page returns 404. The social-analytics-refresh cron fails (depends on the analytics-ingest module). The per-draft analytics endpoint (/api/platform/social/drafts/[id]/analytics) fails.

**What survives:** Publishing, CAP, composer, approval flows, auth, Optimiser — all unaffected.

**Verdict:** Insights is cleanly deletable without affecting any other workflow. The reverse isolation holds.

### Summary

The codebase already exhibits the anti-coupling property: Insights can be deleted without breaking anything else; Insights survives deletion of Site Builder and CAP. The only missing piece is the forward direction: Insights isn't yet *feeding* CAP or the Composer, which is the value proposition of an Insights product.

---

## §8 — Cross-Tenant Reads

### Social module company_id enforcement

The social analytics tables are all RLS-protected. `social_profile_analytics_snapshots` and `social_post_analytics_snapshots` both require `is_company_member(p.company_id)` via a join through `platform_social_profiles`. (migration 0121:61-76, 136-151)

The `getSocialAnalytics()` function (lib/platform/social/analytics.ts:81) takes `companyId` as a required parameter and passes it to every query as `.eq("company_id", companyId)`. The caller (`/company/social/analytics/page.tsx`) supplies `session.company.companyId` from the authenticated session. No cross-tenant data leakage is possible on the read path.

The admin route (`/admin/companies/[id]/social-profiles/[profileId]/analytics/`) is gated by `requireAdminForApi()` (an opollo_staff gate) and adds an explicit cross-tenant guard: `if (profile.company_id !== companyIdResult.value) return notFoundResponse(...)`. (admin dashboard/route.ts:47-49)

### Optimiser's cross-client aggregation (working analog for Insights §4.1)

Optimiser's `runPatternExtraction()` (extractor.ts:51-229) is the working analog for any future cross-client social analytics aggregation. Key pattern:

1. Only clients with `cross_client_learning_consent=true` contribute data (extractor.ts:72-77)
2. Source identifiers (client_id, page_id, proposal_id) are used only for counting distinct contributors — never persisted in the output table
3. Minimum 2 clients required before any pattern is persisted
4. Output is statistical (mean effect, 95% CI, confidence level) — no per-client copy

Any cross-client Insights feature (e.g., "posts in your industry average X impressions") must follow this same pattern. The RLS on snapshot tables does not currently support cross-client reads — that would require a new service-role aggregation job, not a direct DB query.

---

## Appendix A — Inventory

### Chart library usage

Recharts is confirmed in use: `components/analytics/ImpressionsTimeSeries.tsx:1-12` imports CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis from recharts. The other analytics components (HeroImpressionsBar, PlatformStatCards, TopPostsPanel) use pure Tailwind/HTML — no Recharts dependency for the non-chart views.

### Cron inventory (vercel.json — relevant to Insights)

| Path | Schedule | Purpose |
|---|---|---|
| /api/cron/social-analytics-refresh | 0 4 * * * | Daily analytics pull from bundle.social → snapshot tables |
| /api/cron/social-connections-health | 0 3 * * * | Connection health check (precedes analytics refresh) |
| /api/cron/social-publish-backfill | */5 * * * * | Backfill unpublished posts |
| /api/cron/social-publish-watchdog | */5 * * * * | Watch for stuck publish jobs |

### Webhook inventory (relevant to Insights)

| Route | Purpose |
|---|---|
| POST /api/webhooks/bundlesocial | Receives post.published, post.failed, social-account.* events. No engagement metrics in payload — publication state only. |
| POST /api/webhooks/qstash/social-publish | QStash callback — fires the actual publish job. |
| POST /api/webhooks/qstash/social-post-history-import | QStash callback — drives the post-history import job on fresh connects. |

### Analytics API routes

| Route | Auth | Purpose |
|---|---|---|
| GET /api/platform/social/drafts/[id]/analytics | company member (view_calendar) | Per-draft analytics, Redis→Postgres→bundle.social waterfall |
| GET /api/admin/companies/[id]/social-profiles/[profileId]/analytics/dashboard | opollo_staff | BSP dashboard payload (snapshots) |
| POST /api/admin/companies/[id]/social-profiles/[profileId]/analytics/refresh | opollo_staff | Manual trigger for refreshAnalyticsForProfile |
| GET /api/cron/social-analytics-refresh | CRON_SECRET | Daily bulk refresh |

### Key env vars for Insights

```
BUNDLE_SOCIAL_API              - SDK key; required for refresh cron
BUNDLESOCIAL_WEBHOOK_SIGNING_SECRET - verifies inbound webhooks
SUPABASE_URL / SERVICE_ROLE_KEY / ANON_KEY - DB access
CRON_SECRET                    - protects cron routes
UPSTASH_REDIS_REST_URL/TOKEN   - analytics hot cache
```

No METRICOOL, N8N, SERPAPI, or FIRECRAWL env vars exist or are needed.

---

## Key Unknowns

1. **bundle.social analytics rate limits** — the code comments "5/day per team per platform" but this is an author assertion, not a linked API doc. If Insights becomes a separate service calling the same team's analytics endpoint, this limit applies. Resolves by: reading bundle.social API documentation for `/api/v1/posts/{id}/analytics` and `analyticsGetSocialAccountAnalytics` rate limits.

2. **bundle.social post.published webhook — does it carry engagement metrics?** The webhook types.ts shows only `postId`, `bundlePostId`, `platformPostUrl`, `error`. No engagement metrics. If bundle.social ever adds engagement to the webhook payload, the polling model could be eliminated. UNKNOWN: whether they plan to add this. Resolves by: checking bundle.social webhook documentation changelog.

3. **Instagram, Pinterest, TikTok analytics coverage** — platform-map.ts only maps linkedin_personal, linkedin_company, facebook_page, gbp. The SDK analytics enum includes INSTAGRAM, TIKTOK, YOUTUBE, PINTEREST, etc. Whether these endpoints actually return data for Opollo's bundle.social tier is UNKNOWN. Resolves by: testing analyticsGetSocialAccountAnalytics with INSTAGRAM platform type on a live connected account.

4. **Whether the bundlesocial SDK version in node_modules supports the analytics endpoints** — the SDK is present at node_modules/bundlesocial (confirmed by ls) but the specific version and whether analyticsGetBulkPostAnalytics is stable-API vs beta is UNKNOWN. Resolves by: reading node_modules/bundlesocial/package.json for version and changelog.

5. **Cross-client social pattern aggregation consent model** — Optimiser has `cross_client_learning_consent` on opt_clients. No equivalent exists on platform_companies or cap_subscriptions for social analytics cross-client aggregation. Any "industry benchmarks" Insights feature requires adding a consent flag and a separate aggregation job. Resolves by: designing the migration and getting Steven's sign-off on the consent model.
