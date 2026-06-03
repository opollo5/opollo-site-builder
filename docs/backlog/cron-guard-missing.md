# Known Issue: claimDueDrafts has no company-level guard

**Status:** ACCEPTED / DEFERRED — do not build a cron guard  
**Logged:** 2026-06-03  
**Decision:** 2026-06-03 by Steven Morey  
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

## Decision: Accept the risk

**Steven's decision (2026-06-03):** Accept. Do NOT build a cron guard now.

**Mitigations already in place:**

1. **Procedural guard (CLAUDE.md hard rule):** Verification scripts, seeding
   scripts, and integration tests never use production credentials. If local
   Supabase/Docker is unavailable, stop. This eliminates the root scenario
   (test data reaching prod).

2. **B4 scope protection:** B4 is reconnect + approval only. B4 has no write
   path that sets `social_post_drafts.state = 'scheduled'`. The cron exposure
   is moot for B4.

3. **Blast radius is bounded:** `claimDueDrafts` already caps at
   `publish_attempts < maxAttempts` (3). A draft with empty `target_profiles`
   dead-letters after 3 attempts. No actual publishing occurs.

**Options A–D (evaluated but not selected):** Building Option A
(`is_test_company` flag), B (sentinel UUIDs), or D (additional rate guard)
adds schema or logic cost for a scenario that should not occur if the
procedural guard holds.

---

## Revisit triggers

Reopen and evaluate if:

- More than one paying customer has connected publish accounts (at which
  point blast radius of a hypothetical future test-data leak increases
  meaningfully).
- A "draft/test company" concept is introduced in production (e.g., a
  sandbox or staging company that lives in the prod Supabase project).

Neither condition is present today. Do not act before then.

---

## B4 scope protection (restated)

B4 (Client Portal) is reconnect + approval only. B4 must have **no write
path that sets `social_post_drafts.state = 'scheduled'`**. Every B4 code
path that touches draft state must be audited to confirm it cannot reach
`state = 'scheduled'`. This constraint is also documented in
`docs/proposals/BUILD_BRIEF_4_CLIENT_PORTAL.md` § Known hazards.
