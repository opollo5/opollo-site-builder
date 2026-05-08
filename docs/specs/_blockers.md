# Spec run blockers

## Spec 11 / 12 / 05-conditional / 14 PR B+C / 08 sweep — deferred from 2026-05-08 master-brief run

**Date:** 2026-05-08

The 2026-05-08 master brief covered eight specs (06, 07, 09, 08, 11, 12, 14, plus a conditional Spec 05 PR C). This session shipped six PRs against the truly-independent specs; the rest are deferred for the reasons below.

### Spec 11 — Yoast-style SEO panel (deferred)

Depends on Spec 10 (composer right-sidebar panel primitive). Spec 10 is being executed by a parallel session and is not yet in main. Once Spec 10 lands, Spec 11 can ship per its plan in the master brief: Google search preview at top, live length progress bars under SEO title + meta description (heuristic thresholds with qualifying language — "typically good" not "ideal"), no collapsible header, field order Google preview → SEO title → Slug → Meta description, Mobile/Desktop toggle dropped.

### Spec 12 — Composer typography + column width (deferred)

Depends on Spec 13 (composer right column work that frees the layout's right edge). Spec 13 is also in flight on a parallel session. Once Spec 13 lands: title input 40px desktop / 32px mobile (700 weight), body editor 18px / 1.7, prose-style overrides scoped to `.composer-editor-content` in `app/globals.css`, main column 760–800px desktop with 300px sidebar + 32–40px gap. **Composer-only — do NOT change the published post renderer.**

### Spec 05 PR C (conditional) — caption-quality follow-up (deferred)

The master brief gates this PR on >5% of `image_library` rows missing captions in production telemetry. The parallel session has already landed Spec 05 polish work (#752, #753, #754, #756 — picker debounce + suggest RPC vector array fix + bounded fetches + spec-aligned empty state). The caption-quality PR is conditional on Axiom telemetry that doesn't yet exist; defer until the data is available.

### Spec 14 PR B (shipped — pending manual review merge)

PR B (#772) shipped: `lib/hooks/use-activity.ts` (60s active window; keydown / mousedown / pointerdown / touchstart — NOT mousemove), `lib/hooks/use-auto-save.ts` (dirty-state guard + localStorage leader election + visibility-aware cadence), extended `useSessionExpiry` with 15-minute non-renewable grace period, `SessionGraceBanner`, and `hardLogout()`. Awaiting Steven's manual review + merge.

**Auto-save sweep findings (PR B):** BlogPostComposer already has localStorage-backed cadence-bumping wired up correctly. No server-side auto-save handler needed for current surfaces — existing patterns are sufficient. The `_blockers.md` note for surfaces-lacking-auto-save has no current entries.

### Spec 14 PR C (shipped — pending manual review merge)

PR C (#773) shipped: `app/auth/expired/page.tsx` with cybersecurity-explainer copy (three-bullet rationale: session-hijacking protection, compliance alignment, credential freshness). Force-static, no nav chrome. `hardLogout()` in `SessionExpiryWatcher` redirects here when grace elapses. Awaiting Steven's manual review + merge.

### Spec 08 surface sweep (partially shipped)

The primitive layer shipped (#762 — `SuccessMoment`, `useFirstTime`, `celebrate`, `toastSuccess`). This PR (feat/spec08-surface-sweep) ships:
- Post-publish hero in `PostDetailClient` — SuccessMoment with `firstTimeKey="post-published:{id}"`
- Batch-completion hero in batch detail page — new `BatchSuccessMoment` client component

**Deferred Tier-1 surfaces (no existing implementation; need new work):**
- **First-site-connection:** No trigger point exists in the current UI. The sites list (`app/admin/sites/page.tsx`) and site detail (`app/admin/sites/[id]/page.tsx`) don't track whether a WP connection is "first". Would need a `firstTimeKey="wp-connected:{siteId}"` trigger wired into the WP credential save flow. Defer to a targeted follow-up.
- **First-customer-onboarded:** No "customer onboarded" milestone event exists on any current surface. Would require identifying where company/customer onboarding completes and adding a `firstTimeKey` there. Defer to a targeted follow-up.

**toastSuccess standardization:** `PostDetailClient` migrated from `toast.success` → `toastSuccess`. Full sweep of remaining `toast.success` calls across other files is deferred to a separate cleanup PR.

### Trusted-devices feature reconsideration after 48h cap (Spec 14 follow-up)

Spec 14 PR A applies the 48h session cap to all sessions including trusted devices. This effectively reduces what `trusted_devices` means on this codebase — it remains a skip-2FA flag but no longer controls TTL. Steven should decide whether the feature has remaining value and either rename it (e.g. `mfa_remembered_devices`) or remove it.

### Image-search latency baseline (Spec 05 follow-up)

The master brief's Spec 05 P95 < 300ms target is aspirational ("not a hard SLA"). Real production P95 depends on Supabase region, vector index config, and embedding-call path. No telemetry exists yet to verify against. Once `/api/images/suggest` has been live for >24h, query Axiom for request duration P95; if above 300ms, investigate (likely fixes: hnsw index params, regional Supabase replica, or pre-compute warm cache).

---

## Spec 04 — Optimiser PageHeader sweep (TODO, do after `feat/optimiser` merges to main)

**Date:** 2026-05-08

**Spec section in tension:** Spec 04 PR E aimed to drain `PAGE_HEADER_DEFERRED_ROUTES` to `[]` for every admin-tier route. The optimiser module lives on the long-running `feat/optimiser` branch and is **out of scope** for this workstream by explicit instruction.

**What this leaves open:**

- Routes under `app/optimiser/**/page.tsx` will need the same Title → Breadcrumb → Subtitle → Meta → Actions migration once `feat/optimiser` merges into main.
- The audit script's `headings-use-page-header` rule scopes to `app/admin/` and `app/account/` only; it does NOT walk `app/optimiser/`. So nothing fires today, but the moment Steven adds the optimiser to the audit roots, every optimiser page.tsx will surface as HIGH.

**To execute:** after `feat/optimiser` lands, walk every `app/optimiser/**/page.tsx`, migrate header chrome to PageHeader (matching the patterns used in PRs B–E), then extend the `roots` array in `check11_headingsUsePageHeader`, `check12_breadcrumbRequiredWithPageHeader`, and `check13_noRawH1InPages` from `["app/admin", "app/account"]` to `["app/admin", "app/account", "app/optimiser"]`. PR 4 of the optimiser cleanup is the natural place.

---

## Spec 02 PR 2 — partial admin-route adoption sweep (8 of 37 routes)

**Date:** 2026-05-07

**Spec section in tension:** Spec 02 §2.1 ("Walk app/admin/**/page.tsx and migrate every page").

**What this PR did:**

Migrated the highest-traffic operator routes:

- `/admin/sites`
- `/admin/sites/new`
- `/admin/sites/[id]/edit`
- `/admin/sites/[id]/onboarding`
- `/admin/sites/[id]/setup`
- `/admin/sites/[id]/setup/extract`
- `/admin/sites/[id]/posts`
- `/admin/sites/[id]/settings`

**Routes deferred to a follow-up PR:**

- `/admin` (dashboard)
- `/admin/batches/*`
- `/admin/companies/*`
- `/admin/email-test`
- `/admin/images/*`
- `/admin/posts/new`
- `/admin/settings/*`
- `/admin/sites/[id]` (large detail page with rich aside)
- `/admin/sites/[id]/appearance`
- `/admin/sites/[id]/blueprints/*`
- `/admin/sites/[id]/briefs/*/run`
- `/admin/sites/[id]/briefs/*/review`
- `/admin/sites/[id]/content`
- `/admin/sites/[id]/design-system/*`
- `/admin/sites/[id]/pages/*`
- `/admin/sites/[id]/posts/[post_id]`, `/admin/sites/[id]/posts/new`
- `/admin/system/jobs`
- `/admin/users/*`

**Reason:** Single autonomous-run session couldn't reliably hand-migrate 37 page.tsx files within reasonable wall-time without risking subtle layout regressions. Each migration is mechanical but unique to the page's existing header structure.

**Implication for PR 3 (audit:static rules):** PR 3's `headings-use-page-header` and `breadcrumb-required-when-page-header` HIGH rules need an allowlist that excludes the deferred routes until a follow-up sweep migrates them. The allowlist is documented in `docs/RULES.md` with a target date.

---

## Spec 03 PR 3 — content_type gating without modifying brief-runner.ts

Surfaced by the autonomous spec runner. Each entry: which spec/PR, the
contradiction encountered, and the chosen interim behaviour.

## Spec 03 PR 3 — content_type gating without modifying brief-runner.ts

**Date:** 2026-05-07

**Spec section in tension:** Spec 03 §3.1 + §3.2.

- §3.1 requires `<blog_content_classes>` to emit only when `content_type='post'`.
- §3.2 says "This PR does not modify the runner" (per ARCH §18, `lib/brief-runner.ts` is on the cannot-refactor list).

**Reality on disk:**

- The runner calls `buildDesignContextPrefix(brief.site_id)` at `lib/brief-runner.ts:2004` — siteId only, no content_type, no `ctx` parameter.
- The spec's diagnostic ("`ctx.brief.content_type` mirrors the pattern at brief-runner.ts:656-661") didn't match the actual signature. The spec author wrote "If different, use the actual path and adjust this spec's wording" but also wrote "this PR does not modify the runner" — these instructions disagree when the only non-runner-touching path requires adding a DB read inside the helper.

**What this PR did:**

- Added optional `contentType?: 'post' | 'page'` parameter to `buildDesignContextPrefix()` and `renderInjection()`.
- Added the `<blog_content_classes>` block emission gated on `contentType === 'post'` AND `extracted_design.blog_styling` having usable data.
- **Did NOT modify `lib/brief-runner.ts:2004`.** The call site still passes only `siteId`. Result: with current main, the new block never emits — the helper extension is ready-to-activate but inert.

**To activate:** change `lib/brief-runner.ts:2004` from

```ts
const designContextPrefix = await buildDesignContextPrefix(brief.site_id);
```

to

```ts
const designContextPrefix = await buildDesignContextPrefix(
  brief.site_id,
  brief.content_type,
);
```

That single-line change is gated on Steven's explicit approval per ARCH §18.

**Why this is acceptable interim state:**

- All vitest tests for the helper still pass (they exercise both the gated and ungated paths via the optional parameter).
- No runtime regression: existing callers' behaviour is unchanged.
- PR 1 (extraction) + PR 2 (preflight gate) of Spec 03 still deliver value: operators can calibrate, gate fires at publish time. The third leg (model receives the calibrated classes) waits on Steven's approval to thread the parameter.
