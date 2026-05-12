# Incident: Channel picker UI — second pass (post PR #878)

**Date:** 2026-05-12
**Reporter:** Steven Morey
**Symptoms:**
1. Row Steven set to `healthy` via ops script (PR #878 step 5) renders as "Pending channel selection" in the UI.
2. Clicking "Select channel" opens the picker modal, which immediately surfaces "Something went wrong, please try again later" from `GET /api/platform/social/connections/[id]/channels`.

---

## Section A — Bug A (row shows "Pending channel selection")

### A.1 — Actual row state

The original row `3f29ab79-ddc1-49fd-a598-926d412db47d` no longer exists. It was deleted (the disconnect flow does `unset → disconnect → DELETE`, per `tests/regressions/disconnect-ordering.test.ts`).

A new row was created at 06:23 UTC, ~10 minutes after the PR #878 deploy verification:

```json
{
  "id": "65beb232-4334-4a67-bb16-bd3de05d0920",
  "platform": "linkedin_personal",
  "status": "pending_identity",
  "external_account_id": null,
  "external_user_id": "urn:li:person:cn_0IGowb1",
  "is_personal_mode": false,
  "display_name": "Steven Morey",
  "bundle_social_account_id": "02109aeb-5a39-4aff-aa27-376cc613523a",
  "created_at": "2026-05-12T06:23:39.168237+00:00"
}
```

`bundle_social_account_id` is different from the prior `f6eb9f32-…` — Steven re-OAuthed. The new account `02109aeb-…` exists in bundle.social with `externalId=null` (no channel selected yet) and 16 channel candidates.

**Verdict on Bug A symptom**: the row is **genuinely** `status=pending_identity` because of the re-OAuth. The post-#884 sync logic correctly refused to mark it `healthy` without a channel binding. The UI rendering is internally consistent with the row state.

### A.2 — Where the pill text comes from

`components/SocialConnectionsList.tsx:683-687` renders `STATUS_LABEL[c.status]`. `STATUS_LABEL` is defined in `lib/platform/social/connections/types.ts:61-67`:

```ts
pending_identity: "Pending channel selection",
```

So the pill text comes from branch **(a) `status === 'pending_identity'`**. There is no separate branch for `external_account_id === null` or `is_personal_mode === false` — the UI is purely driven by `status`.

### A.3 — The actual UI gap

The current code already does the right thing for the Select Channel button: it only shows when `status === 'pending_identity'` (line 698-700). But the UI does **not** distinguish, in the rendered row, whether a healthy connection is bound via:
- **Personal mode** (`is_personal_mode = true`, `external_account_id = null`)
- **Channel mode** (`is_personal_mode = false`, `external_account_id` populated)

Both render the same way (display_name + Healthy pill). For LinkedIn especially, where the same user can pick personal vs org channel, this is ambiguous: "Steven Morey" could mean "personal LinkedIn" or "Steven happens to be the OAuth-er for some org page". Steven wants a visible discriminator.

**Fix scope for Bug A**: add an italic "Personal profile" subtext under the display_name when `is_personal_mode === true`. Keep the rest of the rendering as-is — the existing Select Channel button visibility (only on `pending_identity`) and pill rendering already match the spec.

### A.4 — AdminProfileConnectionsList

`components/AdminProfileConnectionsList.tsx` renders raw `Account` rows from bundle.social (not `SocialConnection` rows from our DB), without a Status column or `is_personal_mode` awareness. Bug A does not apply to it. No change needed there.

---

## Section B — Bug B (channels endpoint 500s)

### B.1 — Direct SDK probe results

Hit against `teamId=2960f6ea-1c15-4baf-8812-00f681c05dd6` (Opollo), `type=LINKEDIN`:

| SDK method | Request body | Status | Channels returned |
|---|---|---|---|
| `socialAccountGetByType` | `{ teamId, type: 'LINKEDIN' }` | **200** | 16 |
| `socialAccountRefreshChannels` | `{ requestBody: { teamId, type: 'LINKEDIN' } }` | **500** | — body: `{"statusCode":500,"message":"Something went wrong, please try again later."}` |

`socialAccountGetByType` returns the cached channels list with `externalId: null` (channel not yet selected) and `channels: [16 items]`. `socialAccountRefreshChannels` 500s — bundle.social's server-side failure on the refresh endpoint, repeatable across calls.

### B.2 — Endpoint wiring

`app/api/platform/social/connections/[id]/channels/route.ts:53-56`:

```ts
const result = await refreshChannels({
  teamId: conn.teamId,
  platform: conn.bundlePlatform,
});
```

`refreshChannels` (in `lib/platform/social/connections/channels.ts:210-228`) calls `socialAccountRefreshChannels`. This is the 500-ing endpoint.

There's already a `getChannels` wrapper in the same file (lines 245-279) that calls `socialAccountGetByType` — the method that works. It returns the same shape (`{ channels: Channel[] }`).

### B.3 — Root cause

The picker GET endpoint calls `refreshChannels` (force-refresh from the platform), which 500s on bundle.social's side. The cheaper `getChannels` (read cached) works fine. The picker only needs to render what bundle.social already has; a force refresh is not required for the picker's job.

**Fix scope for Bug B**: switch the route from `refreshChannels` → `getChannels`. The wrapper already exists. The contract test (`lib/__tests__/social-channels.contract.test.ts:234-246`) already pins the `getChannels` calling convention.

### B.4 — A "Refresh from platform" affordance later?

Out of scope. The cached channels list is sufficient. If a future scenario needs force-refresh, it can be a separate button in the modal backed by a separate endpoint — but until bundle.social fixes their 500, force-refresh is a known dead end.

---

## Section C — Fix plan per bug

**Bug A**: In `components/SocialConnectionsList.tsx`, add a small italic "Personal profile" subtext under the display_name in the Account column when `is_personal_mode === true` AND `status === 'healthy'`. No change to the Select Channel button logic (which already gates on `pending_identity` only). No change to AdminProfileConnectionsList.tsx (different data shape, no status column).

**Bug B**: In `app/api/platform/social/connections/[id]/channels/route.ts`, replace the `refreshChannels` import with `getChannels` and update the call site. The error mapping branches (`RECEIVER_NOT_CONFIGURED`, `UPSTREAM_REJECTED`) stay — `getChannels` returns the same `ChannelOpsResult` shape. Add a regression test in `tests/regressions/channels-endpoint-uses-getbytype.test.ts` that mocks the SDK and asserts the route calls `socialAccountGetByType`, not `socialAccountRefreshChannels`.

---

## Section D — Files changing

- `components/SocialConnectionsList.tsx` — add `is_personal_mode` subtext in the Account column.
- `app/api/platform/social/connections/[id]/channels/route.ts` — switch import + call from `refreshChannels` to `getChannels`.
- `tests/regressions/channels-endpoint-uses-getbytype.test.ts` — new regression pinning the SDK method via mocks.
- `docs/incidents/2026-05-12-channel-picker-second-pass.md` — this doc.
