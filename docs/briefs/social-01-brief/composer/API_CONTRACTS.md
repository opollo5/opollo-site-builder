# API Contracts

Every endpoint the composer + dashboard depend on. Request/response shapes are TypeScript interfaces — copy directly into the codebase or regenerate from Zod schemas.

All endpoints live under `/api/platform/social/` and are protected by Supabase auth. The auth middleware (existing) injects `auth.uid()` into RLS context.

For each endpoint: method, path, request shape, response shape, status codes, RLS behaviour, retry behaviour.

---

## 1. Drafts CRUD

### `POST /api/platform/social/drafts`

Create a draft. Used by every scheduling mode (the differentiator is the `mode` field in the body).

**Request body:**

```ts
interface CreateDraftRequest {
  content: string;                           // post body, up to 63206 chars
  media_urls?: string[];                     // URLs from social-media-uploads bucket
  target_profile_ids: string[];              // uuid[] of social_connections.id
  platform_variants?: {                      // optional per-platform overrides
    [platform: string]: {
      content?: string;
      link?: string;
      cta?: string;
    };
  };
  mode: 'post_now' | 'schedule' | 'recurring' | 'draft';

  // mode === 'schedule' requires:
  scheduled_at_list?: string[];              // ISO 8601 timestamps. One row per timestamp.

  // mode === 'recurring' requires:
  recurrence?: {
    rule: string;                            // RFC 5545 RRULE
    starting_at: string;                     // ISO 8601
    until?: string;                          // ISO 8601; absent = no end
  };

  // mode === 'draft' (optional):
  planned_for_at?: string;                   // ISO 8601 hint, not auto-publish trigger

  // any mode:
  approval_required: boolean;
  approver_user_id?: string;                 // override company default
}
```

**Response 201:**

```ts
interface CreateDraftResponse {
  drafts: Array<{
    id: string;
    state: 'draft' | 'pending_approval' | 'scheduled' | 'recurring' | 'publishing';
    scheduled_at?: string;
    parent_draft_id?: string;                // present on recurring children
  }>;
  batch_id?: string;                         // present when N > 1 rows created
}
```

**Status codes:**
- 201 — created
- 400 — validation failure (`{ errors: ValidationError[] }`)
- 401 — unauthenticated
- 403 — RLS denied (user not in company)
- 429 — rate limit (3 bulk creates per hour per company)

**Validation rules:**
- `content` length must be ≤ platform-specific limit for every targeted profile. LinkedIn=3000, X=280, Facebook=63206, Instagram=2200, GBP=1500.
- If `platform_variants[X]` exists, that variant's `content` is validated instead of `content` for platform X.
- `scheduled_at_list` entries must all be in the future (>= now + 60s).
- `recurrence.rule` must parse as valid RRULE.
- `media_urls` must all be under `social-media-uploads` bucket.

**Side effects:**
- For `mode === 'recurring'`: creates one parent row + first 6 child rows.
- For all non-draft modes with `approval_required = false`: enqueues QStash job at `scheduled_at` (or now for post_now).
- For `approval_required = true`: sends approval email + Slack DM, no QStash enqueue yet.

---

### `GET /api/platform/social/drafts/[id]`

Fetch one draft.

**Response 200:**

```ts
interface DraftResponse {
  id: string;
  company_id: string;
  created_by_user_id: string;
  state: DraftState;
  content: string;
  media_urls: string[];
  target_profiles: Array<{
    profile_id: string;
    platform: Platform;
    account_name: string;
    account_avatar_url: string;
  }>;
  platform_variants: Record<string, { content?: string; link?: string; cta?: string }>;
  scheduled_at: string | null;
  planned_for_at: string | null;
  approval_required: boolean;
  approver_user_id: string | null;
  parent_draft_id: string | null;
  recurrence_rule: string | null;
  recurrence_state: 'active' | 'paused' | 'ended' | null;
  occurrence_index: number | null;
  published_at: string | null;
  published_url: string | null;
  last_publish_error: { code: string; message: string; attempted_at: string; attempt_number: number } | null;
  publish_attempts: number;
  created_at: string;
  updated_at: string;
}

type DraftState = 'draft' | 'pending_approval' | 'rejected' | 'scheduled' | 'recurring' | 'paused' | 'publishing' | 'published' | 'failed';
type Platform = 'linkedin' | 'facebook' | 'instagram' | 'x' | 'google_business_profile' | 'pinterest' | 'tiktok';
```

