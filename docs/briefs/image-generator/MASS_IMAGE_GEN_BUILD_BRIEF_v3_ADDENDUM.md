# Mass Image Generation — Build Brief v3 ADDENDUM

**Status:** Authoritative. This document supersedes any conflicting content in `MASS_IMAGE_GEN_BUILD_BRIEF.md` v3. Read this before acting on any slice from A3 onwards.
**Date:** 2026-05-29
**Author:** Steven Morey (decision), drafted from session record
**Path:** `docs/briefs/image-generator/MASS_IMAGE_GEN_BUILD_BRIEF_v3_ADDENDUM.md`

---

## What this addendum changes

The v3 brief is otherwise intact and correct. This addendum changes ONE thing: the compositing path. Bannerbear is removed entirely. A native sharp-based compositor + an in-product visual template editor replace it.

Everything else in v3 — recon findings, §1 locked specifications (aspect ratios, route namespace, budget cap, parser schema, auto-attach, URL persistence, job semantics), and slices A1, A2, A3, A6, B1, B2, B3, B4, B5, C1, C2, C3, C4, D2, D3 — stays unchanged.

The decision is locked. Do not re-litigate. Steven has accepted the trade-offs (longer timeline, larger scope, but a sellable product feature instead of a third-party dependency).

## Current state of execution (as of 2026-05-29)

- **A1 (Ideogram v3 endpoint reshape + MASS_GEN_PLATFORM_MAP):** merged to main
- **A2 (generated-images bucket migration + v1.1 backlog doc):** merged to main
- **A3 (consolidate Ideogram clients):** merged to main
- **B1 (QStash handler + Redis lease):** merged to main
- **A6 (regenerate loop + escalation email):** merged to main
- **B2 (batch tracking table + dispatch endpoint):** merged to main
- **All subsequent slices:** not started, proceed per §3 below

Note: A6 and B2 shipped before A-NEW-1 (no compositing dependency; both are pure infrastructure). This is correct — the sequencing constraint is "A-NEW-1 before A4/A5", not "A-NEW-1 before A6/B2".

## Cross-references to v3

References to "v3" below mean `docs/briefs/image-generator/MASS_IMAGE_GEN_BUILD_BRIEF.md`. Specific sections cited as e.g. "v3 §1.1" refer to that file.

---

## 1. What's removed

### From the codebase (in slice A-NEW-4)
- `lib/image/compositing/bannerbear.ts` — deleted
- `lib/image/compositing/placid.ts` — deleted
- `COMPOSITING_PROVIDER` env var and the dispatch in `compositing/index.ts` — removed
- All `BANNERBEAR_*` env vars in `.env.example` — removed
- All `BANNERBEAR_*` env vars in Vercel production — removed
- `https://api.bannerbear.com` and `https://api.placid.app` in `lib/security-headers.ts` CSP allowlist — removed

### From the brief
- v3 §4 slice D1 (Bannerbear account setup) — deleted entirely. No Steven dashboard work required.
- v3 §1.1 references to specific Bannerbear template UIDs — superseded by §4 of this addendum.

### From the v1.1 backlog (v3 §9)
- Item 3 (per-client template selection) — REMOVED from v1.1, now in scope as A-NEW-3
- Item 4 (configurable logo position) — REMOVED from v1.1, now in scope as A-NEW-3
- Items 1, 2, 5, 6 — stay in v1.1, but reframed in §6 of this addendum

### Other docs
- `docs/briefs/image-generator/BANNERBEAR_TEMPLATE_GUIDE.md` — rename to `LEGACY_BANNERBEAR_TEMPLATE_GUIDE.md` with a one-line header note: "Superseded by addendum. The Bannerbear path is abandoned; templates live in the database via slice A-NEW. This file is retained for historical reference only."

---

## 2. What's added — the A-NEW slice cluster

Four new slices replace the Bannerbear path. Each is a single PR with its own checkpoint. They sit between B1 and A4 in execution order.

### A-NEW-1: sharp-based rendering backend

**Goal:** implement the existing `compositeImage()` contract using sharp directly. No editor yet — just a code path that takes a template definition (as JSON) and renders.

