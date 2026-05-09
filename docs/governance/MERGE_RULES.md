# Merge rules — full version

> Moved from `CLAUDE.md` 2026-05-09 as part of the harness restructure.
> Source: pre-restructure CLAUDE.md §§ "Merging", "Self-test loop",
> "Sub-slice autonomy", "Auto-continue", "Enabling auto-merge",
> "PR auto-merge monitoring", "Self-audit is the review".
>
> CLAUDE.md keeps the §"Merge decision tree" — that's the load-bearing
> Yes/No flow. This file is the deeper-detail reference.

## Decision tree (mirrors CLAUDE.md)

The seven-step Yes/No flow lives in `CLAUDE.md` §"Merge decision tree".
This file expands on the operational mechanics, sub-slice autonomy,
and auto-continue chain.

## Auto-merge — operational mechanics

- Every PR must arm GitHub auto-merge at creation time. Call
  `mcp__github__enable_pr_auto_merge` with `mergeMethod: "SQUASH"`
  immediately after `create_pull_request` — not enabled implicitly.
  Without this, the PR sits mergeable until someone clicks the UI
  button, breaking the self-driving loop.
- **Never call `gh pr merge --auto`.** Branch protection has no
  required checks here, so `--auto` fires immediately without CI.
  Project memory documents the incident. Poll `gh pr checks` until
  every check is `pass` and only then call `gh pr merge --squash`.
- **Out-of-date with base** handling: if a polled PR shows state OPEN
  with mergeable=BEHIND, run `gh pr update-branch <PR>` automatically.
  If update-branch fails due to merge conflict, stop and report — do
  not force. If update-branch succeeds, continue polling; CI will
  re-run and auto-merge fires when green. Apply this to every PR being
  monitored, including stacks behind other PRs that just merged.

## Sub-slice autonomy

For sub-slices of a parent milestone whose plan Steven has already
approved (M2a/b/c/d under M2, etc.):

- Propose the sub-slice plan in the PR description itself, not as a
  message to Steven beforehand.
- Write code immediately against the approved parent plan.
- Open the PR with plan-as-description + code + tests in one go.
- Self-correct CI failures within the 10-retry ceiling
  (CLAUDE.md §"Self-test loop").
- Auto-merge when green.
- Status update to Steven once merged: one-liner, e.g.
  `M2c-2 merged, proceeding to M2c-3`.

Escalate only for: architectural decisions not in the parent plan,
spec deviations, security tradeoffs, or loop-detection
(CLAUDE.md §"Loop detection"). Do NOT escalate for: sub-slice
planning, operational/infra issues, routine tradeoffs already covered
in the parent plan.

## Auto-continue chain — across sub-slices AND across milestones

After an auto-merged PR, automatically proceed to the next PR per the
roadmap. No stop-gates at sub-slice boundaries, no stop-gates at
parent-milestone boundaries. Silence = keep going.

Rule chain:

- `M2c-1 merged → start M2c-2`
- `M2c-2 merged → start M2c-3`
- `M2c-3 merged → start M2d-1` (next slice of parent M2)
- `M2d-N (last) merged → start M3-1` (next milestone per the roadmap)
- `M3-N (last) merged → start M4-1`
- ... through the roadmap in the technical design doc.

Write-safety-critical milestones (M3 batch generator, M4 image
library, M7 anything that spends money or mutates client WP sites)
still require per-slice plans with the **"Risks identified and
mitigated"** audit (see §"Self-audit"). That audit + the
concurrency / E2E / migration / RLS test patterns are the safety net —
not a wait for Steven at a milestone boundary.

Stop and wait for Steven only when:

- An architectural escalation surfaces (cost tradeoff, spec
  ambiguity, security decision — things the plan can't resolve).
  Cross-references CLAUDE.md §"Risk-weighted execution".
- Loop-detection fires (CLAUDE.md §"Loop detection").
- A required env var is missing (note what's needed, skip the
  affected sub-slice, continue with slices that don't depend on it).
- Steven explicitly says pause. Silence is NOT a pause signal; it's
  a proceed signal.

Post a one-line status ping per merge: `<slice> merged, starting
<next>`. That's the visibility channel — Steven reads the pings in
his GitHub inbox.

## Self-audit — "Risks identified and mitigated"

Self-audit is the first AND the final layer for planning. Once a
plan has a populated **"Risks identified and mitigated"** section,
proceed directly to implementation. Do NOT post plans to Steven or
Claude.ai as a review gate — not for parent milestones, not for
sub-slices.

Where plans live:

- Parent milestone plans go in the first sub-slice's PR description.
- Sub-slice plans go in their own PR description.
- Status updates ("M3-1 merged, starting M3-2") happen once per merge.

Escalate to Steven only when:

- You cannot self-resolve a tradeoff (cost, deadline, spec ambiguity).
- A decision needs information you don't have (legal, security review,
  infrastructure cost ceiling).
- Loop-detection fires.

Every plan MUST include a **"Risks identified and mitigated"** section
listing:

- Each write-safety hotspot in the proposed design (billed external
  calls, concurrent writers, multi-row state transitions, triggers,
  race windows, schema-level uniqueness assumptions).
- How the plan mitigates it (idempotency key, DB unique constraint,
  advisory lock, dedicated test case, etc.).
- Any gaps you are deliberately deferring, with a reason and a
  follow-up slice / milestone pointer.

If an obvious write-safety gap exists (missing idempotency key on a
billed external call, missing constraint on a high-churn table,
missing test assertion on a concurrency invariant, trigger that can
deadlock with a worker), fix it in the plan **before** coding.
Write-safety-critical milestones get this audit applied to every
sub-slice plan, not just the parent milestone plan.

A plan without a populated "Risks identified and mitigated" section
is not ready to execute.
