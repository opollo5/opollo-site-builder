# M12 — Reconciliation Report

## STATUS: superseded

This is an overnight session artifact describing a 7-slice A–G split that is NOT the canonical M12 plan. See `docs/plans/m12-parent.md` for the canonical 6-slice split (M12-1 through M12-6). The repo-state reconciliation below is accurate for its timestamp and useful as history; the Slices A–G proposal it recommends was not adopted. Preserved as history; do not execute against.

---

Phase 0 output of the overnight autonomous M12 build session. Reads the repo + open PRs + existing plan docs + stray branches and locks the actual starting state so Phase 1 (capability audit) and Phase 2 (slice execution) don't re-derive it.

**Generated:** 2026-04-22 late evening (overnight session).
**Starting point:** origin/main @ `29a89ac` (chore/security-server-only-guards #102 merged).
**Session branch:** `claude/m12-00-reconcile`.

---

## 1. Plan docs — current state on main

| File | Lines | State | Notes |
| --- | --- | --- | --- |
| `docs/plans/m12-parent.md` | 58 | Header complete, 6 trailing sections are empty stubs | Merged via PR #98. Write-safety contract, testing strategy, performance, risks, relationship-to-patterns, status tracker are all `##` headers with no body. |
| `docs/plans/m13-parent.md` | — | Missing | Never committed. A 119-line draft exists in a session-local scratch file (Steven's paste earlier this session). Reconstituted in this PR. |
| `docs/CONTEXT.md` | 83 | Verbose version landed via PR #100's coupled commit | Contains the locked-decisions anchor. A tighter 75-line version was pasted by Steven later in the session; reconstituted in this PR. |
| `docs/patterns/assistive-operator-flow.md` | — | Shipped (PR #99) | Operator-facing UX contract M12/M13 both inherit. |
| `docs/BACKLOG.md` | — | No M12 status-tracker section yet | `## Sub-slice status tracker` in m12-parent.md says "maintained in BACKLOG.md" but the section doesn't exist there. Addressed in Slice G, not here. |
| `docs/RUNBOOK.md` | — | No brief-runner entries | Addressed in Slice G. |

### The unmerged fill-in commit

`claude/create-m12-plan-KDhVi` carries one unmerged commit `7539854 docs(m12): fill in remaining sections of parent plan` that populates all six stub sections with ~97 lines of substantive content: 7 write-safety subsections (concurrency, multi-pass idempotency, visual-review sandbox, whole-doc context, conventions capture, first-page anchor, crash resume), a per-slice testing strategy table + EXPLAIN ANALYZE requirement, performance notes (wall-clock, per-page cost, running-summary budget, visual-review I/O, M8 capacity-aware dep), 12 numbered risks with mitigations, a per-slice relationship-to-patterns map (M12-3 + M12-4 flagged for promotion), and the BACKLOG status-tracker contract with M13 checkpoint.

**Decision:** port the fill-in content into the reconcile PR. It is well-written, already reviewed internally (auto-generated on the original M12 plan session), and carries the write-safety audit the overnight prompt mandates. Not porting would either (a) require Steven to re-open and land `claude/create-m12-plan-KDhVi` separately or (b) force me to re-derive the same content from scratch. Port is cheaper and the content is identical to what the audit expects.

---

## 2. Open-PR landscape

```
#101  fix(security): server-only guards + .env.local.example cleanup   OPEN
#102  chore(security): add server-only guards to node-only lib modules MERGED
#98   docs(m12): parent plan for brief-driven sequential page generation MERGED
#99   docs(patterns): assistive-operator-flow — UX playbook             MERGED
#100  feat(security): rate-limit cost-bearing and auth-adjacent routes  MERGED
```

- **PR #98 merged.** The overnight prompt anticipates it may still be open; it is not. The merged parent plan with its stub sections is the base this reconcile sits on top of.
- **PR #101 (mine, earlier this session) is redundant.** It bundled server-only guards + an `.env.local.example` cleanup. PR #102 (the other tab) shipped the server-only guards cleanly; the env cleanup is still useful but unrelated to M12. Decision: leave #101 open for Steven to adjudicate (close it or rebase to env-only). Not blocking this overnight build — noted in handoff.
- **Dependabot PRs** (#43, #45, #47, #48, #49, #50, #86) have nothing to do with M12. Ignored.

---

## 3. Branch + WIP catalogue

**Relevant unmerged branches** (older branches from pre-M11 work omitted):

| Branch | HEAD commit | Relevance |
| --- | --- | --- |
| `claude/create-m12-plan-KDhVi` | `7539854` | The M12 parent-plan fill-in commit described above. Porting contents into this reconcile PR. After port, branch is redundant. |
| `claude/client-blog-builder-5JK9P` | `aa44217` | Contained only `docs(patterns): assistive-operator-flow` which shipped as PR #99. Nothing unmerged. Stale. |
| `fix/server-only-guards-env-cleanup` | (PR #101) | Earlier-session branch. Redundant for server-only; env cleanup deferred. |
| `feat/m13-1-posts-schema` | (local only) | Briefly checked out earlier this session to scaffold M13-1; no commits. Stale. |
| `docs/m12-m13-context-anchor` | (local only) | Briefly checked out earlier to write the context anchor before "leave it" decision. No commits. Stale. |

No active WIP on M12 code itself — `lib/brief-*`, `lib/site-conventions*`, `lib/posts*`, `app/admin/sites/[id]/briefs/*`, `e2e/briefs.spec.ts`, migrations `0013*` all **do not exist** in any branch.

**Feature flags:** `rg FEATURE_M12 FEATURE_BRIEF FEATURE_BLOG` returns no code hits. No flag has been provisioned in advance.

---

## 4. Overnight-prompt alignment with existing plan

The overnight prompt lays out Slices A–G. The existing `m12-parent.md` lays out slices M12-1..M12-6. These are largely congruent but not identical:

| Overnight slice | Maps to existing | Deviation |
| --- | --- | --- |
| **A — Theme extractor** (site_conventions from an existing Site Builder site) | Partially M12-2 (the `site_conventions` column + anchor spec) | The overnight prompt asks for extraction from an existing site's DS. Existing M12-2 derives conventions from the page-1 anchor cycle, not from the prior-site DS. These are actually complementary, not conflicting — **extraction** (A) feeds an initial conventions JSONB; **anchor promotion** (M12-2) refines it on page 1's first run. A site that already has a DS gets the extractor path; a greenfield site anchors through page 1. |
| **B — Brief schema + upload + parser** | M12-1 | Clean 1:1. |
| **C — Single-page engine** | Subset of M12-3 | Overnight prompt emphasizes the single-page engine can be used directly for blog/landing briefs, not only multi-page. That's consistent with the M13 spec (the same engine runs at `mode: 'post'` for single-post briefs). Slice C ships the single-page shape; Slice D ships the multi-page sequential wrapper. |
| **D — Sequential runner** | M12-3's sequential-runner + running-summary + anchor-cycles + resume | Clean. |
| **E — Visual review pass** | M12-4 | Clean. |
| **F — Operator surfaces** | M12-5 + the "Add a blog / landing page" entry points Steven calls out | Entry points inside the existing Site Builder are a small extension — mentioned in M12-5 as "the runner surface"; the entry-point copy is operator-facing UX that assistive-operator-flow governs. |
| **G — E2E + docs + pattern promotion** | M12-6 | Clean. |

**Net effect:** the overnight slice order is A → B → C → D → E → F → G. The existing plan's slice order is M12-1 → M12-2 → M12-3 → M12-4 → M12-5 → M12-6. These differ — overnight puts theme extraction first; existing plan puts brief schema + parser first. Reasoning for overnight's ordering: a theme extractor is the only slice with **zero** new data shape (reads existing pages/DS, writes a single column to a not-yet-existent briefs table). So it can almost ship before the brief schema lands. But in practice Slice A still needs somewhere to write the extracted conventions — either a scratch table or the brief schema must land first. **Decision: execute Slice B (brief schema) first, then Slice A (extractor) second.** That's a deliberate deviation from the overnight order, logged in handoff. Every other slice stays in overnight's order.

---

## 5. Decisions locked for this session

1. **Port the unmerged m12-parent.md fill-in.** This reconcile PR replaces the empty stub sections with `7539854`'s content. `claude/create-m12-plan-KDhVi` is then stale; Steven can delete it.
2. **Supersede `docs/CONTEXT.md`** with the tighter 75-line version. The verbose version is redundant with the parent plan; the anchor only needs to carry locked decisions + the resume-after-dead-session protocol.
3. **Reconstitute `docs/plans/m13-parent.md`.** Even though M13 is not in scope for this overnight build, the M13 shared-primitives contract is a load-bearing constraint on M12-3 (`lib/brief-runner.ts` must extend cleanly to a `mode` parameter in M13-3 without forking). The 119-line draft Steven pasted earlier is committed verbatim in this PR.
4. **Re-order: brief schema (B) before theme extractor (A).** Extractor has nowhere to write without the schema.
5. **PR #101 stays open for now.** Not blocking M12. Noted in handoff.
6. **Each overnight slice ships as a separate draft PR branched off main** (not stacked on this reconcile branch), per the overnight policy. Exception: if a later slice depends on this reconcile PR's plan docs being merged first, note that in its PR description as "Depends on: #N."
7. **Handoff doc (`docs/plans/m12-handoff.md`) lives on the LAST branch of the session,** not on this reconcile branch — the overnight prompt says "on the final branch." But to keep the audit trail honest as the session runs, an early version is committed to this reconcile branch and carried forward (rebased or re-copied) onto each subsequent branch. The final branch's version is authoritative.

---

## 6. Next phase

**Phase 1 — Capability audit.** Read actual source (not plan docs) to determine which of the 18 overnight capabilities already exist and are reusable. Output: `docs/plans/m12-audit.md` appended to this reconcile branch, PR description updated. No branch switch.

**Phase 2 — Slice execution.** Per overnight prompt, each slice ships as a separate draft PR. Execution order (deviation from overnight prompt logged):

1. Slice B — brief schema + upload + parser → branch `claude/m12-b-brief-schema`
2. Slice A — theme extractor → branch `claude/m12-a-theme-extractor`
3. Slice C — single-page engine → branch `claude/m12-c-single-page-engine`
4. Slice D — sequential runner → branch `claude/m12-d-sequential-runner`
5. Slice E — visual review pass → branch `claude/m12-e-visual-review`
6. Slice F — operator surfaces → branch `claude/m12-f-operator-surfaces`
7. Slice G — E2E + docs + pattern promotion → branch `claude/m12-g-e2e-docs`

If a slice genuinely depends on another slice's migration (specifically: A depends on B's brief schema, E+F depend on D's runner for anything to render), the PR description declares "Depends on: #N."

**Non-negotiables enforced throughout:** no merges to main, no force-push, no `.github/` edits, no shared-secret edits, no destructive migrations. All PRs are drafts.
