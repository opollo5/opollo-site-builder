# Rules

Codified one-paragraph rules born from specific incidents. Each entry states the rule up front, then the incident that taught it. For recurring shapes with scaffolding, see `docs/patterns/`. For operations playbooks, see `docs/RUNBOOK.md`. This file is the short-form list.

Sort: strongest "if you skip this, production breaks" signal at the top.

> **Cross-reference (added 2026-05-09):** `CLAUDE.md` carries top-level
> engineering rules that aren't incident-derived (Verification over
> assumption, Loop detection, Incident stabilisation priority,
> Risk-weighted execution, Security escalation, Heartbeat, PR size
> limit, Communication discipline). Read both: this file is the
> historical incident registry, `CLAUDE.md` is the daily operating
> manual.

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

## 6. ADD COLUMN on a populated table needs a default or a backfill

**Rule.** New migrations of the form `ALTER TABLE <t> ADD COLUMN <c> <type> NOT NULL` against a table that already has rows in production MUST ship one of: (a) a `DEFAULT <value>` clause so existing rows get populated at ALTER time; or (b) an explicit backfill step in the same migration file (`UPDATE <t> SET <c> = ...` before the `SET NOT NULL`). A migration that only works on a fresh DB is a latent incident — it runs green in CI and blows up the first time it meets real data. Reviewers should bounce any `ADD COLUMN ... NOT NULL` without a default or backfill; migrations that rely on the target table being empty need that assumption stated explicitly in the migration's header comment AND verified against production row counts before merge.

**Incident (Audit 3, 2026-04-22).** Migrations `0008_m3_4_slot_html.sql` and `0009_m3_7_retry_after.sql` add columns to `generation_job_pages` without defaults or backfills. They shipped clean because at the time every row in that table was either fresh or absent (M3 was the first milestone to populate it). Audit 3 surfaced the pattern as a latent risk — if a future rollback-and-replay scenario, fork, or migration-order reshuffle exposed those migrations to a populated table, they would fail on a live-DB upgrade. Runbook section `Apply a backfill-required migration to a populated production DB` covers the recovery path; this rule prevents new instances from landing.

---

## 7. Typography minimums — body ≥ 1rem, small ≥ 0.875rem, no text-xs

**Rule.** Operator-facing UI text has two floors. Body text (paragraph copy, form input values, page descriptions, modal body, table cells used as primary reading content) sits at `text-base` (1rem / 16px) minimum. Small text (helper copy, captions, badges, eyebrows, breadcrumbs, status microcopy) sits at `text-sm` (0.875rem / 14px) minimum. `text-xs` (0.75rem / 12px) is forbidden on every operator surface; do not introduce it in new code, and uplift any encountered to `text-sm`. The two floors map directly to Tailwind's existing utilities — no custom font-size values, no inline `style={{ fontSize: ... }}` below 14px. Reference: A-1 typography-scale doc block in `app/globals.css`.

**Incident (UAT 2026-05-02).** Steven flagged during UAT that the admin UI had "a lot of text that is too small to read" — 530+ `text-xs` (12px) usages across 122 files lived in the operator surfaces, plus the A-1 typography primitives' `Lead` ("intro / context line") sat at `text-sm` despite being the body-copy companion to `H1`. Phase 1 sweep eliminated `text-xs` site-wide and bumped `Lead` to `text-base`. Phase 2 — auditing each `text-sm` callsite where the role is body copy rather than helper / caption — is captured in `docs/BACKLOG.md`.

---

## 8. Pre-merge checklist — `npm run audit:static` HIGH must be zero

**Rule.** Every PR MUST pass the `static-audit` CI job — i.e. `npm run audit:static` exits with code 0 (no HIGH severity issues). The script lives at `scripts/audit.ts` and runs nine checks (HIGH severity: middleware-public-paths, migration-ordering, unauthenticated-api; MEDIUM: admin-api-gate, db-column-references, error-handling; LOW: typography-minimums, env-vars, dead-routes). HIGH severity gates the build; MEDIUM/LOW are advisory. If a HIGH hit is a genuine false positive, the fix is to refine the heuristic in the audit script itself — never bypass with `// audit:ignore` or similar (no such mechanism exists by design). If the audit reports a new MEDIUM or LOW class on a PR, address it in the same PR or open a follow-up; don't let the warning count drift up.

