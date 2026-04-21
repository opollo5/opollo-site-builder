# Testing roadmap

Captures where we are on the testing ladder and what's deliberately
deferred. Update this as levels ship.

## Where we are today

| Level | Name                                   | Status                                                              |
| ----- | -------------------------------------- | ------------------------------------------------------------------- |
| 1     | Playwright happy-path E2E              | **Shipped.** See `e2e/*.spec.ts`, CI `.github/workflows/e2e.yml`. |
| 2     | Visual regression (`toHaveScreenshot`) | **Deferred.** Needs first-run baselines captured in CI + reviewed + committed. Follow-up slice. |
| 3     | Accessibility + keyboard testing       | **Partial.** axe-core audits run on every page (report-only via `auditA11y` helper). Keyboard-only nav tests not yet written. Flip axe from report-only → blocking once the initial backlog is triaged. |
| 4     | Property-based / fuzz testing          | **Deferred.** No user-facing benefit until the API surface is stable and we have paying customers. Natural fit: `fast-check` around `computeBodyHash`, slug generation, and the auto-prefix algorithm. |
| 5     | Load + concurrency (production-like)   | **Deferred.** M3's unit-level 4-worker × 20-slot test pins the concurrency contract. A 20-browser session load test against a real preview deploy is the next rung — needs a staging Supabase project first. |
| 6     | Chaos / failure injection              | **Deferred indefinitely.** Netflix-scale infra territory. M3 already has crash-recovery tests at the unit layer. |
| 7     | Synthetic production monitoring        | **Deferred until public launch.** ~$50–100/mo for Checkly / Datadog Synthetics / Playwright Cloud running every 5 min against prod. Worth it once we have paying customers. |

## Why Playwright runs against localhost, not Vercel preview

The user's original spec said "running against Vercel preview deploys." We ship against localhost in CI instead because:

1. Vercel preview deploys use the **production** Supabase project (no staging env exists). Running E2E against prod would pollute real customer data.
2. Setting up a staging Supabase project is its own slice — provisioning, preview-branch wiring, seeded data policy.
3. Running in CI against a fresh `supabase start` per run is deterministic, fast, and safe.

When staging Supabase lands, flip `PLAYWRIGHT_BASE_URL` to the preview URL + point `SUPABASE_*` env vars at the staging project. No Playwright code changes needed.

## Upcoming follow-up slices

- **Visual regression (Level 2 remaining).** Add `toHaveScreenshot` to login, sites list, site detail, users list, batches list. First CI run captures baselines as an artifact; developer downloads + commits them; subsequent runs gate on diff.
- **Keyboard-only nav tests.** Tab-order assertions on each form. Part of the Level-3 upgrade.
- **Axe blocking.** After the initial a11y backlog is cleared, flip `auditA11y`'s default `blocking` to `true`.
- **Staging Supabase + preview-deploy E2E.** Level-5 prep; until it lands, localhost remains the target.
