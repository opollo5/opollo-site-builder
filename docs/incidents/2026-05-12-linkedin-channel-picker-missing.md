# Incident: LinkedIn channel picker not shown after OAuth

**Date:** 2026-05-12  
**Reporter:** Steven Morey  
**Symptom:** Connecting LinkedIn via the new OAuth + channel-picker flow completed without showing the channel picker. The row was created with `status='healthy'` and no org page selected. Steven expected to see a picker listing his 15 LinkedIn company pages.

---

## 1. Verdict: Possibility B

**Bundle.social returned 16 channels. Our code skipped the picker.**

The picker was never rendered because `sync.ts` treated "channels are available to pick from" (`channels.length > 0`) as equivalent to "a channel has been selected." When the row is inserted as `healthy`, the callback route's picker-trigger lookup (which filters on `status='pending_identity'`) returns null, so the callback sends `connect=success` instead of `connect=needs_channel`.

---

## 2. Evidence

### I1 — Production `social_connections` row

```json
{
  "id": "3f29ab79-ddc1-49fd-a598-926d412db47d",
  "platform": "linkedin_personal",
  "status": "healthy",
  "display_name": "Steven Morey",
  "external_account_id": null,
  "external_user_id": "urn:li:person:cn_0IGowb1",
  "is_personal_mode": false,
  "created_at": "2026-05-12T04:55:17Z"
}
```

Key signals:
- `status = 'healthy'` without channel selection
- `external_account_id = null` — bundle.social `externalId` is null, meaning no channel was bound via `setChannel`
- `is_personal_mode = false` — user did not click "Connect as personal profile"

### I2 — `socialAccountGetByType` response (verbatim)

```json
{
  "id": "f6eb9f32-840f-4529-a867-ec3375eb99e0",
  "type": "LINKEDIN",
  "teamId": "2960f6ea-1c15-4baf-8812-00f681c05dd6",
  "externalId": null,
  "userUsername": "stevenmorey",
  "userDisplayName": "Steven Morey",
  "userId": "urn:li:person:cn_0IGowb1",
  "channels": [
    { "id": "urn:li:person:cn_0IGowb1", "name": "Steven Morey", "username": "stevenmorey" },
    { "id": "urn:li:organization:66715373", "name": "Planet6", "username": "planet6" },
    { "id": "urn:li:organization:95770769", "name": "Essential 8 Compliance", "username": "essential-8-compliance" },
    { "id": "urn:li:organization:1918610", "name": "Ascentient IT Support & Managed IT Services", "username": "ascentient" },
    { "id": "urn:li:organization:237210", "name": "SkyView Technology", "username": "skyviewtechnology" },
    { "id": "urn:li:organization:3693146", "name": "SIAX Computing Solutions Pty Ltd", "username": "siax-computing-solutions-pty-ltd" },
    { "id": "urn:li:organization:1117957", "name": "Platform 24 IT Services & Solutions Sydney", "username": "p24" },
    { "id": "urn:li:organization:10073355", "name": "Com Pro Managed Business Solutions", "username": "com-pro-business-solutions-ltd." },
    { "id": "urn:li:organization:76154564", "name": "StrikeWorks", "username": "strikeworks-solutions" },
    { "id": "urn:li:organization:311566", "name": "SMS Data Products Group, Inc.", "username": "sms-data-products" },
    { "id": "urn:li:organization:85775", "name": "Davenport Group", "username": "davenport-group" },
    { "id": "urn:li:organization:1175611", "name": "SkyNet IT Support & Managed IT Services Ohio", "username": "skynet-it-services" },
    { "id": "urn:li:organization:105341307", "name": "AIINX", "username": "aiinx" },
    { "id": "urn:li:organization:40810993", "name": "Opollo MSP Marketing", "username": "opollo-marketing" },
    { "id": "urn:li:organization:106698852", "name": "AIINX - AI In Finance", "username": "ai-solutions-in-finance" },
    { "id": "urn:li:organization:96576033", "name": "Lead Source", "username": "lead-source-co" }
  ],
  "deletedAt": null
}
```

**channels.length = 16.** `externalId = null` (no channel bound).

### I3 — `socialAccountRefreshChannels` response

`500 Something went wrong, please try again later` — bundle.social server error on this endpoint. Not directly relevant to diagnosis; I2 (getByType) is the call path sync.ts actually uses.

---

## 3. Callback-handler decision logic (I5)

Source: `app/api/platform/social/connections/callback/route.ts:230-256`

```typescript
// Determine needsChannelConnectionId
let needsChannelConnectionId: string | null = null;
if (
  sync.ok &&
  sync.data.inserted > 0 &&
  classified?.kind === "success" &&
  CHANNEL_SELECTION_PLATFORMS.has(classified.platform.toUpperCase() as "LINKEDIN")
) {
  needsChannelConnectionId = await findMostRecentlyInsertedConnectionId(companyId);
}

// connectParam decision
if (needsChannelConnectionId) {
  connectParam = "needs_channel";   // ← picker opens
} else if (sync.data.inserted > 0) {
  connectParam = "success";          // ← no picker
}
```

`findMostRecentlyInsertedConnectionId` (lines 308-329) filters:
```typescript
.eq("status", "pending_identity")
.gte("created_at", since)  // within last 60 seconds
```

**Because sync set the row to `status='healthy'`, this query returned 0 rows.** `needsChannelConnectionId = null` → `connectParam = 'success'` → picker never opened.

---

## 4. Root cause in sync.ts

File: `lib/platform/social/connections/sync.ts:311-318`

```typescript
const hasChannel = identity.channels.length > 0;   // ← BUG

const status: "healthy" | "pending_identity" = !hasIdentity
  ? "pending_identity"
  : isChannelPlatform && !hasChannel && !isPersonal
    ? "pending_identity"
    : "healthy";
```

`identity.channels` is the **available-to-pick** list returned by `socialAccountGetByType`. It is populated as soon as OAuth completes — before the user has selected anything. `externalId` (→ `external_account_id`) is what gets set after `socialAccountSetChannel` is called with the user's chosen channel.

The check `hasChannel = channels.length > 0` fires true immediately, causing the row to be inserted as `healthy` before the user has made a selection.

---

## 5. What next

**This is a single-line code fix in `sync.ts`.** Replace `identity.channels.length > 0` with `identity.external_account_id !== null` as the "channel selected" check.

```typescript
// BEFORE (wrong — fires true as soon as OAuth completes)
const hasChannel = identity.channels.length > 0;

// AFTER (correct — only true after setChannel has been called)
const hasChannelSelected = identity.external_account_id !== null;
```

And rename the variable in the status expression:

```typescript
const status: "healthy" | "pending_identity" = !hasIdentity
  ? "pending_identity"
  : isChannelPlatform && !hasChannelSelected && !isPersonal
    ? "pending_identity"
    : "healthy";
```

The personal-profile path is unaffected — `is_personal_mode=true` bypasses the channel check entirely; no setChannel is needed for personal mode.

The callback route's `findMostRecentlyInsertedConnectionId` query (`status='pending_identity'`) will then find the row and send `connect=needs_channel`, opening the picker correctly.

The current production row (`3f29ab79-...`) has `status='healthy'` with no channel bound. After the fix ships, the row's existing state needs to be corrected — either disconnect-and-reconnect, or directly update `status='pending_identity'` so the overdue banner shows the picker affordance within 24h.

No support email to bundle.social is needed. Channels are present and correct — 15 org pages available. The bug is entirely in our code.