**Incident (PLATFORM-AUDIT 2026-05-02).** UAT surfaced three logic-error classes that cost a half-day each to debug at runtime — middleware-public-path miss (invite acceptance link bounced to /login), admin API gate excluding super_admin (invite submit returned `Role 'super_admin' is not permitted`), and missing-column writes to `sites.updated_by` (mode save returned masked 500). All three would have been caught by static analysis. The PLATFORM-AUDIT workstream (PRs #386, #389, #392, #394, #396, #398, #400) shipped the audit script + CI integration + fixes for every HIGH finding the first run produced (38 → 0). Going forward, CI catches these classes at PR time, not at UAT time.

---

## 9. Never echo env-var values or connection strings to tool output

**Rule.** When a command consumes a value from `.env.local`, env, or any other secret source, it MUST run with stderr redirected to `$null` (PowerShell) / `/dev/null` (bash), and any successful-path output must be filtered to drop the secret before it appears in the conversation transcript. Concretely: pass the value via a variable (never inline it into the visible command), set `2>$null` on the invocation, and if the tool's own success output contains the secret (some CLIs echo what they parsed), additionally pipe through a redactor before printing. The same rule applies to anything that *constructs* a URL from an env value — `Write-Output $env:FOO`, `Write-Host $url`, `console.log(connectionString)` are all banned. If you need to confirm a value is set, print only its length or a SHA-256 prefix, never the value.

**Incident (P1 bootstrap, 2026-05-03).** During the first attempt to apply migration 0074 to the remote project, a PowerShell parsing bug (`.Trim('"').Trim("'")` — only stripped quote characters, not whitespace) left trailing tabs on the value read from `.env.local`. The supabase CLI received `postgresql://user:password@host:6543/postgres\t\t --dry-run`, failed parsing, and echoed the full malformed input (including the live database password) to stderr — which Claude Code captured into the conversation transcript. The credential is now in a chat log Steven controls but couldn't be rotated until P1 finished. Rotation got logged in `docs/BACKLOG.md`. Going forward: every `.env`-consuming invocation gets `2>$null` (or stderr piped through a redactor), values pass via variables that are never `Write-Output`'d, and pre-flight parsing trims with bare `.Trim()` so malformed input fails before reaching the CLI.

---

## 10. Admin pages use the shared PageHeader primitive

**Rule.** All authenticated admin pages must use the shared PageHeader component to ensure consistent typographic hierarchy and breadcrumb structure across the platform. Concretely: every `app/admin/**/page.tsx` and `app/account/**/page.tsx` file MUST `import { PageHeader } from "@/components/ui/page-header"` and render its compound slots (`<PageHeader.Title>`, `<PageHeader.Breadcrumb>`, optional Subtitle / Meta / Actions) in the component tree. Slot order is enforced by the component (Title → Breadcrumb → Subtitle → Meta → Actions; Spec 04 amendment, 2026-05-08), so the JSX child order does not matter. Audit script `headings-use-page-header` (HIGH) enforces presence at PR time.

There are TWO allowlists in `scripts/audit.ts`:

- `PAGE_HEADER_DEFERRED_ROUTES` is **temporary** — routes pending migration. Entries get removed as each route adopts PageHeader. Should reach `[]` when Spec 04 completes. New entries here = regression — don't add.
- `PAGE_HEADER_EXEMPT_ROUTES` is **permanent** — routes that legitimately can't fit PageHeader (full-bleed editor, modal-style page, custom chrome that doesn't pair with the shell). Each entry must include a comment explaining why. The bar is high; default is migrate.

**Incident (Spec 02, 2026-05-07; amended Spec 04, 2026-05-08).** PageHeader / PageShell / Breadcrumb landed in PR 1 of Spec 02. PR 2 swept the top 8 operator-traffic routes; 31 routes deferred via `PAGE_HEADER_DEFERRED_ROUTES`. Audit rule lands in PR 3 with the allowlist so the rule starts firing as soon as the follow-up migrates each route. Spec 04 (2026-05-08) flipped the slot order, applied the polish pass (rhythm + weight 700), and completes the deferred sweep — `PAGE_HEADER_DEFERRED_ROUTES` drains to `[]` by the end of Spec 04. The permanent `PAGE_HEADER_EXEMPT_ROUTES` list lands in Spec 04 PR A as a separate, narrower escape hatch.

---

## 11. Breadcrumbs are required when a page imports PageHeader

