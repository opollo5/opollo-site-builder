# Opollo Site Builder — Working Brief

## What this is

Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui + Vercel AI SDK.
A chat interface that generates WordPress pages for Opollo's clients, plus a
multi-tenant social posting platform (bundle.social), plus the Optimiser
module for landing-page optimisation.

This file is the operating manual every session reads first. Architecture
detail, audits, and operational deep-dives live under `docs/`. The
"Pointers" section at the bottom is the canonical index. Target: ≤450 lines.

## Staging access

Supabase: `bjiiqnetaxoibhcaukqm`. Vercel stable URL (branch alias, created
automatically when the `staging` branch is pushed):

`https://opollo-site-builder-git-staging-opollo5.vercel.app`

Seeded personas — passwords in 1Password, **never in the repo**:

| Email | Role |
|---|---|
| `steven.m@opollo.com` | `super_admin`, Opollo staff |
| `uat-bot@staging.opollo.com` | `admin`, Opollo staff |
| `test-member@staging.opollo.com` | `user`, "Staging Test Co" member |

Re-seed after reset: `npx tsx scripts/seed-staging.ts` (staging `SUPABASE_URL`
+ `SUPABASE_SERVICE_ROLE_KEY`). Full runbook: `docs/environments-staging-plan.md`.

## Default execution contract

Every task ends the same way: **a working solution deployed to production and
ready for Steven to test.** That is the only terminal state. The user starting
a task authorises every step between "task started" and "deployed and verified".
No mid-task approval gate exists.

### Intermediate states are not stopping points

| Current state | Next action |
|---|---|
| Plan drafted | Implement it. No approval gate before code is written. |
| Code written | Run lint, typecheck, unit tests; fix; commit and push. |
| Branch pushed | Open a PR with the §"Pre-PR checklist" populated. |
| PR open, CI in flight | Arm `gh pr merge <PR> --squash --auto`; fall back to `gh pr checks <PR> --watch` then `--squash` if `--auto` can't be armed. |
| PR open, CI failed | Read failure logs (auto-posted as PR comments), fix, push, repeat. §"Self-test loop". |
| PR open, CI green | **User-facing changes:** open the Vercel preview URL; confirm the change is live and correct on staging before merging. Docs/internal-only changes: skip. |
| Staging verified (or exempt) | `gh pr merge <PR> --squash` per §"Merge gate" + §"Merge decision tree". |
| PR open, branch behind main | `gh pr update-branch <PR>`; wait for CI to re-run. |
| PR merged | Watch production deploy; verify deployed SHA matches merge commit. |
| Deploy complete | Hit the live surface; confirm behaviour matches acceptance criteria. |
| Live behaviour verified | Surface to Steven: one line — "`<task>`: deployed, verified at `<URL>`." Then §"Auto-continue". |
| Live behaviour fails | Diagnose per `docs/patterns/WORKING_ANALOG.md`; fix; restart from "code written". |

The only deviation is a §"Hard stop". **When the default could be "stop and
ask" or "continue", continue.**

## Hard stops

The only reasons to surface before deployed-and-verified. Closed list.

1. **Missing env var or secret.** Note the exact var name and target environment. Skip the affected slice if possible.
2. **External dashboard config the agent cannot access.** Name the exact dashboard path Steven needs to navigate.
3. **Required external account or signup** needing credit card, email verify, or sign-up flow.
4. **Architectural decision the spec genuinely does not resolve.** Material cost-vs-correctness or security tradeoff. NOT: naming, folder placement, implementation style — pick and proceed.
5. **Loop-detection fired.** Same workflow + job + first error line, twice in a row, AND working-analog search came back empty or unchanged.
6. **Write-safety-critical milestone gate.** M3, M4, M7 boundaries per §"Merge decision tree".
7. **Branch protection literally blocks the merge** and no admin bypass is available. NOT: optional review requests that don't block `gh pr merge`.
8. **Steven explicitly said pause.** The literal word "pause" or "stop" — not inferred.

Not on this list: CI running, CI failed, PR behind main, tests need updating,
"want me to apply this?", both PRs open. Fix and continue.

## Instruction to AI agents — explicit

Past agents stopped at "PR opened", claimed third-party bugs without protocol
completion, shipped features without coverage, or designed fixes without
searching for a working analog. Hard correctives:

- **Task started = authorised to deployed-and-verified.** Drive it end-to-end. Never ask "should I continue?"
- **No coverage = no ship.** If the change-shape has no hard floor in §"Seven-layer test harness", surface to Steven.
- **No analog search = no fix design.** See `docs/patterns/WORKING_ANALOG.md`. Either the analog exists and the fix is the diff, or you state explicitly that no analog exists and justify the new pattern.
- **No "third-party bug" claim** without all steps in `docs/runbooks/RUNBOOK.md §"Live diagnostic protocol"`.
- **Security findings surface immediately** — see §"Security escalation".

## Engineering principles

Tradeoff defaults; specific rules below override these.

1. Prefer reversible over irreversible.
2. Prefer correctness over cleverness.
3. Prefer narrow tested fixes over broad untested refactors.
4. Prefer rollback over forward-patch during incidents.
5. Prefer verification over inference — see §"Verification over assumption".
6. Prefer matching existing patterns over inventing new ones — see `docs/patterns/WORKING_ANALOG.md`.

## Decision policy

Apply in order; do not stop for human input unless none of these resolves the choice.

1. **Root cause over symptom.** Symptomatic patches only when root cause is out of scope AND logged in backlog with a root-cause link.
2. **Validate over assume.** A green test suite is not validation if it doesn't exercise the actual broken path.
3. **System fix over workaround.** A bug worth fixing once is worth preventing. Use deterministic date helpers (not `Date.now() + N` offsets for assertions).
4. **Correctness over micro-optimisations.** Caches and in-memory flags are presumed wrong until proven right.
5. **Single PR per logical change.** Fix + test + docs is ONE concern. Fix + unrelated refactor is TWO.

When in doubt, choose the option the user would have chosen if watching.

## Merge decision tree

Walk top to bottom. Full background: `docs/governance/MERGE_RULES.md`.

```
1. Write-safety-critical? (M3 batch | M4 image lib | M7 money/WP mutations
   | billed external call without idempotency | encryption path)
   ├─ Yes → STOP. Steven merges.
2. On milestone human-merge list? (M3, M4, M7, or Steven flagged)
   ├─ Yes → STOP. Steven merges.
3. PR opened by Steven?
   ├─ Yes → STOP. Steven merges.
4. Steven flagged for review (comment, label, or message)?
   ├─ Yes → STOP. Wait.
5. CI green on all required status checks?
   ├─ No  → §"Self-test loop".
6. Pending review requests or unresolved comments?
   ├─ Yes → STOP. Wait.
7. → `gh pr merge <PR> --squash --auto`
```

## Communication

Communicate only on: completed milestones, verified findings, real blockers
(§"Hard stops" only), security findings, final outcomes.

§"Heartbeat" is the only exception during long autonomous runs.

## Verification over assumption

Never claim the following without direct evidence — command output, CI status,
API response, or observable system state: deploy succeeded, migration applied,
test passed, webhook fired, queue drained, smoke passed, branch merged, rollback
completed, third-party integration works.

If you cannot verify: "I have not verified `<X>`; the evidence I have is `<Y>`."

## Diagnose by working analog

Before designing any fix, find where the same shape already works in the
codebase. The fix is to make the broken surface match the working one.
Full protocol and report-back template: `docs/patterns/WORKING_ANALOG.md`.

## Loop detection

Same workflow + same job + same first error line, twice in a row → stop retrying.
Narrow the problem, reassess assumptions. Hard ceiling: **10 retry pushes per PR**;
then escalate to Steven with the full evidence chain.

## Incident stabilisation priority

1. Restore stability. 2. Contain blast radius. 3. Preserve evidence (see
`docs/runbooks/RUNBOOK.md §"Live diagnostic protocol"`). 4. Root-cause only after.

Rollback to last known-good preferred over speculative forward-fixes when users
are actively impacted.

## Risk-weighted execution

For auth, billing, webhooks, multi-tenant boundaries, concurrency, external side
effects, destructive mutations, data migrations, or security enforcement —
prioritise verification depth over speed. Verify each sub-step rather than
chaining.

## Security escalation

Surface **immediately** — even if unrelated to the current task — if a
vulnerability could expose: tenant data, credentials, authentication state,
billing operations, webhook authenticity, or arbitrary code execution
(XSS/deserialisation/prompt-injection-to-RCE).

Stop current task; post severity + exploit path + evidence to Steven; wait.

## Critical paths

Production smoke (Layer 7) MUST pass for changes touching these.

