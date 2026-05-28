# Mass Image Generation — Build Brief v3

**Programme:** Opollo Site Builder / Social Module — Mass-Production Image Generation
**Owner:** Steven Morey
**Author:** Drafted from recon at `docs/recon/mass-image-gen-recon.md`
**Status:** Ready for execution
**Path chosen:** Option B — complete Phase C + build mass-production in one programme
**Version:** v3 (operational-edge-case-corrected)

**Changes from v2:** five fixes from second technical audit — (1) signed URLs never persisted; storage paths only; sign on read. (2) Auto-attach writes media asset references, not URLs. (3) Job-vs-row semantics locked: budget and acceptance tests count jobs, not rows. (4) Redis concurrency counter uses TTL'd lease tokens with finally-block release. (5) DOCX parser uses explicit placeholder token detection, not italic-formatting heuristics.

**Changes from v1:** five fixes from first technical audit — aspect ratio mapping locked, route namespace unified, budget default raised, auto-attach committed for v1, parser schema specified as label-based.

---

## 0. What we know

The recon at `docs/recon/mass-image-gen-recon.md` is the ground truth. Read it before starting any slice. The headlines:

- **Phase C (I1–I5) has never run end-to-end in production.** Zero rows in `image_generation_log`. No regression risk. No data to migrate. Greenfield.
- **The Ideogram client has been wired wrong since I1 shipped.** The `model` value is the Replicate model slug, not the Ideogram API enum. Probe confirmed: 36 generations completed successfully end-to-end once the value was fixed.
- **Ideogram concurrency cap is ≥ 16** at ~11s per request. An N=16 batch fits in ~12s wall-time. This raises the QStash-fan-out threshold meaningfully.
- **`compositeImage()` has zero production callers.** The Bannerbear adapter, the text zone map, the logo placement contract all exist as code. No route or trigger invokes them.
- **The `generated-images` Supabase bucket does not exist.** It's referenced in code but never created in any migration or in the dashboard.
- **No production env wiring** for Bannerbear (API key, template UIDs), the mood-board flag, or compositing provider selection. Ideogram API key is present.
- **No XLS support anywhere.** `.docx` parser (`mammoth`) is installed but fenced to the page-builder briefs flow, not social.
- **No AI interpretation layer** that converts content documents into post + image-brief pairs. CAP generates inside-out from brand profile; it cannot ingest a brief.
- **No batch-generation surface** above N=6. No QStash handler for image-gen. No batch tracking table.

The complete 22-item gap list, scoring, and conflicts with locked BUILD.md decisions are in `docs/recon/mass-image-gen-recon.md` §5. Refer to it whenever a slice references a gap number.

---

## 1. Locked specifications

These are the contracts every slice must respect. No slice may invent its own values for any of these.

### 1.1 Platform → aspect ratio mapping

Ideogram v3 supports: `1x1`, `4x5`, `9x16`, `16x9`, `3x2`, `2x3`, `3x4`, `4x3`, `16x10`, `10x16`, `1x2`, `2x1`, `1x3`, `3x1`.

The platform mapping is fixed at:

| Platform | Ideogram aspect | Bannerbear template | Why |
|---|---|---|---|
| LinkedIn feed | `1x1` | `mass_gen_square` | LinkedIn renders 1:1 cleanly across feed and mobile |
| LinkedIn landscape (link cards) | `16x9` | `mass_gen_landscape` | Closest Ideogram value to LinkedIn's preferred 1.91:1 — LinkedIn crops; loss is minimal |
| Instagram feed | `4x5` | `mass_gen_portrait` | Native Instagram portrait, no crop |
| Instagram Story | `9x16` | `mass_gen_story` | Native Story dimensions |
| Facebook feed | `1x1` | `mass_gen_square` | Square renders consistently across desktop and mobile |
| Facebook Story | `9x16` | `mass_gen_story` | Same as Instagram Story |
| X / Twitter | `16x9` | `mass_gen_landscape` | Closest match to X's preferred 16:9 link-card and in-feed image ratio |
| GBP (Google Business Profile) | `4x3` | `mass_gen_landscape_43` | GBP recommends 4:3; supported natively |

**Note on `mass_gen_landscape_43`:** this is a fifth Bannerbear template. The build guide v1 specified four (1080×1080, 1080×1350, 1920×1080, 1080×1920). Add a fifth: **1440×1080** (a 4:3 landscape) for GBP. Update slice D1 accordingly.

**Note on LinkedIn/Facebook 1.91:1:** these platforms accept any ratio. Generating at 1:1 (square) is the v1 choice because it renders predictably across the mobile/desktop feed without platform-side cropping surprises. If client feedback shows the square feels narrow on landscape-feed contexts, we can revisit with a v1.1 slice.

**Per-row platform variations.** If a row's `target_platforms` includes multiple platforms with different aspect-ratio requirements (e.g. `linkedin, instagram, instagram_story`), the system generates **one image per distinct aspect ratio** (deduped) and attaches each to the relevant platform variant. Three Instagram platforms specifying `4x5`, `4x5`, `9x16` → two images generated, not three.

### 1.2 Route namespace

All image-generation routes live under the **image** product namespace, not **social**. The `/api/platform/social/cap/generate-image/route.ts` route exists for legacy reasons and stays where it is, but no new routes get added under `/social/` for this programme.

| Surface | Path |
|---|---|
| UI: ingestion entry point | `/company/image/ingest` |
| UI: batch results viewer | `/company/image/batches/[id]` |
| UI: batch history | `/company/image/batches` |
| UI: mood board (existing, gets compositing added) | `/company/image/generate` |
| API: single-image generation (existing) | `/api/platform/image/generate` |
| API: batch dispatch | `/api/platform/image/batch` |
| API: batch detail | `/api/platform/image/batch/[id]` |
| API: per-job approve / reject | `/api/platform/image/jobs/[id]/select` |
| API: ingestion (upload doc → AI interpret → batch dispatch) | `/api/platform/image/ingest` |
| API: QStash handler (internal) | `/api/internal/image/qstash-handler` |

**Slice C4 deliverable is at `/api/platform/image/ingest`, not `/api/platform/social/ingest`.** Any reference to the latter elsewhere in this brief is a v1 artefact; treat it as the former.

