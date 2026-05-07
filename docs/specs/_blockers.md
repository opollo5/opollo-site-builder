# Spec run blockers

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
