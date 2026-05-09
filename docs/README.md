# docs/ — Navigable Index

This file is the map. Read it first when looking for a document.

## Structure

```
docs/
├── README.md                   ← you are here
├── PARALLELISM_PLAN.md         ← redirect → governance/PARALLELISM.md (deprecated 2026-05-09)
├── WORK_IN_FLIGHT.md           ← active session claims (hot-shared file)
├── UAT.md                      ← UAT script (pinned to a specific commit)
├── UAT-CHECKLIST.md            ← pre-UAT checklist
├── BACKLOG.md                  ← backlog / UX-debt register (project-wide)
├── ISSUES_LOG.md               ← known issues log
├── QA-ISSUES.md                ← QA issues tracker
├── SCOPE_v3.md                 ← product scope v3
├── feature-flags.md            ← feature flag inventory
├── freeze-list.md              ← release-freeze list
├── security-findings.md        ← material findings register (test-harness landed 2026-05-09)
├── test-coverage-roadmap.md    ← post-harness propagation work
├── test-coverage-target.md     ← Phase A audit (route × layer matrix)
├── test-harness-recon.md       ← cold-start audit of existing test infra
├── testing-roadmap.md          ← seven-level testing ladder status
│
├── architecture/               ← engineering standards, data contracts, post-workstream contracts
│   ├── ARCHITECTURE.md         ← system architecture (canonical reference)
│   ├── AUTH.md                 ← auth architecture
│   ├── BUILD.md                ← platform/social/image operational reference for Claude Code
│   ├── CONTEXT.md              ← context-window usage conventions
│   ├── CRITICAL_PATHS.md       ← full enumeration of routes counted as critical (NEW 2026-05-09)
│   ├── DATA_CONVENTIONS.md     ← soft-delete, audit columns, version_lock, data migrations
│   ├── DESIGN_SYSTEM.md        ← post-DESIGN-SYSTEM-OVERHAUL contract (NEW 2026-05-09)
│   ├── ENGINEERING_STANDARDS.md← code standards + review checklist
│   ├── NAVIGATION.md           ← two-level rail + section panel rules (NEW 2026-05-09)
│   ├── OBSERVABILITY.md        ← request IDs, structured logging, headers, email contract (NEW 2026-05-09)
│   ├── OPTIMISER.md            ← optimiser module namespacing + inheritance rules (NEW 2026-05-09)
│   ├── PERFORMANCE.md          ← Lighthouse CI + EXPLAIN ANALYZE rules (NEW 2026-05-09)
│   ├── PROMPT_VERSIONING.md    ← lib/prompts/vN/ layout, eval harness, Langfuse
│   └── RULES.md                ← one-off rules with incident history (load-bearing)
│
├── audits/                     ← frozen-in-time analyses (NEW 2026-05-09)
│   ├── README.md               ← index
│   └── DESIGN_SYSTEM_2026-05-02.md  ← pre-overhaul Q1–Q8 + locked decisions
│
├── backlog/                    ← live, incrementally-actioned items (NEW 2026-05-09)
│   ├── README.md               ← index
│   └── ux-debt.md              ← UX-debt live items
│
├── governance/                 ← operational rules of the road (NEW 2026-05-09)
│   ├── README.md               ← index
│   ├── DX_HYGIENE.md           ← pre-commit hooks, commitlint, supply-chain scans
│   ├── MERGE_RULES.md          ← auto-merge mechanics, sub-slice autonomy, auto-continue
│   ├── PARALLELISM.md          ← multi-session coordination + bootstrap prompt (moved from top-level)
│   └── RELEASE_HYGIENE.md      ← release-please workflow + changelog mapping
│
├── runbooks/                   ← incident response and operational procedures
│   ├── RUNBOOK.md              ← on-call playbook (load-bearing — update with every blocker change)
│   ├── branch-protection-setup.md
│   ├── observability-verification.md
│   └── optimiser-credentials.md
│
├── incidents/                  ← one file per material production incident
│   ├── README.md               ← index (NEW 2026-05-09)
│   └── TEMPLATE.md             ← incident-doc skeleton with diagnostic-protocol layout
│
├── patterns/                   ← recurring implementation patterns (playbook)
│   └── *.md                    ← one file per pattern shape
│
├── specs/                      ← spec briefs (numbered, sequential)
│   ├── _run-log.md             ← autonomous-run log
│   ├── _blockers.md            ← spec blockers and deviations
│   └── NN-<slug>.md            ← individual spec briefs
│
├── plans/                      ← milestone implementation plans
│   └── *.md
│
├── status/                     ← dated platform status reports
│   └── YYYY-MM-DD-platform-status.md
│
├── registry/                   ← canonical lists (milestones, specs)
│   ├── milestones.md           ← M1–M16 milestone registry
│   └── specs.md                ← Spec 01–NN spec registry
│
├── reports/                    ← one-off reports
│   └── *.md
│
├── adrs/                       ← architectural decision records
│
├── decisions/                  ← architectural decision records (legacy location)
│   ├── integration-model.md
│   ├── company-hierarchy-proposal.md
│   ├── m16-decisions.md
│   └── starter-repo-plan.md
│
├── prompts/                    ← historical prompt snapshots
│   ├── system-prompt-v1.md
│   └── tool-schemas-v1.md
│
└── archive/                    ← historical / superseded documents (do not delete)
    ├── audits/                 ← audit reports (dated)
    └── milestones/             ← milestone planning notes
```

