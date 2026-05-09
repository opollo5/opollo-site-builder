# Test Coverage Roadmap — post-harness build (2026-05-09)

This is the prioritised follow-up list after the seven-layer test
harness landed on `chore/test-harness`. The harness itself is
complete: contracts pinned, security boundary tests in place,
production smoke + drift workflows scaffolded, CLAUDE.md updated.

What's listed here is **propagation work** — extending the harness
to cover surfaces that weren't part of the canary. Each item names a
layer, an estimated size, and the worked example that lives in the
canary commits.

---

## Order of work

1. **Cross-tenant route sweep — high-traffic admin + platform routes.**
   *Layers 3 + 6.*

   Apply `seedTwoCompanies()` from `lib/__tests__/_security-helpers.ts`
   to a per-route harness that hits every route in
   `app/api/platform/social/posts/`,
   `app/api/platform/social/connections/`, and
   `app/api/admin/sites/[id]/`. Assert:

   - Anon → 401
   - Company-A admin reading Company-B resource → 403/404
   - Company-A admin writing Company-B resource → 403

   Worked example: the canary's `tests/regressions/
   bundle-social-callback-rejects-cross-tenant.test.ts` asserts the gate
   is invoked with the right company id. Promote that pattern.

   Estimated size: 1–2 days.

2. **Optimiser route layer.** *Layers 1, 3, 6.*

   ~40 routes under `app/api/optimiser/*`. Today's coverage: 3 lib
   tests + 4 e2e specs. Gap: no contract snapshots for the Google
   Ads / GA4 / Clarity / Vercel Logs API calls under `lib/optimiser/
   sync/*`; no prompt-injection coverage on copy fields evaluated by
   Claude; no SSRF coverage on `lib/optimiser/page-import/fetch-source.ts`.

   Worked example: the canary's `bundle-social.contract.test.ts` for the
   contract pattern; the qstash signature security test for the
   signature-verification pattern.

   Estimated size: 2–3 days.

3. **CAP / prompt-injection coverage.** *Layer 6.*

   Routes: `app/api/platform/social/cap/{generate,assist,generate-image}`.
   Drive `PROMPT_INJECTION_PAYLOADS` through each, assert the
   downstream Anthropic call wraps user content in a tagged delimiter
   AND the response is post-validated by Zod.

   Worked example: pair `tests/helpers/prompt-injection-payloads.ts`
   with the contract-snapshot pattern — drive each payload, assert
   the outgoing Anthropic call body has the safety wrapper.

   Estimated size: 1 day.

4. **Visual regression baselines committed.** *Layer 5.*

   Infrastructure exists (`screenshots.spec.ts`, `screenshots.yml`).
   Gap: baselines not committed. Run
   `npm run screenshots:baseline` once on CI Linux, commit the
   `e2e/__screenshots__/` tree, flip `RUN_SCREENSHOTS=1` to default
   on for every run.

   Estimated size: half a day (one CI capture cycle + baseline review).

5. **Component coverage — modals + forms.** *Layer 4.*

   Today's coverage: 5 component tests after the canary added
   `ConceptReviewCards.security.test.tsx`. Modals and forms with
   user input that get echoed back somewhere need the same
   XSS_PAYLOADS treatment as ConceptReviewCards.

   Worked example: `components/__tests__/
   ConceptReviewCards.security.test.tsx`.

   Estimated size: 2 days.

6. **Promote axe to blocking on critical journeys.** *Layer 5.*

   Today: axe runs on every spec, non-blocking. Critical journeys
   (login, signup, post composer, social connect) should be flipped
   to blocking. Other surfaces stay non-blocking until they're clean.

   Estimated size: 1 day (run + fix any genuine violations on the
   critical four).

7. **gitleaks history sweep.** *Layer 6.*

   Today: gitleaks runs on every push. Hasn't been run retroactively
   on the full git history. Recommended: run `gitleaks detect --redact
   --source=. --no-git -v` against the full history once, address any
   findings (rotate + scrub via BFG if needed), then trust the
   per-push gate.

   Estimated size: half a day.

8. **Production bundle secret-pattern grep.** *Layer 6.*

   Today: not covered. Add a CI step after `npm run build` that
   greps `.next/**` for known secret patterns (BUNDLE_SOCIAL_API,
   OPOLLO_MASTER_KEY, etc.) and fails on any hit. Catches the failure
   mode where a server-only env var leaks into a client bundle.

   Estimated size: 2 hours.

9. **Semgrep with OWASP Top 10 + React rules.** *Layer 6.*

   Adds catches CodeQL doesn't. Tune false positives within budget;
   if Semgrep is too noisy on first pass, document the gap in
   `docs/security-findings.md` and proceed with CodeQL alone.

   Estimated size: 1 day (mostly tuning).

10. **Vercel API rollback hookup in `auto-hotfix`.** *Layer 7.*

    The skeleton in `.github/workflows/smoke.yml` creates the hotfix
    branch + incident doc + issue. It does NOT yet auto-revoke the
    failed deploy via Vercel API — blocked on `VERCEL_TOKEN`
    provisioning (see batched ask). Once the token lands, add a step
    that calls `vercel deployments rollback` against the previous
    green deploy.

    Estimated size: half a day post-token.

11. **Image route SSRF assertions.** *Layer 6.*

    Routes: `admin/images/fetch-url`, `tools/search-images`,
    `optimiser/page-import/fetch-source`. The SSRF guard at
    `lib/ssrf-guard.ts` exists; route-level enforcement assertions
    are partial. Drive `SSRF_PAYLOADS` through each route, assert 4xx
    rejection.

    Estimated size: 1 day.

---

## Parallelism

Items 1, 2, 5 are diff-line independent — three concurrent sessions
can work on cross-tenant sweep, optimiser, and component coverage in
parallel without conflicts. Items 4, 6, 7 are also independent.

Coordination via `docs/WORK_IN_FLIGHT.md` per the existing
parallelism plan.

---

## Coverage targets (informational only)

V8 coverage thresholds in `vitest.config.ts` are 60 % line / 55 %
branch / 55 % functions / 60 % statements. Soft. Won't ratchet up
until the optimiser and the cross-tenant sweeps land — those will
naturally lift the numbers.