**Files & changes:**
- New module `lib/image/compositing/sharp-renderer.ts` implementing the `compositeImage()` interface from `lib/image/compositing/index.ts`. Interface contract stays unchanged.
- Bundle fonts: `assets/fonts/Inter-Bold.ttf` and `assets/fonts/Inter-Regular.ttf`. Document font licence in a code comment alongside the asset.
- Text auto-fit: given a region width/height and a string, find the largest font size such that text fits without overflow. Implement and test with 10-char, 40-char, 80-char inputs.
- Logo fit-into-box: preserve aspect ratio, contain within region, anchor configurable (default bottom-right).
- Overlay band: rectangle drawn over the background with derived colour + configurable alpha (default 0.75).
- Five **hard-coded** template constants in `lib/image/compositing/templates-v1.ts`, one per supported aspect ratio. These match the layouts previously specified in `LEGACY_BANNERBEAR_TEMPLATE_GUIDE.md`. **This file is temporary** — it exists so A4 and A5 can ship as stubs against code templates while A-NEW-2 and A-NEW-3 land. It gets deleted in A-NEW-4.
- Tests: unit tests rendering one composite per ratio with a known input. Snapshot-test the output dimensions and that text/logo regions are populated. Use one of the previously-approved A1 verification images as the background fixture.

**Checkpoint:** Claude Code surfaces 5 composited PNGs (one per ratio) as signed URLs in the same message that announces CI green. Steven reviews visual quality before merge.

### A-NEW-2: template storage + RLS

**Goal:** templates become first-class database entities, scoped to companies, with global Opollo-owned defaults.

