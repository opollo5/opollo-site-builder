# Incidents

One file per material production incident. Use `TEMPLATE.md` to author
new entries; the template carries the live diagnostic protocol's
six-step evidence layout already.

The auto-hotfix workflow at `.github/workflows/smoke.yml` will create
files here automatically when production smoke fails (Phase E of the
test harness; gated on Steven provisioning the smoke creds + Vercel
token + notification channel).

| File | Scope |
|---|---|
| [TEMPLATE.md](TEMPLATE.md) | Incident-doc skeleton with diagnostic-protocol evidence rows |

Historical incidents land here as `<YYYY-MM-DDThhmm>-<integration>.md`.
The May 2026 bundle.social outage is the canary for the test harness;
its evidence is currently distributed across PR descriptions,
`docs/security-findings.md`, and `tests/regressions/bundle-social-*.test.ts`
rather than a single incident doc — backfilling that is a follow-up
slice tracked in `docs/test-coverage-roadmap.md`.
