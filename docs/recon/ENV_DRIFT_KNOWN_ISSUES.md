# Env drift — known issues

Resolved 2026-05-29. No outstanding drift.

History: 2026-05-29 publish-due outage was caused by `SUPABASE_URL` and `SUPABASE_DB_URL` drifting to different Supabase projects in Vercel preview + development scopes, and production's `SUPABASE_DB_URL` having the wrong pooler region segment. Manual dashboard fix + the consistency CI guard introduced in `scripts/check-supabase-env-consistency.ts` should prevent recurrence.

Re-open this doc if Supabase env drift is detected in any environment.
