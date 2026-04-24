# Pattern — Brief-driven generation

## When to use it

A process that accepts a whole-document brief (text/markdown today; PDF/.docx on the backlog), parses it into an ordered page list, then walks the list **one page at a time**, each page:
- seeing the full brief + a running summary of previously-approved pages in its context,
- running a multi-pass text loop (draft → self_critique → revise),
- running a visual review loop over the rendered draft (up to 2 iterations),
- pausing at `awaiting_review` for operator approval before the runner advances.

Inverts every assumption in the M3 batch worker: **sequential**, **stateful across pages**, **review-gated per page**, and **cost-variable per page** (anchor adds 2 extra text passes; visual review adds 0-2 iterations).

Today only M12 (whole-site briefs) uses this pattern. If a future milestone runs the same shape — a blog-post series with cross-post continuity, a multi-chapter document generator, anything else where **page N depends on approved pages 1..N-1** — follow this pattern rather than forking the runner.

## How it differs from the batch worker

The batch worker (M3) and the brief runner (M12-3) share their lease/heartbeat primitives with [`background-worker-with-write-safety.md`](./background-worker-with-write-safety.md). The brief runner adds five more invariants the batch worker doesn't need:

| | Batch worker (M3) | Brief runner (M12-3) |
| --- | --- | --- |
| Ordering | Fan-out parallel; slot N has no dependency on slot N-1. | Strictly sequential. Page N cannot start until page N-1 is `approved`. |
| Cross-slot state | None. Each slot is a leaf job. | Running `content_summary` + frozen `site_conventions` carry forward. |
| Review gate | Auto-approve via quality gates. | Pause at `awaiting_review`; operator must click approve before the runner advances. |
| Pass shape | One Anthropic call per slot. | 3-5 text passes + 0-2 visual passes per page. Anchor adds 2 extra revises. |
| Cost shape | Fixed (~30c per slot). | Variable 50-200c per page depending on model tier + visual iterations + anchor. Per-page cost ceiling is a hard stop. |

If a new feature only needs fan-out parallelism and auto-approval, use the batch worker pattern. If page N depends on 1..N-1, use this pattern.

## The nine invariants

