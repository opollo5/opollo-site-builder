<!--
PR template — every section is required. Don't delete the headings;
fill in the bullets. CLAUDE.md §"Seven-layer test harness — coverage
rules" is the source of truth for which layer applies to which change.
-->

## Summary

<one to three bullets — what this PR does and why>

## Coverage by layer

Tick every layer where this PR adds or modifies tests. State **why not**
for any layer the change-shape touches but you didn't cover.

- [ ] **Layer 1 (Unit)** — `*.unit.test.ts`
- [ ] **Layer 2 (Contract)** — `*.contract.test.ts`, snapshots reviewed
- [ ] **Layer 3 (Integration)** — `lib/__tests__/*.test.ts`, real Supabase
- [ ] **Layer 4 (Component)** — `components/__tests__/`
- [ ] **Layer 5 (E2E)** — `e2e/*.spec.ts`, includes `auditA11y`
- [ ] **Layer 6 (Security)** — see security checklist below
- [ ] **Layer 7 (Probes / smoke)** — `scripts/probes/` or `e2e/smoke/`

## Security checklist

Tick the threats this PR's change-shape exposes; show the test that
proves it's blocked. Untickable items (n/a for this PR's scope) get
"n/a" on the right.

- [ ] **AuthN / AuthZ** — anon rejected, non-admin rejected, cross-tenant rejected: `<test path>` / `n/a`
- [ ] **Multi-tenant data isolation** — Company A user cannot read/update/delete Company B rows: `<test path>` / `n/a`
- [ ] **Input validation** — Zod or equivalent on every entry; malformed → 400, not 500: `<test path>` / `n/a`
- [ ] **SQL injection** — payload list driven through route + DB unchanged: `<test path>` / `n/a`
- [ ] **Prompt injection** — payload list, route either filters or wraps in tagged delimiter: `<test path>` / `n/a`
- [ ] **SSRF** — `lib/ssrf-guard.ts` enforced at the boundary: `<test path>` / `n/a`
- [ ] **XSS** — every `dangerouslySetInnerHTML` in the diff has a sanitiser or sandbox + a component-layer test driving `XSS_PAYLOADS`: `<test path>` / `n/a`
- [ ] **CSRF** — state-changing routes reject cross-origin: `<test path>` / `n/a`
- [ ] **Rate limit** — login / reset / OTP / secret-bearing endpoints rate-limited: `<test path>` / `n/a`
- [ ] **Secrets** — no env values printed, no `.next/**` greppable for known secret patterns: `<reasoning>` / `n/a`
- [ ] **Webhook authenticity** — signature verification + 401 on forge: `<test path>` / `n/a`
- [ ] **Headers** — security headers present on new route: `<reasoning>` / `n/a`

## Live diagnostic protocol — required if this is a fix for a third-party integration regression

Tick all six. CLAUDE.md §"Live diagnostic protocol" is the spec.

- [ ] Probe output captured: `scripts/probes/<integration>.ts` run against prod
- [ ] Deployed bundle ↔ source SHA verified
- [ ] Contract test passed against live deployed environment
- [ ] Network trace + response bodies attached
- [ ] Tokens decoded
- [ ] Incident doc created at `docs/incidents/<timestamp>.md`

## Smoke status (post-deploy)

For changes touching auth, social, webhooks, billing, or any
critical-path route:

- [ ] Production smoke is expected to pass after this merges (`e2e/smoke/`)
- [ ] If a smoke spec needs updating, it's in this PR

## Test plan

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test:unit`
- [ ] `npm run test:components` (if components touched)
- [ ] `npm run test:integration` (if lib or routes touched)
- [ ] `npm run test:e2e` (if UI touched, requires `supabase start`)
- [ ] CI green on every required status check

## Notes for review

<anything you'd want a reviewer to look at first — risky decisions,
deferred items, deliberate scope choices>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
