# Hardening Pass — Steven Actions

Actions that require Steven's manual intervention. Appended as work surfaces them.

---

## WS5 — Staging environment setup

**When**: after PR #feat/staging-environment-scaffold merges.

**What to do in Vercel**:

1. In the Vercel dashboard for `opollo-site-builder`, go to **Settings → Git → Preview Branches**.
2. Create a long-lived branch named `staging` in GitHub: `git checkout main && git checkout -b staging && git push origin staging`.
3. In Vercel → **Settings → Environment Variables**, add the following for the `staging` branch only (under the "Custom Environment" or "Branch Environment" override):

   | Variable | Value |
   |---|---|
   | `APP_ENV` | `staging` |
   | `STAGING_EMAIL_RECIPIENT` | `hi@opollo.com` (or a dedicated staging inbox) |
   | `STAGING_SIDE_EFFECTS_ENABLED` | (leave unset — side effects blocked by default) |

4. Vercel will auto-deploy the `staging` branch as a preview URL (e.g. `opollo-site-builder-git-staging-opollo5.vercel.app`). Share that URL with the team as the staging URL.

**What this gives you**:
- `isStaging()` returns `true` on the staging branch.
- All transactional emails are redirected to `STAGING_EMAIL_RECIPIENT` instead of real clients.
- Cron side effects (AI generation, real billing calls) are blocked unless `STAGING_SIDE_EFFECTS_ENABLED=1` is set.
- All other behaviour (DB, auth, social connections) works normally against the staging Supabase project (or production if you choose to share — staging shares the main project by default until a staging Supabase project is provisioned).

**Optional: dedicated staging Supabase project**
If you want full data isolation, provision a new Supabase project and override `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` for the `staging` branch. Then run migrations on it separately.

---

## WS1 — IDEOGRAM_API_KEY in production

**When**: immediately (image generation in CAP is silently skipped without it).

**What to do**: confirm `IDEOGRAM_API_KEY` is set for the `Production` environment in Vercel (it was added to Development + Preview on 2026-05-19 but may need Production scope). Check: Vercel → Settings → Environment Variables → IDEOGRAM_API_KEY → ensure `Production` is checked.

---
