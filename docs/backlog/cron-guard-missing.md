# Known Issue: claimDueDrafts has no company-level guard

**Status:** Pending Steven's decision — fix vs accept  
**Logged:** 2026-06-03  
**Found during:** B3 verification (wrote test data to prod Supabase by mistake; test scheduled draft would have been claimed by cron)  
**Owner:** Steven Morey

---

## The exposure

`lib/social/publishing/claim-due-drafts.ts` runs as the V2 publish-due
cron and queries:

```sql
WHERE state = 'scheduled'
  AND scheduled_at <= now()
  AND publish_attempts < $maxAttempts
  AND archived_at IS NULL
```

There is **no company-level filter**. Any draft in any company that
satisfies those conditions — including test/seed drafts written to
production by mistake — will be claimed and enter the live publish path on
the next cron tick.

The draft will flip to `state = 'publishing'`, a `social_publish_attempts`
row will be created, and `bundle.social` will be called to publish the
post. If `target_profiles` is empty (as it would be for a seed/test draft),
the call fails gracefully without publishing anything visible, but the
attempt is consumed and noise enters the logs and monitoring.

---

## Why it isn't fixed yet

Fixing it requires either:

**Option A — Allowlist/denylist by company flag.**
Add `is_test_company boolean DEFAULT false` to `platform_companies` and
filter `WHERE NOT c.is_test_company`. Low schema cost but requires a join
on every cron tick.

**Option B — Sentinel `company_id` range.**
Reserve a UUID prefix or range for test companies and filter it out. Works
without a schema change but is convention-only, not enforced.

**Option C — Accept the exposure.**
All real scheduled drafts have non-empty `target_profiles`. The worst-case
outcome of a test draft reaching the cron is a failed bundle.social call,
not actual publishing. If local Supabase is always used for testing (per
the CLAUDE.md hard rule), this scenario should never arise again. Accept
the gap and rely on the procedural guard.

**Option D — Rate-guard the cron entry.**
The `claimDueDrafts` logic already checks `publish_attempts < maxAttempts`
(currently capped at 3). A test draft with empty `target_profiles` would
dead-letter after 3 attempts and stop. The blast radius is bounded.

---

## B4 scope protection

B4 (Client Portal) is reconnect + approval only — no scheduling. B4 must
have **no write path that sets `social_post_drafts.state = 'scheduled'`**.
If B4 never produces a scheduled draft, this cron exposure is moot for B4.
Every B4 code path that touches draft state must be audited to confirm it
cannot reach `state = 'scheduled'`.

---

## Decision required from Steven

1. Which option (A/B/C/D) — or a different approach?
2. If fixing: is this a standalone migration PR or bundled with another?
3. Priority relative to current workstream (B4)?
