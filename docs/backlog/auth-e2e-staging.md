# Backlog: Auth E2E Coverage Against Staging

**Provenance:** June 2026 lockout — login broke and there was zero e2e coverage
to catch it. This is the system fix that prevents recurrence.

**Priority:** High. Auth is a critical path (§"Critical paths" in `CLAUDE.md`).
Until this is built, the hard floor is unmet.

---

## What needs to be built

A Playwright e2e spec suite covering the auth critical paths, running in CI
against the staging deployment using the seeded personas.

### Personas (passwords in 1Password)

| Email | Role | Use for |
|---|---|---|
| `steven.m@opollo.com` | `super_admin` | Admin-only flows |
| `uat-bot@staging.opollo.com` | `admin` / Opollo staff | Standard staff flows |
| `test-member@staging.opollo.com` | `user` / company member | Customer-facing flows |

### Staging config

```
PLAYWRIGHT_BASE_URL=https://opollo-site-builder-git-staging-opollo5.vercel.app
STAGING_UAT_PASSWORD=<from Vercel Preview env STAGING_UAT_PASSWORD>
```

Verify the actual branch alias URL in the Vercel dashboard after the `staging`
branch is pushed. The format is `opollo-site-builder-git-staging-opollo5.vercel.app`.

### Journeys to cover (minimum)

- [ ] Login with valid credentials → lands on correct home page
- [ ] Login with invalid credentials → shows error, does not redirect
- [ ] Forgot password flow → email sent confirmation
- [ ] Password reset link → allows password change, redirects to login
- [ ] Session persistence — refresh on authenticated page stays authenticated
- [ ] Logout → session cleared, redirect to login
- [ ] 2FA challenge (when `AUTH_2FA_ENABLED=true`) → TOTP accepted/rejected

### Hard floor rule (from `CLAUDE.md`)

> Any auth critical path (login, signup, password reset, 2FA) → e2e required.
> A spec that conditionally skips when `STAGING_UAT_PASSWORD` is absent is a
> failing gate, not coverage.

This means: the CI `e2e` check must run these specs against staging on every PR.
Missing `STAGING_UAT_PASSWORD` must cause the spec to **fail**, not skip.

### File locations

Follow the `e2e/*.spec.ts` convention. Suggested files:
- `e2e/auth-login.spec.ts`
- `e2e/auth-password-reset.spec.ts`
- `e2e/auth-2fa.spec.ts` (guarded by `AUTH_2FA_ENABLED`)

Reference the existing `e2e/` directory for Playwright config and helper
patterns. See also `docs/patterns/playwright-e2e-coverage.md`.

---

## Acceptance criteria

- All specs run in CI on every PR (not just on staging branch pushes)
- All specs fail fast (not skip) when credentials are absent
- Coverage includes at minimum the 7 journeys above
- `docs/test-coverage-roadmap.md` updated to mark auth e2e as complete
