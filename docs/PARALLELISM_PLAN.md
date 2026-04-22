# Parallelism feasibility — multi-session coordination via GitHub

Target: two (or more) Claude Code browser sessions shipping independent sub-slices against the same repo at the same time, without breaking the auto-merge + auto-continue workflow. This is the analysis; Steven decides whether to adopt it at M5 or later.

Non-goal: local worktrees. Steven runs Claude Code in the browser; sessions coordinate through shared GitHub state (branches, PRs, main's commit history, and one small file checked into the repo).

## The short answer

**Yes, feasible.** Two browser sessions can work in parallel against the same repo provided:

1. Each session claims its sub-slice in `docs/WORK_IN_FLIGHT.md` before writing code.
2. Each session works on its own `<type>/<scope>` branch.
3. Both PRs arm auto-merge on creation.
4. The merge queue serialises — GitHub's auto-merge handles the race. Conflict recovery is the standard "rebase on main + re-push" procedure.
5. Branch-protection's "Require branches to be up to date before merging" is ON — so the second PR re-runs CI against post-merge main automatically.

The remaining risks are (a) two sessions claiming overlapping file scopes by accident, (b) CI flakes getting amplified by 2× the runs, (c) operator context split across two tabs.

## What *could* break — risk model

### 1. Auto-merge queue with concurrent mergeable PRs

**Setup.** PR-A and PR-B both pass all required checks and have auto-merge armed. They're independently mergeable at roughly the same moment.

**GitHub's actual behaviour.** Auto-merge doesn't process PRs as a literal FIFO queue. It evaluates each PR when the last required check reports green. Whichever PR finishes CI last is the last one it tries to merge. Both merges are atomic — the winner updates main, the loser sees "merge conflict" only if they actually touch the same lines.

**What breaks.** If "Require branches to be up to date before merging" is OFF, two PRs can both merge even if their diffs would have conflicted at a logical (but not textual) level. Example: PR-A removes a function `foo`, PR-B adds a new caller of `foo`. Both diffs merge cleanly as text; the resulting `main` is broken at runtime. CI never caught it because neither branch's CI saw the other's change.

**Mitigation.** Turn ON "Require branches to be up to date before merging" in branch protection. GitHub then forces PR-B to re-test against the post-merge main before the second merge fires. The second merge waits on PR-B's fresh CI run. Adds ~5 minutes of wall clock per second merge; eliminates the logical-conflict class entirely.

**Action item (1-click):** Branch protection → main → **Require branches to be up to date before merging**: ON. Also confirm **Required status checks** includes `typecheck`, `lint`, `build`, `test`, `audit`, `scan`. Don't add `lhci` / `e2e` to required — they're informational today.

### 2. Textual merge conflicts

**Setup.** Session A edits `CLAUDE.md` on branch `feat/a-thing`. Session B edits `CLAUDE.md` on branch `feat/b-thing`. Both PRs open.

**What GitHub does.** PR-A merges first. PR-B shows "This branch has conflicts that must be resolved." Auto-merge does nothing until the conflict resolves.

**Recovery — standard rebase.** From Session B:

```bash
git fetch origin main
git rebase origin/main
# resolve conflicts in editor (Claude Code handles this via Edit tool)
git rebase --continue
git push -f origin feat/b-thing
```

GitHub re-tests CI on the rebased branch; auto-merge re-fires on green.

**`-f` is OK here because** it's the session's own branch, never main. Auto-merge on PR-B is preserved across force-push (the armed-auto-merge state sticks to the PR, not the commit SHA).

**Prevention.** `docs/WORK_IN_FLIGHT.md` declares files each session is claiming. Before either session edits a file, it checks the other's claim. If a conflict is inevitable (both sessions legitimately need `CLAUDE.md`), they negotiate — one session waits, or they split the edit.

### 3. CI flake amplification

**Setup.** `lhci` is flaky (~10% of runs). E2E is flaky (~5%). With two PRs running concurrent CI pipelines, probability of at least one flake per pair ≈ 1 − 0.90×0.95 ≈ 14.5% per pair.

**What breaks.** One or both PRs stall on a flake, operator context switches to investigate.

**Mitigation.** The CLAUDE.md rule — *same failure twice in a row is the escalation trigger; a one-off flake is an empty-commit retrigger*. Plus: `lhci` and `e2e` are NOT required checks (per above), so flakes in those don't block merge.

### 4. Two sessions fighting over shared infra files

Files where simultaneous editing is especially risky:

- `CLAUDE.md` — two sessions adding rules/sections at different line offsets. Textual conflict certain.
- `docs/BACKLOG.md` — both sessions adding entries or promoting items. Conflict likely.
- `docs/WORK_IN_FLIGHT.md` — the coordination file itself. Needs special handling.
- `package.json` + `package-lock.json` — if both sessions add deps, lockfile diffs conflict.
- `supabase/migrations/0NNN_*.sql` — both sessions adding a migration pick the same N. UNIQUE version collision at apply time.
- `.github/workflows/*.yml` — both sessions tweaking CI simultaneously.

**Mitigation matrix in `WORK_IN_FLIGHT.md`.** Any of these files appear in a claim line → the other session waits or scopes around.

**Migration numbering.** First session to reserve a migration number writes it in their claim. Second session picks N+1. Numbering doesn't need to match merge order (the CLI applies in lexical order, not merge order).

### 5. Operator context split

Steven runs two Claude Code tabs. Each posts status pings. Each subscribes to its own PR webhooks.

**What breaks.** Cross-session confusion — "which session was doing M5-2 again?"

**Mitigation.** Each session tags its status messages with `[Session A]` / `[Session B]` prefix. `WORK_IN_FLIGHT.md` is the always-current map of who's doing what. A simple `cat docs/WORK_IN_FLIGHT.md` resolves "which session is on M5-2" in one read.

## Branch protection one-shot

Before adopting parallelism, flip these on main in a single settings pass:

- **Require a pull request before merging:** ON
- **Require status checks to pass before merging:** ON
  - Required: `typecheck`, `lint`, `build`, `test`, `audit`, `scan`, `CodeQL`, `Analyze (javascript-typescript)`
  - NOT required: `lhci`, `e2e`, `Vercel Preview Comments`
- **Require branches to be up to date before merging:** ON ← this is the critical one
- **Require linear history:** ON (cleaner main, easier bisect)
- **Allow auto-merge:** ON (already on per `CLAUDE.md`)
- **Do not allow bypassing the above settings:** ON for Steven too

## The bootstrap prompt — copy-paste into a second browser tab

```
You're joining an existing Claude Code session as [Session B]. Session A is already
in flight on the same repo.

Step 1 — Read these files first, in order:
  1. CLAUDE.md (the working brief; note the three-doors structure)
  2. docs/WORK_IN_FLIGHT.md (what Session A is doing; files-not-to-touch)
  3. docs/ENGINEERING_STANDARDS.md (portable engineering rules)
  4. docs/patterns/README.md (the pattern index)
  5. docs/RUNBOOK.md (operations playbook — skim the index)
  6. docs/RULES.md (one-paragraph rules from specific incidents — skim)

Step 2 — Your assigned sub-slice:
  <PASTE SLICE NAME HERE, e.g. "M5-2: component gallery list page">

Step 3 — Before writing any code:
  a. Open docs/WORK_IN_FLIGHT.md. Read Session A's claim block.
  b. If your slice touches any file in Session A's "files-claimed" list OR any
     file in the "hot-shared" list (CLAUDE.md, BACKLOG.md, package.json,
     package-lock.json, supabase/migrations/*, .github/workflows/*), STOP and
     post a message to Steven: "[Session B] Scope conflict with Session A on
     <files>. How to proceed?"
  c. Otherwise, append your own claim block:

     ---
     ## Session B
     - Started: 2026-MM-DD HH:MM UTC
     - Branch: <type>/<scope>
     - Slice: <slice name>
     - Files claimed:
       - <path>
       - <path>
     - Migration number reserved: <N, if applicable>
     ---

     Commit this as the first commit on your feature branch. Title:
     "chore(wip): claim <slice name> for Session B".

Step 4 — Work the slice. Follow docs/patterns/ship-sub-slice.md. Standard flow:
  - Plan-in-PR-description with "Risks identified and mitigated" section.
  - Open the PR with code + tests.
  - Arm auto-merge with mergeMethod=SQUASH immediately.
  - Subscribe to PR activity.
  - Self-correct CI failures (10 retries, escalate on same-failure-twice).

Step 5 — Prefix ALL status updates to Steven with "[Session B]" so Session A and
Steven can tell us apart.

Step 6 — On merge, remove your claim block from docs/WORK_IN_FLIGHT.md in your
NEXT PR (doesn't need its own PR — fold into the next slice's first commit).
If you're done for the session, open a tiny cleanup PR that just removes the
block.

If you hit same-failure-twice, architectural ambiguity, or a scope conflict
with Session A that isn't resolvable by picking a different file: stop and
ask Steven. Don't coordinate directly with Session A — Steven is the conflict
arbiter.
```

Steven customises one line (`<PASTE SLICE NAME HERE>`) and pastes the rest verbatim.

## `docs/WORK_IN_FLIGHT.md` template

A single markdown file checked into the repo. Each session appends a claim block on start, removes it on slice completion. The file exists even when no parallel work is happening — the absence of claim blocks is the signal.

See `docs/WORK_IN_FLIGHT.md` in this PR for the live template. The shape:

```
# Work in flight

Active claim blocks live below. Each session claims its files before editing
them; both sessions read this file before starting any new slice.

<!-- CLAIM BLOCKS BELOW THIS LINE -->

---
## Session A
- Started: 2026-05-02 14:30 UTC
- Branch: feat/m5-1-component-gallery-schema
- Slice: M5-1 — component-gallery schema migration
- Files claimed:
  - supabase/migrations/0010_m5_1_component_gallery.sql
  - supabase/rollbacks/0010_m5_1_component_gallery.down.sql
  - lib/__tests__/m5-schema.test.ts
- Migration number reserved: 0010
---

## Hot-shared (always check before claiming)

- CLAUDE.md
- docs/BACKLOG.md
- docs/WORK_IN_FLIGHT.md (this file)
- package.json
- package-lock.json
- supabase/migrations/*.sql (see claimed migration numbers above)
- .github/workflows/*.yml
- .github/dependabot.yml
```

Update discipline:

- **Start of slice** — append claim block.
- **Mid-slice** — if scope grows and new files need claiming, update the block.
- **End of slice (PR merged)** — remove the block in the next PR's first commit, or in a standalone cleanup PR if no follow-up is queued.
- **Session exit** — if a session is being abandoned mid-slice, convert the claim block to a `## Paused — Session A` block with a note, or remove it if the work is being dropped.

## Dependency analysis — where parallel work pays off

The analysis below is based on what I know of M4 and educated guesses about M5+. Steven fills in specifics as milestones scope.

### Within-milestone parallelism

**M4 (image library / transactional transfer Cloudflare ↔ WP ↔ DB).** Probably **not** parallelisable internally. Every sub-slice depends on the previous schema / worker state. Transactional write-safety guarantees cross across sub-slice boundaries — parallel sub-slices risk racing on the same invariants. Ship M4 serially.

**M5 / M6 / M7 / M8.** Unknown shape; the general principle:

- **Schema-first sub-slices** (migration + helpers) serialise. Two concurrent migrations collide on the version number; two concurrent helper-lib changes fight over `lib/<resource>.ts`.
- **UI-surface sub-slices** parallelise reasonably well. List page + detail page + create modal can often ship in parallel once the API + lib layer is stable.
- **Test-surface sub-slices** parallelise very well. Adding E2E specs for a shipped surface rarely collides.

### Across-milestone parallelism

**M4 → M5.** M5 planning (PR descriptions, risk audits, `docs/patterns/` updates if a new shape emerges) can happen during M4 in a second session. M5 *code* should wait until M4 signs off — M4 is write-safety critical and "while M4 is in flight" doubles the review burden Steven is trying to avoid.

**M5 / M6.** If decoupled (different feature areas with minimal schema overlap), they can run in parallel. If M6 is "per-page iteration UI" it probably depends on M5's output; serialise.

**M7 / M8.** Not enough signal to analyse. Defer the question.

### Recommendation

Adopt parallelism starting at a sub-milestone boundary with known-independent work, not mid-milestone. Best first candidate: a post-M4 pass where the two parallel slices are (a) a documentation / pattern update and (b) a test-coverage expansion — both low write-safety, both unlikely to touch shared files. Proves the coordination mechanism under low stakes before running it on feature code.

## Testing the hypothesis

Before committing to parallelism for real slices, run one dry-run pair:

1. **Two trivial parallel PRs**, both via bootstrap prompt above. Claim-block flow exercised. Disjoint files.
2. **Target**: both PRs merge without manual intervention. Both post `[Session N] <slice> merged` one-liners. `WORK_IN_FLIGHT.md` ends empty.
3. **If the dry run surfaces a coordination bug** (claim race, merge-queue ordering issue, conflict-recovery path unclear), patch this file + the bootstrap prompt before running a real pair.

## Operator workflow — how Steven tracks two sessions

- Two browser tabs, one per session. Tab titles: `[A] <slice>` / `[B] <slice>` — Steven sets this manually on session start.
- GitHub PRs page — filter by `author:claude-*` or by branch prefix. Two open PRs normal; more than two, investigate.
- `docs/WORK_IN_FLIGHT.md` — the ground truth. Steven reads it first when context-switching.
- Status pings — every session message prefixed with `[Session A]` / `[Session B]`. In-tab Claude output already in-tab; the prefix is for when Steven paraphrases back into the repo (e.g. "Session B: M5-2 merged; Session A: working on M5-3") so future agents reading the history can follow.

Nothing in this workflow requires tooling beyond what already exists. No dashboard, no external coordination service, no webhook router.

## What this plan does *not* cover

- **Three+ sessions in parallel.** Two is the target. Three would require promoting `WORK_IN_FLIGHT.md` into a harder source of truth (e.g. file locking via pre-commit hook). Defer.
- **Cross-session code review.** Sessions don't review each other's PRs; Steven is the reviewer by virtue of merging. If two sessions *did* need to coordinate code design, they'd go through Steven, not via a message between sessions.
- **Parallel hotfix on main while a feature is in flight.** Hotfixes that bypass `main` gates are a different pattern — see `docs/RUNBOOK.md` "Production incident recovery" for the serial version.
- **Shared runtime state changes** (feature flag flips, env var provisioning, infra secrets). These are single-operator actions by Steven; sessions request + wait.

## Recommendation

**Adopt parallelism at a well-chosen boundary, not by default.** The coordination file + bootstrap prompt + branch-protection tighten are shipping in this PR. A dry-run pair is cheap to try once M4 ships. If the dry run passes clean, use parallelism on M5 or later when two independent slices are genuinely available. If the dry run surfaces bugs, patch and retry.

Serial-single-session remains the default for anything write-safety-critical.

## Next steps in this PR

- Ship `docs/PARALLELISM_PLAN.md` (this file).
- Ship `docs/WORK_IN_FLIGHT.md` as an empty-claim template — exists so the first parallel session has a file to append to, no bootstrap thrash.
- Point at both from `CLAUDE.md` under a new *Parallelism* section.

Next steps *after* this PR:

- Steven flips the branch-protection settings listed above.
- Stop and wait for M4 sign-off before any parallel work starts.
- First dry-run pair scheduled at Steven's discretion post-M4.
