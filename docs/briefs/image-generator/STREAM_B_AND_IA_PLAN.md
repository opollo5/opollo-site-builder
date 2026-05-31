# Stream B + Information Architecture Plan
## Image Generation — Client Scoping, Engine Placement, Bulk Flow, Output Paths

**Status:** Investigation complete. Awaiting approval before build begins.  
**Investigator:** Tab 3 (v2 editor session)  
**Date:** 2026-06-01

---

## 1. Existing Client-Scoping Model (How the Platform Works Today)

### 1.1 Session and company context

`getCurrentPlatformSession()` (`lib/platform/auth/current-user.ts`) returns:

```typescript
PlatformSession = {
  userId: string;
  email: string;
  isOpolloStaff: boolean;
  company: { companyId: string; role: CompanyRole } | null;
}
```

`company` is the **only** channel through which a company context flows through the platform. Every page, layout, and API route reads `session.company.companyId`. There is no second mechanism.

**V1 constraint** (hardcoded in the DB schema): `UNIQUE(user_id)` on `platform_company_users`. A client user belongs to exactly one company. `session.company` is always unambiguous for client users.

### 1.2 How Opollo staff "act as" a client

The platform has a clean cookie-based impersonation mechanism, fully implemented:

1. **Company switcher** (`components/nav/company-selector.tsx`): renders only when `isOpolloStaff=true`. Staff pick a client company from a dropdown of all companies.
2. **Switch route** (`app/api/platform/companies/switch/route.ts`): POST validates staff status + company existence, then sets an httpOnly cookie `opollo_selected_company_id` (1-week TTL).
3. **Session resolver** (`resolveStaffCookieCompany()` in `current-user.ts`): when `isOpolloStaff=true`, reads this cookie and synthesises a `{ companyId, role: "admin" }` membership, **overriding** any natural membership. The staff member retains `isOpolloStaff: true`.

The result: once a staff member selects a client, their `session.company.companyId` is set to that client's ID. All downstream code — pages, API routes, DB queries — then operates identically to a native client user of that company. There is **no explicit `actingAs` flag** in the session; the context is indistinguishable from a real client session except for the `isOpolloStaff: true` flag that remains.

### 1.3 The permission bypass

`canDo(companyId, action)` (`lib/platform/auth/index.ts` line 40):

```typescript
if (await isOpolloStaff(client)) return true;   // unconditional bypass
return hasCompanyRole(companyId, minRoleFor(action), client);
```

Staff pass all permission checks regardless of role. This means a staff member with a selected client company has full `admin` access to that company without needing a real membership row.

### 1.4 How existing features scope to a company

**Pattern** (confirmed from social posts, image batches, template routes):

**Server pages:** `session.company.companyId` → guard + query filter  
**API routes:** caller supplies `company_id` in request body or query → `requireCanDoForApi(companyId, action)` validates + returns `{ userId }` for audit logging → all DB queries use that `companyId` as an explicit filter

Neither form has implicit company resolution. The caller always supplies the `company_id`; the platform validates it against the current user's permissions. This is the correct pattern for Stream B to follow.

### 1.5 What this means for Stream B

**Both "admin in client context" and "client self-service" use the exact same routes.** The company switcher sets the context upstream; every downstream route just reads `session.company.companyId`. Stream B needs no new "admin vs client" branching — one set of routes, scoped by `company_id`, works for both.

---

## 2. Stream B Engine — Where It Lives and How It's Invoked

### 2.1 The engine already exists

The rendering engine for Stream B is fully built:

| What | Where | Status |
|------|-------|--------|
| Template field metadata | `GET /api/platform/image/templates/:id/fields` | ✅ Task 1 done |
| Apply modifications to layers | `applyModifications(layers, mods)` — `lib/image/compositing/layer-renderer.ts` | ✅ E9 done |
| Apply variant (multi-format) | `applyVariant(template, variant)` — `lib/image/variant-utils.ts` | ✅ Phase A done |
| Render template to PNG | `renderTemplate({ template, modifications, variantKey })` | ✅ E7 done |
| Upload + return storage path | `compositeLayerBased(input)` via `compositeImage()` | ✅ E8 done |

