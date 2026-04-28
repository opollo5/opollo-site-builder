# Path B migration — parent plan

## What it is

Rebuild Opollo's content-generation surface from "full standalone HTML documents" (path A) to "body fragments + theme contract" (path B), per the decision recorded in `docs/INTEGRATION_MODEL_DECISION.md`. The runner stops emitting `<!DOCTYPE>` / `<html>` / `<head>` / inline `<style>` chrome. The host WP theme — Kadence by default — provides container width, fonts, palette, spacing, and base typography. Opollo emits a contiguous fragment of scoped sections (`<section data-opollo class="...">…</section>`) that slot into the WP page's content area and inherit the theme's tokens.

This is a rebuild, not a refactor. Three subsystems (M3 batch runner, M7 regen runner, M12 brief runner) and two surfaces (preview iframe, M13 Kadence sync) all change. Existing M2-era full-doc generations need a migration decision. The headline win is that production rendering and preview rendering converge — what the operator sees in the iframe matches what the customer sees on the live site.

## Why this is the structure we picked

The decision doc captured three paths. Path B was chosen because it gives operators in-WP edit access to generated content (via the WP block editor on the fragment), drops per-page token cost ~30–50%, and makes M13 Kadence sync a load-bearing content path rather than decoration — turning the M13 investment into the visual contract for everything Opollo emits. Path C (templated blocks) was rejected for cost: a curated block-template registry is end-of-year scoped, and Opollo needs to ship to first paying customer before then. Path B's migration cost is mid-quarter scoped — substantial but tractable.

Live evidence of "what current behaviour produces" is preserved as page `dcbdf7d5-b867-443b-afdf-f60a28f968aa` (26,286-char path-A doc, `awaiting_review`). It will be retired once Path B replaces the runner.

## Sub-slice breakdown (9 PRs)

| Slice | Scope | Write-safety rating | Effort | Blocks on |
|---|---|---|---|---|
| **PB-1 + PB-2** (lockstep) | Brief runner prompt rework + quality gate rework | High | M | Nothing |
| **PB-3** | Preview iframe theme injection | Low | M | Nothing (parallel with PB-1) |
| **PB-4** | M3 batch runner alignment | High | S | PB-1 + PB-2 (template) |
| **PB-5** | M7 regen runner alignment | High | S | PB-1 + PB-2 (template) |
| **PB-6** | Existing M2 / M3 / M12 data migration decision + execution | Medium | S decision, M–L execution | PB-1, PB-4, PB-5 land |
| **PB-7** | Publish path validation (regression test only) | Low | S | PB-1 |
| **PB-8** | M13 reframe — palette + typography sync as content path | Low | S | Nothing (parallel) |
| **PB-9** | Cost-control reset — `RUNNER_MAX_TOKENS` 16384 → 4096 | Low | S | PB-1 + PB-2 land |

**Effort key:** S = under 2 hours, M = ½–1 day, L = 1+ days (single contributor).