## Doc index

| Path | Purpose | Load-bearing? |
|---|---|---|
| `CLAUDE.md` (repo root) | Operating manual — every session reads first | Yes — top-level rules |
| `docs/architecture/ARCHITECTURE.md` | System architecture | Yes — sessions read before writing code |
| `docs/architecture/CRITICAL_PATHS.md` | Routes counted as critical for smoke gating | Yes — gates production smoke |
| `docs/architecture/DESIGN_SYSTEM.md` | Post-overhaul contract (mode-aware generation) | Yes |
| `docs/architecture/NAVIGATION.md` | Two-level rail + section panel rules | Yes |
| `docs/architecture/OBSERVABILITY.md` | Request IDs, logging, headers, email contract | Yes |
| `docs/architecture/OPTIMISER.md` | Optimiser namespacing + inheritance rules | Yes |
| `docs/architecture/PERFORMANCE.md` | Lighthouse CI + EXPLAIN ANALYZE rules | Yes |
| `docs/architecture/RULES.md` | One-off rules (rule #8 gates CI) | Yes — rule #8 gates CI |
| `docs/architecture/DATA_CONVENTIONS.md` | Soft-delete / audit columns contract | Yes |
| `docs/architecture/PROMPT_VERSIONING.md` | Prompt immutability + eval harness | Yes |
| `docs/architecture/BUILD.md` | Platform/Social/Image operational doc | Yes |
| `docs/architecture/AUTH.md` | Auth architecture | Yes |
| `docs/architecture/CONTEXT.md` | Context-window conventions | Yes |
| `docs/architecture/ENGINEERING_STANDARDS.md` | Code standards | Yes |
| `docs/audits/DESIGN_SYSTEM_2026-05-02.md` | Pre-overhaul Q1–Q8 audit | Reference (frozen) |
| `docs/governance/MERGE_RULES.md` | Auto-merge mechanics, sub-slice, auto-continue | Yes — full merge rules |
| `docs/governance/PARALLELISM.md` | Multi-session coordination + bootstrap prompt | Live — second-tab bootstrap |
| `docs/governance/DX_HYGIENE.md` | Hooks, commitlint, supply-chain scans | Yes |
| `docs/governance/RELEASE_HYGIENE.md` | release-please workflow | Reference |
| `docs/backlog/ux-debt.md` | Live UX-debt items | Live |
| `docs/runbooks/RUNBOOK.md` | On-call playbook | Yes — update with every blocker change |
| `docs/runbooks/branch-protection-setup.md` | Branch protection setup guide | Ops |
| `docs/runbooks/observability-verification.md` | Observability verification | Ops |
| `docs/runbooks/optimiser-credentials.md` | Optimiser credentials runbook | Ops |
| `docs/incidents/TEMPLATE.md` | Incident-doc skeleton with diagnostic-protocol layout | Yes — required template |
| `docs/security-findings.md` | Material findings register | Live — surface immediately |
| `docs/test-coverage-roadmap.md` | Post-harness propagation work | Reference |
| `docs/test-coverage-target.md` | Phase A audit (route × layer matrix) | Reference |
| `docs/test-harness-recon.md` | Cold-start audit of existing test infra | Reference |
| `docs/WORK_IN_FLIGHT.md` | Active session claims | Live — read before editing any file |
| `docs/UAT.md` | UAT script | Ops |
| `docs/specs/_run-log.md` | Autonomous-run log | Record |
| `docs/specs/_blockers.md` | Spec blockers | Record |
| `docs/registry/milestones.md` | M1–M16 registry | Reference |
| `docs/registry/specs.md` | Spec 01–NN registry | Reference |

## Quick links

- **Operating manual:** `CLAUDE.md` (repo root)
- **Critical paths (full enumeration):** `docs/architecture/CRITICAL_PATHS.md`
- **Architecture:** `docs/architecture/ARCHITECTURE.md`
- **Rules (incident-driven):** `docs/architecture/RULES.md`
- **Merge rules (full version):** `docs/governance/MERGE_RULES.md`
- **On-call runbook:** `docs/runbooks/RUNBOOK.md`
- **Incident template:** `docs/incidents/TEMPLATE.md`
- **Security findings register:** `docs/security-findings.md`
- **Pattern playbook:** `docs/patterns/README.md`
- **Spec briefs:** `docs/specs/`
- **Milestone plans:** `docs/plans/`
- **Platform status:** `docs/status/`

## Naming conventions

| Directory | Convention |
|---|---|
| `docs/architecture/` | `UPPER_SNAKE.md` — existing convention kept |
| `docs/runbooks/` | `UPPER_SNAKE.md` or `kebab-case.md` |
| `docs/specs/` | `NN-kebab-slug.md` (two-digit prefix, sequential) |
| `docs/plans/` | `mN-slug.md` or `slug-parent.md` |
| `docs/decisions/` | `kebab-case.md` |
| `docs/status/` | `YYYY-MM-DD-platform-status.md` |
| `docs/archive/` | Keep original filename — do not rename archived files |

## Archive policy

Files in `docs/archive/` are historical or superseded. Do not delete them — they provide
context for decisions and audit trails. Do not modify them except to add a `> **Superseded:**`
header note pointing to the replacement document.