**Status codes:**
- 200 — found
- 404 — not found or RLS denied (return 404, not 403, to avoid leaking existence)

---

### `PATCH /api/platform/social/drafts/[id]`

Update a draft. Used by drag-and-drop reschedule, content edits, etc.

**Request body:** partial of `CreateDraftRequest` plus:

```ts
interface UpdateDraftRequest extends Partial<CreateDraftRequest> {
  scheduled_at?: string;                     // for drag-and-drop reschedule
  cancel_recurrence?: boolean;               // pauses parent + deletes future children
}
```

**Response 200:** same as `GET /drafts/[id]`.

**Validation:**
- Cannot transition state directly (use approval/publish endpoints).
- `scheduled_at` changes only allowed in `state IN ('scheduled', 'pending_approval')`.

---

### `DELETE /api/platform/social/drafts/[id]`

Delete a draft. Trash icon in dashboard.

**Response 204:** no content.

**Validation:**
- `state IN ('published')` — cannot delete; return 409 Conflict.
- `state IN ('publishing')` — cannot delete; return 409 Conflict.
- Other states: soft delete (set `state = 'deleted'`) or hard delete per RLS.

---

## 2. Calendar view

### `GET /api/platform/social/drafts/calendar-view`

Used by the dashboard calendar grid. Returns posts in a date range with denormalised fields for quick rendering.

**Query params:**
- `from` (ISO 8601 date, required)
- `to` (ISO 8601 date, required)
- `profile_ids` (comma-separated uuid list, optional — filter)

**Response 200:**

```ts
interface CalendarViewResponse {
  posts: Array<{
    id: string;
    state: DraftState;
    scheduled_at: string | null;
    published_at: string | null;
    content_excerpt: string;                 // first 100 chars of content
    primary_media_url: string | null;        // first of media_urls, for thumbnail
    target_profiles: Array<{
      platform: Platform;
      account_avatar_url: string;
    }>;
    is_recurring_child: boolean;
  }>;
  range: { from: string; to: string };
}
```

**Caching:**
- Server-side cache key: `calendar:{company_id}:{from}:{to}:{profile_ids_hash}`.
- Upstash Redis, 30s TTL.
- Invalidated on draft create/update/delete via tag-based eviction.

---

## 3. Bulk CSV upload

### `POST /api/platform/social/drafts/bulk`

Multipart form upload. Used by the bulk-CSV modal AND by CAP automation (with a service-role-like authentication).

**Request:** `multipart/form-data` with field `file` containing CSV bytes.

**CSV format (canonical):**

```
Content,Date,Time,Channel
"Hello world",05/21/2026,09:00,LinkedIn
"Visit us Saturday",05/22/2026,14:00,
"Cyber tip",05/23/2026,10:00,LinkedIn|Facebook
```

- `Content` (required): post body, UTF-8, ≤63206 chars
- `Date` (required): MM/DD/YYYY (US format — see `DECISIONS_LOCKED.md` Q5 rationale)
- `Time` (required): HH:MM 24-hour, in the company's timezone
- `Channel` (optional): empty = all connected, or pipe-separated list of `LinkedIn|Facebook|Instagram|X|GoogleMyBusiness`

**Response 202:**

```ts
interface BulkUploadResponse {
  batch_id: string;
  count: number;                             // rows successfully queued
  warnings?: Array<{ row: number; message: string }>;
}
```

**Response 400 (validation):**

```ts
interface BulkUploadValidationError {
  errors: Array<{
    row: number;                             // 1-indexed (row 1 = first data row, not header)
    column: 'Content' | 'Date' | 'Time' | 'Channel';
    message: string;
  }>;
}
```

**Validation behaviour:** ALL-OR-NOTHING per `DECISIONS_LOCKED.md` Q5. If any row has an error, NO rows are committed. The user fixes the CSV and re-uploads.

**Rate limit:** 3 uploads per company per hour. Returns 429 with `Retry-After` header.

**File size limit:** 1 MB. Row limit: 100.

**Shared parser:** `lib/social/bulk-csv/parse.ts` is the single source of truth. Both this endpoint and CAP automation import from it.

---