Every brief-driven runner must satisfy the [five lease/heartbeat invariants](./background-worker-with-write-safety.md#the-five-invariants) plus these additional four:

6. **One active run per brief.** Partial UNIQUE index on `<run_table> (brief_id) WHERE status IN ('queued','running','paused')`. Second enqueue raises 23505. The DB is the guard — the app layer relies on this index existing, it does not duplicate the check.

7. **Per-pass idempotency keyed on (brief_id, ordinal, pass_kind, pass_number).** Deterministic, stable across retries. Anthropic's 24h cache replays the same response for free. Resume-after-crash re-enters at the same pass, the cache matches, no double billing.

8. **Anchor cycle freezes site conventions before page 2 starts.** Page 0 runs the standard passes PLUS `ANCHOR_EXTRA_CYCLES` (2) additional revises. The final revise is prompted to emit a ```json fenced block. Runner extracts, validates against `SiteConventionsSchema`, writes the result to `site_conventions` with `ON CONFLICT (brief_id) DO NOTHING`. Pages 1..N read this row verbatim — no re-summarisation, no drift.

9. **Per-page cost ceiling + hard iteration cap.** Default 200c per page (tenant override allowed). Before every visual iteration, runner checks `page_cost_cents + projected_iteration_cost > ceiling`. On hit: set `quality_flag = 'cost_ceiling'`, skip the loop, commit to `awaiting_review`. Visual iterations also hard-capped at 2 regardless of budget; on cap with critique still severity-high, set `quality_flag = 'capped_with_issues'`. A third iteration is structurally unreachable.

10. **Model tier is operator-controlled, allowlist-validated.** Per-brief columns for `text_model` + `visual_model`. DB CHECK against a curated allowlist; app-layer `isAllowedAnthropicModel` guard at pass-start. Unknown value → page fails with `INVALID_MODEL`, zero Anthropic calls fired. No hard-coded model string anywhere in the runner.

## The three state machines

Three interlocking state machines. All transitions under CAS on `version_lock`.

**`<run_table>.status`**

```
  (operator start)       (all pages approved)
queued ──────────────▶ running ─────▶ succeeded
  ▲                       │
  │                       │ (page reaches awaiting_review)
  │  (operator approve    ▼
  │   OR cancel clears)  paused
  │                       │
  │                       │ (operator cancel | page_failed | budget_exceeded)
  └───────────────────    ▼
                        cancelled | failed
```

**`<page_table>.page_status`**

```
pending ──▶ generating ──▶ awaiting_review ──▶ approved
                │                              (operator click)
                ▼
              failed
```

`skipped` is reserved for a future "operator chooses not to generate this page" surface; not wired today.

**Text pass sequence (`current_pass_kind` + `current_pass_number`)**

```
null ──▶ draft:0 ──▶ self_critique:0 ──▶ revise:0 ──▶ [anchor? revise:1 ─▶ revise:2] ──▶ null (→ gates → visual loop)
```

`nextPassAfter(currentKind, currentNumber, isAnchor)` is the pure function that walks this sequence. On resume-after-crash, the runner reads the persisted `current_pass_kind` + `current_pass_number`, asks `nextPassAfter` what's next, and re-enters there. Anthropic's per-pass idempotency key replays any in-flight pass for free.

**Visual pass loop**

Orthogonal to the text sequence. After text passes complete + gates pass + anchor freeze lands, the runner enters:

```
for i in 0..VISUAL_MAX_ITERATIONS:
    if would_exceed_ceiling(): quality_flag='cost_ceiling'; break
    critique = visual_render + multi_modal_claude
    persist critique_log entry
    if no severity-high issues: break          # clean exit
    if i == VISUAL_MAX_ITERATIONS-1: quality_flag='capped_with_issues'; break
    if would_exceed_ceiling(with_revise_cost): quality_flag='cost_ceiling'; break
    visual_revise_text_pass(with_critique_as_feedback)
→ awaiting_review
```

Screenshots live in the worker tmpdir, base64-inlined into the multi-modal call, and unlinked in a `finally` on every path. **No Storage write, no log line containing image bytes.** If the operator needs to re-see what Claude saw, the approve surface re-renders from the current `draft_html` on demand.

## Required files

| File | Role |
| --- | --- |
| Migration `supabase/migrations/0NNN_<flow>_schema.sql` | `<brief_table>`, `<page_table>`, `<run_table>` with soft-delete + audit columns + `version_lock` + coherence CHECKs (e.g. `committed_at IS NOT NULL ⇔ status='committed'`). Partial UNIQUE `(brief_id) WHERE status IN ('queued','running','paused')`. |
| Migration `supabase/migrations/0NNN_<flow>_cost_controls.sql` | `page_cost_cents`, `run_cost_cents`, `quality_flag` (CHECK enum), `text_model` + `visual_model` (CHECK against allowlist), `tenant_cost_budgets.per_page_ceiling_cents_override`. |
| `lib/<flow>-parser.ts` | Structural-first parser (H1/H2, `---`, numbered headers) + Claude-inference fallback. Returns a draft page list with per-page `mode in ('full_text','short_brief')`. |
| `lib/<flow>-runner.ts` | `processBriefRunTick(runId, opts)` entry. Lease/heartbeat/reaper primitives. `processPagePassLoop` (text sequence). `runVisualReviewLoop` (visual loop with cap + ceiling). `approveBriefPage` helper. |
| `lib/visual-review.ts` | `defaultVisualRender` (Playwright, tmpdir-scoped). `critiqueBriefPageVisually`. `VisualCritiqueSchema`. `hasSeverityHighIssues`, `resolvePerPageCeilingCents`, `wouldExceedPageCeiling` helpers. |
| `lib/<flow>-runner-dummy.ts` | Deterministic stub Anthropic + visual render for preview and E2E environments that run without `ANTHROPIC_API_KEY`. |
| `lib/anthropic-pricing.ts` additions | `ANTHROPIC_MODEL_ALLOWLIST` derived from the `PRICING_TABLE` keys. `isAllowedAnthropicModel`. `estimatePerPageCostCents` + `estimateBriefRunCostCents` for the pre-flight. |
| `app/api/briefs/[brief_id]/commit/route.ts` | Freezes the page list. Accepts `text_model` / `visual_model` as optional body fields. |
| `app/api/briefs/[brief_id]/run/route.ts` | POST wraps `startBriefRun`. GET returns the pre-flight estimate. |
| `app/api/briefs/[brief_id]/cancel/route.ts` | Idempotent halt. Leaves generated pages. |
| `app/api/briefs/[brief_id]/pages/[page_id]/approve/route.ts` | Promotes `draft_html` → `generated_html` under CAS; re-queues run at ordinal+1. |
| `app/api/briefs/[brief_id]/pages/[page_id]/revise/route.ts` | Operator note + re-queue at current ordinal. Appends to `operator_notes` (timestamped). |
| `app/api/cron/process-<flow>-runner/route.ts` | Bearer-auth'd tick entrypoint. Reaps expired leases, picks oldest queued run, calls `processBriefRunTick`. Routes to real Anthropic when key set; otherwise dummy stub. |
| `vercel.json` cron | 1-minute schedule for the cron route above. |
| `app/admin/sites/[id]/briefs/[brief_id]/review/page.tsx` + client | Parse-review surface; commit form with model-tier selects. |
| `app/admin/sites/[id]/briefs/[brief_id]/run/page.tsx` + client | Run surface: cost panel, per-page cards, preview, approve / revise / cancel. |
| `lib/__tests__/<flow>-runner.test.ts` | Happy path + idempotency key stability + pass cap (anchor vs non-anchor). |
| `lib/__tests__/<flow>-runner-concurrency.test.ts` | Partial UNIQUE 23505 + two concurrent ticks serialise. |
| `lib/__tests__/<flow>-runner-anchor.test.ts` | Anchor freeze writes `site_conventions` with `frozen_at`; runner halts at awaiting_review + zero re-tick calls. |
| `lib/__tests__/<flow>-runner-visual.test.ts` | Cap-at-2 + cost ceiling + model allowlist + cost rollup. |
| `lib/__tests__/<flow>-routes.test.ts` | Start run (CONFIRMATION_REQUIRED + BRIEF_RUN_ALREADY_ACTIVE), cancel (idempotent), revise (INVALID_STATE + VERSION_CONFLICT). |
| `e2e/briefs-full-loop.spec.ts` | Upload → commit → start → drive cron ticks → approve → approve → cancel. Runs against the dummy stub when no ANTHROPIC_API_KEY. |

## Operator UX contract

The UI surfaces three non-obvious cost signals the operator must see:

1. **Pre-flight estimate** with a soft-gate `CONFIRMATION_REQUIRED` response when estimate exceeds 50% of remaining monthly budget. The client renders a modal with explicit `estimate_cents` and `remaining_budget_cents` numbers. Operator overrides with `confirmed: true`.
2. **Per-page + per-run cost rollup** on the run surface: `brief_pages.page_cost_cents` stamped in the same CAS UPDATE as the `critique_log` write; `brief_runs.run_cost_cents` rolls up in the same transaction shape. Never drifts from the sum-of-pages.
3. **`quality_flag` badges** on page cards. `cost_ceiling` = the per-page ceiling halted the visual loop; `capped_with_issues` = 2 iterations ran but critique still severity-high. Operator sees the flag + the critique and decides whether to approve, revise-with-note, or cancel.

## Resume semantics

Resume-after-crash is handled at three layers:

1. **Lease timeout.** A crashed worker's row is reaped back to `queued` after `lease_expires_at < now()`. Next cron tick picks it up.
2. **Text-pass resume.** The page row carries `current_pass_kind` + `current_pass_number`. `processPagePassLoop` reads them and calls `nextPassAfter` to determine entry point. Anthropic's idempotency cache replays the last-in-flight pass for free.
3. **Visual-pass resume.** Visual iteration count is reconstructed from `critique_log` entries with `pass_kind='visual_critique'`. The loop picks up from that count.

Operator-visible state (`approved`, `cancelled`, `awaiting_review`) is **never rolled back** by a resume. Resume only re-enters states the runner itself owns.

## What not to do

- **Don't hard-code the model.** `RUNNER_MODEL` is a fallback constant for backward-compat; real callers resolve the model from `briefs.text_model` / `briefs.visual_model` per run. Allowlist-validate at pass start.
- **Don't loop visual iterations in the visual-review lib.** That lib is stateless. The runner owns the cap. Enforcing the cap in one place (the runner) makes the "runner never runs iteration 3" test simpler.
- **Don't persist screenshots.** Parent plan Risk #8. The `finally` cleanup runs on every path — render success, render throw, critique throw, critique-parse-failed. No Storage write. The Langfuse trace wrapper redacts image bytes from its span input; don't undo that by logging `req.messages` directly.
- **Don't advance past `awaiting_review` automatically.** The runner's `advanceOneStep` checks `page_status === 'awaiting_review'` and pauses the run without entering the pass loop for ordinal+1. Zero Anthropic calls fire on a re-tick.
- **Don't fork the runner for a new flow.** Parameterise the existing `lib/brief-runner.ts` via the mode dispatch shipped in M13-3 (pages vs posts). A new generation shape that's truly incompatible is rare enough that PR review catches it; defaults to "extend, don't fork".

## Related patterns

- [`background-worker-with-write-safety.md`](./background-worker-with-write-safety.md) — the lease/heartbeat primitives this pattern inherits.
- [`quality-gate-runner.md`](./quality-gate-runner.md) — the gate contract the runner reuses between text passes and visual pass.
- [`new-api-route.md`](./new-api-route.md) — the shape of the five new routes (commit, run, cancel, approve, revise).
- [`playwright-e2e-coverage.md`](./playwright-e2e-coverage.md) — the E2E spec shape, extended here by the cron-tick driver (`/api/cron/process-brief-runner` with Bearer) for advancing the runner between Playwright steps.

## Shipped surface

As of M12-6, this pattern is in production as the whole-site brief runner:
- `lib/brief-runner.ts` (text + visual loop, lease/heartbeat/reaper, approveBriefPage)
- `lib/visual-review.ts` (render + critique + cap helpers)
- `lib/brief-runner-dummy.ts` (stub for preview + E2E)
- Five admin routes under `app/api/briefs/[brief_id]/`
- Two admin pages (`review`, `run`) under `app/admin/sites/[id]/briefs/[brief_id]/`
- Cron tick at `/api/cron/process-brief-runner` (1-minute Vercel schedule)

M13's post-runner (M13-3) reuses the same runner via the mode dispatch — first cross-reuse. If a third shape lands, audit this doc against the actual diff; promote any stable deltas into the checklist above.