The full chain: `template + modifications + variantKey → renderTemplate() → compositeLayerBased() → Supabase Storage path`.

### 2.2 Where the engine is invoked

The existing QStash pipeline invokes `generateWithFallback()` (Ideogram) + `compositeImage()` (headline overlay). For Stream B (template-driven generation instead of Ideogram), the same QStash pipeline is the right vehicle — with a modified handler path for template jobs.

**Proposed:** a new `templateJobType` discriminator in the job payload. When `jobType === "template"`, the handler calls `renderTemplate()` + `compositeLayerBased()` instead of Ideogram. The concurrency cap, Redis lease, budget tracking, and job state machine (`pending → running → completed/failed`) are identical.

### 2.3 Company scoping in the engine

Every generated image must be tagged to a company:
- `image_generation_jobs.company_id` is already a non-null FK
- `compositeLayerBased()` writes to `generated-images/{companyId}/...` path in Supabase Storage
- The QStash handler already receives `companyId` via the job record

**No new scoping work is required.** The schema and storage conventions already enforce company isolation.

### 2.4 The `/fields` contract (Stream B1)

`GET /api/platform/image/templates/:id/fields?company_id=<uuid>` returns:

```typescript
{ ok: true, fields: TemplateField[] }
// where TemplateField = { name: string; type: V1LayerType; var: VarMetadata }
// and VarMetadata = { label, required, default, category, help }
```

This is what B1 reads to auto-build form inputs. The `name` field is the modification key (`modification.name === layer.name`). The social composer can iterate `fields`, build an input per field, and map user values to `Modification[]` for render time.

### 2.5 Modification → render flow (Stream B2/B3)

```
/fields → TemplateField[] → user fills form → Modification[]
→ renderTemplate({ template, modifications, variantKey })
→ compositeLayerBased({ template, modifications, variantKey, outputStoragePath })
→ image_generation_jobs row (completed, result_storage_path)
```

The variant key maps from target platform (B3): `"square"` for IG/FB/LI, `"landscape"` for LI/FB/X. The `applyVariant()` reflow + modifications resolution already handles this correctly.

---

## 3. Bulk Flow Architecture

### 3.1 What already exists (reuse, don't reinvent)

The full bulk pipeline for Ideogram-based generation is live:

| Component | Location | What it does |
|-----------|----------|--------------|
| XLSX/DOCX parser | `lib/ingestion/xlsx-parse.ts`, `docx-parse.ts` | File → `PostRow[]` |
| C3 Interpreter | (under `lib/ingestion/`) | `PostRow[]` → `InterpretedPost[]` (style, colour, platforms) |
| Fan-out | `lib/image/fan-out.ts` `fanOutJobs()` | `InterpretedPost[]` → `DispatchJobSpec[]` (one per post × ratio) |
| Batch dispatch | `lib/image/dispatch.ts` `dispatchImageBatch()` | Budget check → batch row → job rows → QStash enqueue |
| QStash handler | `app/api/internal/image/qstash-handler/route.ts` | Concurrency cap, lease, Ideogram call, composite, job complete |
| Ingest API | `app/api/platform/image/ingest/route.ts` | Multipart upload → C1–C4 pipeline |
| Ingest UI | `app/(platform)/company/image/ingest/` | File drop + submit |
| Batch list/detail | `app/(platform)/company/image/batches/` | View results, signed URLs |

Stream B's bulk flow is the same pipeline with one substitution: instead of the C3 interpreter mapping posts to Ideogram parameters, it maps spreadsheet rows to **template field values** (modifications).

### 3.2 The Stream B bulk flow end-to-end

```
Spreadsheet (rows: content per layer, optional date, target platforms)
    ↓
Parser (reuse existing XLSX/DOCX parsers — same file format)
    ↓
Template column mapper (new: maps column headers → TemplateField.name)
    ↓
Per-row fan-out (one job per row × variant — square/landscape per platform set)
    ↓
dispatchImageBatch() (reuse exactly, same budget + job tracking)
    ↓
QStash handler (new branch: if jobType==="template" → renderTemplate() + compositeLayerBased())
    ↓
image_generation_jobs.result_storage_path
    ↓
Batch results UI (reuse exactly — already shows thumbnails, signed URLs)
    ↓
DOWNLOAD (zip, or per-image) — new output action
SOCIAL POSTER STUB (if dates present → date-tagged for future handoff)
```

