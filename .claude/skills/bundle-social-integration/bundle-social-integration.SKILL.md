---
name: bundle-social-integration
description: Use this skill whenever touching bundle.social — publishing, webhooks, connections, media upload, or the getBundlesocialClient/getBundlesocialTeamId helpers. Trigger on lib/bundlesocial.ts, lib/platform/social/publishing/fire.ts, lib/platform/social/webhooks/, lib/platform/social/media/upload-to-bundle.ts, social_publish_attempts, or any bundle.social API call. Getting the publish → webhook round-trip wrong creates lost posts, phantom in_flight rows, or double-billed API calls.
---

# bundle.social Integration

bundle.social is the only platform used for social publishing. All publishing goes through it. Never call LinkedIn/Facebook/X/GBP APIs directly.

## Client setup

```typescript
import { getBundlesocialClient, getBundlesocialTeamId } from "@/lib/bundlesocial";

const client = getBundlesocialClient();  // null if BUNDLESOCIAL_API_KEY unset
const teamId = getBundlesocialTeamId();  // null if BUNDLESOCIAL_TEAM_ID unset
if (!client || !teamId) { /* degrade gracefully — mark attempt failed */ }
```

Both helpers return `null` when their env var is unset. Code that uses them must handle `null` and mark the publish attempt as failed (error_class: `platform_error`, code: `RECEIVER_NOT_CONFIGURED`), then advance master state to `failed`. Never hard-require at cold-start.

## Platform mapping

```typescript
const PLATFORM_TO_BUNDLE = {
  linkedin_personal: "LINKEDIN",
  linkedin_company:  "LINKEDIN",
  facebook_page:     "FACEBOOK",
  x:                 "TWITTER",
  gbp:               "GOOGLE_BUSINESS",
};
```

## Post creation — the `postCreate` call

```typescript
const response = await client.post.postCreate({
  requestBody: {
    teamId,
    title: `attempt:${attemptId}`,   // correlates bundle.social post → our attempt row
    postDate: new Date().toISOString(),
    status: "SCHEDULED",
    socialAccountTypes: [bundlePlatform],
    data: {
      LINKEDIN: { text, link, uploadIds? },
      // OR FACEBOOK, TWITTER, GOOGLE_BUSINESS — only the matching key, not all
    },
  },
});
```

- `status: "SCHEDULED"` is always used even for immediate posts — bundle.social dispatches immediately when `postDate` is in the past or near-present.
- `text` can be omitted when `uploadIds` is non-empty (image-only post).
- `TWITTER` does not support `link` in the data block.
- Response is `{ id?: string; status?: string }`. Status `"ERROR"` is a synchronous failure even on HTTP 200 — treat it as a failed attempt.

## Media — resolving upload IDs

```typescript
import { resolveBundleUploadIds } from "@/lib/platform/social/media";

const resolved = await resolveBundleUploadIds(assetIds, companyId);
if (!resolved.ok) { /* media_invalid — mark attempt failed */ }
const uploadIds = resolved.data.uploadIds;
```

`resolveBundleUploadIds` caches `bundle_upload_id` on the `social_media_assets` row after first resolution. Concurrent resolvers race at the UPDATE — last writer wins; all returned IDs are valid (bundle.social upload IDs are immutable per asset).

Source resolution order:
1. If `bundle_upload_id` is cached → return it (no network call).
2. If `source_url` is set → call `uploadCreateFromUrl` (bundle.social pulls the bytes).
3. (Future) If only `storage_path` is set → download from Supabase Storage, upload as Blob.

## Webhook inbound — `post.published` / `post.failed`

Endpoint: `POST /api/webhooks/bundlesocial` (L6).

```typescript
import { verifyBundlesocialSignature } from "@/lib/bundlesocial";

const sig = req.headers.get("x-bundlesocial-signature") ?? "";
const body = await req.text();
const valid = verifyBundlesocialSignature(body, sig);
if (!valid) return new Response("Unauthorized", { status: 401 });
```

Webhook payload shape:
```json
{
  "event": "post.published" | "post.failed",
  "post": { "id": "<bundle_post_id>", "status": "POSTED" | "ERROR", ... }
}
```

On `post.published`:
1. Find the `social_publish_attempts` row by `bundle_post_id`.
2. Predicate-guarded update: `status = 'succeeded'`, `completed_at = now()`.
3. Find the `post_master_id` via `post_variant_id`.
4. Predicate-guarded update: master `state = 'published'`, `state_changed_at = now()` WHERE `state = 'publishing'`.
5. Dispatch `post_published` notification.

On `post.failed`:
1. Same lookup chain.
2. Update attempt: `status = 'failed'`, `error_class = 'platform_error'`, `error_payload = { bundle_status }`.
3. Update master: `state = 'failed'` WHERE `state = 'publishing'`.
4. Dispatch `post_failed` notification.

**Idempotency:** webhook may redeliver. Both updates are predicate-guarded (`WHERE status = 'in_flight'` / `WHERE state = 'publishing'`), so re-delivery is a no-op if the row has already advanced.

## QStash — the delivery mechanism

QStash delivers to `POST /api/webhooks/qstash/social-publish`.

```typescript
import { verifyQstashSignature } from "@/lib/qstash";
// call at top of handler — returns 401 on failure
```

On CAPPED outcome from `claim_publish_job`, re-enqueue with a 30 s delay:
```typescript
await qstash.publishJSON({
  url: callbackUrl,
  body: { scheduleEntryId },
  delay: 30,
  deduplicationId: `social-publish-cap-${scheduleEntryId}-${Math.floor(Date.now() / 35000)}`,
});
```

The 35 s dedup bucket prevents rapid re-enqueue storms. QStash handles retries on our side automatically — do NOT add manual retry logic in the publish route.

## Error classification

`classifyError(message: string)` in `fire.ts` maps error message substrings to `error_class`:

| Pattern | Class |
|---------|-------|
| `rate limit` / `429` | `rate_limit` |
| `401` / `403` / `unauth` | `auth` |
| `400` / `invalid` | `content_rejected` |
| `network` / `timeout` / `econn` | `network` |
| anything else | `platform_error` |

Always persist `error_class` + `error_payload` on the `social_publish_attempts` row before returning.

## Drift guard — timing observability

`fireScheduledPublish` reads `social_schedule_entries.scheduled_at` before claiming the job and logs:
- `warn` if firing >2 min early (QStash delivered ahead of schedule)
- `warn` if firing >2 min late
- `error`-level if firing >30 min late (QStash outage scenario)

Always proceed regardless of drift — a late post is better than a missed one.