| Class | Routes / surfaces |
|---|---|
| **Auth** | `/api/auth/*` (login, callback, logout, accept-invite, reset-password, forgot-password, change-password, devices), middleware session enforcement |
| **Social — connect / publish** | `/api/platform/social/connections/*`, `/api/platform/social/posts/[id]/{schedule,submit,approve,publish-attempts,recipients}`, `/api/webhooks/bundlesocial`, `/api/webhooks/qstash/social-publish` |
| **Multi-tenant boundaries** | Any RLS-protected route under `/api/platform/*`, `/api/admin/sites/[id]/*`, `/api/admin/companies/*` |
| **Billing** | (none today — slot reserved for future) |
| **Encryption** | Anything touching `lib/encryption.ts` (`site_credentials.encrypted_value`, `opt_client_credentials`) |
| **Data migrations** | Any change to `supabase/migrations/`, `supabase/rollbacks/` |
| **Brief generation hot path** | `/api/cron/process-brief-runner`, `/api/cron/process-batch`, `/api/briefs/[brief_id]/{run,commit,cancel}` |

Full enumeration: `docs/architecture/CRITICAL_PATHS.md`.

## Seven-layer test harness — coverage rules

Every PR must satisfy the layer rules for its change-shape.

| # | Layer | File convention | npm script | CI check |
|---|---|---|---|---|
| 1 | Unit | `*.unit.test.ts`, mocked deps | `test:unit` | `test-unit` |
| 2 | Contract | `*.contract.test.ts` + `__snapshots__/` | `test:contract` | `test-unit` (subset) |
| 3 | Integration | `lib/__tests__/*.test.ts` (real Supabase) | `test:integration` | `test` |
| 4 | Component | `components/__tests__/**/*.test.{ts,tsx}` | `test:components` | `test-components` |
| 5 | E2E | `e2e/*.spec.ts` | `test:e2e` | `e2e` |
| 6 | Security | `lib/__tests__/*.security.test.ts`, `tests/security/**` | `test:security` | `test-unit` / `test` |
| 7 | Live probes + smoke | `scripts/probes/*.ts`, `e2e/smoke/*.spec.ts` | `test:smoke` | `smoke` (post-deploy) |

### E2E staging config

Layer 5 runs in CI against staging. Set `PLAYWRIGHT_BASE_URL` to the staging
URL (§"Staging access") and authenticate as `uat-bot@staging.opollo.com`
(password from Vercel Preview env `STAGING_UAT_PASSWORD`). **A spec that
conditionally skips when `STAGING_UAT_PASSWORD` is absent is a failing gate,
not coverage.** Config details: `docs/backlog/auth-e2e-staging.md`.

### Hard floors per change-shape

- **New API route** → integration (happy + auth + validation) + cross-tenant if tenant-scoped + injection if user input flows to DB or LLM.
- **New external SDK call** → contract snapshot + probe script.
- **New user-facing journey** → e2e + `auditA11y`.
- **Any auth critical path** (login, signup, password reset, 2FA) → e2e required. Provenance: June 2026 lockout — login broke with zero coverage. Backlog: `docs/backlog/auth-e2e-staging.md`.
- **User-input rendering surface** (`dangerouslySetInnerHTML` or operator/tenant content) → component test driving every `XSS_PAYLOADS` entry through the real renderer.
- **New webhook receiver** → signature-verification security test asserting 401 on wrong-signed payload.
- **Any RLS policy change** → cross-tenant isolation test using `seedTwoCompanies()`.
- **Any critical path change** (§"Critical paths") → production smoke post-deploy.
- **Any >1-PR production bug fix** → regression test under `tests/regressions/<bug-slug>.test.ts` before final merge.

### Flaky / fixme tests

`test.skip()` that bails on missing seed is forbidden — fix the seed.
`test.fixme()` is the only acceptable skip; must link an open issue within
seven days. Static-audit flags violators; CI fails on stale fixmes.

## Live diagnostic protocol

Full seven-step protocol (env check → probe → bundle verify → contract test →
network trace → token decode → incident doc) lives at
`docs/runbooks/RUNBOOK.md §"Live diagnostic protocol"`. **No agent may claim
"third-party bug" without completing it.**

## Security realism rule

Layer 6 security tests must drive the payload through the real enforcement
boundary and assert a concrete outcome (status code, DOM shape, DB row). A
scanner without an actionable assertion is not a security test.
**High-severity findings block merge.**

## Self-test loop