### 3.3 Spreadsheet column → template field mapping

The `/fields` response gives `{ name, label, var: { category, help } }` per field. The spreadsheet mapper needs to match column headers to field names. Two strategies:

**Option A (exact match):** Spreadsheet column header must match `layer.name` exactly (e.g., column "headline" maps to `modification.name = "headline"`). Simple, no ambiguity.

**Option B (label match):** Column header matches `layer.var.label` (e.g., "Episode Title" maps to the layer labelled "Episode Title"). More user-friendly but requires a reverse lookup.

**Recommendation:** Support both. Try exact `name` match first; fall back to `label` match. Warn (but don't fail) on unmatched columns. Missing required fields (`var.required = true`) with no spreadsheet column → validation error before dispatch.

### 3.4 Dates are optional (as required)

The existing schema already handles this correctly:

- `image_generation_jobs.target_publish_date DATE` — nullable, explicitly optional
- `fan-out.ts` already accepts `publishDateBySourceRow: Map<number, string> = new Map()` (default empty = no dates)
- Jobs without a date are generated, stored, and available for download with no date metadata

**No changes needed to the date handling.** If the spreadsheet has a date column, parse it and pass it through. If not, pass an empty map. The downstream pipeline is already date-optional.

**Date format tolerance:** Accept ISO-8601 (`2026-06-15`), common locale formats (`15/06/2026`, `Jun 15 2026`), and relative terms (`next Monday`) where practical. Validate and normalise to ISO-8601 before storing. Invalid/unparseable dates → warning, not error (treat as no date).

### 3.5 Same flow in both contexts (admin-central and client-self-service)

**The flow is identical.** Both surfaces call the same API routes with the same auth pattern. The only difference is which `company_id` is passed:

| Context | How `company_id` is set |
|---------|------------------------|
| Client self-service (company portal) | `session.company.companyId` from their own membership |
| Opollo admin acting as client | Same: `session.company.companyId` from the cookie-selected company |

**Recommended surface placement:**

- **Client portal:** Already exists at `/company/image/ingest` and `/company/image/batches`. Extend these pages for template-based generation (add a "Generate from template" mode alongside the existing Ideogram mode, or merge into one unified ingest flow).
- **Admin-central (optional, later):** If Opollo staff need to operate without selecting a company first (e.g., bulk-generate for multiple clients at once), a separate admin route at `/admin/image/bulk/` can call the same ingest API with an explicit `company_id` per row. This is a future concern — do not build now.

**Action:** For launch, one unified surface in the company portal. Admin uses the company switcher to set context, then uses the same portal. No admin-specific route needed until there's a clear requirement for cross-client batching.

---

## 4. Output Paths

### 4.1 Download (build this)

Mechanism: **signed URL pack** — all completed jobs in a batch already have `result_storage_path` in the DB. The batch detail page (`/company/image/batches/[id]`) already generates fresh 1-hour signed URLs per job on each page load.

**Download flow:**
1. User reviews batch results (thumbnails already shown)
2. Clicks "Download all" → server generates a ZIP of all completed job images
3. OR: per-image download links (individual signed URL → browser download)

**Implementation:** A new `GET /api/platform/image/batch/[id]/download` route that:
- Validates auth (`requireCanDoForApi(companyId, "create_post")`)
- Fetches all `result_storage_path` values for the batch
- Generates signed URLs (or fetches buffers + streams as ZIP)
- Returns a ZIP download or redirect to pre-signed URL

This is fully self-contained. No new schema needed.

### 4.2 Social poster handoff (stub only — do not wire live)

The interface is already defined by the existing `image_selections` table (B4):

```sql
image_selections (
  job_id UUID → image_generation_jobs.id,
  selected_by UUID → platform_users.id,
  post_master_id UUID → social_post_masters.id (nullable),
  created_at TIMESTAMPTZ
)
```

When `target_publish_date` is set on a job and the user approves a generated image, the handoff stub would:
1. Write a row to `image_selections` linking the job to a post (if one exists for that date)
2. The social poster can later query `image_selections` to pre-attach images to posts

**What to build now (stub):** After download/approval, if `target_publish_date` is set on the job, show a "Attach to scheduled post" button that calls `PATCH /api/platform/image/jobs/:id/select` (already exists for B4). This UI button is disabled/labelled "coming soon" if no social poster integration is live.

**What not to build now:** Any live social poster integration, calendar auto-scheduling, or auto-publish trigger. These depend on the social poster being tested and verified, which it isn't.

**Clean interface for later:** The `target_publish_date` on the job + the `post_master_id` FK on `image_selections` is the complete handoff surface. When the social poster is ready, it reads `image_selections WHERE post_master_id IS NOT NULL` and attaches the associated images. No new schema required.

---

## 5. Recommended Build Sequence

### Phase 1: Template column mapper + template-mode QStash handler (engine wiring)
Prerequisite for everything else. No UI yet.

**B1-engine:** Given a `template_id` + `company_id`, call `/fields` and return `TemplateField[]` to a mapper.  
**B2-engine:** Given a spreadsheet row + `TemplateField[]`, produce `Modification[]` (column → layer name matching).  
**B3-engine:** Given `target_platforms`, select `variantKey` (`"square"` or `"landscape"`).  
**QStash handler fork:** `if (job.jobType === "template")` → `renderTemplate({ template, modifications, variantKey })` → `compositeLayerBased()` → write storage path → mark complete.

Tests: unit tests for mapper, golden-image test for one full template render via this path.

### Phase 2: Ingest API — template mode
Extend `/api/platform/image/ingest` with a `mode=template` parameter and a `template_id` field. In template mode, skip C3 (Ideogram interpreter), run the template column mapper instead, and dispatch jobs with `jobType: "template"`.

Reuse all existing: XLSX/DOCX parsers, dispatchImageBatch(), budget check, job creation, QStash enqueue, batch tracking.

### Phase 3: Download
`GET /api/platform/image/batch/[id]/download` → ZIP of all completed job images. Wire a "Download" button into the existing batch detail page.

### Phase 4: UI — template-mode ingest
Extend `/company/image/ingest` with a "Generate from template" tab:
1. Pick template (shows available templates for the company)
2. Upload spreadsheet
3. Preview column → field mapping (confirm before dispatch)
4. Submit → existing batch progress UI

### Phase 5: Poster stub (optional, low-risk)
Add "Attach to post" affordance to batch detail. Show it only if the job has a `target_publish_date`. Wire to existing `PATCH /api/platform/image/jobs/:id/select`. Label it "coming soon" until social poster is tested.

---

## Appendix: Key Files

| Purpose | File |
|---------|------|
| Session resolution + staff cookie | `lib/platform/auth/current-user.ts` |
| Permission check + staff bypass | `lib/platform/auth/index.ts` |
| API gate pattern | `lib/platform/auth/api-gate.ts` |
| Company switcher (UI) | `components/nav/company-selector.tsx` |
| Company switch API | `app/api/platform/companies/switch/route.ts` |
| Batch dispatch | `lib/image/dispatch.ts` |
| QStash enqueue | `lib/image/enqueue.ts` |
| Fan-out | `lib/image/fan-out.ts` |
| QStash handler | `app/api/internal/image/qstash-handler/route.ts` |
| Template compositing | `lib/image/compositing/index.ts` |
| `renderTemplate()` | `lib/image/compositing/layer-renderer.ts` |
| `/fields` endpoint | `app/api/platform/image/templates/[id]/fields/route.ts` |
| Ingest API | `app/api/platform/image/ingest/route.ts` |
| Ingest UI | `app/(platform)/company/image/ingest/page.tsx` |
| Batch list/detail UI | `app/(platform)/company/image/batches/` |
| Image selections (B4) | `image_selections` table, `app/api/platform/image/jobs/[id]/select/route.ts` |
