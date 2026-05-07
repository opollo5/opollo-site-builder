# Milestone Registry

All shipped and active milestones. Each entry links to the plan doc and the merge commit(s).

## Status key

`shipped` — all PRs merged to main  
`active` — in-flight on a feature branch  
`blocked` — waiting on a dependency  
`deferred` — descoped or not yet scheduled

---

| # | Name | Plan doc | Status | Notes |
|---|---|---|---|---|
| M1 | Foundation (auth, DB, basic admin) | `docs/plans/m1-parent.md` | shipped | |
| M2 | Site management + design tokens | `docs/plans/m2-parent.md` | shipped | M2d added prefix auto-generation |
| M3 | Batch generator | `docs/plans/m3-parent.md` | shipped | Write-safety-critical |
| M4 | Image library | `docs/plans/m4.md` | shipped | Write-safety-critical |
| M5 | Per-page iteration UI | `docs/plans/m5-parent.md` | shipped | |
| M6 | Design system authoring | `docs/plans/m6-parent.md` | shipped | M6-4 shipped jargon cleanup |
| M7 | WP publish + circuit breaker | `docs/plans/m7-parent.md` | shipped | Write-safety-critical |
| M8 | Blog post workflow | `docs/plans/m8-parent.md` | shipped | |
| M9 | Multi-company + hierarchy | `docs/plans/m9-parent.md` | shipped | |
| M10 | Design discovery wizard | `docs/plans/m10-parent.md` | shipped | |
| M11 | Image library context injection | `docs/plans/m11-parent.md` | shipped | |
| M12 | Copy-existing extraction | `docs/plans/m12-parent.md` | shipped | |
| M13 | Mode-aware generation | `docs/plans/m13-parent.md` | shipped | |
| M14 | Auth hardening (password reset + profile management) | `docs/plans/m14-parent.md` | shipped | |
| M14b | Run surface UX overhaul | `docs/plans/run-surface-ux-overhaul-parent.md` | shipped | |
| M15 | World-class polish | `docs/plans/world-class-polish-parent.md` | shipped | |
| M16 | Blog post pipeline | `docs/plans/m16-parent.md` | shipped | See `docs/decisions/m16-decisions.md` |

## Sub-slice and companion plan files

These plan files live in `docs/plans/` but are sub-slices or companion docs to the milestones above:

| File | Parent milestone | Notes |
|---|---|---|
| `blog-post-workflow-parent.md` | M16 / M8 | Blog post workflow planning |
| `m12-1-slice.md` | M12 | M12 sub-slice 1 plan |
| `m12-audit.md` | M12 | M12 audit findings |
| `m12-handoff.md` | M12 | M12 handoff notes |
| `m12-reconciliation.md` | M12 | M12 reconciliation |
| `path-b-legacy-data-decision.md` | Path B | Path B legacy data decision |
| `path-b-migration-parent.md` | Path B | Path B migration parent plan |

## Gap note

M1–M16 were the original roadmap milestones. Post-M16 work is tracked as numbered
**Specs** (01, 02, … NN) rather than milestone labels. See `docs/registry/specs.md`.
