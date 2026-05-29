# Mass Image Generation — Build Brief v3 ADDENDUM

**Status:** Authoritative. This document supersedes any conflicting content in `MASS_IMAGE_GEN_BUILD_BRIEF.md` v3. Read this before acting on any slice from A3 onwards.
**Date:** 2026-05-29
**Author:** Steven Morey (decision), drafted from session record

---

## What this addendum changes

The v3 brief is otherwise intact and correct. This addendum changes ONE thing: the compositing path. Bannerbear is removed entirely. A native sharp-based compositor + an in-product visual template editor replace it.

Everything else in v3 — recon findings, §1 locked specifications (aspect ratios, route namespace, budget cap, parser schema, auto-attach, URL persistence, job semantics), and slices A1, A2, A3, A6, B1, B2, B3, B4, B5, C1, C2, C3, C4, D2, D3 — stays unchanged.

---

## Current state of execution (as of 2026-05-29)

- **A1** — Ideogram v3 endpoint reshape + MASS_GEN_PLATFORM_MAP: ✅ merged
- **A2** — generated-images bucket + v1.1 backlog doc: ✅ merged
- **A3** — consolidate Ideogram clients: ✅ merged
- **B1** — QStash handler + Redis lease: ✅ merged
- **A6** — regenerate loop + escalation email: ✅ merged
- **B2** — batch tracking table + dispatch endpoint: ✅ merged
- **A4** — mood board compositing (templates-v1.ts): ✅ merged
- **A5** — CAP trigger via QStash + compositing: ✅ merged
- **A-NEW-1** — sharp-based rendering backend + code templates: ✅ merged
- **A-NEW-2** — image_templates storage + RLS + seed defaults: ✅ merged
- **A-NEW-3** — template editor UI (Fabric.js canvas): ✅ merged
- **A-NEW-4** — pipeline integration + Bannerbear removal: in progress
- **B3 → D3** — remaining slices: not started

---

## 1. What's removed

### From the codebase (in slice A-NEW-4)
- `lib/image/compositing/bannerbear.ts` — deleted
- `lib/image/compositing/placid.ts` — deleted
- `COMPOSITING_PROVIDER` env var and dispatch in `compositing/index.ts` — removed
- All `BANNERBEAR_*` env vars in `.env.example` — removed
- `https://api.bannerbear.com` and `https://api.placid.app` in `lib/security-headers.ts` — removed

### From the brief
- v3 §4 slice D1 (Bannerbear account setup) — deleted. No Steven dashboard work required.

---

## 2. A-NEW slice cluster

### A-NEW-1: sharp-based rendering backend ✅
`lib/image/compositing/sharp-renderer.ts` — implements `compositeImage()` via sharp + librsvg. Five hard-coded code templates in `lib/image/compositing/templates-v1.ts` (temporary, deleted in A-NEW-4). Fonts: Inter, Roboto, Montserrat, Open Sans, Poppins (OFL-1.1) in `assets/fonts/`.

### A-NEW-2: template storage + RLS ✅
`image_templates` table (migration 0162): company_id (null=global), name, aspect_ratio, definition JSONB, version, is_active. `image_template_versions` for history. `update_image_template()` RPC (versioning, never UPDATE directly). Seed: 5 global defaults per §1.1. `lib/image/templates/index.ts`: `get_template()`, `list_templates()`, `update_template()`, `create_template()`.

### A-NEW-3: template editor UI ✅
Fabric.js canvas editor at `/company/image/templates/[id]/edit`. Overlay band draggable → sets `customTextZone`. Controls panel: composition type, overlay alpha, font family, max headline size, logo position, logo size/padding. "Test with real background" button calls preview API. Save via `PATCH /api/platform/image/templates/[id]`.

### A-NEW-4: pipeline integration + Bannerbear removal
`compositeImage()` reads template from DB via `get_template()` (per §1.8). Delete bannerbear.ts, placid.ts, templates-v1.ts. Remove `COMPOSITING_PROVIDER`. Update A4/A5 to use DB templates. `sharp_native` added to `compositing_provider` enum.

---

## 3. Sequencing (revised)

```
✅ A1 → A2 → A3 → B1 → A-NEW-1 → A4 → A5 → A6 → A-NEW-2 → A-NEW-3 → A-NEW-4
✅ B2 (shipped before A-NEW-1 — no compositing dependency; correct)
   A-NEW-4 → B3 → B4 → B5 → C1 → C2 → C3 → C4 → D2 → D3
```

**Constraints:**
1. A-NEW-1 must complete before A4 or A5.
2. A-NEW-4 must complete before C4.
3. B2 must complete before C4.
4. B4 must complete before D2.

---

## 4. Locked specifications additions (§1.8 and §1.9)

### §1.8 — Compositing path
Native sharp-based rendering. No third-party. Templates in `image_templates` after A-NEW-2. Before A-NEW-2: code constants in `templates-v1.ts` (deleted in A-NEW-4). All compositing through `lib/image/compositing/index.ts → compositeImage()`.

### §1.9 — Template editor
Database-backed editor at `/company/image/templates/[id]/edit`. Built on Fabric.js (react-konva requires React 19; project on React 18). Company-scoped templates override globals. All writes through `update_image_template()` RPC. No direct UPDATE.

---

## 5. v1.1 backlog

1. **CTA button layer.** Pill-shaped CTA button, configurable text + icon. New element type in definition schema, renderer, and editor.

2. **Multi-zone headline / highlighted phrases.** Blackbird-style "white text + lime-highlighted phrase" effect. Multiple text layers with per-layer colour and background-fill.

3. **Subhead / supporting copy layer.** Smaller text line below headline. Same shape as CTA work.

4. **Illustrated / non-photographic backgrounds.** Requires new Ideogram style_id or a non-Ideogram asset library.

5. **Template editor polish: undo/redo (Cmd-Z), snap-to-grid, mobile responsiveness, keyboard shortcuts.**

6. **Custom font upload.** Per-company font uploads served via Supabase Storage.

7. **Template editor UX overhaul.** Clearer labels for each control; visual preview of finished output (not just wireframe); better defaults so templates look good without tinkering; visible logo placeholder on canvas; inline help-text explaining what each composition type means. Filed after A-NEW-3 walk-through (2026-05-29).

8. **Animated previews (MP4 / GIF export).** Out of scope architecturally for v1 + v1.1; product roadmap only.

9. **Template marketplace.** Caleb-designed templates shareable between companies (with billing). Requires its own brief.

Items removed from v1.1 (now in v1 scope via A-NEW):
- Per-client template selection → A-NEW-2 + A-NEW-3
- Configurable logo position → A-NEW-3 (4-anchor picker)

---

## 6. Acceptance tests (additions to v3 §5)

15. **Template editor produces a renderable template.** Build a template, save, confirm `image_templates` row updated, render composite via `compositeImage()` — confirm output matches preview.

16. **Per-company templates override globals.** Create company "default" for 1x1 → `get_template(companyId, '1x1')` returns company-scoped; delete it → global fallback confirmed.

17. **Template versioning works.** Save 3 times → 3 version rows in `image_template_versions`, only latest `is_active = true`.

18. **`rg "bannerbear|placid"` returns zero non-doc hits after A-NEW-4.**

---

## 7. Steven's role (updated)

Bannerbear dashboard task does not exist. Remaining:
1. PR reviews per slice.
2. Visual approval after A-NEW-4 end-to-end run.
3. Walk-through of A-NEW-3 editor ✅ (done 2026-05-29).
4. **Caleb:** collect reference template designs for the editor before v1.1 scoping.