Retry ceiling: **10 per PR**, absolute. "Not converging" (same workflow + same
job + same first error line, twice in a row) is the escalation trigger — not
retry count alone. CI failure logs auto-post as PR comments; read those.

## Heartbeat

After 90 minutes of autonomous work without a merge or surfaced milestone, post:
`Still on <slice>; current state: <X>; next: <Y>.`

## Merge gate — no merge without CI-verified green

**Primary:** `gh pr merge <PR> --squash --auto` — GitHub fires when all required
checks pass. **Fallback:** `gh pr checks <PR> --watch` until terminal, then
`gh pr merge <PR> --squash`. **Behind main:** `gh pr update-branch <PR>`
automatically; CI re-runs; auto-merge fires when green.

## Delivery ownership

The agent owns outcome completion, not process completion. Responsibility
remains active until: change is **deployed**, **runtime behaviour verified**
against the original acceptance criteria, and **Steven can exercise the feature
live**. The merge is one row in the §"Default execution contract" table.

## Sub-slice autonomy

For sub-slices of an already-approved milestone, execute end-to-end without
per-slice plan review. Plan in the PR description; auto-merge per §"Merge
decision tree". Status post-verify: `<slice> deployed and verified, starting <next>`.

## Auto-continue

After a merged PR, proceed to the next slice. Silence = keep going. Pauses
only for §"Hard stops". Write-safety milestones (M3, M4, M7) still require
per-slice **"Risks identified and mitigated"** per §"Self-audit is the review".

## Parallelism

Default: single session. For two tabs: read `docs/WORK_IN_FLIGHT.md`, append
a claim block, prefix messages `[Session A]`/`[Session B]`, remove claim on
merge. Conflict → stop and ask. Full protocol: `docs/governance/PARALLELISM.md`.

## Self-audit is the review

A plan with a populated **"Risks identified and mitigated"** section proceeds
directly to implementation — no review gate. Risks section must list each
write-safety hotspot (billed calls, concurrent writers, multi-row transitions,
triggers, race windows, uniqueness) and its mitigation. Plans live in the PR
description.

## PR size limit

Soft ceiling: **500 lines net change**. Exceptions: renames, generated files,
config consolidations. Above 500: state the reason in the PR description.

## Pre-PR checklist

```
- [ ] Lint, typecheck, build all green
- [ ] Layer scripts run: which of test:unit / test:integration / test:components / test:e2e / test:security
- [ ] Contract snapshots reviewed (if SDK calls touched)
- [ ] Cross-tenant test added (if tenant-scoped resource added)
- [ ] XSS payload coverage added (if user-content rendering touched)
- [ ] Probe script updated (if SDK boundary changed)
- [ ] Regression test added (if this fix is for a >1-PR production bug)
- [ ] Working-analog block in PR body OR explicit "no analog" + justification — see docs/patterns/WORKING_ANALOG.md
- [ ] Risks identified and mitigated section in PR body
- [ ] PR is under 500 net lines OR exception stated
```

## Pre-commit / commit-msg

Husky-managed. `pre-commit`: `lint-staged` + `test:unit` (bypass with
`SKIP_PRECOMMIT_TESTS=1` for rebases — never `--no-verify`). `commit-msg`:
Conventional Commits, 100-char header cap. Detail: `docs/governance/DX_HYGIENE.md`.

## Commands

| Command | What |
|---|---|
| `npm run dev` | Local dev |
| `npm run lint` | ESLint |
| `npm run lint:css` | stylelint on `seed/**/*.css` |
| `npm run typecheck` | tsc --noEmit |
| `npm run build` | Production build |
| `npm run test:unit` | Layer 1 + 2 + regression + no-DB security (~10 s) |
| `npm run test:components` | Layer 4 (jsdom, no Supabase) |
| `npm run test:integration` | Layer 3 (real Supabase, ~10–40 min) |
| `npm run test:e2e` | Layer 5 Playwright |
| `npm run test:security` | Layer 6 |
| `npm run test:smoke` | Layer 7 against live URL |
| `npm run test:precommit` | lint + typecheck + Layer 1 |
| `npm run test:regressions` | `tests/regressions/` only |
| `npm run audit:static` | Static-analysis (HIGH gates CI) |
| `npm run analyze` | Production build with bundle analyzer |

## Standards

- Server Components by default; Client Components only when required
- shadcn/ui over custom; Tailwind utility classes only
- Strict TypeScript — no `any`, no `@ts-ignore`
- One logical change per commit; conventional commit messages