### 1.3 Budget cap

Default per-company monthly image-gen budget: **$20**. Per-image cost: ~$0.06 at standard quality. That allows ~330 images/month before the cap rejects.

- **Budget is per image job, not per source row.** See §1.7 — one row can produce multiple jobs if it targets multiple platforms with distinct aspect ratios.
- Operators see remaining budget and projected job count on the ingest page before submitting.
- Pre-flight check on `/api/platform/image/batch`: if `(projected_jobs × $0.06) > remaining_budget`, reject with a clear error including projected cost, projected job count, source row count, and remaining budget.
- Preview mode (slice B5) does not consume budget — preview rows skip Ideogram entirely.
- Operators with `manage_billing` permission can raise the cap from `/company/settings/billing` (out of scope for this programme; the UI surface goes on the backlog).
- Operator email when 80% of monthly budget consumed.

### 1.4 Document parser schema

Both parsers use a **label-based** schema, not a structural one. The parser walks the document looking for known labels, takes the next paragraph(s) as the value, and ignores anything it doesn't recognise.

**For .docx** — within each H1 section (one H1 = one post), the parser looks for H2 headings matching this allowlist (case-insensitive, whitespace-trimmed):

| H2 label | Required | Maps to |
|---|---|---|
| `Headline` | yes | `headline_text` |
| `Body` | yes | `body_text` (concatenates all paragraphs until next H2 or H1) |
| `Platforms` | yes | `target_platforms` (parsed as comma-separated) |
| `Style hint` or `Style` | no | `style_hint` |
| `Composition hint` or `Composition` | no | `composition_hint` |
| `Publish date` or `Date` | no | `publish_date` (YYYY-MM-DD) |
| `Notes` | no | `notes` |

The H1 itself becomes `post_topic`. Any H2 not in this allowlist is logged as a warning and ignored — the parser does not fail.

**For .xlsx** — column-header-based. The first row contains column names from this allowlist (case-insensitive, whitespace-trimmed):

| Column | Required |
|---|---|
| `post_topic` | yes |
| `headline_text` | yes |
| `body_text` | yes |
| `target_platforms` | yes |
| `style_hint` | no |
| `composition_hint` | no |
| `publish_date` | no |
| `notes` | no |

Missing required columns → parser rejects the whole file with a clear error. Extra columns → logged and ignored.

**Parser robustness contract** — both parsers must:
- Skip blank rows / empty H1 sections silently
- Reject the whole file if any required field is empty in any post (with row number / H1 number)
- Strip whitespace from all values
- Normalise platform codes to lowercase (`LinkedIn` → `linkedin`)
- Validate platform codes against the known set; unknown codes reject the row
- Validate style/composition hints against the enum; unknown values reject the row
- Validate `publish_date` as a real YYYY-MM-DD; malformed dates reject the row

### 1.5 Auto-attach behaviour

When an operator approves an image in the batch results viewer (slice D2, B4):

- If the originating row had a `publish_date`: the system writes the composited image URL to `social_post_drafts.media_urls` for that date's draft, and creates the draft if one doesn't exist (state = `scheduled`).
- If no `publish_date`: the image stays in `social_media_assets` for manual attachment from the composer.

The auto-attach path requires:
- A new column on `image_generation_jobs`: `target_publish_date` (date, nullable). Populated by C4 during ingestion.
- The approval handler (B4) checks this column on approval and triggers the attach.
- If a draft with that date already exists for the company, the new image is appended to `media_urls`; not replaced.
- Attach failures (FK violation, RLS rejection, etc.) do not block approval — they log an `attach_failed` event and the operator can attach manually.

This is v1 behaviour and is not optional — the XLS/Word templates promise it.

### 1.6 Signed URL and asset persistence rules

Signed URLs expire. They are never persisted to disk, never stored in any DB column, never written to any drafts table. Every URL the user sees is signed on read.

**Persistence rules:**

- Database columns store `storage_path` (the path inside the bucket) and an implicit or explicit `bucket` reference. Never a URL.
- The signed URL is created at the moment the API/UI needs it, with a short TTL (default 1 hour for UI display, fresh signing per render).
- `image_generation_jobs` has `result_storage_path` (text) only. **No `result_signed_url_path` column.** The v2 reference to this column is removed.
- `image_generation_log` has `output_storage_path` (text) only.
- `social_media_assets` already stores `storage_path` — this is the canonical pattern.

**For auto-attach (§1.5), the social_post_drafts.media_urls contract is replaced:**

Today, `social_post_drafts.media_urls` is a `text[]` of signed URLs. This was a v1 shortcut. For mass-image-gen, auto-attach writes **media asset references**, not URLs. Specifically:

- Auto-attach creates (or finds) a `social_media_assets` row for the composited image with `storage_path`, `mime_type`, `bytes`, `width`, `height`, `company_id`, `scope='company'`.
- The asset's UUID is appended to `social_post_drafts.media_asset_ids` (a new column added in B4's migration if it doesn't already exist; check `social_post_variant.media_asset_ids` for an existing pattern to mirror).
- `social_post_drafts.media_urls` is left untouched for the v1 path; the social publishing layer is updated to prefer `media_asset_ids` and sign at publish time.
- If the existing publishing code only knows how to read `media_urls`, slice B4 includes a small refactor to teach it `media_asset_ids` first, falling back to `media_urls` for legacy drafts.

**Why this matters:** signed URLs in `media_urls` start expiring 1 hour after generation. A draft scheduled for next Tuesday would publish a broken image. The asset-reference pattern signs fresh at the moment of publishing.

**Mood board "copy to clipboard" pattern:** the mood board pages have always copied signed URLs to the clipboard. That's fine — they're 1-hour disposable URLs for immediate paste-into-composer use. Don't change that. The rule is **don't persist signed URLs to the database**, not "don't ever give one to a user."

### 1.7 Job-vs-row semantics

A row in an uploaded XLS / .docx is a **post**. A post may produce **one or more image jobs** depending on platform targeting. Spec is clarified as:

- **Post** — a single row in the input doc. Conceptually one piece of social content.
- **Image job** — a single Ideogram generation + Bannerbear composite call, producing one image. Logged as one row in `image_generation_jobs`.

**Fan-out rule (replaces v2's loose "one image per distinct aspect ratio" wording):**

For each post, derive the set of distinct aspect ratios from its `target_platforms` via `MASS_GEN_PLATFORM_MAP`. Generate one image job per distinct ratio.

Examples:

| Post `target_platforms` | Distinct ratios | Image jobs |
|---|---|---|
| `linkedin` | `1x1` | 1 |
| `linkedin, facebook` | `1x1` (both square) | 1 |
| `linkedin, instagram, instagram_story` | `1x1`, `4x5`, `9x16` | 3 |
| `instagram, instagram_story` | `4x5`, `9x16` | 2 |
| `linkedin, x` | `1x1`, `16x9` | 2 |

**Budget accounting is on jobs, not rows.** Pre-flight check is `(total_jobs × $0.06) > remaining_budget`. A 30-row upload where every row targets all 5 platforms produces ~90 jobs and costs ~$5.40. The ingest UI shows projected job count and cost before submission.

**Auto-attach (§1.5) attaches each job's image to the platform variant(s) it was generated for.** A `linkedin, instagram` post's two jobs produce two images; the square image attaches to the LinkedIn variant of the draft, the 4x5 image attaches to the Instagram variant. This requires the draft model to support per-platform media — verify in slice C4 by checking `social_post_drafts.draft_data` JSONB shape; if it doesn't already, fall back to attaching only the first job per post for v1 and document the limitation.

**Batch tracking shape:**

- `image_generation_batches.total_jobs` = total image jobs across all rows (not row count).
- `image_generation_batches.completed_jobs` / `failed_jobs` = per-job counts.
- Optional: add `source_row_count` to the batches table for "30 posts → 90 images" UI display.

**UI grouping (D2):** the batch results viewer groups jobs under their parent post. Each post card shows N image thumbnails (one per ratio), each individually approvable/rejectable. Approving a post's three images results in three separate `image_selections` rows and three auto-attaches (one per platform variant).

---

## 2. The shape of the programme

Four work streams, sequenced. Each is a small number of PRs. Do not skip ahead — later streams depend on earlier ones being real.

| Stream | Goal | PRs | Approx Claude Code time |
|---|---|---|---|
| **A. Foundation fix-up** | Make Phase C actually work end-to-end. One client, one bucket, working model identifier, working compositing, working fallback. | 6 | ~2–3 days |
| **B. Mass-production infrastructure** | QStash fan-out, batch tracking, budget cap, approval/rejection + auto-attach, dry-run preview. | 5 | ~3–4 days |
| **C. Doc ingestion + AI interpretation** | XLS parser, `.docx` reuse with label-based extraction, LLM step that converts raw documents into structured post + image-brief pairs. New ingestion route that triggers per-row image generation through the batch infrastructure. | 4 | ~3–4 days |
| **D. Bannerbear setup + operator UX** | Bannerbear account, **five** template UIDs (one added for GBP 4:3), env wiring, operator surface to monitor/approve batches, mass-rerun capability. | 3 | ~2 days |

Total: roughly 18 PRs across 10–13 days of Claude Code time. Steven's review cycles and any Bannerbear dashboard work are on top of that.

---

## 3. Out of scope for v1

Decisions to defer deliberately, so they don't drag the build:

- **Premium routing (gap #12).** `selectModelTier` is dead because the underlying columns (`is_high_value`, `previous_rejection_count`) don't exist. Defer. Every call uses the standard model. If a future commercial driver requires premium routing, build it as a separate slice.
- **Multi-zone compositing (gap #22).** Bannerbear adapter takes only the first text zone. Single-zone is enough for v1 (headline at top, image fills frame, logo bottom-right). Multi-zone is a deferred enhancement.
- **Stock fallback re-implementation (gap #6 partial).** Do **not** create `image_stock_library`. Replace the dead stock-fallback path with a regenerate-with-simpler-prompt loop. If that also fails, escalate to operator email. No stock library is needed.
- **V1 CSV bulk (gap #19).** Target V2 only. V1 CSV bulk is in retirement.
- **Per-client visual templates beyond style_id.** The 5×5 style × composition matrix plus brand profile fields is sufficient. If clients later demand bespoke layouts, that's a v2 product slice (Bannerbear template per client or per template-pack), not part of this programme.
- **Billing-side budget management UI.** Operators can change the budget cap via direct DB write or admin tool for v1. A self-serve UI at `/company/settings/billing` is on the backlog.
- **LinkedIn 1.91:1 / Facebook 1.91:1 native ratios.** Square (`1x1`) is the v1 default for these platforms. Revisit if client feedback demands it.

---

## 4. Slices

Each slice below is a single PR unless explicitly broken into sub-PRs. Each is gated by a checkpoint where Claude Code must report findings, wait for approval, then proceed. Same discipline as the recon prompts.

### Stream A — Foundation fix-up

#### A1. Fix Ideogram model identifier and endpoint shape

**Goal:** make the canonical Ideogram client actually reach Ideogram's image backend.

**Decision (locked):** v3 endpoint. Change to `https://api.ideogram.ai/v1/ideogram-v3/generate`, multipart/form-data body, `rendering_speed: FLASH`, drop the `image_request` wrapper, update aspect ratio enum to v3 values per §1.1.

**Files:**
- `lib/image/generator/ideogram.ts` — URL, content-type, request body shape, model field replacement
- `lib/image/types.ts` — `AspectRatio` enum updated to v3 values (`1x1`, `4x5`, `9x16`, `16x9`, `4x3` per §1.1). Add `MASS_GEN_PLATFORM_MAP` constant exporting the platform → aspect ratio mapping from §1.1
- `.env.example` — model env var names and defaults
- `BUILD.md` — update §"Defaults (locked)" lines 324-325 to reflect new model identifiers

**Checkpoint:** PR includes one passing live-call test against Ideogram in dev (single image per supported aspect ratio in §1.1, marker rows in `image_generation_log` with `triggered_by='a1_verification'`). Steven reviews the output images visually before approving merge.

#### A2. Create `generated-images` Storage bucket via migration

**Goal:** make the bucket the code already writes to actually exist, reproducibly.

**Files:**
- `supabase/migrations/<next>_create_generated_images_bucket.sql`
  - `INSERT INTO storage.buckets (id, public, file_size_limit, allowed_mime_types)` with `public=false`, 10 MB limit, jpeg/png/webp allowlist
  - RLS policies matching the existing `social-media` bucket conventions (read: company members read their own company's path prefix; write: service role only)

**Checkpoint:** After migration runs in dev, generate one image via the route from A1 and confirm bucket write succeeds. PR includes the rollback step.

#### A3. Consolidate to a single Ideogram client

**Goal:** kill the three-parallel-clients problem.

**Changes:**
- Delete `lib/cap/pal/image-provider.ts` (orphaned, never wired)
- Refactor `app/api/platform/social/cap/generate-image/route.ts` to call `generateWithFallback` instead of inline fetch. Composer AI tab now goes through the canonical pipeline, gets quality checks, gets logged. **The route stays under `/social/` per §1.2 (legacy preservation); no new social routes are added for this programme.**
- Update tests

**Files:** roughly 4 files changed, 1 deleted.

**Checkpoint:** Confirm composer AI generations now produce `image_generation_log` rows. Grep confirms `fetch("https://api.ideogram.ai` only at the canonical client.

#### A4. Wire `compositeImage()` into the three consumers — Part 1: Mood board

**Goal:** the mood board UI returns composited images (background + logo + headline overlay), not raw Ideogram backgrounds.

**Decision (locked):** A4 mood board headline is user-supplied text input on the page. Default placeholder if blank: `Headline preview`.

**Changes:**
- `app/api/platform/image/generate/route.ts` — after `generateWithFallback`, for each result call `compositeImage()` with the brand's logo URL (fresh-signed) + text zone + first composition slot
- `components/MoodBoardClient.tsx` — add text input, send text in POST body
- Pick the right Bannerbear template UID per requested aspect ratio (use `MASS_GEN_PLATFORM_MAP` from A1)
- `lib/platform/brand/index.ts` — confirm `get_active_brand_profile` returns the logo URL fields (it does, no change needed)

**Checkpoint:** Steven views a mood-board result and confirms logo + text appear correctly on the image. Compositing duration logged. `image_generation_log` rows have `compositing_provider='bannerbear'`.

**Hard blocker before this slice runs:** D1 (Bannerbear account + **five** template UIDs + env vars) must be complete. If D1 isn't done, A4 cannot land.

#### A5. Wire `compositeImage()` into the three consumers — Part 2: CAP trigger

**Goal:** CAP-generated posts publish with composited images, not raw backgrounds.

**Changes:**
- `lib/platform/social/cap/image-trigger.ts` — after Ideogram returns the background, call `compositeImage()` with the brand logo + a headline derived from the post copy (first sentence, truncated to 80 chars for square / 120 for landscape)
- Drop the hard-coded `compositionType: "split_layout"` + `aspectRatio: "ASPECT_1_1"` — derive aspect ratio from `MASS_GEN_PLATFORM_MAP` based on the target platform on the draft
- Replace `void triggerCAPImageGen(...)` with a QStash dispatch (depends on B1)

**Hard blocker:** B1 (QStash handler) must be complete. Move A5 after B1 in execution order.

**Checkpoint:** CAP weekly cron runs in dev, produces a composited image, attaches it to a draft. Steven views the draft, confirms logo + text on the image.

#### A6. Replace dead stock fallback + wire escalation email

**Goal:** the failure handler does something useful when quality-check fails twice.

**Changes:**
- `lib/image/generator/stock.ts` — delete or replace the `image_stock_library` query with a "regenerate with simpler prompt" call (third attempt with maximum `simplify=true` and a different `style_id` from the brand's allowed list)
- `lib/image/failure/handler.ts` — replace the `logger.error` escalation with `dispatch('image_generation_failed', {...})` via `lib/platform/notifications/dispatch.ts`
- `supabase/migrations/<next>_add_image_generation_failed_event.sql` — add the new `NotificationEvent` enum value
- Email template at `emails/image-generation-failed.tsx`

**Checkpoint:** Trigger an intentional quality-check failure in dev (e.g., force a luminance miss), confirm regenerate happens, confirm operator email arrives.

### Stream B — Mass-production infrastructure

#### B1. QStash handler for single-image generation

**Goal:** any caller can enqueue "generate one image" as a QStash job, persistent across Vercel function termination.

**Changes:**
- `app/api/internal/image/qstash-handler/route.ts` — accepts `{batchId, jobId, generationParams, brand, options}`, calls `generateWithFallback` + `compositeImage`, persists result, marks the job complete
- Idempotency key on `(batchId, jobId)` — duplicate deliveries are no-ops at the DB layer
- Job state machine: `pending → running → completed | failed | escalated`. Transitions are atomic (single UPDATE WHERE state matches expected). No state goes backwards.
- Retry semantics: Ideogram or Bannerbear 429 / 5xx → re-enqueue with QStash native retry (30s delay, max 3 attempts matching social-publish pattern). 4xx other than 429 → fail-fast, no retry.
- Rate-limit check at start of handler: read current Ideogram-call concurrency from a Redis counter; if at cap, re-enqueue with 30s delay. Cap defaults to 12 (per §1.1 §A1 probe finding of 16, with buffer).
- **Redis lease design (concurrency tracking that survives crashes):**
  - Each in-flight Ideogram call holds a lease: `SET concurrency:ideogram:<jobId> 1 EX 90 NX`. TTL of 90 seconds is comfortably longer than worst-case wall time (Ideogram ~11s + Bannerbear polling ~30s + downloads ~10s = ~51s p99). If a worker crashes, the lease expires naturally; the slot is not leaked permanently.
  - Concurrency check is a `KEYS concurrency:ideogram:*` count (or a separate counter incremented with the SET; the counter approach is faster but needs a periodic reconciliation pass to catch drift).
  - Release: in a `finally` block, `DEL concurrency:ideogram:<jobId>`. Always runs even if Ideogram throws.
  - Reconciliation: a daily cron walks the keys, decrements the counter if it disagrees with the count. Documented as `app/api/cron/reconcile-image-concurrency/route.ts` — out of scope for B1 itself but on the backlog. For v1, the TTL alone is sufficient; the reconciliation cron is a belt-and-braces measure for long-running production.

**Checkpoint:** Enqueue one job from a test script, observe it complete, observe the audit-log row and the stored image. Run an idempotency test (deliver the same QStash message twice, confirm only one row written).

#### B2. Batch tracking table + dispatch endpoint

**Goal:** N images for one operator action are grouped, trackable, and resumable.

**Changes:**
- `supabase/migrations/<next>_create_image_generation_batches.sql`
  - `image_generation_batches` — `id`, `company_id`, `triggered_by`, `created_at`, `total_jobs`, `completed_jobs`, `failed_jobs`, `state` (`pending | running | completed | partial | failed`), `source_filename` (nullable, populated by C4), `source_row_count` (int, nullable — for "N posts → M images" display)
  - `image_generation_jobs` — `id`, `batch_id`, `state` (`pending | running | completed | failed | escalated`), `generation_params` jsonb, `target_publish_date` (date, nullable — for auto-attach per §1.5), `target_platforms` jsonb (array of platform codes), `parent_post_index` (int, nullable — which row of the source doc this job is from, for UI grouping per §1.7), `result_storage_path` (text, nullable — points into the `generated-images` bucket; **no signed URL stored — sign on read per §1.6**), `error_class`, `error_detail`, `created_at`, `started_at`, `completed_at`
  - RLS on both
- `app/api/platform/image/batch/route.ts` (POST) — accepts a list of generation specs, creates the batch + jobs, enqueues N QStash messages (one per job), returns `batchId`
- `app/api/platform/image/batch/[id]/route.ts` (GET) — returns batch state + job results. Signs result URLs fresh on read.
- Concurrency-aware throttling: enforce `BATCH_CONCURRENCY_CAP` (default 12, env-configurable). Batch dispatch enqueues all jobs to QStash, but the QStash handler self-throttles via the Redis counter (per B1).

**Checkpoint:** Dispatch a batch of 20 from a test script, watch it complete, query the batch endpoint and see all 20 results.

#### B3. Per-company image-gen budget cap

**Goal:** an unbounded upload cannot accidentally cost an unbounded amount. **Budget is measured in image jobs, not source rows (per §1.7).**

**Changes:**
- `lib/image/budget.ts` — `check_image_gen_budget(companyId, projectedJobCount)` returns `{ allowed: boolean, remaining_cents, projected_cents }`
- Migration adds `monthly_image_gen_budget_cents` column to `platform_companies` (**default 2000 = $20/month per §1.3**)
- Migration adds `image_gen_spend` table: `company_id`, `month` (date, first of month), `spend_cents` — incremented per successful generation, never per preview
- `app/api/platform/image/batch/route.ts` — pre-flight check: `projectedJobCount = sum of distinct aspect ratios across all rows` (per §1.7); reject if `(projectedJobCount × 6 cents) > remaining_cents`. Error response includes projected cost, projected job count, source row count, remaining budget, and `next_reset_at` so the UI can render a clear message ("30 posts × ~3 platforms each ≈ 90 images. Projected $5.40. Remaining $3.00.").
- `app/api/internal/image/qstash-handler/route.ts` — per-call increment of spend on successful completion (not on preview, not on failure)
- Operator email when 80% of budget consumed in a month

**Checkpoint:** Set test company's budget to $0.50, upload a doc with 10 rows where each row targets 3 platforms with distinct ratios (= 30 jobs), confirm rejection with error "30 images projected, $1.80 cost, $0.50 remaining." Set budget to $20, run same upload, confirm acceptance and spend ticks up correctly per completed job (not per row).

#### B4. Approval / rejection signal + auto-attach

**Goal:** when an operator picks one of N batch results, that selection is recorded; if the job has a `target_publish_date`, the image auto-attaches to a scheduled draft per §1.5. **Attachment writes asset references, not URLs (per §1.6).**

**Changes:**
- `supabase/migrations/<next>_add_image_selections_and_attach.sql`
  - `image_selections` table: `id`, `job_id`, `selected` boolean, `selected_by`, `selected_at`, `rejection_reason` text nullable
  - Add `auto_attached_draft_id` (uuid, nullable, FK to `social_post_drafts`) and `auto_attach_state` (enum: `not_applicable | pending | attached | attach_failed`) to `image_generation_jobs`
  - Add `media_asset_ids` (uuid[], default `{}`) to `social_post_drafts` **only if it doesn't already exist** — first verify against the current `social_post_drafts` schema. The pattern mirrors `social_post_variant.media_asset_ids`. Migration is conditional.
- `app/api/platform/image/jobs/[id]/select/route.ts` (POST for approve, PATCH for reject)
  - On approve: create `image_selections` row; if `target_publish_date` is non-null, kick the auto-attach
- `lib/image/auto-attach.ts` — handles the attach logic per §1.6:
  - **Step 1: Create a `social_media_assets` row** for the composited image with `storage_path` = the job's `result_storage_path`, `mime_type`, `bytes`, `width`, `height`, `company_id`, `scope='company'`, `uploaded_by` = the approving operator's user id. The asset gets a UUID.
  - **Step 2:** Look up or create a `social_post_drafts` row for `(company_id, publish_date)` with `state='scheduled'`.
  - **Step 3:** Append the new asset's UUID to `media_asset_ids`. **Do not write to `media_urls`.** Signed URLs are produced at publish time.
  - **Step 4:** Update `image_generation_jobs.auto_attach_state` to `attached` (or `attach_failed` with the error)
  - All errors logged, none block the approval — selection still succeeds
- **Publish-layer refactor (small):** the social publishing code currently reads `media_urls` to attach images. Update it to read `media_asset_ids` first (sign URLs at that moment via `getServiceRoleClient().storage.from(bucket).createSignedUrl(path, 3600)`), falling back to `media_urls` for legacy drafts that don't have asset IDs. This refactor lives in this slice because it's a pre-requisite for auto-attach to work end-to-end.
- Wire from the batch-result UI (D2)

**Checkpoint:** UI smoke test: select an image with a publish date, query `social_post_drafts` and confirm the row exists with the new asset UUID in `media_asset_ids` (not a signed URL in `media_urls`). Verify `social_media_assets` row exists with the correct `storage_path`. Select an image without a publish date, confirm `auto_attach_state='not_applicable'`. Trigger an intentional FK violation, confirm `auto_attach_state='attach_failed'` and the approval still succeeded. Run publish on the draft, confirm a fresh signed URL is generated at publish time.

#### B5. Dry-run / preview mode

**Goal:** an operator can ask the system "if I ran this batch, what would the prompts look like?" without spending real Ideogram credits.

**Changes:**
- `lib/image/generator/ideogram.ts` — accept `previewOnly: true` option; return synthetic placeholder + the prompt that would have been sent. **Never calls Ideogram in preview mode.**
- Batch dispatch endpoint accepts `mode: 'preview' | 'generate'`
- Preview jobs do not increment spend (per B3)
- Preview rows go to `image_generation_log` with `outcome='preview'` (new enum value, migration required)
- Preview jobs still write to `image_generation_jobs` with `state='completed'` and `result_storage_path=null`; the UI shows the prompt text instead of an image thumbnail

**Checkpoint:** Run a 10-row preview batch, confirm no Ideogram calls were made (`image_generation_log.outcome='preview'`, zero `success` rows), confirm prompts visible in UI, confirm no spend increment.

### Stream C — Doc ingestion + AI interpretation

#### C1. XLS parser

**Goal:** accept `.xlsx` uploads, parse them into rows per §1.4, expose them to the ingestion pipeline.

**Changes:**
- Add `xlsx` (SheetJS) to `package.json`
- `lib/ingestion/xlsx-parse.ts` — reads multipart file, parses first sheet, validates against the schema in §1.4
- Tests with fixture files (good case, missing required column, malformed dates, multi-sheet, blank rows, unknown column ignored)
- Strict adherence to §1.4 parser robustness contract

**Checkpoint:** Parse the official template at `docs/templates/mass-image-gen-template.xlsx`, output 3 structured rows. Then parse a malformed copy with a missing `headline_text` column and confirm clear rejection.

#### C2. `.docx` parser for social ingestion

**Goal:** accept `.docx` uploads, extract structured content using the **label-based** schema in §1.4.

**Changes:**
- `lib/ingestion/docx-parse.ts` — reuses `mammoth` (already installed for page-builder)
- **Label-based parser** (per §1.4): walks the doc, finds each H1 (one H1 = one post = `post_topic`), then within each H1's range looks for H2 headings matching the allowlist (case-insensitive, trimmed). Maps each found H2 to its column. Takes the next paragraph(s) up to the next H2 or H1 as the value.
- **Instructional / placeholder text filtering — explicit, not heuristic:**
  - The template uses placeholder text wrapped in square brackets, e.g. `[Your image headline here]`, `[platforms]`, `[YYYY-MM-DD or blank]`. The parser strips any paragraph that **starts with `[` and ends with `]`** with no other content. Whitespace tolerant.
  - The template also includes hint paragraphs immediately after each H2 (e.g. "Text that appears on the image. Under 80 chars for square, 120 for landscape."). The parser maintains a **known-hint allowlist**: a hard-coded set of exact strings that appear in the template's hint paragraphs. Any paragraph matching one of these is stripped. If the operator deletes the hint text (recommended), nothing breaks. If they leave it in, it's filtered.
  - The italic-formatting heuristic from v2 is **not used** — it's brittle across editors (Google Docs export, Word's copy-paste from web, etc.).
  - The allowlist must be regenerated whenever the .docx template changes. Slice C2 ships with a unit test that asserts every hint paragraph in `docs/templates/mass-image-gen-template.docx` is in the allowlist.
- Tests with `docs/templates/mass-image-gen-template.docx` as the canonical fixture, plus malformed variants. Add a test that runs the official template through the parser and confirms the 3 worked examples come out with no hint-paragraph contamination.

**Checkpoint:** Parse the official template, output 3 structured posts matching the 3 worked examples. Then parse a copy with a missing `Body` H2 in one post and confirm clear rejection naming the post.

#### C3. AI interpretation layer

**Goal:** an LLM call converts the parsed rows into the structured `{ post_text, image_brief }` shape that the batch endpoint expects. The image brief is a tuple of `{ style_id, composition_type, primary_colour, headline_text, aspect_ratios[], target_platforms[] }` — all values constrained to the existing enum sets per BUILD.md "parameterised prompts only" rule.

**Changes:**
- `lib/ingestion/interpret.ts` — Anthropic call (claude-sonnet-4-6, same model as CAP) with a structured-output prompt that returns JSON conforming to a Zod schema
- The interpretation respects the brand profile: only picks `style_id` values in `approved_style_ids`, respects `safe_mode`, uses brand `primary_colour` unless content explicitly suggests otherwise. If the row has `style_hint` set, honour it. If unset, AI picks.
- For each row, derive `aspect_ratios[]` from `target_platforms[]` using `MASS_GEN_PLATFORM_MAP` (from A1), deduped.
- Headline text: if the row has `headline_text` set, use it verbatim (truncated to template max length). If not set (shouldn't happen since it's required, but defensive), AI generates from `body_text`.
- Per-call cost cap (reuse `lib/cap/cost-cap.ts` pattern)

**Checkpoint:** Feed the official template's 3 parsed posts through the interpreter, review the output JSON, confirm style/composition picks are sensible, confirm aspect ratios match §1.1.

#### C4. New ingestion route + batch dispatch wiring

**Goal:** end-to-end: upload XLS or `.docx` → parser → AI interpretation → batch dispatch → batchId returned.

**Changes:**
- `app/api/platform/image/ingest/route.ts` — POST multipart, content-type-routes to C1 or C2 depending on file type, calls C3, then dispatches to B2's batch endpoint
- Populates `image_generation_jobs.target_publish_date` and `target_platforms` per row, for B4's auto-attach to consume
- Returns batchId for the operator to monitor
- 100-row cap, file size cap (5 MB), per-company rate limit (5/hour, reuse the existing CSV limiter)
- Supports `?mode=preview|generate` query param routed through to B5

**Checkpoint:** Upload `docs/templates/mass-image-gen-template.xlsx` via test, confirm end-to-end flow produces 3 composited images. Run preview mode, confirm 3 prompt-only rows.

### Stream D — Bannerbear setup + operator UX

#### D1. Bannerbear account, templates, env vars

**Not a Claude Code task — Steven dashboard work.**

- Create Bannerbear account (if not done)
- Create **five** templates per the per-platform aspect-ratio mapping in §1.1:
  - `mass_gen_square` 1080×1080
  - `mass_gen_portrait` 1080×1350
  - `mass_gen_landscape` 1920×1080
  - `mass_gen_landscape_43` 1440×1080 (**new — for GBP per §1.1**)
  - `mass_gen_story` 1080×1920
- Each needs: background image slot (`background_image` layer), text zone (`headline` layer) with overlay, logo zone (`logo` layer) in bottom-right
- Capture template UIDs
- Add to Vercel production env: `BANNERBEAR_API_KEY`, **five** `BANNERBEAR_TEMPLATE_*` UIDs (including the new `BANNERBEAR_TEMPLATE_1440x1080`), `COMPOSITING_PROVIDER=bannerbear`, `IMAGE_FEATURE_MOOD_BOARD=true`

**Hard blocker for A4 and A5.** This is the single Steven task on the critical path.

#### D2. Batch results viewer

**Goal:** operator can monitor an in-flight batch, see results as they arrive, approve or reject each. Approval auto-attaches per §1.5.

**Changes:**
- `app/(platform)/company/image/batches/[id]/page.tsx` — server component, polls batch status every 3 seconds while `state='running'`
- `components/BatchResultsClient.tsx` — grid of result cards, accept/reject buttons, regenerate button, download-all button
- Each card displays: thumbnail, headline text, target platforms, aspect ratio used, auto-attach state badge (`Not scheduled | Will attach to <date> on approval | Attached to <date> | Attach failed`)
- Calls B4 endpoints

**Checkpoint:** Run a 20-image batch with mixed publish dates, watch it complete in UI, accept 15, reject 5, confirm 15 selections recorded, confirm auto-attaches happen for jobs with publish dates.

#### D3. Ingestion UI + history

**Goal:** the file-upload entry point and a history of past batches.

**Changes:**
- `app/(platform)/company/image/ingest/page.tsx` — drop zone for XLS/`.docx`, template download links pointing at `docs/templates/`, preview-vs-generate toggle, remaining-budget display
- `app/(platform)/company/image/batches/page.tsx` — list of past batches with state badges, links to results viewer
- Nav entry under Social → Bulk Image Generation

**Checkpoint:** Steven walks through upload → preview → generate → review → approve → confirm auto-attach end-to-end.

---

## 5. Acceptance tests (must pass before declaring programme complete)

These are the gates. Each is a real test executed against staging or dev. The programme is **not done** until all pass.

1. **30-post preview (single platform).** Upload an XLS with 30 rows, each row targeting only `linkedin`. Expect 30 image jobs (one ratio each). Run in preview mode. All 30 prompts visible in UI, zero Ideogram calls made, zero spend incremented, completes in under 30 seconds.
2. **30-post generate (single platform).** Same file, generate mode. All 30 jobs complete within 90 seconds. All 30 results have logo + text composited. `image_generation_log` shows 30 success rows. Spend = $1.80.
3. **30-post generate (multi-platform fan-out per §1.7).** Upload an XLS with 30 rows, each row targeting `linkedin, instagram, instagram_story` (= 3 distinct ratios). Expect 90 image jobs. All complete within 3 minutes. Total spend = $5.40. UI groups results into 30 post cards, each with 3 thumbnails.
4. **Budget rejection (job-counted per §1.3).** Company with `monthly_image_gen_budget_cents=300` ($3) uploads an XLS with 10 rows targeting 3 platforms each (= 30 jobs projected). Pre-flight rejects with error "30 images projected (10 posts × 3 platforms), $1.80 cost, $3.00 budget but $X.XX already spent. Resets <date>." Zero Ideogram calls made.
5. **Retry on Ideogram 429.** Force a 429 from Ideogram (mock or rate-limit). Job re-enqueues, succeeds on retry. `image_generation_log` shows `retry_count=1, outcome='retry_success'`.
6. **Escalation on double failure.** Force two quality-check failures. Third attempt (regenerate with simpler prompt) runs. If still failing, operator email arrives. Job state = `escalated`.
7. **Malformed DOCX rejection.** Upload a `.docx` with no H1 headings. Parser rejects with clear error. No batch created.
8. **Malformed XLSX rejection.** Upload a `.xlsx` with `headline_text` column missing. Parser rejects with clear error. No batch created.
9. **DOCX template instructional-text filtering.** Upload `docs/templates/mass-image-gen-template.docx` with its 3 worked examples. Parser produces 3 clean posts with no hint paragraphs or `[bracket placeholders]` in the values. Test the same template with one of the hint paragraphs manually edited; parser still produces clean output for the others.
10. **Auto-attach end-to-end via asset reference (per §1.6).** Upload, approve an image with `publish_date='2026-06-15'`. Query `social_post_drafts WHERE publish_date='2026-06-15' AND company_id=X`. Confirm `media_asset_ids` contains the new asset UUID. Confirm `social_media_assets` has a row with `storage_path` matching the job's output. Confirm `media_urls` is **not** populated with a signed URL. `image_generation_jobs.auto_attach_state='attached'`.
11. **Publish-time URL freshness.** Take the auto-attached draft from test 10. Wait 2 hours (or fast-forward via test fixture). Trigger publish. Confirm the publishing layer signs a fresh URL at publish time and the publish succeeds. (This proves the "don't persist URLs" rule actually works end-to-end.)
12. **Approval without publish_date.** Approve an image with no publish date. `auto_attach_state='not_applicable'`. No draft created. Image visible in composer Library tab for manual attach.
13. **Multi-aspect-ratio fan-out attach.** A row with `target_platforms='linkedin, instagram, instagram_story'` produces three image jobs. On approve-all, three `social_media_assets` rows exist; the LinkedIn variant has the 1x1 asset attached, Instagram has the 4x5, Story has the 9x16. If the platform-variant model doesn't yet support this (per §1.7), the test instead asserts that the first job's asset attaches to the draft and the others are visible in the Library tab for manual use, with a clear UI message about the limitation.
14. **Redis lease release on crash (per B1).** Simulate a worker crash mid-Ideogram-call (kill the process). After 90 seconds, confirm the Redis lease key has expired and the concurrency counter has not permanently lost a slot. Run a follow-up batch and confirm it processes without artificial throttling.

---

## 6. Sequencing constraints

Strict ordering rules. Violations break things:

1. **A1 → A2 → A3** before anything else. The Ideogram client must actually work, the bucket must exist, the three-clients problem must be resolved. These are foundational.
2. **D1 (Bannerbear setup) must complete before A4 or A5.** Without templates and env vars, compositing throws.
3. **B1 (QStash handler) must complete before A5.** A5 changes CAP from fire-and-forget to QStash dispatch.
4. **B2 (batch dispatch) must complete before C4.** C4 dispatches into B2's infrastructure.
5. **B4 (auto-attach) must complete before D2.** D2's UI displays the auto-attach state badges.
6. **C1, C2, C3 can be parallel-built but C4 lands last** because it ties them together.
7. **D2 and D3 are last.** They consume everything below.

**Recommended order for Claude Code:**
A1 → A2 → A3 → (Steven does D1 in parallel) → B1 → A4 → A5 → A6 → B2 → B3 → B4 → B5 → C1 → C2 → C3 → C4 → D2 → D3

---

## 7. Standing rules for every slice

These apply to every PR in the programme. Claude Code must respect them.

- **Single PR per logical change.** No multi-slice PRs.
- **Investigation-first.** Before writing code, confirm assumptions against the recon document or by reading current code. State assumptions in the PR description.
- **No production code outside the slice scope.** If a slice surfaces an unrelated bug, log it under a follow-up — don't fix it in the same PR.
- **Read the relevant skill before touching the layer.** `lib/image/**` → image-generation skill. `lib/platform/brand/**` → platform-brand-governance skill. `lib/social/**` → n-series-layer-rules skill.
- **Every generation writes to `image_generation_log`.** No exceptions, no bypasses. Composer AI tab, CAP, mood board, batch handler, previews — all log.
- **All file outputs go inside the repo.** `docs/`, `lib/`, `app/`, `supabase/migrations/`, `scripts/`. Never `/tmp`, never the Desktop, never outside the project.
- **Tests for every new module.** Unit tests at minimum. Integration tests for any route that touches Ideogram or Bannerbear. Acceptance test for the slice from §5 if listed.
- **No `console.log`.** Use `lib/logger`.
- **No direct UPDATE on `platform_brand_profiles`.** Always `update_brand_profile()` RPC.
- **Cost-conscious.** Every Ideogram call costs money. Don't generate in tests if a fixture works. Mark all probe / test generations with `triggered_by='<slice_id>_<purpose>'` so they're filterable.
- **Respect §1 locked specifications.** No slice may invent its own aspect ratios, route paths, budget values, parser schema, or attach behaviour.

---

## 8. How to start

1. **Steven:** start D1 (Bannerbear account, **five** templates per §1.1, env vars). Half a day of dashboard work. This is the only thing blocking parallel Claude Code work.
2. **Claude Code:** start A1 (Ideogram model identifier fix). Hand it this brief plus the recon, point it at the slice description, let it run with the standard checkpoint discipline.
3. When A1 lands, proceed to A2, then A3. Each is a single PR with a clear checkpoint.
4. By the time A3 is done, D1 should be complete on Steven's side, and Claude Code can proceed to B1 → A4 → A5 → A6.

If at any point a slice surfaces a contradiction with this brief or the recon, **stop and flag it.** The recon was thorough but not exhaustive — corrections are expected, and a slice that fights the spec is more useful as a flag than as a forced merge.

---

## 9. v1.1 backlog — deferred template variety

After v1 ships, the following template enhancements were identified from real client examples (Blackbird IT, Cybersecure) and deferred. Do not implement in v1. Revisit after v1 is in production with at least 4 weeks of real client output.

1. **CTA button as a fourth Bannerbear layer.** Pill-shaped call-to-action button with configurable text and icon. Example: "Shop Now →", "Book now →". Requires brand profile to gain a `cta_text` (per-post) field and template UID per CTA style.
2. **Two-zone headline (multi-zone compositing).** Headline with highlighted phrase — e.g. white text + lime-highlighted phrase on next line. This was gap #22 in the recon. Requires Bannerbear template with second text layer + composite call to pass both zones.
3. **Per-client template selection.** Cybersecure's split-photo-with-colour-block layout is fundamentally different from Blackbird's full-bleed-with-overlay layout. Both need to coexist. Requires:
   - `brand_profile.template_pack` field (enum: `default`, `split_photo`, `full_bleed_overlay`, etc.)
   - Bannerbear templates per pack per ratio (5 ratios × N packs)
   - Compositing layer reads pack from brand profile, picks template UID accordingly
4. **Configurable logo position.** Bottom-right is the v1 default. Some brands (Cybersecure) anchor top-right/top-left; some (Blackbird image 6) put logo top-centre. Requires `brand_profile.logo_position` field with enum and corresponding Bannerbear template variants.
5. **Subhead / supporting copy layer.** A smaller text line below the main headline (e.g. "Tech-driven in harmony, simplifies life"). New `subhead` Bannerbear layer + per-post `subhead_text` field.
6. **Photo style support — illustrated vs photographic.** Cybersecure image 10 uses an illustrated background instead of photographic. Requires either an Ideogram style addition (`style_id='illustrated'`) or a Bannerbear-side illustration-asset library.

These six items together would constitute a v1.1 release worth 1.5–2 weeks of focused work after v1 stabilises. Reference examples live in `docs/briefs/image-generator/reference-examples/` (Blackbird IT + Cybersecure samples) — copy them into the repo before v1.1 scoping begins.
