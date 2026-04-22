# M11 — Audit Close-out

## What it is

A closeout milestone that resolves every concrete gap surfaced by `docs/AUDIT_2026-04-22.md`. The audit found the shipped scope through M10 substantively matches its documentation, but identified specific, actionable gaps: the chat route (the product's headline surface) bypasses the M10 observability contract; two M7 terminal-failure branches are implemented but untested; an M8 health probe is documented but unimplemented; an M6 inline-HTML cap is documented on the render surface but not enforced server-side; M8's admin-UI slice has zero E2E coverage; and M1–M3 / M9 / M10 never got parent plans. M11 closes all of these in order of operational importance.

## Why a separate milestone

These gaps are small individually, mostly documentation or test-only, and don't belong to any single earlier milestone's risk surface. Bundling them into M11 lets each sub-slice ship as a discrete, review-in-5-minutes PR with a focused risks audit, while keeping the "what does LeadSource-launch readiness look like" picture in one place. M11-1 is the only sub-slice that touches a hot code path (chat streaming); the rest are test coverage, doc reconciliation, or thin write-path guards.

Two of the audit's ranked launch-readiness recommendations (#1 chat observability, #7 HTML cap) map directly to M11-1 and M11-4. The rest land as post-launch hygiene.

## Scope (shipped in M11)

- **M11-1 — chat route observability.** Route `app/api/chat/route.ts` through a new `traceAnthropicStream()` Langfuse wrapper so every billed token spent by an operator in the chat builder lands in Langfuse. Replace the three `console.*` calls with `logger.{info,error}` so request-id correlation works. Add `e2e/chat.spec.ts` covering sign-in → send message → token stream happy path + one Anthropic-error case. Fix the BACKLOG "wraps every call" overstatement.
- **M11-2 — regeneration-worker untested error branches.** Add tests for `DS_ARCHIVED` (in `regeneration-worker.ts`) and `WP_CREDS_MISSING` (in the cron route `app/api/cron/process-regenerations/route.ts`). Both are terminal-failure codes the admin UI surfaces to operators; both have zero branch coverage today.
- **M11-3 — tenant-budget reset health probe.** Extend `/api/health` to flag tenants whose `daily_reset_at` or `monthly_reset_at` is more than 25h in the past. Returns 503 `degraded` with a `budget_reset_backlog` count so the on-call monitor pages when the reset cron gets stuck. Fulfills the M8 parent plan's risk #2 claim.
- **M11-4 — server-side 500KB HTML cap.** The render-side cap already lives in `components/PageHtmlPreview.tsx` (auditor missed this — cap is in the component, not the page). What's still missing is the server-side cap the M6 plan implies. Enforce a 500KB ceiling in the batch publisher and regen publisher with a clear `HTML_TOO_LARGE` error code so oversized payloads fail loudly at write time rather than silently degrading the admin render surface.
- **M11-5 — budget enforcement E2E.** New `e2e/budgets.spec.ts` drives the admin badge UI (load page, verify cap displayed, open edit modal, PATCH caps, verify VERSION_CONFLICT surface on stale-version edit). Complements the unit suite that covers the reserveBudget race.
- **M11-6 — documentation reconciliation.** Retroactive parent plans for M1, M2, M3, M9, M10 (reflecting shipped code, not forward-looking design — the scaffolding is historical). Fix the M6 parent plan (risk #5 wording — cap IS shipped, wording drift only) and M8 parent plan (line 50–51 — iStock seed uses env cap, not per-tenant cap). BACKLOG hygiene: reconcile "shipped in MX" claims against actual code.

## Out of scope (tracked in BACKLOG.md)

- **Upstash rate limiting on `/api/auth/*`** — audit ranked #3. Adapter is ready but wiring is a standalone milestone (rate-limit policy + per-route decisions + per-tenant reset cron). Belongs in a dedicated slice, not bundled with M11.
- **`lib/__tests__/self-probe.test.ts`** — audit ranked #4. Worth doing, but the self-probe route is forward-compatible and a regression surfaces immediately on a manual curl. Not launch-blocking.
- **Schema hygiene pass across migrations 0001–0009** — audit ranked #10. Already in BACKLOG with the right trigger ("first compliance surface"). Not in M11.
- **Design-system authoring E2E** (create DS / add template / add component). Real gap the audit noted, but sizeable — belongs to its own slice under a UX-polish milestone.
- **Batch-worker full-loop E2E** (create batch → cron tick → publish). Similar — a standalone smoke-test PR after M11.
- **`logger.ts` Axiom-transport test.** Low churn, silent-regression risk is real but small. Backlog entry, not M11.
- **Pricing-table scale audit for the chat route.** Cost reporting for chat tokens lands after M11-1 wires the span; the pricing table mapping is follow-up.

## Env vars required

None new. M11 is code + tests + docs only.

## Sub-slice breakdown (6 PRs)

| Slice | Scope | Write-safety rating | Blocks on |
| --- | --- | --- | --- |
| **M11-1** | `traceAnthropicStream()` helper in `lib/langfuse.ts`; chat route wraps the streamed `messages.stream(...)` call in it. Replace `console.log`/`console.error` in `app/api/chat/route.ts` with `logger.{info,error}`. New `e2e/chat.spec.ts` (sign-in, navigate to `/`, send message, assert stream, plus one Anthropic-error case with stubbed 5xx). Update BACKLOG "wraps every call" → "wraps every non-chat call + streaming path through `traceAnthropicStream`". | Medium — streaming wrapper must not break the existing SSE response contract; Langfuse flush must be fire-and-forget so chat latency doesn't regress. | Nothing |
| **M11-2** | Two tests in `lib/__tests__/regeneration-worker.test.ts` and/or a new `app/api/cron/__tests__/process-regenerations.test.ts`: DS_ARCHIVED asserts the branch by seeding a page whose `design_system_version` points at an archived DS → `buildSystemPromptForSite` throws → worker records terminal failure with code. WP_CREDS_MISSING asserts the cron-route branch by seeding a site without credentials → cron marks the job failed with code. | Low — test-only. | Nothing |
| **M11-3** | New `checkBudgetResetBacklog()` helper in `/api/health`; joins `tenant_cost_budgets` filtering `daily_reset_at < now() - 25h` OR `monthly_reset_at < now() - 25h + 31d`. Returns count + sample of up to 5 site_ids. Health response degrades to 503 when count > 0. Unit test: seed stuck row + fresh row → helper returns 1 with the stuck row's site_id. | Low — read-only probe; no mutation. | Nothing |
| **M11-4** | `HTML_TOO_LARGE` error code added to the batch publisher and regen publisher write path. If `generated_html` > 500KB, short-circuit the publish/write with the error — the slot / regen job records terminal failure with a diagnostic (actual bytes, cap). Unit tests for both write paths: oversized payload → HTML_TOO_LARGE, not a silent truncation. | Medium — write path. Must not break legitimate ~100-300KB payloads; cap matches the render-side constant in `PageHtmlPreview.tsx`. | Nothing |
| **M11-5** | `e2e/budgets.spec.ts` — admin navigates to `/admin/sites/[id]`, badge renders with current caps + usage, edit modal opens, PATCH updates cap, stale-version PATCH returns VERSION_CONFLICT. `auditA11y()` on every visited page. | Low — E2E over existing code paths. | M8-5 (shipped) |
| **M11-6** | Five new `docs/plans/m{1,2,3,9,10}-parent.md` files. Retroactive — each reflects what actually shipped, not forward-looking design. Risks audits populated from test files + migration comments. Two in-place edits: `docs/plans/m6-parent.md:112` wording ("Download raw HTML" → match shipped "Open in WordPress admin" copy) and `docs/plans/m8-parent.md:50–51` (iStock seed: env cap, not per-tenant). BACKLOG strike-through pass: every "shipped in MX" row verified against a concrete file path. | Low — pure docs. | M11-1..M11-5 (plans reference their shipped state) |

**Execution order:** M11-1 first (launch-blocking per audit). M11-2 / M11-3 / M11-4 / M11-5 are independent; execute serially to keep review cadence steady (M11-2 → M11-3 → M11-4 → M11-5). M11-6 last so it can reference the shipped state of its predecessors.

## Write-safety contract

### Chat-route Langfuse wrapper (M11-1)

The existing `traceAnthropicCall()` wraps the non-streaming `client.messages.create(...)` shape used by the batch worker and regen worker. The chat route uses `client.messages.stream(...)` which returns an async iterable of events + a `finalMessage()` promise. The new `traceAnthropicStream()`:

- Creates the Langfuse trace + generation at stream start (same as `traceAnthropicCall`).
- Returns a handle with `recordFinal(finalMsg)` + `fail(message)` — the caller invokes `recordFinal` after `await streamed.finalMessage()` so tokens + cost land on the span after the stream drains.
- Is a no-op when Langfuse env isn't set — matches the existing pattern.
- Does NOT intercept SSE events themselves. Callsite writes tokens to the SSE stream directly; Langfuse captures the final-message shape only. Keeps the wrapper's surface area small.

If Langfuse ingest errors, the SSE stream proceeds unaffected — `recordFinal` is wrapped in a try/catch-and-swallow, matching `lib/langfuse.ts:146`.

### Console → logger swap (M11-1)

The three `console.*` calls in `app/api/chat/route.ts:204,234,315` become `logger.info`/`logger.error`. The logger pulls `x-request-id` from AsyncLocalStorage so every log line correlates to the triggering request — today's `console.log` output has no request-id context.

### HTML size cap (M11-4)

Write-time enforcement. The render-side cap already lives in `components/PageHtmlPreview.tsx:15` (`INLINE_HTML_MAX_BYTES = 500 * 1024`). M11-4 enforces the same ceiling at the persistence boundary in `lib/batch-publisher.ts` + `lib/regeneration-publisher.ts`:

- Check `generated_html.length > 500 * 1024` before the write.
- Over-cap: return `HTML_TOO_LARGE` with `{ actual_bytes, cap_bytes }` in the diagnostic. Retries won't fix it; the publisher records terminal failure.
- Matches the `HTML_SIZE_MAX_BYTES` constant location — same constant exported from a shared module (`lib/html-size.ts`) so the render + write sides can never drift.

This does NOT retroactively reject rows that already exceed the cap (none exist today on LeadSource-sized batches). If one shows up later, the M11-4 cap fails the regen that tries to rewrite it, not the existing row — defence-in-depth without a destructive migration.

### Health probe backlog query (M11-3)

Pure read. One `SELECT site_id FROM tenant_cost_budgets WHERE daily_reset_at < now() - interval '25 hours' OR monthly_reset_at < now() - interval '25 hours' + interval '31 days' LIMIT 5`. Index-backed by the existing `tenant_cost_budgets_site_id_key`. Helper returns `{ count, sample: site_id[] }`; zero cost when the cron is healthy.

### Test-only surfaces (M11-2, M11-5)

M11-2 seeds fixture rows and asserts existing code paths. M11-5 exercises shipped admin UI via Playwright. Neither introduces new production code paths.

### Docs-only surface (M11-6)

No code. Every plan file references shipped migrations / commits / tests rather than proposing new work. If a retroactive plan's risks-audit doesn't match what the test suite actually asserts, the plan is wrong — tests win.

## Testing strategy

| Slice | Patterns applied |
| --- | --- |
| M11-1 | `playwright-e2e-coverage.md` for the chat spec (stub Anthropic via fetch intercept). `new-api-route.md` for the logger/tracing swap — unit test via a no-Langfuse-env run asserts `traceAnthropicStream` is a pure no-op. |
| M11-2 | Existing worker + cron-route test patterns. Two new `it(...)` blocks, one per error branch. Assert: status='failed', failure_code matches, finished_at set, worker_id cleared. |
| M11-3 | Health-route unit test extended. Seed one stuck row + one fresh row; assert helper returns count=1 and sample includes the stuck site_id. Assert `/api/health` returns 503 when count > 0. |
| M11-4 | Unit test per publisher: 499KB payload succeeds; 501KB payload fails with HTML_TOO_LARGE; diagnostic includes actual + cap bytes. |
| M11-5 | `playwright-e2e-coverage.md`. One spec with four tests: badge renders, modal opens + edits, VERSION_CONFLICT on stale-version PATCH, `auditA11y()` on each page. |
| M11-6 | No test surface. Validation is "does the plan match the shipped state": each new plan references at least one real migration, one real test file, and one real source file per risk claim. |

**EXPLAIN ANALYZE requirement.** M11-3's health query is the only new query. Single-table, small-cardinality (≤ sites × 1 row), indexed. Trivial plan — attach to PR description for the record.

## Performance notes

- M11-1's Langfuse span adds one HTTP round-trip per chat turn, fire-and-forget, off the SSE critical path. Zero latency impact on the user-visible stream.
- M11-3's health query runs on every probe. Kept indexed + capped at LIMIT 5 so even a pathological "every tenant is stuck" case stays under 1ms.
- M11-4 is a single `.length` check — sub-microsecond.

## Risks identified and mitigated

1. **Langfuse streaming wrapper breaks SSE.** → `traceAnthropicStream` wraps only the trace bookkeeping; the SSE `send()` callsite is untouched. Test: chat spec asserts a token stream arrives regardless of Langfuse env state. Existing `traceAnthropicCall` no-op pattern extends to the stream handle.

2. **Logger emits in hot SSE loop and regresses TTFB.** → `logger.info` at stream start + after `finalMessage()` only — not per-delta. The `console.log` it replaces runs in the same two positions. Same call count, structured output replaces ad-hoc.

3. **Chat E2E flaky under real Anthropic API.** → Spec stubs the Anthropic call via Playwright `route()` fetch interception at `api.anthropic.com`. No network egress, deterministic response body, hermetic.

4. **`traceAnthropicStream` crashes the chat handler if Langfuse SDK misbehaves.** → Same try/catch-and-swallow shape as `traceAnthropicCall` (lib/langfuse.ts:145,154). A Langfuse error can never surface as a 500 to the operator.

5. **DS_ARCHIVED test is timing-dependent (DS archive flag propagation).** → Test seeds the archived-DS row directly via service-role client; no propagation delay. Assertion hits the `buildSystemPromptForSite` throw deterministically.

6. **WP_CREDS_MISSING test races the cron reaper.** → Cron-route unit test calls the route handler directly with `Date.now()` mocked; no real cron schedule involved. Deterministic.

7. **Health-probe query saturates when every tenant's reset is stuck.** → `LIMIT 5` on the sample; `COUNT(*)` is exact but bounded by table size. On a 10k-tenant deployment the worst case is a single indexed scan; fine.

8. **Health-probe false-positive at tenant-create-time.** → New `tenant_cost_budgets` rows are backfilled with `daily_reset_at = now() + 1 day`. A row can't satisfy `daily_reset_at < now() - 25h` until the reset cron has missed two consecutive runs. 25h is the guard; first-run slack is absorbed by the +1h tolerance.

9. **HTML cap false-rejects a legitimate 40-section landing page.** → 500KB matches the render-side cap that's already been running on production-scale LeadSource pages without trips. Actual payloads observed during M3/M7 are 30-150KB. 500KB is 3× the tail; test with a real fixture asserts a 300KB HTML succeeds.

10. **HTML cap in two places — drift risk.** → Shared constant `HTML_SIZE_MAX_BYTES` exported from `lib/html-size.ts`. Render (`PageHtmlPreview.tsx`) + batch publisher + regen publisher all import it. A future edit lands in one file.

11. **Budget E2E spec racing the hourly reset cron.** → The spec never waits across a reset boundary; it reads the current cap, edits it, re-reads. The reset cron only advances `*_reset_at` — it doesn't touch `*_cap_cents`. No race.

12. **Retroactive parent plans drift from what actually shipped.** → Each plan cites: the migration numbers + their CHECK constraints, the test file names + the `it(...)` blocks asserting each risk, the commit SHAs that shipped each sub-slice. If a plan claims a risk is mitigated but the test file doesn't contain a matching assertion, the plan is wrong — reviewer checks the citation.

13. **M6 / M8 plan edits silently change the risks audit.** → Edits are wording / accuracy only. Each edit keeps the number of risks the same; the plan file's `# of risks` doesn't move, only the text. Diffs are surgical.

14. **BACKLOG hygiene pass introduces false strike-throughs.** → Every line struck through by M11-6 cites the merged PR number + the file path where the feature lives. Reviewer can click through. If a line can't be cited that concretely, it stays un-struck.

15. **M11-6 plan-writing isn't code — ships unchecked by CI.** → The new plan files contain file paths, test names, and migration numbers. A typo in a file path is caught by `find . -name <referenced-file>` at review time. Nothing in the retroactive plans changes runtime behaviour, so "CI green" is all the plan files need.

## Relationship to existing patterns

- **M11-1** follows `docs/patterns/playwright-e2e-coverage.md` for the E2E + `new-api-route.md` for the logger/tracing swap. The `traceAnthropicStream` helper is a new shape but parallels `traceAnthropicCall` — not promoted to a pattern until a third streaming surface asks for it.
- **M11-2** follows the existing regeneration-worker and cron-route test patterns. No new architectural shape.
- **M11-3** extends the existing `/api/health` check shape. One more check function, one more key in the response body.
- **M11-4** follows the same "short-circuit with a diagnostic on a write boundary" pattern that M7's quality-gates runner uses.
- **M11-5** follows `playwright-e2e-coverage.md`. Admin UI spec alongside existing specs.
- **M11-6** is a meta-pattern — documenting what already shipped. No existing pattern; not promoted to one.

## Sub-slice status tracker

Maintained in `docs/BACKLOG.md` under a new **M11 — audit close-out** section. Updated on every merge:

- `M11-1` — status (planned / in-flight / merged / blocked)
- `M11-2` — status
- `M11-3` — status
- `M11-4` — status
- `M11-5` — status
- `M11-6` — status

On M11-6 merge, auto-continue halts. User explicitly requested a review checkpoint after audit close-out to decide next steps (rate limiting, schema hygiene, DS authoring E2E, etc. — all in BACKLOG).
