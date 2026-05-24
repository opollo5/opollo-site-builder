# Staging — PR Status Log

---

## PR-C: feat(staging): migration workflow + runtime verification of staging Supabase isolation

- URL: https://github.com/opollo5/opollo-site-builder/pull/1026
- Merge SHA: (pending CI)
- Deploy: (pending)
- Summary: Adds `staging-migrations.yml` workflow, `/api/debug/env-check` endpoint (returns 404 in production), CI guard for endpoint production gate, middleware allow-list, migration 0151 (Pg17 compat), and `docs/staging/` documentation.
- CI status: fast checks all green (build, lint, typecheck, test-unit, static-audit, env-check-production-guard, migration-versions); integration shards + e2e pending as of 2026-05-24.

---

## PR-D: feat(staging): idempotent UAT seed script

- URL: https://github.com/opollo5/opollo-site-builder/pull/1027
- Merge SHA: (pending — stacked on PR-C)
- Deploy: (pending)
- Summary: Adds `scripts/seed-uat-staging.ts` (idempotent ghost user + UAT company + social connections + drafts + image_library + analytics snapshot). Hard-fails if run against production Supabase. Adds `seed:staging` npm script.

---

## PR-E: docs(staging): state-a-verification + uat-harness prerequisites

- URL: (pending)
- Merge SHA: (pending — stacked on PR-D)
- Deploy: (pending)
- Summary: Adds verification checklist (`docs/staging/state-a-verification-2026-05-24.md`), UAT harness prerequisites (`docs/uat-harness/PREREQUISITES.md`), RESOLVED section in investigation doc, and this STATUS.md update.
