# Opollo Site Builder — Working Brief

## What this is

Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui + Vercel AI SDK.
A chat interface that generates WordPress pages for Opollo's clients, plus a
multi-tenant social posting platform (bundle.social), plus the Optimiser
module for landing-page optimisation.

This file is the operating manual every session reads first. Architecture
detail, audits, and operational deep-dives live under `docs/`. The
"Pointers" section at the bottom is the canonical index.

## Instruction to AI agents — explicit

You are reading this section because a past agent shipped insecure code,
claimed a third-party bug without protocol completion, or merged a feature
without coverage. Read it as a hard rule:

- **Refuse to ship features without coverage.** If the work doesn't fit one of the hard-floor patterns in §"Seven-layer test harness", say so and route the question to Steven.
- **Refuse to claim a third-party bug** without all seven steps of §"Live diagnostic protocol".
- **Refuse to skip tests** silently. Convert to `test.fixme` with an open issue link or remove with reasoning.
- **Surface security findings the moment you see them.** Do not defer them into a roadmap doc. See §"Security escalation".
- **Verify, don't assume.** See §"Verification over assumption".
- **Stop loops early.** See §"Loop detection".

Point any agent that violates these rules back to this section.

## Engineering principles

These are the tradeoff defaults. When in conflict with a specific rule
below, the specific rule wins; otherwise apply these.

1. **Prefer reversible decisions over irreversible.** A revert window matters more than a clever shortcut.
2. **Prefer correctness over cleverness.** Boring code that obviously matches the spec ships faster than smart code that needs explanation.
3. **Prefer narrow tested fixes over broad untested refactors.** A bug fix is not a license to clean up. Ship the fix; open a separate slice for the cleanup if it's warranted.
4. **Prefer rollback over forward-patch during incidents.** Cross-references §"Incident stabilisation priority". Forward-patches under pressure are how the original bug compounded.
5. **Prefer verification over inference.** See §"Verification over assumption".

## Merge decision tree

The single source of truth on whether Claude Code can auto-merge a PR.
Walk top to bottom.

```
1. Is the PR write-safety-critical?
   (M3 batch generator | M4 image library | M7 anything that spends money
    or mutates client WP sites | any code path that gates a billed external
    call without idempotency | any encryption / decryption code path)
   ├─ Yes → STOP. Steven merges.
   └─ No  → continue.

2. Is the PR on the milestone human-merge list?
   (M3, M4, M7. Plus any milestone Steven explicitly flagged as human-merge.)
   ├─ Yes → STOP. Steven merges.
   └─ No  → continue.

3. Was the PR opened by Steven?
   ├─ Yes → STOP. Steven merges.
   └─ No  → continue.

4. Has Steven flagged this PR for review (comment, label, or message)?
   ├─ Yes → STOP. Wait for review.
   └─ No  → continue.

5. Is CI fully green on every required status check?
   ├─ No  → see §"Self-test loop" + §"Auto-merge — operational notes".
   └─ Yes → continue.

6. Are there pending review requests or unresolved review comments?
   ├─ Yes → STOP. Wait for review.
   └─ No  → continue.

7. Merge gate: poll `gh pr checks <PR> --watch` until terminal. Verify
   every required check shows `pass`. Only then `gh pr merge <PR> --squash`.
   Auto-merge flags (`--auto`, `enable_pr_auto_merge`, UI button) are
   forbidden until issue #822 closes — they bypass CI on permissive branch
   protection. See §"Merge gate — no merge without CI-verified green".
```

Full background and edge cases: `docs/governance/MERGE_RULES.md`.

## Communication

Do not send conversational progress narration. Communicate only on:

- Completed milestones (slice merged, phase finished)
- Verified findings (test red-on-break confirmed, exploit reproduced + blocked)
- Real blockers (missing env var, external signup needed, architectural ambiguity)
- Security findings (immediate, regardless of current task — see §"Security escalation")
- Architectural escalations (cost tradeoff, spec ambiguity, security decision)
- Final outcomes (PR merged, CI green, incident resolved)

The heartbeat rule (§"Heartbeat") is the only exception during long
autonomous runs.

## Verification over assumption

Never claim any of the following without direct verification by command
output, CI status, API response, or observable system state. Inference is
not verification.

