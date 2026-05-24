# Staging — PR Status Log

---

## PR-C: feat(staging): migration workflow + runtime verification of staging Supabase isolation

- URL: https://github.com/opollo5/opollo-site-builder/pull/1026
- Merge SHA: 44b69e38
- Merged to `staging` 2026-05-24

---

## PR-D: feat(staging): idempotent UAT seed script

- URL: https://github.com/opollo5/opollo-site-builder/pull/1027
- Merge SHA: 89490c65
- Merged to `staging` 2026-05-24

---

## PR-E: docs(staging): state-a-verification + uat-harness prerequisites

- URL: https://github.com/opollo5/opollo-site-builder/pull/1028
- Merge SHA: eb3369a3
- Merged to `staging` 2026-05-24

---

## Isolation Verification Session — 2026-05-24

**Trigger:** Steven confirmed BLOCKED-1 through BLOCKED-4 all resolved.

**Actions:**
- No-op commit `a5bb8fa4` pushed to `staging` to trigger fresh Vercel deploy
- `gh workflow run staging-migrations.yml --ref staging` triggered
- Staging Supabase queried via PostgREST to verify seed data
- Production Supabase queried to confirm no UAT contamination
- Production CSP header inspected to confirm production Supabase URL

**Verification results:**

| Check | Result |
|---|---|
| Vercel deploy triggered | ✅ |
| `staging-migrations.yml` migration push | ✅ `Remote database is up to date` |
| `staging-migrations.yml` seed step | ❌ BLOCKED-5 |
| Staging: `platform_companies` (uat-staging) | ✅ count=1 |
| Staging: `platform_users` | ✅ count=1 |
| Staging: `social_post_drafts` | ✅ count=5 |
| Staging: `image_library` (uat-*) | ✅ count=10 |
| Staging: `social_connections` | ✅ count=3 |
| Production: `platform_companies` (uat-staging) | ✅ count=0 |
| Production: `platform_users` (uat-bot) | ✅ count=0 |
| Production CSP confirms `sazapxgmrdaewrkwoxby` | ✅ |
| env-check curl | ⚠️ BLOCKED-6 (Vercel SSO) |

**New blockers:** BLOCKED-5 + BLOCKED-6 documented in `docs/staging/BLOCKED.md`.

**STATE A: 12/14 complete. UAT harness build is unblocked.**
