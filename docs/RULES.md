# Rules

Codified one-paragraph rules born from specific incidents. Each entry states the rule up front, then the incident that taught it. For recurring shapes with scaffolding, see `docs/patterns/`. For operations playbooks, see `docs/RUNBOOK.md`. This file is the short-form list.

Sort: strongest "if you skip this, production breaks" signal at the top.

---

## 1. Service-role client pollution in test helpers

**Rule.** Test helpers that create rows for E2E or unit coverage use the service-role Supabase client (`getServiceRoleClient`) via the seed helpers in `_helpers.ts` / `_auth-helpers.ts` — never instantiate a fresh client inside the test body. Tests that do their own `createClient(url, SERVICE_ROLE_KEY, ...)` leak a client instance that bypasses the shared pool, fails to clean up on worker shutdown, and causes `supabase_migrations` lock contention in the next test file.

**Incident (M2b).** One of the M2b test files instantiated a service-role client inline for a one-off INSERT. Subsequent test files started intermittently hanging on startup because the leaked client held an open connection to the migrations advisory lock, blocking the CLI's own migration-status probe. Fix: everything that writes to the DB from a test goes through the shared `getServiceRoleClient()` + the helper seeds, which reuse the one process-wide client.

---

## 2. Supabase email auth for fresh local stacks

**Rule.** When onboarding a fresh local Supabase stack to a developer machine or a CI runner, `supabase start` doesn't enable the email/password auth flow by default — the CLI ships with magic-link-only. `supabase/config.toml` must declare `[auth.email] enable_signups = true` and the `[auth] site_url` has to match the dev server origin, or `auth.signUp({ email, password })` returns 400 with a cryptic "Email signups are disabled" message that looks unrelated to config.

**Incident (M2a onboarding).** The first M2a draft worked against a manually-configured Supabase cloud project; CI's `supabase start` ran against the default CLI config and every auth test failed on the first call with an error that didn't mention email-vs-magic-link. Fixed by committing `supabase/config.toml` with the auth block explicit + adding a paragraph in `CLAUDE.md` pointing at the file so fresh clones see the knob.

---

## 3. CI stuck-run recovery: empty commit, don't cancel-rerun

**Rule.** When a GitHub Actions run hangs or stalls (concurrency-group lock, flaky Vercel preview, service timeout), the correct recovery is `git commit --allow-empty -m "ci: retrigger"` followed by `git push`. Do NOT use the UI's "Cancel" + "Re-run all jobs" path. Cancelling a run in a concurrency group sometimes leaves the group ref pinned; a re-run queues against the stale ref and hangs again. An empty commit advances the SHA, triggers a fresh run against a fresh concurrency-group key, and always clears the hang.

**Incident (several).** Twice in M3 the CI queue got wedged by `concurrency: group: e2e-${{ github.ref }} cancel-in-progress: true` interacting badly with the Vercel preview deployment racing the e2e job. Cancel-rerun reproduced the hang within 30s. An empty commit always cleared it. Bolted this into `docs/RUNBOOK.md` too.

---

## 4. Write-safety risk audit is mandatory on every sub-slice plan

**Rule.** Every PR description — sub-slice, hotfix, or infra — includes a **"Risks identified and mitigated"** section. Each entry names a write-safety hotspot in the proposed design (billed external calls, concurrent writers, multi-row state transitions, triggers, race windows, schema-level uniqueness assumptions) and states the concrete mitigation (idempotency key, DB unique constraint, advisory lock, dedicated test case, etc.). A PR without that section is not ready to merge. If the PR has no write-safety hotspots (pure docs, pure refactor), write "No write-safety hotspots — <one-line reason>" explicitly; don't skip the section.

**Incident (M3-6).** An early M3-6 draft landed in review without a risks section; the `pages (site_id, slug)` UNIQUE pre-commit claim was present in the schema but missing from the description. The reviewer spotted a SAVEPOINT gap that would have dup-billed Anthropic calls on the conflict path. The SAVEPOINT fix shipped in the same PR but wouldn't have been caught without the section. Rule codified in `CLAUDE.md` + reinforced in [`ship-sub-slice.md`](./patterns/ship-sub-slice.md).

---

## 5. UX debt capture discipline — into BACKLOG.md, never inline-fix

**Rule.** When a user-facing jargon leak, copy-text drift, label inconsistency, or other "small UX cleanup" surfaces inside an otherwise in-scope PR, capture it in `docs/BACKLOG.md` under the nearest applicable section (typically `## Product surface`). Do NOT silently expand the current PR's scope to fix it. The current PR has a focused plan + a risks audit sized for that plan; an unplanned "while I'm here" cleanup breaks both the scope contract and the review-in-five-minutes rule. Open the BACKLOG entry with a concrete pickup trigger ("next PR that touches this file") so it doesn't rot.

**Incident (M2d sign-off).** The `scope_prefix` UI field in `AddSiteModal.tsx` was flagged during M2c review as a jargon leak but got absorbed into an unrelated PR that was supposed to fix a login regression. The login PR's diff doubled, review stretched, and a second production bug almost landed because the reviewer's attention was split. The auto-prefix cleanup eventually shipped as PR #38 — a clean, focused slice. Since then, every ambient "while I'm here" observation goes into `BACKLOG.md`.

---

## Adding a new rule

- If a recurring shape with scaffolding emerges, that's a pattern — put it in `docs/patterns/`, not here.
- If an operational failure mode needs a response playbook, that's a runbook entry — put it in `docs/RUNBOOK.md`.
- If a rule is a one-paragraph "remember this" born from a specific incident, it belongs here.
- Rules in this file never have scaffolding. A rule that wants code belongs in a pattern.