**Rule.** Breadcrumbs are required because the platform's nested navigation depth (`Admin > Sites > Site > Setup > Step`) cannot be inferred from the URL alone. If a `page.tsx` imports `PageHeader`, it MUST render `<PageHeader.Breadcrumb>` in its JSX. Audit script `breadcrumb-required-when-page-header` (HIGH) enforces. Pages outside admin / account (public marketing, login chrome) don't import PageHeader and are unaffected.

**Incident (Spec 02, 2026-05-07).** Same workstream as Rule #10. Operators on the run page have lost track of which site they were on more than once — no breadcrumb on that surface meant 5-deep navigation depth without trail. The rule prevents that class of UX failure from regressing on any PageHeader-adopting page.

---

## 12. Raw h1 tags are forbidden in page.tsx

**Rule.** Raw `<h1>` JSX tags appearing directly in `app/admin/**/page.tsx` or `app/account/**/page.tsx` outside of `<PageHeader.Title>` are forbidden — they bypass the type scale defined in `app/globals.css` (`.text-page-title` 28px / 24px mobile) and create accessibility issues with multiple page-level h1s. Audit script `no-raw-h1-in-pages` (HIGH) enforces JSX-tag-positionally. Excluded from rule scope: `app/api/**`, `app/**/_components/**`, polymorphic `<Component as="h1" />` patterns, and pages that already render an `<h1>` inside a `<PageHeader.Title>` window. Variable-assigned `<h1>` then passed into PageHeader does not fire — see Spec 02 §3.3 rule scope.

**Incident (Spec 02, 2026-05-07).** Same workstream as Rules #10 and #11. The pre-PageHeader admin surfaces had 30+ `<H1>` instances scattered across page files with inconsistent custom class soup. Rule #12 prevents new instances; PR 2's sweep removed them on the migrated routes; the deferred-routes allowlist in the audit script keeps legacy h1s tolerated until each is migrated.

---

## 13. Tables in admin / company pages must use the canonical DataTable

**Rule.** Every list / table view in `app/admin/**` or `app/company/**` must render via the canonical `DataTable` primitive (`components/ui/data-table.tsx`), never a bespoke `<table>`. Status / type / role indicators must use `<Pill>`. Row actions must live in the trailing `...` menu (`<RowActions>`) with the documented single-primary-action exception (e.g. the Sites table's `Connect →` link for not-yet-paired rows). Empty states use the `emptyState` prop (which renders `<EmptyState>`); never a blank `<tbody>`. Audit script `tables-use-datatable` (LOW) enforces.

**Why a single primitive.** The platform had at least nine distinct table treatments by mid-2026 — Sites table-with-pills-and-overflow, Users table-with-inline-dropdowns, Companies table-with-rounded-full-chips, Images table-with-checkboxes, etc. Operators reported it "feels like five different tools". Spec 18 (2026-05-08) consolidated to one `DataTable` primitive plus four supporting components (`Pill`, `RowActions`, `EmptyState`, `TableCell.{Primary,Secondary,Mono,Stack,Empty}`). Reference page at `/admin/_internal/table-examples` is the canonical visual spec — when migrating or building a new table, look there first.

**Where the rule applies.**
- `app/admin/**/*.tsx` and `app/company/**/*.tsx` — bespoke `<table>` triggers a finding.
- `DATATABLE_AUDIT_EXEMPT` in `scripts/audit.ts` carries the legacy holdouts (audit log, system jobs) that haven't been migrated yet. Don't add to it without documenting the deferral.

**Incident (Spec 18, 2026-05-08).** Operators repeatedly described the admin app as "five different tools". The five tables in the original screenshot review (Sites, Users, Companies, Images, Members) used five different chrome treatments, three different action patterns (overflow menu vs inline dropdown vs button), and two different empty-state shapes. PR A built the DataTable primitive; PRs B/C/D swept the seven highest-traffic tables; the audit rule prevents regression as new admin surfaces land.

---

## Adding a new rule

- If a recurring shape with scaffolding emerges, that's a pattern — put it in `docs/patterns/`, not here.
- If an operational failure mode needs a response playbook, that's a runbook entry — put it in `docs/RUNBOOK.md`.
- If a rule is a one-paragraph "remember this" born from a specific incident, it belongs here.
- Rules in this file never have scaffolding. A rule that wants code belongs in a pattern.
