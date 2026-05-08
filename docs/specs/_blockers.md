# Spec run blockers

## ~~Spec 14 PR B — auto-save surface adoption~~ (RESOLVED 2026-05-08, PRs #783 + #787)

PR #783 shipped the autosave endpoint (`POST /api/sites/[id]/posts/[post_id]/autosave`) — last-write-wins partial PATCH; rejects already-published posts so the publish/unpublish CAS routes are never bypassed. PR #787 ships the first consumer surface — `PostDraftEditor` mounted on `PostDetailClient` when `post.status === 'draft'`. Title + RichTextEditor with cadence-escalating server flushes via `useAutoSave` (#772). Other long-form surfaces (wizards, multi-field forms) remain deferred — see entries below.

Original deferral note kept for context:

## ~~Spec 14 PR B — auto-save surface adoption (deferred to a follow-up slice)~~ (resolved per above)

**Date:** 2026-05-08

PR B ships the load-bearing infrastructure (`useActivity`, `useSessionGrace`, `useTabLeader`, `useAutoSave`) plus the grace banner and hard-logout enforcement. The auto-save **surface adoption sweep** is deferred — each long-form surface needs case-by-case review before adopting `useAutoSave`, and the parallel-session friction during the 2026-05-08 master-brief run makes large multi-file edits risky.

**Surfaces audited:**

- **`components/BlogPostComposer.tsx`** (post composer) — already has aggressive client-side autosave to `localStorage` (BL-2 pattern, debounced 800ms per keystroke, keyed by siteId). Local autosave survives logout, but a fresh login on a different browser does not. Adding a server-side `useAutoSave` flush here is a small change in principle but the composer is a 1700-line file with active parallel-session work; the slice deserves its own PR with thorough E2E coverage.

- **Site builder / Brief PDF parser surfaces** — no autosave exists. These are larger changes (multi-step wizards with file upload + parse pipelines). Adopting `useAutoSave` requires defining what "save" means at each step (snapshot the wizard state? PATCH the row?). Defer.

- **`components/SiteEditForm.tsx`, `components/SiteCreateForm.tsx`, `components/DesignDirectionInputs.tsx`, `components/SetupWizard.tsx`** — multi-field forms with explicit Save buttons. Adding autosave is mostly mechanical but each needs a server-side endpoint that accepts partial state. Defer.

**Recommendation for the follow-up slice:**

1. Start with the post composer: extend the existing localStorage autosave with a server-side flush keyed off `useAutoSave`, gated on `enabled === true` only when the post has an id. Verify the existing 800ms-debounced local save isn't double-firing the server save.
2. Then sweep one wizard surface (e.g. `SetupWizard.tsx`) as a proof point.
3. Each surface's PR should include an E2E test that simulates the grace banner appearing while the form is dirty.

Until adoption ships, the PR B infrastructure is **inert** — no surface uses `useAutoSave` yet — but the user-visible session-policy changes (grace banner, non-renewable timer, hard-logout enforcement) are live and protective on their own.

---

## Spec 11 / 12 / 05-conditional / 14 PR B+C / 08 sweep — deferred from 2026-05-08 master-brief run

**Date:** 2026-05-08

The 2026-05-08 master brief covered eight specs (06, 07, 09, 08, 11, 12, 14, plus a conditional Spec 05 PR C). This session shipped six PRs against the truly-independent specs; the rest are deferred for the reasons below.

### ~~Spec 11 — Yoast-style SEO panel~~ (RESOLVED 2026-05-08, PR #778)

The "blocked on Spec 10" status turned out to be loose: the existing composer sidebar already provides the panel surface. Shipped: `lib/seo/length-feedback.ts` with heuristic bucket maps (qualifying language, "typically good" not "ideal"), `<SeoLengthFeedback>` progress-bar component, rebuilt SEO section with field order locked to **Google preview → SEO title → Slug → Meta description**, slug input MOVED into the SEO section (Permalink panel removed), `<GoogleSnippetPreview>` enhanced with site-identity row + 80×80 right-aligned featured-image thumbnail. 23-case unit test on length-feedback heuristics.

### ~~Spec 12 — Composer typography + column width~~ (RESOLVED 2026-05-08, PR #779)

Same loose-dependency story for Spec 13. Shipped: `app/globals.css` `.composer-editor-content` overrides + `.composer-title-input` (32px mobile / 40px ≥1024px / 700 / 1.2). `RichTextEditor.tsx` adds the class; `BlogPostComposer.tsx` form grid → `lg:grid-cols-[minmax(0,800px)_300px] lg:gap-10`. Composer-only — published post renderer untouched.

### Spec 05 PR C (conditional) — caption-quality follow-up (deferred)

The master brief gates this PR on >5% of `image_library` rows missing captions in production telemetry. The parallel session has already landed Spec 05 polish work (#752, #753, #754, #756 — picker debounce + suggest RPC vector array fix + bounded fetches + spec-aligned empty state). The caption-quality PR is conditional on Axiom telemetry that doesn't yet exist; defer until the data is available.

### ~~Spec 14 PR B~~ (RESOLVED 2026-05-08, MERGED #772)

`lib/hooks/use-activity.ts`, `lib/hooks/use-session-grace.ts`, `lib/hooks/use-tab-leader.ts`, `lib/hooks/use-auto-save.ts`, `SessionGraceBanner`, hard-logout enforcement in `SessionExpiryWatcher`. All shipped + merged.

### ~~Spec 14 PR C~~ (RESOLVED 2026-05-08, MERGED #773 + #775)

`app/auth/expired/page.tsx` with cybersecurity-explainer copy (three-bullet rationale). `SessionExpiryWatcher` retargeted to redirect cap-driven logouts to `/auth/expired?returnTo=...` (#775); `returnTo` defended against absolute / protocol-relative URLs.

### ~~Spec 08 surface sweep~~ (RESOLVED 2026-05-08, PRs #774 + #776 + #782)

All five Tier-1 surfaces wired with `<SuccessMoment>`:
- Post-publish hero (PostDetailClient) — #774
- Batch-completion hero (BatchSuccessMoment) — #774
- First site connected (`/admin/sites/[id]/onboarding?fresh=1`) — #776
- First customer onboarded (`/admin/companies?created=...`) — #776
- Optimiser proposal applied (`/optimiser/proposals/[id]`) — #776
- Brief-run completed — parallel session (#764)

**Tier-2 toast.success → toastSuccess sweep:** RESOLVED via #782 (18 files swept; `lib/toast-success.ts` extended with `duration` + `id` passthrough so the helper covers every option the existing call sites passed; behaviour-only change).

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

## ~~Spec 03 PR 3 — content_type gating without modifying brief-runner.ts~~ (resolved 2026-05-08, PR #785)

**Date:** 2026-05-07 — **Resolved:** 2026-05-08

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

**Resolution (2026-05-08):** Steven approved on 2026-05-08. PR #785 made the change and merged. `<blog_content_classes>` now emits for `copy_existing` sites with calibrated blog styling when running `content_type='post'` briefs.

**Why this is acceptable interim state:**

- All vitest tests for the helper still pass (they exercise both the gated and ungated paths via the optional parameter).
- No runtime regression: existing callers' behaviour is unchanged.
- PR 1 (extraction) + PR 2 (preflight gate) of Spec 03 still deliver value: operators can calibrate, gate fires at publish time. The third leg (model receives the calibrated classes) waits on Steven's approval to thread the parameter.
