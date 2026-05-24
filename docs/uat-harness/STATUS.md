# UAT Harness — PR Status Log

---

## PR 1: feat(uat): sign-in bypass route + Playwright auth helper

- URL: (pending merge)
- Merge SHA: (pending)
- Deploy: (pending)
- Specs added: 0 (infrastructure only)
- Known failures opened: 0

### What shipped

- `app/api/uat/sign-in/route.ts` — POST endpoint, env-guarded (404 in production), bearer-token auth via `STAGING_UAT_SECRET`, password-auth primary + magic-link fallback
- `e2e/uat/helpers/auth.ts` — `signInAsUatBot(page)` + `navigateAsUatBot(page, path)` helpers
- `lib/rate-limit.ts` — `uat_sign_in` limiter (100 req / 5 min / IP, cosmetic)
- `middleware.ts` — `/api/uat/` prefix added to `isPublicPath` (pre-session reachable)
- `.github/workflows/button-migration-gates.yml` — Gate 8: UAT route env-guard + secret check

### Required action from Steven before PR 2

| Item | Where |
|---|---|
| Set `STAGING_UAT_SECRET` in Vercel (staging branch) | Vercel → Project → Settings → Environment Variables → Git Branch = `staging` |
| Set `STAGING_UAT_SECRET` as GitHub Actions secret | GitHub → Settings → Secrets and variables → Actions → New secret |

The route returns HTTP 500 until `STAGING_UAT_SECRET` is set in Vercel. The Playwright helper throws until `STAGING_UAT_SECRET` is set in the CI environment.

---