## Proofing / Workflow / Client-Portal — Durable Principles

Hard rules for the proofing/approval/workflow subsystem (magic links, proof
lifecycle, workflow engine, client portal). Full detail:
`docs/architecture/PROOFING_DURABLE_PRINCIPLES.md`. Key invariants in force:

- **Never use the production DB as a test environment.** Stop if Docker is
  unavailable; do not fall back to prod creds.
- **Recon before every migration.** Grep for existing stubs before adding tables.
- **`magic_links` is the single token primitive.** No second token system.
- **V2 pipeline only** (`social_post_drafts`). Skip V1 lookups when `post_master_id IS NULL`.
- **Company-context always explicit.** Verify at every RLS boundary.
- **Hard-stop PRs in this subsystem require Steven's manual merge.** Do NOT arm `--auto`.

## Migration deploy rules — staging + production parity

Every migration merged to `main` must land in **both** environments via
`deploy-migrations.yml`:

1. `push` job — production (`sazapxgmrdaewrkwoxby`)
2. `push-staging` job — staging (`bjiiqnetaxoibhcaukqm`), runs only after `push` succeeds

**A migration is not deployed until `push-staging` is also green.** A red
`push-staging` is a staging incident — diagnose and fix it the same as a
production failure. A job skip is acceptable only during the one-time setup
window; after secrets are in place, a skip is a misconfiguration. Never apply
migrations out-of-band — all must flow through the workflow to keep the
schema tracking table accurate.

Provenance: 60+ migrations accumulated without staging application; drift broke
login on every preview deploy. Full setup: `docs/environments-staging-plan.md`.

## Pointers

Architecture and historical detail live under `docs/`. Pointers below are
load-bearing — when a section in this file references one, it is the canonical
source.

| Topic | Lives at |
|---|---|
| Critical paths (full enumeration) | `docs/architecture/CRITICAL_PATHS.md` |
| Design system architecture (final state) | `docs/architecture/DESIGN_SYSTEM.md` |
| Design system architecture (pre-overhaul audit Q1–Q8) | `docs/audits/DESIGN_SYSTEM_2026-05-02.md` |
| Navigation architecture (two-level rail + section panel) | `docs/architecture/NAVIGATION.md` |
| Optimiser module | `docs/architecture/OPTIMISER.md` |
| Observability + security contract | `docs/architecture/OBSERVABILITY.md` |
| Performance standards | `docs/architecture/PERFORMANCE.md` |
| Data + AI conventions | `docs/architecture/DATA_CONVENTIONS.md` |
| Prompt versioning | `docs/architecture/PROMPT_VERSIONING.md` |
| Incident-derived rules with provenance | `docs/architecture/RULES.md` |
| Auth architecture | `docs/architecture/AUTH.md` |
| Engineering standards | `docs/architecture/ENGINEERING_STANDARDS.md` |
| Build setup | `docs/architecture/BUILD.md` |
| Project context | `docs/architecture/CONTEXT.md` |
| Proofing / Workflow durable principles | `docs/architecture/PROOFING_DURABLE_PRINCIPLES.md` |
| Merge rules (full version) | `docs/governance/MERGE_RULES.md` |
| Parallelism plan + bootstrap prompt | `docs/governance/PARALLELISM.md` |
| DX hygiene (hooks, commitlint, supply chain) | `docs/governance/DX_HYGIENE.md` |
| Release hygiene (release-please, changelog) | `docs/governance/RELEASE_HYGIENE.md` |
| On-call playbook + live diagnostic protocol | `docs/runbooks/RUNBOOK.md` |
| Incident report template | `docs/incidents/TEMPLATE.md` |
| Test coverage roadmap | `docs/test-coverage-roadmap.md` |
| Security findings register | `docs/security-findings.md` |
| Test harness recon (cold-start audit) | `docs/test-harness-recon.md` |
| UX debt (live items only) | `docs/backlog/ux-debt.md` |
| Auth e2e staging backlog | `docs/backlog/auth-e2e-staging.md` |
| Working analog protocol + report-back template | `docs/patterns/WORKING_ANALOG.md` |
| Patterns playbook | `docs/patterns/` |
| In-flight work claims | `docs/WORK_IN_FLIGHT.md` |
| Staging environment setup + migration parity runbook | `docs/environments-staging-plan.md` |
