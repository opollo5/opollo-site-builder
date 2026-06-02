# Build Brief 3/3 — Workflow Engine + Versioning

CONTRACT-DRIVEN AUTONOMOUS BUILD. Third of three. DEPENDS ON Briefs 1 + 2 (magic-link +
core proofing). Build LAST, after both merged + verified. Update with their drift reports.
This is the PageProof-depth engine — the most complex brief; expect it to span several PRs.

> START WITH RECON: re-read docs/recon/PROOFING_RECON.md + Brief 1 & 2 drift reports.

---

## Goal

Evolve the 3 fixed gates (copy_review / image_review / final_signoff) into a configurable
**workflow engine**: ordered steps, each with reviewer-role semantics and thresholds, plus
version comparison and exportable audit. Supersedes the fixed gates via a migration bridge
— does NOT throw away what Briefs 1–2 and Phases 1–2 built.

## Locked context

- Pipeline: V2 (Brief 2). Versioning: the `content_group_id` / `version_number` /
  `supersedes_id` chain from Brief 2 — extend it, don't duplicate.
- Approval backbone: `social_approval_requests` (`approval_rule` any_one|all_must already
  exists), `_recipients`, `_events`. `record_approval_decision` RPC drives it.
- Roles today: flat approver list with all_must/any_one. This brief adds role semantics.

## Step 1 — Migration: workflow steps + roles + gate bridge

New `workflow_steps` (replaces the implicit 3-gate ordering):
```
id uuid pk; company_id uuid fk; workflow_template_id uuid (nullable for ad-hoc)
step_order int not null
name text not null              -- e.g. 'Internal review','Client sign-off'
pass_rule text check (pass_rule in ('any_one','all_must','custom_count'))
required_count int               -- when pass_rule='custom_count'
blocking boolean not null default true
created_at timestamptz default now()
```
New `workflow_step_participants`:
```
id uuid pk; step_id uuid fk
platform_user_id uuid            -- null = external
external_email text
role text check (role in ('reviewer','mandatory_reviewer','gatekeeper','approver'))
```
**Gate → step migration bridge (critical, must be lossless):** for every company with
`company_workflow_gates`, generate equivalent `workflow_steps` — copy_review/image_review/
final_signoff become ordered steps, `pass_rule` carried over, approvers become
participants with `role='approver'`. Keep `company_workflow_gates` readable during
transition; the engine reads steps. State the cutover plan (dual-read then deprecate).

## Step 2 — Role semantics in the state machine

Extend the approval engine so a step passes per role rules (PageProof model):
- ordinary `reviewer` — can comment/decide but does NOT block progression.
- `mandatory_reviewer` — must decide before the step closes.
- `gatekeeper` — can halt the workflow and send it back **ONE step only** (to the
  immediately prior step), per B0 §5. CANNOT send to an arbitrary earlier step, CANNOT
  send to the owner directly, CANNOT bypass mandatory reviewers. (This overrides any
  broader "send back to a prior step / owner" phrasing.)
- `approver` — final-step decision.
- Step threshold: all_must / any_one / custom_count of the blocking participants.
- Sequencing: step N opens only when N-1 closes; gatekeeper send-back reopens an earlier
  step. Skipping: owner/inviter can skip a blocked non-mandatory participant.
- All transitions transactional + idempotent; every transition appends an audit event.

### Role-behaviour matrix (eliminates interaction ambiguity)

| Role | Can comment | Can approve | Blocks step | Can send back |
|------|-------------|-------------|-------------|---------------|
| reviewer | yes | yes | NO | no |
| mandatory_reviewer | yes | yes | yes | no |
| gatekeeper | yes | yes | yes | yes (one step, B0 §5) |
| approver | yes | yes | yes (final step) | no |

Resolved interactions (build exactly this):
- A `reviewer`'s decision is recorded but NEVER blocks step progression.
- A step closes when its threshold (below) is met across its BLOCKING participants
  (mandatory_reviewer / gatekeeper / approver). Non-blocking reviewers never hold a step.
- A gatekeeper counts as a blocking participant AND can send back; both behaviours apply.
- If a mandatory reviewer has not decided, the step CANNOT close regardless of others.

### custom_count definition (eliminates the "count of whom" gap)

`custom_count` + `required_count` means: **N approvals from the step's BLOCKING participants
only** (mandatory_reviewer / gatekeeper / approver). Non-blocking reviewers do not count
toward `required_count`. `required_count` must be ≤ the number of blocking participants
(validate on config save).

## Step 3 — Versioning depth

- Version comparison: given two versions in a `content_group_id` chain, show what changed
  (V1 = side-by-side; smart/diff is later).
- New version re-entry is DETERMINISTIC per B0 §4 (this overrides any "chosen step"
  phrasing): the new version re-enters **at the step that requested the change**, and
  **skips participants who already approved the prior version**. Configurable re-entry is
  explicitly DEFERRED — do not build a chooser.

## Step 4 — Audit + dashboards

- Append-only audit already exists (`social_approval_events`); add exportable audit view
  (CSV) covering lifecycle: created, viewed, comment, decision, send-back, new-version,
  approved, time-to-approval.
- Role-aware operator dashboard: proofs across the team by state/step (recon: mirror the
  existing company-page tab + batch-results patterns).

## Step 5 — Config UI evolution

- Evolve the Workflow tab (built Phase 1) from 3 fixed gate cards into a step builder:
  add/reorder steps, per-step role assignment + threshold, per-participant access
  (login/magic-link via Brief 1). The operator setup wireframe (master brief §7a Screen 2)
  is the target.

## Step 6 — Tests + verify
Gate→step migration is lossless (existing configs reproduce identical behaviour);
mandatory/gatekeeper/approver semantics; send-back reopens prior step; custom_count
threshold; new-version skips prior approvers; audit export; dashboard. L18 Definition of
Done.

## Constraints
Extend the approval backbone + Brief 2 versioning — one engine, no fork. Migration bridge
must be lossless (no company loses its current gate behaviour). Transactional, idempotent,
preserve audit, RLS, mirror conventions. This is the complex tier — phase the PRs
(migration+bridge first; roles; versioning depth; audit/dashboard; config UI).

## Deferred beyond this brief
DAM (asset library, reuse, delivery), advanced markup (DOM selectors, video frame-level),
SDK/webhooks, SSO/SCIM. Per master brief — after this.

## Report
PRs, migrations prod-verified, the lossless-bridge proof, live verification, and the
final state of the proofing/workflow subsystem vs the master-brief vision.