**Files & changes:**
- Migration creating `image_templates` table:
  - `id` uuid PK
  - `company_id` uuid nullable (null = global Opollo template)
  - `name` text
  - `aspect_ratio` enum (matching v3 §1.1: `1x1`, `4x5`, `9x16`, `16x9`, `4x3`)
  - `definition` jsonb — the template structure (regions, fonts, alpha, anchors, etc — defined by sharp-renderer.ts's consumed shape)
  - `version` int
  - `is_active` boolean
  - `created_by` uuid, `created_at` timestamptz, `updated_at` timestamptz
  - Partial unique index on `(company_id, name, version)` where `is_active = true` — mirrors `platform_brand_profiles` pattern
- Migration creating `image_template_versions` table for version history — mirror the `platform_brand_profile_versions` pattern
- RLS: company members read their own company's templates + all global templates; only company admins or Opollo staff write; only Opollo staff write global templates
- Seed migration inserts 5 default Opollo-owned global templates (one per aspect ratio) using the same `definition` JSON the A-NEW-1 `templates-v1.ts` constants produce
- New module `lib/image/templates/index.ts` exporting:
  - `get_template(companyId, aspectRatio, nameOrId?)` — returns the active template for that scope. Per-company beats global. Specific name beats default.
  - `list_templates(companyId)` — returns global + company-scoped templates
  - `update_template()` RPC matching the `update_brand_profile()` pattern in `lib/platform/brand/update.ts` — versioning is automatic, never UPDATE in place

**Checkpoint:** Migrations run in dev. Confirm 5 global templates exist via SELECT. Confirm `get_template(testCompanyId, '1x1')` returns the global one when no company-specific exists. Confirm `update_template()` creates a new version row.

### A-NEW-3: template editor UI

**Goal:** the canvas-based drag-and-drop editor. Largest single slice in v1.

**Files & changes:**
- Add `react-konva` (canvas library) to `package.json`. Alternative: Fabric.js if `react-konva` has incompatibilities with Next.js 14 server components — verify upfront.
- New route at `/company/image/templates/page.tsx` — list view of templates (global + company-scoped), with "Create new" + "Edit" + "Duplicate" actions
- New route at `/company/image/templates/[id]/edit/page.tsx` — the editor itself
- Editor renders the template `definition` on a canvas, with editable elements:
  - `background_image` — full-frame, not draggable, shows the sample background
  - `overlay` band — resizable rectangle, alpha slider, derived-colour preview
  - `headline` — resizable text region, font picker (bundled fonts only for v1), font size, colour picker, alignment
  - `logo` — resizable region, position anchor picker (9-zone grid: top-left, top-centre, top-right, middle-left, middle-centre, middle-right, bottom-left, bottom-centre, bottom-right)
- Sample background image used in preview: an uploaded image OR one of the A1 verification images (selectable via a "Test background" dropdown)
- Live preview: every change re-renders the canvas immediately (no "click preview" button)
- "Test with real background" button: calls A-NEW-1's renderer with the current `definition` + selected sample background, opens the result in a modal
- Save action calls `update_template()` RPC, creating a new version
- Cancel reverts to last saved version

**Out of scope for this slice (deferred to v1.1):**
- Multi-zone text (multi-zone compositing)
- CTA button layer
- Subhead layer
- Snap-to-grid (visual ruler is fine for v1)
- Undo/redo (Cmd-Z)
- Mobile responsiveness (desktop-only is documented)

**Checkpoint:** Steven walks through the editor for 10 minutes, builds a template, saves it, regenerates an image using the new template via A-NEW-4 (or a temporary test endpoint exposed in this slice if A-NEW-4 hasn't landed), confirms the output matches what the editor preview showed.

### A-NEW-4: pipeline integration + Bannerbear removal

**Goal:** the rest of the pipeline (mood board, CAP, batch handler) uses database templates via the sharp renderer. Old code deleted.

**Files & changes:**
- `lib/image/compositing/index.ts` — `compositeImage()` now reads the template from the database via `get_template()`, then renders via `sharp-renderer.ts`. Signature unchanged.
- Delete `lib/image/compositing/bannerbear.ts`
- Delete `lib/image/compositing/placid.ts`
- Delete `lib/image/compositing/templates-v1.ts` (data has migrated to the database via A-NEW-2 seed)
- Remove `COMPOSITING_PROVIDER` env var + dispatch logic
- Remove all `BANNERBEAR_*` env vars from `.env.example` and Vercel production
- Remove `https://api.bannerbear.com` and `https://api.placid.app` from `lib/security-headers.ts` CSP allowlist
- Update `image_generation_log.compositing_provider` enum: add `'sharp_native'`. Keep `'bannerbear'` for legacy compat (though no rows should reference it in this codebase).
- Rename `BANNERBEAR_TEMPLATE_GUIDE.md` to `LEGACY_BANNERBEAR_TEMPLATE_GUIDE.md` with the superseded-header note
- Slices A4 and A5 that previously referenced `templates-v1.ts` now read templates from the database — verify and update those slices' integration

**Checkpoint:** Run a full end-to-end generation through the pipeline using the seed-default template. Confirm the output matches what A-NEW-3's editor preview showed for the same template. Confirm `rg "bannerbear|placid"` over the codebase returns zero non-doc, non-legacy hits.

---

## 3. Sequencing

### A4 and A5 — sequencing decision (locked)

**A4 and A5 ship FIRST as code-template stubs**, using A-NEW-1's `templates-v1.ts` constants. They do NOT wait for A-NEW-2 / A-NEW-3 / A-NEW-4.

This is a deliberate trade-off:
- Pro: mood board and CAP get composited output ~1 week sooner than waiting for the full editor
- Pro: visual milestones (Steven seeing the first real composite) land earlier
- Con: A4 and A5 will each need a small follow-up commit when A-NEW-4 lands, swapping `templates-v1.ts` lookups for `get_template()` database lookups
- Con: there's no per-client template variation until A-NEW-3 is live — every A4/A5 output uses the seed defaults

The follow-up swap is a small, mechanical change. It's worth accepting that small refactor to unblock visual milestones earlier.

**Concretely, when slices A4 and A5 are written:**
- They import from `lib/image/compositing/templates-v1.ts` directly
- The PR description states: "Uses code templates from A-NEW-1; will be migrated to database templates in A-NEW-4's follow-up."
- A-NEW-4 includes the migration of A4 and A5 to database-backed templates as part of its scope.

### Full revised execution order

```
✅ A1  — Ideogram v3 endpoint reshape + MASS_GEN_PLATFORM_MAP        [merged]
🟡 A2  — generated-images bucket migration + v1.1 backlog            [CI green, merging]
   A3  — consolidate Ideogram clients (single canonical client)
   B1  — QStash handler for single-image generation (with Redis lease)
   A-NEW-1 — sharp-based rendering backend + code template constants
   A4  — mood-board compositing (uses templates-v1.ts initially)
   A5  — CAP trigger via QStash + compositing (uses templates-v1.ts initially)
   A6  — regenerate loop + escalation email
   A-NEW-2 — template storage + RLS + seed defaults
   A-NEW-3 — template editor UI (react-konva, canvas, live preview)
   A-NEW-4 — pipeline integration + Bannerbear removal + A4/A5 migration to DB templates
   B2  — batch tracking table + dispatch endpoint
   B3  — per-company budget cap ($20 default, jobs not rows)
   B4  — approval/rejection signal + auto-attach via media_asset_ids
   B5  — dry-run preview mode
   C1  — XLS parser
   C2  — .docx parser (label-based, explicit placeholder detection)
   C3  — AI interpretation layer
   C4  — ingestion route at /api/platform/image/ingest
   D2  — batch results viewer UI
   D3  — ingestion UI + batch history
```

Total slices: 18 → 20 (replaced D1 with four A-NEW slices, dropped D1).

### Sequencing constraints — updated

These replace v3 §6 constraints related to compositing:

1. **A1 → A2 → A3** before anything else. Unchanged from v3.
2. **B1 must complete before A5.** Unchanged from v3.
3. **A-NEW-1 must complete before A4 or A5.** A4 and A5 import code templates from `templates-v1.ts`.
4. **A-NEW-1, A-NEW-2, A-NEW-3 can run in any order after A-NEW-1 lands**, but A-NEW-4 must be last in the A-NEW cluster because it depends on all three.
5. **A-NEW-4 must complete before C4 lands** so the database-template path is the only path by the time mass ingestion runs in earnest.
6. **B2 must complete before C4.** Unchanged from v3.
7. **B4 must complete before D2.** Unchanged from v3.
8. **D2 and D3 are last.** Unchanged from v3.

The previous v3 §6 sequencing constraint "D1 (Bannerbear setup) must complete before A4 or A5" — **deleted**. D1 no longer exists.

---

## 4. Locked specifications — additions to v3 §1

The v3 §1 locked specifications (1.1 through 1.7) all remain in force unchanged. This addendum adds two:

### §1.8 — Compositing path (locked)

- Native sharp-based rendering. No third-party compositing service.
- Templates are stored in the `image_templates` database table after A-NEW-2 lands.
- Before A-NEW-2 lands (during A4 + A5), templates are code constants in `lib/image/compositing/templates-v1.ts` — temporary.
- The `compositeImage()` interface contract is unchanged; only the implementation has been swapped.
- No slice may bypass the `compositeImage()` interface or call sharp directly from a consumer module. All compositing goes through `lib/image/compositing/index.ts`.

### §1.9 — Template editor (locked)

- Templates have a database-backed visual editor at `/company/image/templates/[id]/edit`.
- Built on `react-konva` (or Fabric.js as a fallback only if react-konva surfaces blocker issues).
- Templates are scoped to companies; global templates are owned by Opollo staff and seeded by A-NEW-2.
- The editor produces JSON `definition` payloads consumed by the sharp renderer. The two contracts are coupled and must evolve together.
- All template writes go through the `update_template()` RPC (versioning is automatic, mirror of brand profile pattern). No direct UPDATE.

---

## 5. v1.1 backlog — updated

Replaces v3 §9 entirely.

```
## 9. v1.1 backlog — deferred enhancements

Items deferred from v1. Revisit after v1 has been in production for at least 4 weeks.

1. CTA button layer. Pill-shaped call-to-action button with configurable
   text + icon. Requires extending the template definition schema, the
   sharp renderer, and the template editor UI (new draggable element type).

2. Multi-zone headline / highlighted phrases. The Blackbird-style
   "white text + lime-highlighted phrase" effect. Requires the template
   to support multiple text layers with per-layer colour and background-fill.

3. Subhead / supporting copy layer. A smaller text line below the main
   headline. Same shape as the CTA work — new element type in the schema,
   renderer, and editor.

4. Illustrated / non-photographic backgrounds. Requires either a new
   Ideogram style_id ('illustrated') or a non-Ideogram asset library.

5. Template editor polish: undo/redo (Cmd-Z), snap-to-grid, mobile
   responsiveness, keyboard shortcuts.

6. Custom font upload. Today only bundled fonts are available. Allow
   per-company font uploads, served via Supabase Storage.

7. Animated previews (export to MP4 / GIF). Out of scope architecturally
   for v1 + v1.1; flagged here for product roadmap awareness.

8. Template marketplace. Caleb-designed templates can be shared between
   companies (with billing attached). Pure product slice, requires its
   own brief.

Items removed from v1.1 because they are now in v1 scope via A-NEW:
- Per-client template selection → solved by A-NEW-2 storage + A-NEW-3 editor
- Configurable logo position → solved in A-NEW-3 (9-zone anchor picker)
```

---

## 6. Acceptance tests — additions to v3 §5

The v3 acceptance tests (numbered 1 through 14) remain in force. Add:

15. **Template editor produces a renderable template.** Open the editor, build a template with a non-default overlay alpha and a top-left logo anchor. Save. Confirm a row exists in `image_templates` with the new `definition`. Render a composite using `compositeImage()` with that template — confirm the output matches the editor preview pixel-for-pixel (within sharp's rendering tolerance).

16. **Per-company templates override globals.** Create a company-scoped template named "default" for ratio 1x1. Confirm `get_template(companyId, '1x1')` returns the company-scoped one, not the global. Delete it, confirm fallback to global works.

17. **Template versioning works.** Edit and save a template three times. Confirm three version rows exist. Confirm only the latest is `is_active = true`. Confirm rollback to a previous version creates a new version row, not an UPDATE.

18. **`rg "bannerbear|placid"` over the codebase returns zero non-doc hits after A-NEW-4 lands.** Documentation references in `LEGACY_BANNERBEAR_TEMPLATE_GUIDE.md` and the v3 brief's history sections are acceptable. Code references are not.

---

## 7. Steven's role — updated

You are no longer on the critical path for compositing. The Bannerbear dashboard task does not exist.

Your remaining responsibilities:

1. PR reviews per slice. Same checkpoint pattern as v3.
2. Visual approval after **A-NEW-1** — review 5 composited PNGs against approved A1 backgrounds.
3. Visual approval after **A4** — first composited mood board image with full pipeline.
4. Visual approval after **A5** — first composited CAP post.
5. **Walk-through of A-NEW-3 editor** when it lands — spend 10 minutes building a template, confirm UX is usable, flag any issues.
6. **Caleb's job:** start collecting reference template designs now. By the time A-NEW-3 lands (~3 weeks), Caleb should have rough sketches of 5-10 templates per ratio ready to build in the editor. Without his templates, v1's mass-production output stays at the seed defaults, which won't differentiate clients.

---

## 8. Timeline expectations — updated

v3 estimated 3-4 weeks for the full programme. This addendum extends that to **6-9 weeks** realistic, **10-11 weeks** worst case if the editor surfaces UX issues.

Distribution:
- Streams A + B1 (foundation + QStash): ~1 week — mostly already in flight
- A-NEW-1 (sharp renderer): ~3 days
- A4 + A5 + A6 (compositing into mood board + CAP + escalation): ~3-4 days
- A-NEW-2 + A-NEW-3 + A-NEW-4 (storage + editor + integration): **~2-3 weeks** — this is the bulk of the added work
- B2-B5 (batch infrastructure): ~1 week
- C1-C4 (ingestion): ~1 week
- D2-D3 (UX): ~1 week

The A-NEW-3 editor is the highest-risk slice for over-runs. Canvas editors always take longer than estimated. Budget for that.

---

## 9. Now what

1. **Finish A2.** It's already CI-green. Merge it. Take whatever cleanup is required for the v1.1 backlog doc that was added to the same branch.
2. **Update the brief.** Add this addendum into the repo at `docs/briefs/image-generator/MASS_IMAGE_GEN_BUILD_BRIEF_v3_ADDENDUM.md`. Add a one-line note at the top of `MASS_IMAGE_GEN_BUILD_BRIEF.md` pointing readers to this addendum.
3. **Rename** `BANNERBEAR_TEMPLATE_GUIDE.md` to `LEGACY_BANNERBEAR_TEMPLATE_GUIDE.md` with a header note that it's superseded.
4. **Proceed with A3** as the next slice. No other re-litigation required.

When A-NEW-1 starts (after A3 and B1), this addendum is the spec to read alongside v3.

If you understand this addendum and have updated the repo per §9, confirm and proceed with A3.