## 4. Approval workflow

### `POST /api/platform/social/drafts/[id]/approve`

Approver approves a draft in `pending_approval`.

**Request body:**

```ts
interface ApproveRequest {
  decision: 'approved' | 'rejected';
  rejection_reason?: string;                 // required if decision === 'rejected', 30–500 chars
}
```

**Response 200:**

```ts
interface ApproveResponse {
  draft: DraftResponse;                      // updated draft
  decision_id: string;                       // social_post_approval_decisions.id
}
```

**Behaviour:**
- On approve: state → `scheduled`. QStash job enqueued.
- On reject: state → `rejected`. Author notified via email.
- Inserts a row into `social_post_approval_decisions`.

**Authorisation:**
- `auth.uid()` must equal `draft.approver_user_id` OR be a platform_admin of the owning company.

---

### `GET /api/platform/social/drafts/[id]/review-link`

Generates a tokenised review link for sending to a client outside the platform.

**Response 200:**

```ts
interface ReviewLinkResponse {
  url: string;                               // https://app.opollo.com.au/review/<token>
  expires_at: string;                        // ISO 8601, 14 days from now
}
```

The token is JWT-signed; the `/review/<token>` route renders a minimal preview + approve/reject buttons.

---

## 5. Publishing (internal, called by Vercel Cron)

### `POST /api/internal/cron/publish-due`

Internal endpoint. Vercel Cron invokes this every minute with `Authorization: Bearer ${CRON_SECRET}` header (auto-injected by Vercel).

Not exposed to user clients. Documented here for completeness.

**Request:** no body. Authenticated via `CRON_SECRET` header check.

**Behaviour:**
1. Within a transaction: `SELECT id FROM social_post_drafts WHERE state = 'scheduled' AND scheduled_at <= NOW() AND publish_attempts < 3 LIMIT 10 FOR UPDATE SKIP LOCKED`.
2. `UPDATE` those rows to `state = 'publishing'` and commit. (This releases the row locks but keeps other cron invocations from picking up the same rows because the state is no longer `scheduled`.)
3. For each draft, in parallel (with concurrency limit 5 via `p-limit`):
   - Call bundle.social publish API for each target profile, wrapped in `withHealthMonitoring('bundle.social', 'publish', ...)`.
   - On success: state → `published`, `published_at` set, `published_url` set.
   - On failure: increment `publish_attempts`, set `last_publish_error`, state → `scheduled` (so the next cron picks it up) OR `failed` if `publish_attempts >= 3`.
4. Update `cron_heartbeats` for `job_name = 'publish-due'` with `last_run_at = NOW()`, `last_status = 'ok'`.
5. Return 200 with `{ processed: N, succeeded: M, failed: K }`.

If the handler itself throws (rare — should only be infrastructure failures), it writes `last_status = 'error'` and propagates. Vercel Cron retries automatically (default 3 attempts).

**The endpoint is safe to invoke manually** (e.g. for testing or backfill) — `FOR UPDATE SKIP LOCKED` makes it idempotent and concurrent-safe.

---

## 6. Analytics

### `GET /api/platform/social/drafts/[id]/analytics`

Used by the post-analytics modal.

**Response 200:**

```ts
interface AnalyticsResponse {
  impressions: number | null;
  engagement_rate: number | null;            // 0.0–100.0 (percentage)
  reactions: number | null;
  shares: number | null;
  comments: number | null;
  clicks: number | null;
  platform_specific: Record<string, number | string>;
  fetched_at: string;                        // ISO 8601 — when these numbers were last refreshed
  is_stale: boolean;                         // true if fetched_at > 5 minutes ago
}
```

**Caching (two-layer with graceful degradation):**
1. **Hot layer:** Upstash Redis, key `analytics:{draft_id}`, TTL 60s. First read attempt.
2. **Cold layer:** Postgres `social_post_analytics_cache` row, `fetched_at > NOW() - INTERVAL '60 seconds'`. Tried on Redis miss OR Redis error.
3. **Origin:** bundle.social analytics API, wrapped in `withHealthMonitoring`. Tried on cold-cache miss.

**On Redis error** (timeout, 5xx, network failure): the call is wrapped in try/catch. Failure records a `service_health_event` of type `service_5xx` for `service_name = 'upstash-redis'`, then falls through to the cold cache. **The user request never fails on Redis outage.**