**Execution order:** PB-1 + PB-2 ship together as one PR (the gate must change in lockstep with the prompt — a path-B fragment fails PR #188's path-A structural gate, so they're inseparable). PB-3 / PB-8 can land any time. PB-4 / PB-5 ship after PB-1+PB-2 lands (so their prompts can copy the validated template). PB-7 / PB-9 ship after PB-1+PB-2 to validate / harvest the cleanup. PB-6 is last — it can't run until the new pipeline is proven on at least one fresh generation.

---

## PB-1 + PB-2 — Brief-runner prompt rework + quality gate rework (lockstep)

### Scope

Two changes ship in one PR because either alone breaks the runner:

- **Prompt rework.** `lib/brief-runner.ts` user prompts for `draft`, `revise`, `visual_revise`, `self_critique` are rewritten to forbid all document chrome. The model is told: "Output a single contiguous HTML fragment. Top-level elements are `<section>` with `data-opollo` attribute and a scoped class name. Do NOT emit `<!DOCTYPE>`, `<html>`, `<head>`, `<body>`, `<nav>`, `<header>`, `<footer>` (chrome and navigation are owned by the host WP theme). Inline `<style>` is permitted only for animation-keyframe and utility-only rules under 200 chars total per page; visual styling comes from the theme palette and the design system tokens injected as CSS variables on `[data-opollo]` scope."
- **Quality gate rework.** PR #188's `isHtmlStructurallyComplete()` is replaced (not deleted — kept available for path-A validation if ever needed) with `isFragmentStructurallySound()`. The new gate validates: no `<!DOCTYPE>`, no `<html>`, no `<head>`, no `<body>` tags; balanced top-level `<section>` opens and closes; inline `<style>` total length ≤ 200 chars; every top-level element has `data-opollo` attribute and a class with the design-system-bound scope prefix; no unescaped `<script>` content.

### What lands

- `lib/brief-runner.ts` — prompt strings rewritten; `RUNNER_MAX_TOKENS` stays at 16384 for this PR (PB-9 drops it). `isHtmlStructurallyComplete` retained as a named export for path-A validation in test fixtures only.
- `lib/brief-runner-fragment-gate.ts` (new) — `isFragmentStructurallySound(fragment, opts)` exported helper plus a sibling `extractTopLevelSections()` that returns the structural shape for downstream consumers. Pure logic, no DB.
- `lib/brief-runner.ts` — the post-visual-review gate that previously called `isHtmlStructurallyComplete` now calls `isFragmentStructurallySound`. Retry path (PR #188) preserved but with the fragment-shape recheck.
- `lib/__tests__/brief-runner-fragment-gate.test.ts` — comprehensive matrix: clean fragment (accepted), DOCTYPE leaked (rejected), `<head>` leaked (rejected), unbalanced sections (rejected), inline `<style>` over 200 chars (rejected), missing `data-opollo` attr (rejected), missing scope class (rejected), `<script>` content (rejected).
- `lib/__tests__/brief-runner.test.ts` updates — fixture HTML in `DRAFT_OUTPUT` / `REVISE_OUTPUT` rewritten to fragment shape so the runner's happy-path tests still pass.
- One new prompt-evaluation eval fixture under `lib/__evals__/` if the eval harness exists, else a smoke test that calls a stubbed `AnthropicCallFn` and asserts the fragment-shape output matches the gate.

### Acceptance criteria

- `brief-runner.test.ts` happy-path tests pass with fragment-shape fixtures.
- `brief-runner-fragment-gate.test.ts` matrix covers all 8 rejection paths above plus the happy path.
- Manual smoke run against `dcbdf7d5-...` (now retired test page) regenerates a page; result is a fragment, not a full doc.
- The structural retry (PR #188) still fires when the fragment is malformed and still flags `quality_flag='malformed_html_truncated'` on second-failure.
- Test coverage on `brief-runner.ts` does not drop below the existing baseline.

### Risks identified and mitigated

- **Existing tests fail because their fixtures are full-doc shapes.** Update fixtures in lockstep. Documented count: brief-runner.test.ts uses `<section><h1>…</h1></section>` already (was scope-guarded by PR #188's "claims completeness" check, which the new fragment gate also handles). brief-runner-anchor.test.ts, brief-runner-concurrency.test.ts, brief-runner-mode.test.ts, brief-runner-visual.test.ts — audit each for assumptions about full-doc shape. Some may be unaffected, some may need fixture updates.
- **Model ignores prompt and emits chrome anyway.** The fragment gate catches this and triggers PR #188's retry-with-bumped-tokens path, then flags. Operator sees the flag. Documented in Cluster B of the visual-review escape valves.
- **Inline `<style>` allowance is the abuse vector.** A model that crams a 5KB stylesheet into 200 chars of inline style would essentially recreate path A by minification. The 200-char cap is enforced server-side, but the scoping rule (`[data-opollo]` only) means even minified styles can't bleed onto theme CSS.
- **Retry path's prompt** (`retryFinalRevisePassForTruncation`) needs the same fragment guidance. Update its `previousVisualCritique` synthetic message to ask for a fragment, not a complete doc.

### Test plan

- Unit: fragment-gate matrix (above), runner happy path with new fixtures.
- Integration: an end-to-end runner tick with a stubbed call returning a known fragment; asserts the page lands `awaiting_review` with `quality_flag=null` and `draft_html` matches the fragment shape.
- Manual: one real Anthropic call against a smoke brief, eyeball the output for chrome leakage.

### Rough effort

M (1 day). Prompt iteration is the time sink — getting Claude to consistently emit fragments requires 2–3 prompt revisions and quality-gate runs. Tests and gate code are mechanical.

---

## PB-3 — Preview iframe theme injection

### Scope

`components/BriefRunClient.tsx`'s preview iframe currently renders `srcDoc={html}` directly. With path-B fragments, that produces unstyled raw HTML — the iframe shows ugly default-styled output that doesn't match production. PB-3 wraps the fragment in a synthetic doc that loads the host WP theme's CSS so the preview matches what the operator will see post-publish.

Two implementation choices, **decision needed in PR**:

- **Option A — Inline-link the WP theme stylesheet.** Synthetic wrapper:
  ```html
  <!DOCTYPE html><html><head>
    <link rel="stylesheet" href="https://customer-wp.example/wp-content/themes/kadence/style.css" />
    <link rel="stylesheet" href="https://customer-wp.example/wp-content/plugins/kadence-blocks/dist/style-blocks.css" />
    <style>:root { /* DS tokens injected here */ }</style>
  </head><body>{fragment}</body></html>
  ```
  Requires CSP allowance for the WP origin in `lib/security-headers.ts` connect-src or as an iframe-scoped allow. Pro: live theme, always current. Con: CSP surgery + cross-origin iframe quirks + customer-WP availability dependency for previews.
- **Option B — Static theme-CSS snapshot.** A nightly job (or operator-triggered fetch) pulls the customer's theme CSS bundle and stores it as a Supabase Storage object keyed by site_id + sha. Iframe loads from that snapshot. Pro: no runtime cross-origin dependency, no CSP changes. Con: snapshot can drift; need a refresh button + a "snapshot taken at" timestamp.

Trade-off captured in the PR body; Steven picks before merge.

### What lands

- `components/BriefRunClient.tsx` — synthetic doc wrapper around the fragment for the preview iframe. Sandbox stays `""` (most restrictive). Truncation banner from PR #189 keeps firing on path-A escape leaks.
- `lib/security-headers.ts` (Option A only) — connect-src widening or iframe-scoped CSP.
- `lib/wp-theme-snapshot.ts` (Option B only) — fetch + store + retrieve helper.
- New supabase storage bucket (Option B only) — `theme-snapshots`, RLS service-role-only, public-read for the iframe.
- `docs/patterns/preview-iframe-contract.md` (new) — pinned contract documenting: what gets wrapped, what stylesheets load, CSP shape, snapshot freshness rules. Becomes the spec for any future preview surface (post-publish preview, regen preview, etc.).

### Acceptance criteria

- Preview iframe of `dcbdf7d5-...` (path-A doc, retained as evidence) renders as before — the synthetic wrapper detects the leading `<!DOCTYPE>` / `<html>` and doesn't double-wrap.
- A path-B fragment renders with theme CSS applied — manual visual confirmation against the customer's WP site.
- CSP doesn't break any other surface (run lighthouse on `/login` post-change).
- The preview-iframe contract doc names the wrapper inputs, outputs, failure modes.

### Risks identified and mitigated

- **CSP regression (Option A).** Widening connect-src to a customer origin loosens CSP for the whole admin surface. Mitigation: scope the allowance to the iframe's CSP attribute (HTML5 `csp` attribute on `<iframe>`) rather than the global response header.
- **Snapshot drift (Option B).** Operator changes the theme; preview shows the old version until the snapshot refreshes. Mitigation: snapshot timestamp visible in the preview UI; one-click refresh button next to the iframe.
- **Operator-pasted draft_html that's still path-A leaks unstyled chrome.** Detect the leading DOCTYPE; render path-A docs in srcDoc directly (current behaviour). Wrap only fragments. The truncation banner from PR #189 already handles this distinction via `claimsCompleteness` heuristic.

### Test plan

- Component snapshot of `BriefRunClient` with both fragment and full-doc page rows.
- Manual visual against a real customer site for both options.

### Rough effort

M (½ day for Option A, 1 day for Option B). Documenting the contract is the larger half.

---

## PB-4 — M3 batch runner alignment

### Scope

M3's `batch-worker.ts` uses the same prompt + quality-gate primitives as M12 but for batch-driven page generation (no brief, no anchor cycle, slot-based). Mirror PB-1 + PB-2 changes into the M3 path: prompts forbid chrome, gates accept fragments only.

### What lands

- `lib/batch-worker.ts` — prompt strings updated to fragment-only.
- `lib/runner-gates.ts` (or wherever the M3-side gates live) — switch from `isHtmlStructurallyComplete` to `isFragmentStructurallySound`.
- `lib/__tests__/batch-worker*.test.ts` — fixture updates + gate-shape assertions.

### Acceptance criteria

- All existing M3 batch-worker tests pass with fragment fixtures.
- A real batch run against a smoke site emits fragments, not docs.

### Risks identified and mitigated

- **M3 has its own quality gates (capped_with_issues, cost_ceiling) that key off content shape.** Audit: does the cost-ceiling logic care about token-output count? Probably yes — fragments are smaller, so fewer outputs hit the ceiling. Document the change in cost expectations.
- **Idempotency keys are content-hashed.** A fragment of a regenerated page produces a different hash than the prior full-doc version. Mitigation: idempotency on `(generation_job_id, slot_index)` is already independent of content shape — verify in the M3 test that re-run with same key returns same row.

### Test plan

Same shape as PB-1.

### Rough effort

S (2 hours). Mostly mirror work since PB-1 + PB-2 build the template.

---

## PB-5 — M7 regen runner alignment

### Scope

M7's regen path mirrors M3 batch but for single-page regenerations triggered by operator action. Same prompt + gate change.

### What lands

- `lib/regeneration-publisher.ts` — prompt + gate updates.
- `lib/regeneration-worker.ts` if applicable.
- `lib/__tests__/regeneration*.test.ts` — fixture updates.

### Acceptance criteria

- Regen tests pass with fragment fixtures.
- A regen of an existing path-A page produces a path-B fragment (separate concern from PB-6's data migration).

### Risks identified and mitigated

- **Regen against a path-A page produces a path-B output that doesn't match the original's visual.** Expected and intended. The operator's mental model is "regen replaces the page"; documenting this in the regen confirm modal is sufficient.
- **`html_image_rewrite.ts` walks the HTML to swap image URLs.** Verify it handles fragment shape (no `<head>` / `<body>` to skip past).

### Test plan

Same shape as PB-4.

### Rough effort

S (2 hours).

---

## PB-6 — Existing M2 / M3 / M12 data migration decision + execution

### Scope

A decision PR followed by an implementation PR (or a single combined PR if the trade-offs make the choice obvious). Existing rows in `pages.generated_html`, `posts.generated_html`, `brief_pages.draft_html`, `brief_pages.generated_html` hold path-A full-doc HTML. After PB-1 / PB-4 / PB-5 land, the runner emits path-B fragments. The two shapes coexist on disk. **What do we do with the legacy rows?**

Three options. Trade-offs:

- **Regenerate-on-next-publish.** Mark legacy rows with a `legacy_path_a` flag. Runner refuses to publish a legacy row without a fresh regen. Operator clicks regen, runner produces a path-B fragment, publish proceeds. Pro: zero data loss; operator-controlled; preserves the legacy doc as a fallback fixture. Con: every legacy page needs an operator action; cost of regen × N pages; slow rollout; runtime branching in publish path.
- **Lossy extraction.** One-time backfill: for each row, parse the path-A HTML, extract `<body>` content, strip `<head>` + chrome, write back as fragment. Use jsdom + a hand-tuned extractor. Pro: zero operator effort; fast (one cron); preserves rough content. Con: lossy — inline `<style>` blocks die; layout that depended on head-CSS breaks; no visual QA gate; some pages will look wrong post-migration.
- **Leave as-is.** Path-A rows stay path-A; path-B rows are new. Runtime branches: publish path checks `claimsCompleteness(html)` and routes to path-A vs path-B publish accordingly; preview iframe (PB-3) handles both shapes via DOCTYPE detection. Pro: zero migration risk; old content keeps working as it always did. Con: two code paths in publish + preview forever; mental overhead; harder to retire path-A code.

Decision dimensions: how many existing rows? How dollar-expensive is regen × N? How visually important is preserving exact past output? How much UI surface area can we afford for runtime branching?

The decision PR establishes which option to take and includes a row-count survey (how many legacy rows exist per table). The implementation PR follows.

### What lands (decision PR)

- `docs/plans/path-b-data-migration-decision.md` — captures row counts (queried via a one-shot diagnostic), trade-offs, decision.
- Updates this parent plan with the chosen option.

### What lands (implementation PR — option-dependent)

- **Option 1 (regenerate-on-next-publish):** schema migration adding `pages.legacy_path_a boolean DEFAULT true` / `posts.legacy_path_a boolean DEFAULT true` / `brief_pages.legacy_path_a boolean DEFAULT true` for existing rows; new rows default false. Publish path checks the flag and refuses if true. Operator-facing UI banner naming the legacy state + regen CTA.
- **Option 2 (lossy extraction):** `scripts/migrate-path-a-to-fragment.ts` — read each legacy row, parse with jsdom, extract `<body>`, write back. Dry-run mode with diff preview. Operator-confirmed batch mode.
- **Option 3 (leave as-is):** runtime branch in publish (`lib/wp-rest-pages.ts` / `lib/wp-rest-posts.ts`) using DOCTYPE detection. Branch in preview iframe (PB-3 already does this via the wrapper detection). Document the dual-path indefinitely.

### Acceptance criteria (option-dependent)

- Whichever option lands, the chosen path's tests pass and existing tests don't regress.
- Operator can publish at least one legacy page successfully under the chosen path.

### Risks identified and mitigated

- **Lossy extraction destroys content.** Backups before write; dry-run diff; operator-confirmed batch.
- **Operator regenerates and the new fragment is visually worse.** Pre-flight preview of the regen result before the legacy row is replaced. Operator can decline.
- **Runtime branching is permanent.** Document the branch as a `legacy_path_a` BACKLOG entry with a "retire when X% of rows are path-B" trigger.

### Test plan

- Decision PR: docs only.
- Implementation PR: depends on option chosen.

### Rough effort

S for decision, M–L for implementation (option-dependent).

---

## PB-7 — Publish path validation (regression test only)

### Scope

`lib/wp-rest-pages.ts` and `lib/wp-rest-posts.ts` POST `content` to WP. The `content` field accepts any HTML — fragment or full doc — and WP renders it inside the page's content area. No code change expected; PB-7 is a regression test that confirms this assumption holds.

### What lands

- `lib/__tests__/wp-rest-pages-fragment.test.ts` — POST a fragment, mock WP returns success, assert no client-side rejection / sanitisation / unwrapping.
- `lib/__tests__/wp-rest-posts-fragment.test.ts` — same for posts.

### Acceptance criteria

- Both tests pass against the existing wrappers with no code change.
- If a code change IS needed (e.g. a sanitiser somewhere strips top-level `<section>`), document it and ship the fix in the same PR.

### Risks identified and mitigated

- **WP's wp_kses default sanitisation strips `<section>` or `data-opollo` attributes.** Catch in test against the WP fixture; if confirmed, the fix is `wp_kses_allowed_html` filter in a mu-plugin or theme `functions.php` — out-of-scope for Opollo and an operator install step. Document.
- **Featured-media / SEO plugin metadata writes (M13-2) assume content has `<title>` / `<meta>` in the head.** Fragments don't have a head. Audit `lib/wp-rest-posts.ts` + `lib/seo-plugin-detection.ts` for any reads off the body's head. Likely none — those metadata writes go through the post's WP custom-fields, not by parsing content.

### Test plan

Unit tests above.

### Rough effort

S (1 hour).

---

## PB-8 — M13 reframe (palette + typography sync as content path, not decoration)

### Scope

M13's Kadence palette sync was scoped under path-A's assumption: a polish item, drift = visual nuisance. Under path-B, palette sync IS the visual contract. Drift = content bug. Update the runbook + tests + monitoring to treat sync drift accordingly.

No code logic change in M13 itself — the sync mechanism is correct. What changes is severity, monitoring, and operator surface.

### What lands

- `docs/RUNBOOK.md` M13 entries — re-rate sync-drift incidents from "polish" to "content-correctness". Add a "verify sync before any path-B page publish" pre-publish check to the publish runbook.
- `lib/__tests__/kadence-palette-sync*.test.ts` — assertion severity bumps. Sync-drift tests that previously emitted a warning now fail the build.
- `app/api/sites/[id]/appearance/preflight/route.ts` — extend the preflight to refuse publish on a site with a sync-drift state (palette differs from DS tokens).
- `components/AppearancePanel.tsx` — visual treatment of "out of sync" upgrades from yellow warning to red alert.

### Acceptance criteria

- A site with palette drift cannot publish a path-B page until sync is restored.
- RUNBOOK entries have the new severity language.
- E2E covers the publish-blocked-on-sync-drift path.

### Risks identified and mitigated

- **Tightening preflight blocks sites that publish OK today.** Mitigation: feature-flag the preflight behind `FEATURE_PATH_B_PUBLISH_GATE`. Default off. Flip on per-site as path-B rolls out.
- **M13's existing tests assume sync is best-effort.** Audit and adjust expectations; some test failures are correct (the tests asserted weak guarantees that no longer hold).

### Test plan

- Unit: sync-drift severity bumps.
- E2E: preflight blocks publish on a drift-state site.

### Rough effort

S (2 hours).

---

## PB-9 — Cost-control reset

### Scope

PR #188 raised `RUNNER_MAX_TOKENS` 4096 → 16384 to fit a path-A doc. Path-B fragments are smaller (typically 2–6K chars ≈ 500–1500 tokens), so the original 4096 cap is comfortable headroom. Drop the cap back to 4096.

This also resolves the rate-limit BACKLOG entry (#191): with `max_tokens=4096`, a single call no longer exceeds the org's 4K-tokens-per-minute output cap. The entry can be retired.

PR #189's truncation banner stays — belt-and-suspenders for the rare case a model still exceeds the cap (e.g. a verbose revise prompt). Banner fires correctly on both path-A and path-B malformed shapes (the `claimsCompleteness` check applies to both).

### What lands

- `lib/brief-runner.ts` — `RUNNER_MAX_TOKENS = 4096`. `RUNNER_RETRY_MAX_TOKENS_HTML` retained at 16384 for the rare retry case (still under the 4K-per-minute cap if the prior pass had already consumed less than 0 tokens this minute, which is the normal cadence).
- `docs/BACKLOG.md` — drop the rate-limit conflict entry (PR #191).

### Acceptance criteria

- Cost per page in a smoke run measurably drops vs. the path-A baseline (target: ≥30% reduction; nice-to-have: ≥50%).
- No rate-limit incidents for at least one full day of normal runner activity.

### Risks identified and mitigated

- **A path-B fragment is occasionally larger than 4096 tokens (long-form blog post).** Structural retry from PR #188 still kicks in; bumps to 16384 for one retry. If the doc is genuinely too large, `quality_flag='malformed_html_truncated'` flags it and operator sees the issue.
- **The retry path's 16384 still trips the rate limit.** Possible if multiple retries hit in a 60s window. Mitigation: log + monitor; fall back to inter-call sleep if recurrence becomes routine. Reuses the rate-limit BACKLOG fix shapes.

### Test plan

- Unit: existing brief-runner tests pass with the lower cap (no fixture change needed; fixtures are well under 4096).
- Manual: re-run the dcbdf7d5 smoke with path-B prompts + 4096 cap; confirm clean output, measured cost.

### Rough effort

S (1 hour).

---

## Execution order summary

```
[lockstep]  PB-1 + PB-2 (brief-runner prompt + gate)   ─┐
[parallel]  PB-3 (preview iframe)                       │ may ship before / during / after
[parallel]  PB-8 (M13 reframe)                          │ may ship anywhere
                                                         │
            (PB-1+PB-2 land)                             ▼
[serial]    PB-4 (M3 batch runner)                       (template established)
[serial]    PB-5 (M7 regen runner)                       (parallel with PB-4)
[serial]    PB-7 (publish path validation)               (cheap, can ship right after)
[serial]    PB-9 (cost-control reset)                    (after first successful PB-1 smoke)
                                                         │
            (all runners path-B)                         ▼
[serial]    PB-6 decision PR
[serial]    PB-6 implementation PR
```

PB-6 is last so the decision is informed by real path-B output and real cost data from PB-9.

## Write-safety contract (parent-level)

- **No silent path mixing.** A page either claims completeness (path A) or doesn't (path B). The publish path, preview iframe, and quality gates all key off `claimsCompleteness(html)`. Mixing is allowed by design (during PB-6 rollout); silent mixing — branch logic that doesn't say which path it's on — is forbidden.
- **PR #188's structural retry stays.** It adapts to whichever shape the gate is checking. The rare malformed output keeps falling through to the `malformed_html_truncated` flag.
- **PR #189's banner stays.** It fires on both shapes (its `claimsCompleteness` heuristic catches path-A incompleteness; the "is it missing closing tags" check catches the few path-B cases where chrome leaked then got truncated).
- **Idempotency keys are content-shape-agnostic.** Existing `(brief_id, ordinal, pass_kind, pass_number)` and `(generation_job_id, slot_index)` keys don't change. A path-A regen and a path-B regen of the same slot use the same key — Anthropic returns whichever response was cached first, then our gate decides what to do with it.

## Testing strategy

| Slice | Unit | Integration | E2E |
|---|---|---|---|
| PB-1 + PB-2 | Fragment-gate matrix; runner pass with fragment fixtures | brief-runner tick → fragment → awaiting_review | One smoke spec: upload brief → generate → assert fragment shape |
| PB-3 | BriefRunClient snapshot for both shapes | — | Browser preview matches production for at least one fixture |
| PB-4 | Mirror PB-1 for batch-worker | batch-worker tick → fragment | Existing M3 E2E updated |
| PB-5 | Mirror PB-1 for regen | regen tick → fragment | Existing M7 E2E updated |
| PB-6 | Option-dependent | Option-dependent | Option-dependent |
| PB-7 | wp-rest-pages / wp-rest-posts fragment POST | — | Existing publish E2E |
| PB-8 | Sync-drift severity bumps | Preflight gate blocks publish | E2E for drift-blocked publish |
| PB-9 | brief-runner pass at 4096 cap | — | Smoke regen confirms cost drop |

## Risks identified and mitigated (parent-level)

| Risk | Mitigation |
|---|---|
| **Gate + prompt drift — PB-2 lands but PB-1 prompt still emits docs.** | Lockstep PR (PB-1 + PB-2 ship together). The PR can't be split. |
| **Mid-rollout, M3 still emits path-A while M12 emits path-B; publish path can't tell which is which.** | `claimsCompleteness(html)` heuristic in publish + preview branches deterministically. Test that asserts both shapes survive a publish round-trip. |
| **Operator's WP theme doesn't have the CSS Opollo expects.** | PB-8 makes M13 sync load-bearing; preflight refuses publish on drift. Operator must run sync before publish. |
| **Rate limits return because retries still ask for 16K.** | PB-9 lowers normal cap; retry stays at 16K but now triggers on under 1% of pages. If recurrence > 5% per day, escalate to the inter-call-sleep mitigation from BACKLOG. |
| **PB-6 lossy extraction loses content the customer cared about.** | Operator-confirmed; backup-before-write; dry-run diff. Decision PR makes the trade-offs explicit before execution. |
| **Theme stylesheet snapshot (PB-3 Option B) goes stale and operator publishes against a wrong preview.** | Snapshot timestamp visible; one-click refresh; auto-refresh on every preflight. |
| **Existing brief-runner tests fail because their fixtures embed full-doc shapes.** | PB-1 + PB-2 PR includes fixture updates as a deliberate, audited line item. Reviewer checks every changed fixture preserves the test's original intent. |
| **The "two unhappy paths exist" mental model leaks into operator-facing copy.** | Single canonical preview rendering (PB-3); operator never sees the path distinction in normal use. Path-A legacy state is opt-in visible (PB-6 Option 1's banner) only. |

## Pointers

- `docs/INTEGRATION_MODEL_DECISION.md` — the trade-off doc that drove this rebuild. Required reading before any sub-slice.
- `docs/patterns/ship-sub-slice.md` — every PB-* PR follows this shape.
- `docs/patterns/brief-driven-generation.md` — needs an appendix update once PB-1 lands.
- `docs/RUNBOOK.md` — M13 entries get severity bumps via PB-8.
- `lib/brief-runner.ts` — the canonical site of PR #188's structural gate that PB-2 replaces. PR history there is the change log for the gate.
- `lib/__tests__/brief-runner.test.ts` and siblings — fixture audit list for PB-1 + PB-2.

## Sub-slice status tracker

| Slice | PR | Merged | Notes |
|---|---|---|---|
| PB-1 + PB-2 | #194 | 2026-04-28 | Brief-runner emits fragments; `runFragmentStructuralCheck` replaces path-A structural gate. |
| PB-3 | #199 | 2026-04-28 | Lowest-risk variant: shim stylesheet in `lib/preview-iframe-wrapper.ts`. Customer-CSS fetch deferred to BACKLOG ("Preview iframe — fetch customer theme CSS for high-fidelity preview"). |
| PB-4 | #197 | 2026-04-28 | M3 batch worker: prompt + fragment-structural gate added. |
| PB-5 | #198 | 2026-04-28 | M7 regen worker: prompt + fragment-structural gate added. |
| PB-6 (decision) | #201 | 2026-04-28 | "Leave-as-is dual-path" — see `docs/plans/path-b-legacy-data-decision.md`. Retire trigger captured in BACKLOG. |
| PB-6 (impl) | — | (deferred) | Implementation deferred per the leave-as-is choice. Retire trigger in BACKLOG. |
| PB-7 | #196 | 2026-04-28 | Regression test: WP wrappers forward fragment content unchanged. No production code change. |
| PB-8 | #200 | 2026-04-28 | Docs-only: M13 sync drift severity bumped to "content bug" in RUNBOOK. Hard publish gate behind `FEATURE_PATH_B_PUBLISH_GATE` deferred to BACKLOG. |
| PB-9 | #195 | 2026-04-28 | `RUNNER_MAX_TOKENS` 16384 → 4096; rate-limit BACKLOG entry retired. |