- A deploy succeeded
- A migration applied
- A test passed
- A webhook fired
- A queue drained
- A smoke suite passed
- A branch merged
- A rollback completed
- A third-party integration works

If you cannot verify, say "I have not verified <X>; the evidence I have
is <Y>" and pause until you can verify or until Steven directs otherwise.

## Loop detection

If the same class of failure persists across two materially different fix
attempts, **stop retrying**. Narrow the problem, isolate the subsystem,
document current evidence, and reassess assumptions before the next
attempt. Repeated retries without new evidence are failure amplification.

"Same class" means: same workflow, same job, same first error line. A
different first error line is a new failure (and resets the per-class count).

Hard ceiling: ten retry pushes total per PR, regardless of class. After
ten, escalate to Steven with the full evidence chain.

## Incident stabilisation priority

During production incidents, in this order:

1. **Restore stability.** Get users back to a working surface.
2. **Contain blast radius.** Disable the broken path, isolate the failed deploy, lock the credential.
3. **Preserve evidence.** Capture network traces, logs, decoded tokens, deployed bundle SHA, env-var state. The §"Live diagnostic protocol" is the canonical evidence template.
4. **Investigate root cause** only after the above.

Rollback to last known-good is preferred over speculative forward-fixes
when users are actively impacted.

## Risk-weighted execution

For changes involving any of: auth, billing, webhooks, multi-tenant
boundaries, concurrency, external side effects, destructive mutations,
production infrastructure, data migrations, or security enforcement —
**prioritise verification depth over implementation speed**. A slower
correct fix is preferred over a fast uncertain fix.

This complements §"Auto-continue": auto-continue applies to low-risk
paths. The list above is the high-risk set; pause and verify on each
sub-step rather than chaining.

## Security escalation

If a suspected vulnerability could expose any of the following, surface
**immediately** — even if unrelated to the current task. Do not defer
exploitable findings into roadmap docs.

- Tenant data
- Credentials (production secrets, API keys, master keys, OAuth tokens)
- Authentication state (session bypass, role elevation, MFA bypass)
- Billing operations (any future billing surface)
- Webhook authenticity (signature verification gap)
- Arbitrary code execution (XSS, deserialisation, prompt-injection-to-RCE)

Surfacing means: stop the current task, post a finding to Steven with
severity + exploit path + evidence, then wait for direction. Material
findings landed during a PR get the immediate-surface treatment, not a
phase-boundary summary.

## Critical paths

A "critical path" is any route or surface where a regression directly
impacts user trust, billing, security, or data integrity. Production
smoke (Layer 7) MUST pass for changes touching these.

| Class | Routes / surfaces |
|---|---|
| **Auth** | `/api/auth/*` (login, callback, logout, accept-invite, reset-password, forgot-password, change-password, devices), middleware session enforcement |
| **Social — connect / publish** | `/api/platform/social/connections/*`, `/api/platform/social/posts/[id]/{schedule,submit,approve,publish-attempts,recipients}`, `/api/webhooks/bundlesocial`, `/api/webhooks/qstash/social-publish` |
| **Multi-tenant boundaries** | Any RLS-protected route under `/api/platform/*`, `/api/admin/sites/[id]/*`, `/api/admin/companies/*` |
| **Billing** | (none today — slot reserved for future) |
| **Encryption** | Anything that touches `lib/encryption.ts` (`site_credentials.encrypted_value`, `opt_client_credentials`) |
| **Data migrations** | Any change to `supabase/migrations/`, `supabase/rollbacks/` |
| **Brief generation hot path** | `/api/cron/process-brief-runner`, `/api/cron/process-batch`, `/api/briefs/[brief_id]/{run,commit,cancel}` (cost + correctness) |

Full enumeration with file paths and last-modified history:
`docs/architecture/CRITICAL_PATHS.md`.

## Seven-layer test harness — coverage rules

Every PR must satisfy the layer rules for its change-shape. CI status
checks gate on the layers covered.