**On bundle.social error** (5xx, 4xx): returns last known cached value from cold cache, sets `is_stale: true`. If no cold-cache row exists, returns `null` values with `is_stale: true`.

**On write path:** writes to BOTH Redis (60s TTL) AND Postgres (permanent, cleaned up by daily cron after 90 days). If Redis write fails, Postgres write still proceeds.

---

## 7. Webhooks (incoming from bundle.social)

### `POST /api/webhooks/bundle-social`

bundle.social posts publish-status updates here.

**Headers:**
- `X-Bundle-Social-Signature` (HMAC-SHA256 of body using `BUNDLE_SOCIAL_WEBHOOK_SECRET`)

**Request body:** see bundle.social docs. Relevant fields: `event_type`, `account_id`, `post_external_id`, `status`, `error_message`.

**Response 200:** `{ ok: true }`. Always 200 unless signature fails (return 401).

**Behaviour:**
- Verify signature.
- Match `post_external_id` to a `social_post_drafts.id` (we pass our id when scheduling).
- Update state accordingly.
- Update `published_url` if bundle.social provides it.

---

## 8. Error response shape (universal)

All error responses follow this shape:

```ts
interface ErrorResponse {
  error: {
    code: string;                            // machine-readable, e.g. 'validation_failed', 'rate_limited'
    message: string;                         // human-readable
    details?: unknown;                       // endpoint-specific extra data
    request_id: string;                      // for log correlation
  };
}
```

Endpoints SHOULD return `request_id` in both response body and `X-Request-Id` response header.

---

## 9. Zod schemas

For each request/response interface above, generate a matching Zod schema in `lib/social/schemas/`. The endpoint handler parses incoming requests with the schema; TS types are derived via `z.infer`. This is the existing repo convention — match it.

---

## 10. Rate limits summary

| Endpoint | Limit | Identifier |
|---|---|---|
| `POST /drafts/bulk` | 3 / hour | company_id |
| `POST /drafts` (single) | 60 / minute | user_id |
| `GET /drafts/[id]/analytics` | 10 / minute | user_id (Redis hot cache absorbs most calls) |
| All other endpoints | inherit existing Opollo middleware limits | — |

Implemented via Upstash Ratelimit primitive (already in repo) with Postgres fallback. If Redis is unavailable, rate-limit checks degrade to a Postgres advisory-lock pattern in `lib/platform/rate-limit/postgres-rate-limit.ts` — slower but never fails. Rate-limit failures NEVER bypass — if both layers fail, return 503.

---

## 11. Service health monitoring (cross-cutting)

Every external API call in this brief — bundle.social publish, bundle.social analytics, Ideogram generate, SendGrid send, Anthropic complete — is wrapped in `withHealthMonitoring(serviceName, operation, fn)` from `lib/platform/service-health/monitor.ts`.

The wrapper:
- Classifies failures (5xx vs auth vs billing vs rate-limit).
- Aggregates 3+ failures in 5 minutes into a `service_health_event` of severity `critical`.
- Notifies platform admins via SendGrid (and optional Slack) when severity reaches `critical`.
- Records a `recovered` event when the service starts succeeding again.

See `../SERVICE_HEALTH.md` for full architecture, schema, and operational behaviour.

## 12. Internal cron endpoints

All cron endpoints live under `/api/internal/cron/` and verify `Authorization: Bearer ${CRON_SECRET}`.

| Endpoint | Schedule | Purpose |
|---|---|---|
| `/api/internal/cron/publish-due` | every 1 minute | Pick up `state = 'scheduled' AND scheduled_at <= NOW()` drafts and publish |
| `/api/internal/cron/heartbeat-check` | every 5 minutes | Verify all crons have run recently; raise `cron_stale` events if not |
| `/api/internal/cron/health-check` | every 5 minutes | Send notifications for unresolved critical `service_health_events` |
| `/api/internal/cron/cleanup-cache` | daily 3am | Delete `social_post_analytics_cache` rows >90 days old |
| `/api/internal/cron/escalate-approvals` | every 6 hours | 48h/72h/96h approval escalation per `DECISIONS_LOCKED.md` Q4 |
| `/api/internal/cron/health-digest` | daily 9am AEST | Send daily service-health digest to admins |
