# docs/ — Navigable Index

This file is the map. Read it first when looking for a document.

## Structure

```
docs/
├── README.md                   ← you are here
├── PARALLELISM_PLAN.md         ← parallel-session bootstrap prompt
├── WORK_IN_FLIGHT.md           ← active session claims (hot-shared file)
├── UAT.md                      ← UAT script (pinned to a specific commit)
├── UAT-CHECKLIST.md            ← pre-UAT checklist
├── BACKLOG.md                  ← backlog / UX-debt register
├── ISSUES_LOG.md               ← known issues log
├── QA-ISSUES.md                ← QA issues tracker
├── SCOPE_v3.md                 ← product scope v3
│
├── architecture/               ← engineering standards, data contracts, prompt rules
│   ├── ARCHITECTURE.md         ← system architecture (canonical reference)
│   ├── AUTH.md                 ← auth architecture
│   ├── BUILD.md                ← platform/social/image operational reference for Claude Code
│   ├── CONTEXT.md              ← context-window usage conventions
│   ├── DATA_CONVENTIONS.md     ← soft-delete, audit columns, version_lock, data migrations
│   ├── ENGINEERING_STANDARDS.md← code standards + review checklist
│   ├── PROMPT_VERSIONING.md    ← lib/prompts/vN/ layout, eval harness, Langfuse
│   └── RULES.md                ← one-off rules with incident history (load-bearing)
│
├── runbooks/                   ← incident response and operational procedures
│   ├── RUNBOOK.md              ← on-call playbook (load-bearing — update with every blocker change)
│   ├── branch-protection-setup.md
│   ├── observability-verification.md
│   └── optimiser-credentials.md
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
├── decisions/                  ← architectural decision records
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
| `docs/architecture/ARCHITECTURE.md` | System architecture | Yes — sessions read before writing code |
| `docs/architecture/RULES.md` | One-off rules (rule #8 gates CI) | Yes — rule #8 gates CI |
| `docs/architecture/DATA_CONVENTIONS.md` | Soft-delete / audit columns contract | Yes |
| `docs/architecture/PROMPT_VERSIONING.md` | Prompt immutability + eval harness | Yes |
| `docs/architecture/BUILD.md` | Platform/Social/Image operational doc | Yes |
| `docs/architecture/AUTH.md` | Auth architecture | Yes |
| `docs/architecture/CONTEXT.md` | Context-window conventions | Yes |
| `docs/architecture/ENGINEERING_STANDARDS.md` | Code standards | Yes |
| `docs/runbooks/RUNBOOK.md` | On-call playbook | Yes — update with every blocker change |
| `docs/runbooks/branch-protection-setup.md` | Branch protection setup guide | Ops |
| `docs/runbooks/observability-verification.md` | Observability verification | Ops |
| `docs/runbooks/optimiser-credentials.md` | Optimiser credentials runbook | Ops |
| `docs/WORK_IN_FLIGHT.md` | Active session claims | Live — read before editing any file |
| `docs/PARALLELISM_PLAN.md` | Parallel-session protocol | Live — bootstrap prompt lives here |
| `docs/UAT.md` | UAT script | Ops |
| `docs/specs/_run-log.md` | Autonomous-run log | Record |
| `docs/specs/_blockers.md` | Spec blockers | Record |
| `docs/registry/milestones.md` | M1–M16 registry | Reference |
| `docs/registry/specs.md` | Spec 01–NN registry | Reference |

## Quick links

- **Architecture:** `docs/architecture/ARCHITECTURE.md`
- **Rules (incident-driven):** `docs/architecture/RULES.md`
- **On-call runbook:** `docs/runbooks/RUNBOOK.md`
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