| # | Layer | File convention | npm script | CI status check |
|---|---|---|---|---|
| 1 | Unit | `*.unit.test.ts`, mocked deps | `test:unit` | `test-unit` |
| 2 | Contract | `*.contract.test.ts` + `__snapshots__/` | `test:contract` | `test-unit` (subset) |
| 3 | Integration | `lib/__tests__/*.test.ts` (real Supabase) | `test:integration` | `test` |
| 4 | Component | `components/__tests__/**/*.test.{ts,tsx}` | `test:components` | `test-components` |
| 5 | E2E | `e2e/*.spec.ts` | `test:e2e` | `e2e` |
| 6 | Security | `lib/__tests__/*.security.test.ts`, `tests/security/**` | `test:security` | included in `test-unit` / `test` |
| 7 | Live probes + smoke | `scripts/probes/*.ts`, `e2e/smoke/*.spec.ts` | `test:smoke` | `smoke` (post-deploy) |

### Hard floors per change-shape

- **New API route** → integration (happy + auth + validation) + cross-tenant if tenant-scoped + injection if user input flows to DB or LLM.
- **New external SDK call** → contract snapshot + probe script.
- **New user-facing journey** → e2e + `auditA11y`.
- **User-input rendering surface** (`dangerouslySetInnerHTML` or operator/tenant content) → component-layer test driving every `XSS_PAYLOADS` entry through the real renderer.
- **New webhook receiver** → signature-verification security test driving real wrong-signed payload through the route handler, asserting 401.
- **Any change to RLS policy** → cross-tenant isolation test using `seedTwoCompanies()`.
- **Any change to a critical path** (§"Critical paths") → production smoke must pass post-deploy.
- **Any production bug fix that took >1 PR** → permanent regression test under `tests/regressions/<bug-slug>.test.ts` BEFORE the final fix merges.

### Flaky / fixme tests

`test.skip()` runtime branches that bail on missing seed are forbidden —
fix the seed. `test.fixme()` is the only acceptable skip variant, and
**every fixme MUST link an open issue within seven days** (provisional —
adjust on real-world data). CI fails the build if any fixme has been
open longer with no linked issue. The static-audit script flags
violators.

## Live diagnostic protocol — required before any "third-party bug" claim

**No agent in this codebase may claim "third-party bug" for any external
integration without completing this protocol first.** Seven steps, all
required, all attached to the incident doc using
`docs/incidents/TEMPLATE.md`.

0. **Confirm env vars the failing path depends on are SET in the target deployment.** Use `vercel env ls` (production scope). Missing env is a config issue, not a third-party bug.
1. **Run the relevant probe script** in `scripts/probes/`. Capture full markdown output. Empty output = a missing probe = step-1-failed.
2. **Verify the deployed bundle matches source.** Use `vercel inspect <deploy-url>` to confirm the deployed commit SHA, then `git log <sha> -1` to confirm the commit content. The "fix wasn't pushed" failure mode (May 2026 incident) must be impossible to recreate.
3. **Run the contract test against the live deployed environment.** Set `PROBE_BASE_URL=https://opollo-site-builder.vercel.app`. If the actual outgoing request payload differs from the contract snapshot — that's the bug. Investigate locally.
4. **Capture full network trace and response bodies.** `curl -v` or Playwright trace export. All headers, body, status codes.
5. **Decode any tokens, JWTs, or signed payloads** in the response. Check that claims match what was sent.
6. **Document at `docs/incidents/<timestamp>-<integration>.md`.** Steps 0–5 are evidence rows.

Only after all seven fail to find a code-side cause is escalation to
"third-party issue" allowed.

## Security realism rule

Every security test (Layer 6) must demonstrate that an exploit is
**blocked by the running system**. Specifically:

- Drive the payload through the real enforcement boundary (the actual route handler, the actual sanitiser, the actual middleware).
- Assert a concrete outcome (status code, DOM shape, DB row state).
- A scanner emitting findings without an actionable assertion is not a security test.

If a security test cannot demonstrate the exploit is blocked, it is not
a security test. Either rewrite it to drive the failure path through
the real system or remove it.

**High-severity security findings block merge.**

## Self-test loop

