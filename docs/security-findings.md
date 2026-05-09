# Security findings — post test-harness build (2026-05-09)

Material findings surfaced during the seven-layer test-harness build.
Each entry has a current state, a recommended remediation, and a
follow-up owner.

Per the brief's immediate-surface rule, items marked **resolved**
were fixed in the same PR that surfaced them. Items marked **open**
need follow-up.

---

## Resolved

### XSS via AI-generated micro-UI HTML in ConceptReviewCards
**Severity:** medium (prompt injection → arbitrary HTML rendering).
**State:** resolved 2026-05-09.

`components/ConceptReviewCards.tsx` rendered three AI-generated HTML
fragments (`micro.button`, `micro.card`, `micro.input`) via
`dangerouslySetInnerHTML` with no sanitisation. Prompt injection
could plausibly cause the LLM to return a payload from
`tests/helpers/xss-payloads.ts`, e.g. `<img src=x onerror=alert(1)>`,
which the browser would execute on render.

**Resolution:** added `lib/sanitize-html-fragment.ts` (allow-listed
tag set, event-handler stripping, `javascript:` URL stripping) +
Layer 1 unit test driving every payload through the sanitiser +
Layer 4 component test driving every payload through the rendered
component. Both verified red-on-break.

### .env file at risk of accidental commit
**Severity:** high (would expose Anthropic, bundle.social,
Cloudflare, Langfuse production keys).
**State:** resolved 2026-05-09.

A `.env.bundlesocial-test` file containing a full Vercel CLI env
dump existed at the repo root, ungitignored. `git add -A` would have
committed it.

**Resolution:** broadened `.gitignore` to match `.env.*` (with
explicit `!.env.example` / `!.env.local.example` allow-list) so any
future `vercel env pull` artifact is automatically excluded. The
file remains in the working tree pending Steven's decision (delete
vs rename); see the working-tree note in the canary commit. **If
those keys were prod-scoped, treat as compromised and rotate.**

---

## Open — defer to follow-up

### Production bundle is not greppable for secret patterns
**Severity:** medium (server-only env vars leaking into client
bundle is silent today).
**State:** open. Added to roadmap (item 8).

Today: nothing checks `.next/**` for known secret patterns post-build.
Recommended: post-`npm run build` CI step that greps for
`BUNDLE_SOCIAL_API`, `OPOLLO_MASTER_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
etc. and fails the build on any hit.

### CSP is report-only
**Severity:** low (defence-in-depth gap).
**State:** open. Pre-existing; no change in this work.

`lib/security-headers.ts` ships CSP in report-only mode. Tightening
to enforce mode requires a stable inventory of inline scripts +
external script sources. Recommended: enable enforce mode on a
single route first (`/login`) and ratchet outward.

### Webhook URL drift detector is partial
**Severity:** medium (the canary outage was caused by exactly this).
**State:** open. The `scripts/drift-check.ts` skeleton exists and
runs daily, but the bundle.social SDK readback (compare registered
URL ↔ `EXPECTED_BUNDLESOCIAL_WEBHOOK_URL`) is not wired — the SDK
version doesn't expose team-config readback ergonomically. Until the
SDK is upgraded or a direct REST call is added, the detector
short-circuits to a noop with an explicit note.

Recommended: upgrade `bundlesocial` to a version that exposes team
configuration, or add a direct `fetch()` against bundle.social's
admin REST API with the API key.

### Optimiser route layer security
**Severity:** medium (40+ routes, near-zero route-level test
coverage; Google Ads / GA4 OAuth callbacks are an under-tested
boundary).
**State:** open. Roadmap item 2.

### CAP / prompt-injection coverage
**Severity:** medium (LLM-driven copy generation routes have no
prompt-injection assertions).
**State:** open. Roadmap item 3. `tests/helpers/
prompt-injection-payloads.ts` is ready to drive against each route.

### gitleaks not run retroactively against history
**Severity:** unknown until run. Likely low (every push has been
gated since the secret-scan workflow landed).
**State:** open. Roadmap item 7.

### Semgrep not yet wired
**Severity:** low (CodeQL covers the high-severity catch surface).
**State:** open. Roadmap item 9.

---

## Hardening that landed during this work

For visibility — these are now permanent guard rails:

- **Layer 2 (contract) snapshots** for bundle.social. Future regression of payload shape (duplicate platform, body-shape change, missing field) fires red in CI.
- **Layer 6 (security) signature tests** for bundle.social and qstash webhooks driven through real route handlers. Forging a webhook now requires defeating both the signature AND the contract.
- **Eight pinned regression tests** under `tests/regressions/` for the bundle.social outage. The next agent literally cannot reintroduce those bugs without breaking CI.
- **Live diagnostic protocol** codified in CLAUDE.md. Future "third-party bug" claims must show all six steps of evidence.
- **Security realism rule** codified in CLAUDE.md. Mocked-into-trivial security tests are now a CLAUDE.md violation.
- **Production smoke skeleton + auto-hotfix workflow.** When the smoke creds + Vercel token land, the loop closes — a critical-path break post-deploy automatically triggers branch + incident doc + p0 issue + Slack.
- **CODEOWNERS** routing security-sensitive paths to a reviewer.
- **PR template** with per-layer + security checklist.
