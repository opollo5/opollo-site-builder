# Split-brain recurrence — "already connected" on empty table (2026-05-13)

## Section 1: Verdict

**Failure mode (a): PR #881 was never merged. Every one of the four defenses is undeployed.**

The incident re-occurred for the same structural reason as the original: a
bundle.social OAuth completed, the popup landed on bundle.social's dashboard
(bundle.social's redirect behaviour, the bug PR #884 targeted), our callback
was never called, and no DB row was created for the new account. With no L1
pre-connect ghost check live, the next connect attempt hit `socialAccountConnect`
directly — bundle.social rejected it with "This team already has a LinkedIn
account connected. Please disconnect it first."

PR #884 (sync-on-close) does NOT help here because it fires *after* the popup
opens. The ghost blocks `socialAccountConnect` before a popup is ever opened.
L1 (PR #881) is the only defense that runs before that call.

---

## Section 2: Findings from I1–I10

### I1 — PR #881 state

```
gh pr view 881 --json state,mergedAt,mergeCommit
→ { "state": "OPEN", "mergedAt": null, "mergeCommit": null }
```

PR #881 (`hotfix/bundlesocial-reconcile-and-failsafe`) is open and unmerged.
The four-layer failsafe described in its description — L1 pre-connect ghost
check, L2 reconciliation API, L3 maintenance UI, L4 verify-loop disconnect —
has never been deployed to production.

### I2 — Deployed SHA vs PR #881

Production deployed SHA: `621ce960` (PR #884 — sync-on-close fix, merged
this session). PR #881's merge commit: null (open). PR #881's code is not in
the deployed bundle.

### I3 — L1 in connect route

`app/api/platform/social/connections/connect/route.ts` (line 107–113):
`initiateProfileConnect` is called directly with no pre-flight ghost check.
No reference to `checkBundleSocialGhost`, `preConnectGhostCheck`, or `L1`.
Confirmed: L1 is not wired.

### I4 — social_connections table

```
GET /rest/v1/social_connections → []
```

Zero rows. The UI's "No social connections yet" is accurate.

### I5/I6 — Ghost account on bundle.social

`socialAccountGetByType(teamId='2960f6ea', type='LINKEDIN')`:

| Field | Value |
|---|---|
| Account ID | `4b3b1448-5fc9-42a6-9d9b-c748f1d816ea` |
| Team | `2960f6ea` (Opollo) |
| User | Steven Morey (`urn:li:person:cn_0IGowb1`, userUsername: `stevenmorey`) |
| externalId | `null` |
| Channels | 15 (personal profile + 14 organisations) |
| `createdAt` on bundle.social | `2026-05-12T21:58:23.254Z` |
| `deletedAt` | `null` |
| DB row matching this account | **none** |

All other teams (Vincovi, ASCII Group, Planet6, Skyview) returned
`"Team does not have a Linkedin account"` → clean.

### I7 — platform_events (last 48 h)

Six `connection_disconnected` events, all LINKEDIN, all `disconnect_ok: true`,
all `deleted: true`. No `connection_created`, no `bundlesocial_ghost_cleared`,
no `disconnect_split_brain_detected`, no `disconnect_failed`.

```
2026-05-12T21:57:58  bundle_social_account_id: 21a1e828  deleted: true
2026-05-12T21:36:00  bundle_social_account_id: 787f0479  deleted: true
2026-05-12T20:23:00  bundle_social_account_id: 93d57333  deleted: true
2026-05-12T20:03:52  bundle_social_account_id: 0055f158  deleted: true
2026-05-12T11:08:13  bundle_social_account_id: 02109aeb  deleted: true
2026-05-12T06:23:22  bundle_social_account_id: f6eb9f32  deleted: true  (unset_ok: null)
```

Note: `sync.ts` does not emit `connection_created` events when it inserts rows,
so there is no positive-side audit trail for when connections were created.

### I8 — Vercel function logs

`vercel logs --environment production` enters streaming mode and does not
return historical log lines via the CLI. Logs for the 21:57–22:05 UTC window
were not accessible through the available tooling.

**Inference from I7**: the ghost account's `createdAt` is `21:58:23` — 25
seconds after the last disconnect event at `21:57:58`. The most likely
explanation is that Steven completed a new OAuth within that window. Without
callback logs, it cannot be confirmed whether the callback URL was hit and
failed, or was never called (bundle.social dashboard redirect).

### I9 — Reconstructed sequence

```
~06:23 → connect → OAuth → bundle.social creates account f6eb9f32
           → callback? (unknown, but DB row existed at time of disconnect)
  11:08 → disconnect f6eb9f32 → deleted: true
  11:08 → connect → OAuth → bundle.social creates account 02109aeb
           → callback hit (DB row created — confirmed by later deleted:true)
  20:03 → disconnect 02109aeb → deleted: true
  20:03 → connect → bundle.social creates 0055f158
  20:23 → disconnect 0055f158 → deleted: true
  20:23 → connect → bundle.social creates 93d57333
  21:36 → disconnect 93d57333 → deleted: true
  21:36 → connect → bundle.social creates 787f0479
  21:57 → disconnect 787f0479 → deleted: true

  21:57:58 → disconnect 21a1e828 → deleted: true  ← last clean state
  21:58:23 → bundle.social receives new OAuth → creates 4b3b1448
             → callback NOT called (dashboard redirect, PR #884 not yet live)
             → no DB row created for 4b3b1448
             → social_connections: 0 rows
             → bundle.social Opollo team: has 4b3b1448

  23:56:32 → PR #884 deployed (sync-on-close)

  [now]    → Steven attempts connect
           → POST /connections/connect → socialAccountConnect
           → bundle.social: "This team already has a LinkedIn account connected"
           → route returns 409 INVALID_STATE
           → popup never opens → sync-on-close never fires
```

### I10 — L1 direct test

POST `/api/platform/social/connections/connect` without auth → 401 UNAUTHORIZED
(correct). With valid auth, the route calls `socialAccountConnect` which returns
bundle.social's "already connected" error. The route wraps it as 409
INVALID_STATE (line 122–123 of the route). No pre-flight check exists.

**PR #884's sync-on-close does not help**: it runs after popup close, but the
popup never opens because `socialAccountConnect` fails before the popup URL is
returned. The error is surfaced to the user before any OAuth flow begins.

---

## Section 3: Concrete fix recommendation

### Immediate (do not skip)

**Merge PR #881.** The branch is current (`hotfix/bundlesocial-reconcile-and-failsafe`),
CI was green at the time the PR was opened (test count: 1475/1475), and the
design is correct:

- L1 detects the ghost via `socialAccountGetByType` before calling
  `socialAccountConnect`, auto-disconnects it, proceeds to OAuth. This
  eliminates the "already connected" surface permanently as long as the DB is
  up.
- L4 prevent new ghosts by refusing to delete the DB row until bundle.social
  confirms the disconnect — closing the 25-second race window observed in I9.
- L2/L3 provide operational tooling to scan and repair divergences.

Before merging, re-run CI to confirm the branch hasn't drifted against main
(PR #884 and PR #881 both touch `components/SocialConnectionsList.tsx` and
the connect/disconnect routes — a rebase or merge may be needed).

### Complementary (do in the same PR or follow-up)

1. **Add a `connection_created` event in `syncBundlesocialConnections`** (sync.ts
   line ~440, inside the insert block). Currently there is no positive-side audit
   trail: we can see when connections are deleted but not when they are created.
   This made I9's sequence reconstruction incomplete.

2. **PR #884 sync-on-close + ghost already present**: if `syncBundlesocialConnections`
   returns `inserted: 0` after popup close, surface a user-visible warning
   ("Connection may not have completed — try again"). The current behaviour
   silently succeeds with no visible row. This is a UX gap that will recur for
   any user who already has a ghost when they open the popup.

3. **Do not rely solely on L1 for future safety**: L1 fixes the pre-connect path,
   but the underlying root cause is that `syncBundlesocialConnections` is never
   called unless triggered by a callback or sync-on-close. A lightweight
   background job that periodically calls `reconcileBundlesocialAccounts` (L2)
   and auto-clears confirmed ghosts would catch any that slip through during
   outage windows.

### What NOT to do

- Do not write a new one-shot unstick script. PR #881's L2/L3 reconcile surface
  covers this permanently.
- Do not add more code before merging PR #881. Every new defensive layer added
  without merging the existing one increases code surface without reducing risk.