- Retry ceiling: **ten attempts per PR**, absolute. Not three.
- Retry count alone is not the escalation trigger. **"Not converging" is**: same workflow + same job + same first error line, twice in a row → stop, narrow, document, reassess (see §"Loop detection").
- Anything else is a new failure and resets the per-class count (but not the absolute 10).
- CI failure logs auto-post as PR comments by `.github/workflows/ci.yml`. Read those instead of asking Steven to paste logs.
- Escalate to Steven only when: (a) loop-detection fires, (b) a genuine architectural question requires his input — spec deviation, security tradeoff, schema decision.

## Heartbeat

If working autonomously for more than **90 minutes** (provisional —
adjust on real-world session data) without a merge or surfaced
milestone, post a one-line status:

```
Still on <slice>; current state: <X>; next: <Y>.
```

Heartbeat is the only allowed deviation from §"Communication". It
exists so Steven knows whether to interrupt without him having to ask.

## Merge gate — no merge without CI-verified green

The §"Merge decision tree" is the truth. This section is the **gate
that prevents premature merges** — the failure mode where a PR
auto-merges before CI runs.

**No merge — CLI, MCP, or UI button — fires until CI is verified green
by polling.** The mechanism that prevents premature merge is
required-status-checks at the branch protection level. Until those are
configured (tracked in #822), all merges are gated by an explicit
polling loop:

1. `gh pr checks <PR> --watch` — wait until every check is terminal.
2. Read the conclusion of each check. Every required check must show `pass`.
3. Only then: `gh pr merge <PR> --squash`.

**Auto-merge flags are forbidden on this repo** until #822 closes:

- ❌ `gh pr merge --auto` — fires immediately on permissive branch protection.
- ❌ `mcp__github__enable_pr_auto_merge` — same failure mode at the API layer.
- ❌ Clicking the green merge button in the UI before checks are green.

The "arm auto-merge at creation time" pattern from earlier docs is
revoked by this rule. It only worked when branch protection required
checks; here it does not, so arming = merging-without-CI.

**"Out-of-date with base" handling**: if a polled PR shows OPEN +
BEHIND, run `gh pr update-branch <PR>` automatically. Update-branch
failure due to merge conflict → stop and report; do not force. After
update-branch, CI re-runs — wait for terminal green again before
`--squash`.

Once #822 closes (branch protection requires the eight CI status
checks), the polling loop becomes a **backup** rather than the primary
gate, and arming auto-merge via `gh pr merge --auto` becomes safe again.
At that point this section gets revised.

## Sub-slice autonomy

For sub-slices of a parent milestone whose plan Steven has already
approved (M2a/b/c/d under M2, etc.), execute end-to-end without
per-slice plan review. Plan goes in the PR description, not a chat
message. Auto-merge per §"Merge decision tree". One-line status ping
post-merge: `<slice> merged, starting <next>`.

Escalate only for: architectural decisions not in the parent plan,
spec deviations, security tradeoffs, or loop-detection.

## Auto-continue

After an auto-merged PR, automatically proceed to the next slice per the
roadmap. No stop-gates at sub-slice or parent-milestone boundaries.
Silence = keep going.

Stop and wait for Steven only when:

- Architectural escalation surfaces (covered by §"Risk-weighted execution").
- Loop-detection fires (§"Loop detection").
- Required env var is missing (note what's needed, skip the affected slice, continue with slices that don't depend on it).
- Steven explicitly says pause.

Write-safety-critical milestones (M3, M4, M7, anything spending money
or mutating client WP) still require per-slice plans with the
**"Risks identified and mitigated"** audit per §"Self-audit".

## Parallelism

Default is single session. When Steven runs two browser tabs:

- Read `docs/WORK_IN_FLIGHT.md` before editing any file.
- Append a claim block (branch + slice + files claimed + reserved migration number).
- Prefix every status message with `[Session A]` / `[Session B]`.
- On merge, remove your claim block in the next PR's first commit.
- Conflict with the other session's claims → stop and ask Steven.

Full protocol + bootstrap prompt: `docs/governance/PARALLELISM.md`.

## Self-audit is the review

Once a plan has a populated **"Risks identified and mitigated"**
section, proceed directly to implementation. Do NOT post plans to
Steven as a review gate.

The Risks section MUST list:

- Each write-safety hotspot (billed external calls, concurrent writers, multi-row state transitions, triggers, race windows, schema-level uniqueness).
- How the plan mitigates each (idempotency key, DB unique constraint, advisory lock, dedicated test, etc.).
- Any deferred gaps with reason + follow-up slice pointer.

Where plans live:

- Parent milestone plans → first sub-slice's PR description.
- Sub-slice plans → that sub-slice's PR description.

A plan without a populated Risks section is not ready to execute.

## PR size limit

Soft ceiling: **500 lines net change per PR** (provisional — adjust if
it produces friction). Stated exceptions: renames, generated files,
atomic config consolidations.

Above 500 net lines, state in the PR description why the size is
warranted (incident response, large rename, generated migration). If
the answer is "incremental work that grew", the PR should split.

## Pre-PR checklist

Paste into the PR description. The PR template at
`.github/pull_request_template.md` is the long form.

```
- [ ] Lint, typecheck, build all green
- [ ] Layer scripts run: which of test:unit / test:integration / test:components / test:e2e / test:security
- [ ] Contract snapshots reviewed (if SDK calls touched)
- [ ] Cross-tenant test added (if tenant-scoped resource added)
- [ ] XSS payload coverage added (if user-content rendering touched)
- [ ] Probe script updated (if SDK boundary changed)
- [ ] Regression test added (if this fix is for a >1-PR production bug)
- [ ] Risks identified and mitigated section in PR body
- [ ] PR is under 500 net lines OR exception stated
```

## Pre-commit / commit-msg

Husky-managed. `pre-commit` runs `lint-staged` + `npm run test:unit`
(skip with `SKIP_PRECOMMIT_TESTS=1` for explicit rebases — never with
`--no-verify`). `commit-msg` enforces Conventional Commits, 100-char
header cap.

Detail + supply-chain scans (CodeQL, Dependabot, gitleaks, npm audit):
`docs/governance/DX_HYGIENE.md`.

## Commands

| Command | What |
|---|---|
| `npm run dev` | Local dev |
| `npm run lint` | ESLint |
| `npm run lint:css` | stylelint on `seed/**/*.css` |
| `npm run typecheck` | tsc --noEmit |
| `npm run build` | Production build |
| `npm run test:unit` | Layer 1 + 2 + regression + no-DB security (no Supabase, ~10 s) |
| `npm run test:components` | Layer 4 (jsdom, no Supabase) |
| `npm run test:integration` | Layer 3 (real Supabase, ~10–40 min) |
| `npm run test:e2e` | Layer 5 Playwright (real Supabase) |
| `npm run test:security` | Layer 6 (filtered by `--testNamePattern=SECURITY`) |
| `npm run test:smoke` | Layer 7 against live URL |
| `npm run test:precommit` | lint + typecheck + Layer 1 |
| `npm run test:regressions` | `tests/regressions/` only |
| `npm run audit:static` | Static-analysis script (HIGH gates CI) |
| `npm run analyze` | Production build with bundle analyzer |

## Standards

- Server Components by default; Client Components only when required
- shadcn/ui over custom; Tailwind utility classes only
- Strict TypeScript — no `any`, no `@ts-ignore`
- One logical change per commit; conventional commit messages

## Pointers

Architecture and historical detail moved out of this file to keep it
under ~450 lines. The pointers below are load-bearing — when a section
links here, it is the canonical reference.

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
| Merge rules (full version) | `docs/governance/MERGE_RULES.md` |
| Parallelism plan + bootstrap prompt | `docs/governance/PARALLELISM.md` |
| DX hygiene (hooks, commitlint, supply chain) | `docs/governance/DX_HYGIENE.md` |
| Release hygiene (release-please, changelog) | `docs/governance/RELEASE_HYGIENE.md` |
| On-call playbook | `docs/runbooks/RUNBOOK.md` |
| Incident report template | `docs/incidents/TEMPLATE.md` |
| Test coverage roadmap | `docs/test-coverage-roadmap.md` |
| Security findings register | `docs/security-findings.md` |
| Test harness recon (cold-start audit) | `docs/test-harness-recon.md` |
| UX debt (live items only) | `docs/backlog/ux-debt.md` |
| Patterns playbook | `docs/patterns/` |
| In-flight work claims | `docs/WORK_IN_FLIGHT.md` |
