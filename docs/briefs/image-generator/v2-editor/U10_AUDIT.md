# U10 Editor Audit — v2 Template Editor

**Date:** 2026-05-31  
**Scope:** U1–U10 (editor shell through geometry block)  
**Status:** Investigation complete. No code changes made. Waiting for Steven to review and direct fixes.

---

## Summary Verdict

The editor is **not yet usable to spec** for the following reasons: canvas click-selection is broken (every canvas click selects the background layer, never the intended layer), the canvas sizing is confusing on wide viewports because the editor renders inside the platform NavShell chrome rather than taking true full-viewport, and several spec-mandated controls are absent (skew X/Y on all layers, word-break on text, rotate X/Y/Z in the geometry block, clip-path on image layers). The save chain is functional and the undo/redo op log works. The per-type property panels (text/image/rectangle) are largely complete and update the DOM renderer in real time. The editor is architecturally sound and close to usable — three focused blockers (canvas click-selection, platform layout escaping, missing skew/rotate controls) need to be fixed before the editor is functional for real template work.

---

## Issues Table

| # | Issue | Severity | Root Cause | Proposed Fix | Files Touched |
|---|-------|----------|-----------|--------------|---------------|
| 1 | Canvas appears as wide rectangle with background not filling the frame | Major | EditorShell renders **inside** NavShellClient's main content area, which has `max-w-7xl mx-auto px-8 py-8`. On wide viewports (section panel collapsed, wide screen) the EditorCanvas container becomes very wide relative to its height. The canvas IS square (scale-to-fit works correctly) but floats as a small square in a large dark container. Additionally, `h-screen` (100vh) on EditorShell overflows the main content area's `py-8` padding, causing the editor body to extend into a scrollable zone. | Make EditorShell escape the NavShell's content wrapper: either (a) use CSS `position: fixed; inset: 0` on the editor shell to overlay the full viewport, or (b) restructure the platform layout to allow full-viewport pages via a layout bypass. Option (a) is simpler: `EditorShell` root div `className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background"`. | `components/image/editor/EditorShell.tsx` |
| 2 | Canvas click-selection always selects the background layer | Blocker | `KonvaInteractionLayer` renders Konva `<Rect>` elements in `template.layers` order (index 0 = top layer = BOTTOM Konva z-order; index N-1 = background = TOP Konva z-order). Konva paints later elements on top, so the background `Rect` intercepts every canvas click. Selecting a non-background layer is impossible via canvas click; only the left-panel rows work. Transformer handles appear correctly once a layer is selected from the left panel, but the user cannot click-select layers on canvas. | Render Konva `Rect` elements in **reverse** order (background first, headline last), mirroring `CanvasContent`'s `renderOrder`. This puts the topmost visual layer's `Rect` on top in Konva z-order, matching user expectation. One-line fix in the `map()` call. | `components/image/editor/KonvaInteractionLayer.tsx` |
| 3 | Skew X/Y missing from all layer panels | Major | The layer model (`LayerBase`) has `skew_x` and `skew_y` fields. The sharp renderer and DOM renderer both apply them. The spec §9 explicitly lists "Skew X/Y" under Typography (text layers). But neither `TextLayerPanel` nor `GeometryPanel` exposes skew inputs. They are uneditable in the UI. | Add `skew_x`/`skew_y` numeric inputs to `GeometryPanel` (affects all layer types, consistent with how angle/opacity live there). | `components/image/editor/panels/GeometryPanel.tsx` |
| 4 | Rotate X/Y/Z missing from geometry block | Minor | The layer model has `rotate_x`, `rotate_y`, `rotate_z` fields (in addition to `rotation`). The spec §9 lists "Rotate X/Y/Z". `GeometryPanel` only exposes `Angle` (which maps to `rotation` = rotateZ). The other three rotation axes have no UI. The sharp renderer logs a warning and skips them (E5 note). | Add `rotate_x`, `rotate_y`, `rotate_z` inputs to `GeometryPanel`, below the Angle field, with a note that server-side rendering only honours rotateZ in V1. | `components/image/editor/panels/GeometryPanel.tsx` |
| 5 | Word Break missing from TextLayerPanel | Minor | The layer model has `word_break: WordBreak`. The spec §9 lists "Word Break" in the Typography group. `TextLayerPanel` does not render a word-break control. The field defaults to `"normal"` and cannot be changed. | Add a `word_break` select (normal / break-all / keep-all / break-word) to `TextLayerPanel` Typography section. | `components/image/editor/panels/TextLayerPanel.tsx` |
| 6 | Font style (italic) missing from TextLayerPanel | Minor | The layer model has `style: string` (CSS font-style). The spec §9 lists "Style" in Typography. `TextLayerPanel` does not render a style toggle. | Add a simple "Italic" toggle button (sets `style: ""` or `"italic"`). | `components/image/editor/panels/TextLayerPanel.tsx` |
| 7 | Clip path missing from ImageLayerPanel | Minor | The layer model has `clip_path: string \| null`. The spec §3.4 and §6.7 document this for diagonal cuts. `ImageLayerPanel` has no clip_path input. The sharp renderer supports it (E3). | Add a text input for `clip_path` (SVG path data string) to `ImageLayerPanel` Style section, with a placeholder like `"M0,0 L640,0 L480,720 L0,720 Z"`. | `components/image/editor/panels/ImageLayerPanel.tsx` |
| 8 | Image upload button absent; only URL input | Minor | `ImageLayerPanel` renders a URL `<Input>` but no file upload button. The spec §9 says "upload/URL." The Asset Abstraction (§1.4) expects `asset_id` from an asset record. Without an upload path, images can only come from external URLs. | Upload button is partially blocked on Stream A's asset resolver (D-series data model not yet extended for upload). Flag as follow-up — add a disabled upload button with tooltip "coming in A-series" as a UX placeholder. | `components/image/editor/panels/ImageLayerPanel.tsx` |
| 9 | Design token violations — hardcoded hex colours | Minor | Two editor files fail the `design-tokens.unit.test.ts` scan (regex `(?:className\|style)=[^>]*#[0-9a-fA-F]{3,8}`): (a) `CanvasContent.tsx` — inline style objects contain `"#e2e8f0"` (placeholder bg), `"#94a3b8"` (placeholder text), `"2px solid #3b82f6"` (selection outline). (b) `EditorCanvas.tsx` — Tailwind arbitrary class `bg-[#1e1e1e]` (canvas dark background). `KonvaInteractionLayer.tsx` uses `#3b82f6` and `#ffffff` as Konva prop values — NOT in `className` or `style` so the test regex does not catch them, but `scripts/audit.ts` check10 WOULD catch `bg-[#1e1e1e]` via the Tailwind-class pattern. | Replace hardcoded colours with design-token aliases: `bg-[#1e1e1e]` → `bg-editor-canvas` (new token, or use `bg-zinc-900`); selection outline `#3b82f6` → `var(--color-primary)` or a Tailwind `border-primary` token; placeholder colours → `bg-muted` / `text-muted-foreground`. | `components/image/editor/CanvasContent.tsx`, `components/image/editor/EditorCanvas.tsx` |
| 10 | `font_weight` select uses string-to-number cast workaround | Cosmetic | `TextLayerPanel` does `value={String(layer.font_weight) as ...}` to feed a number into a string-typed select. Works at runtime but is a TypeScript casting hack. | Use a proper `<select>` with `value={layer.font_weight}` by making the options `<option value={w} key={w}>{w}</option>` (numeric values are stringified by the browser). Change `onChange` to parse correctly. | `components/image/editor/panels/TextLayerPanel.tsx` |
| 11 | Variable metadata (label, required, default, category, help) not editable | Major | The spec §3.7 and §9 describe a "Variable metadata" panel section for each layer (drives auto-form building in N-Series, Stream B). `EditorRightPanel` dispatches to TextLayerPanel/ImageLayerPanel/RectangleLayerPanel but none of these expose the `layer.var` field. | Add a collapsible "Variable" section to each layer panel with inputs for `label`, `required` toggle, `default`, `category` select, `help`. This is U11's scope. | New section in all three `panels/*.tsx` files |
| 12 | Initial render flash at scale=1 | Cosmetic | `EditorCanvas` initialises `scale = useState(1)`. On first render, the canvas is 1080×1080 at full size, overflowing everything. `useEffect` fires `computeScale` after mount (via ResizeObserver), correcting the scale. On slow loads, the flash is visible. | Initialise `scale = 0` and render the canvas `div` only when `scale > 0`, or compute the initial scale synchronously using a `ref.getBoundingClientRect()` call during the first render (SSR-safe via layoutEffect). | `components/image/editor/EditorCanvas.tsx` |

---

## Spec-Conformance Checklist

### Canvas / Shell (U1–U3)

| Control / Behaviour | Status | Note |
|---------------------|--------|------|
| Three-pane layout (layers left, canvas centre, properties right) | ✅ Pass | |
| Full-viewport editor (no platform chrome competing) | ❌ Fail | Platform NavShell wraps the editor — see Issue #1 |
| Scale-to-fit algorithm (§4): `min(cw/W, ch/H)` | ✅ Pass | Correct formula; ResizeObserver fires on resize |
| Geometry in true canvas px; only wrapper scales | ✅ Pass | |
| Dark canvas background with shadow | ✅ Pass | |
| Scale % indicator | ✅ Pass | |
| Snap guides during drag — §6.4 | ✅ Pass | 6px threshold, canvas edges + other layers |
| Guide lines blue dashed | ✅ Pass | |
| Guides disabled when `template.settings.guides === false` | ✅ Pass | |

### Canvas Interaction (U2)

| Control / Behaviour | Status | Note |
|---------------------|--------|------|
| Click layer on canvas to select | ❌ Fail | Background Rect always on top — Issue #2 |
| Drag to move (x,y update) | ✅ Pass | Works after selecting via left panel |
| Resize via SE/S/E handles | ✅ Pass | 8-anchor Transformer, keepRatio=false |
| Rotate via top handle | ✅ Pass | Rotation handle present |
| Deselect by clicking canvas background | ⚠️ Partial | Works in Konva Stage background click, but canvas-click always selects background first |
| Fade heavy content during resize | ❌ Missing | Spec §6.3 deferred to U5+ |
| Group-select | ❌ Missing | Not built; deferred |
| Lock prevents drag | ✅ Pass | `draggable={!layer.locked}` |
| Hidden layers not hit-testable | ✅ Pass | `listening={!layer.hide}` |

### Layers Panel (U4)

| Control / Behaviour | Status | Note |
|---------------------|--------|------|
| Layer list top-first (index 0 = visual top) | ✅ Pass | |
| Drag-to-reorder | ✅ Pass | HTML5 DnD, dispatches `reorder_layers` |
| Row click selects layer | ✅ Pass | |
| Type icon (T / ⬜ / ▭) | ✅ Pass | |
| Locked indicator | ✅ Pass | |
| Hidden indicator | ✅ Pass | |
| Double-click rename | ✅ Pass | |
| Rename slug validation (§1.10, §5) | ✅ Pass | `/^[a-z0-9_]+$/`, unique check |
| Rename rename-warning (§5) | ✅ Pass | `window.confirm()` |
| ⋯ menu: Toggle Lock | ✅ Pass | |
| ⋯ menu: Toggle Hide | ✅ Pass | |
| ⋯ menu: Rename | ✅ Pass | |
| ⋯ menu: Duplicate | ✅ Pass | +16px offset, `_copy` suffix |
| ⋯ menu: Delete | ✅ Pass | `window.confirm()` |
| ⋯ menu: Add to Group | ❌ Missing | Groups not implemented |
| ⋯ menu: Edit Description | ❌ Missing | Not in menu |
| New Layer (+) button | ❌ Placeholder | U14 not built |
| Variant switcher | ❌ Missing | U15 not built |
| Groups expandable | ❌ Missing | Not built |

### Header (U1/U16/U17/U18)

| Control / Behaviour | Status | Note |
|---------------------|--------|------|
| Template name (editable on double-click) | ✅ Pass | |
| Dirty indicator (•) | ✅ Pass | |
| Undo button | ✅ Pass | Simplified op log; full invertible log is U16 |
| Redo button | ✅ Pass | |
| Save button | ✅ Pass | PATCH /api/.../templates/[id] with layer_template |
| Save toasts (success/error) | ✅ Pass | `sonner` toast |
| Unsaved-changes guard on exit | ✅ Pass | `window.confirm()` |
| Exit link back to list | ✅ Pass | |
| Canvas dimensions display (W×H) | ✅ Pass | In left panel header, not main header |

### Text Layer Panel (U5 / U6 / U7)

| Control | Status | Note |
|---------|--------|------|
| Font family dropdown | ✅ Pass | 5 bundled fonts only; U12 full picker deferred |
| Font size | ✅ Pass | |
| Font weight (100–900) | ✅ Pass | Works; string-cast workaround (Issue #10) |
| Color | ✅ Pass | Native `input[type=color]`; U13 hex+alpha+swatches deferred |
| Letter spacing (kerning) | ✅ Pass | |
| Line height | ✅ Pass | |
| H-align (left/center/right/justify) | ✅ Pass | |
| V-align (top/center/bottom) | ✅ Pass | |
| Text transform (none/UPPER/lower/Title) | ✅ Pass | |
| Text decoration (none/underline/strike) | ✅ Pass | |
| Direction (ltr/rtl) | ✅ Pass | |
| Style (italic toggle) | ❌ Missing | Issue #6 |
| Word break | ❌ Missing | Issue #5 |
| Skew X/Y | ❌ Missing | Issue #3 |
| Text Fit toggle | ✅ Pass | |
| Text Fit min/max size | ✅ Pass | Shown when enabled |
| Text Fit max lines | ✅ Pass | |
| Truncate | ❌ Missing | No control; field not exposed |
| Text Box padding | ✅ Pass | |
| Text Box border | ❌ Missing | Field exists in model, not in UI |
| Secondary style color | ✅ Pass | |
| Secondary style font | ✅ Pass | |
| Per-line background color | ✅ Pass | |
| Per-line background padding H/V | ✅ Pass | |
| Per-line background radius | ✅ Pass | |
| Per-line background shift | ✅ Pass | |
| Per-line background border | ✅ Pass | |
| Content textarea | ✅ Pass | |
| Variable metadata | ❌ Missing | U11 scope |

### Image Layer Panel (U8)

| Control | Status | Note |
|---------|--------|------|
| Image URL input | ✅ Pass | |
| Upload button | ❌ Missing | Issue #8; partially blocked on A-series |
| asset_id display | ✅ Pass | Read-only |
| hide_when_empty | ✅ Pass | |
| Fill (cover/contain) | ✅ Pass | |
| Anchor X (left/center/right) | ✅ Pass | |
| Anchor Y (top/center/bottom) | ✅ Pass | |
| Tint color | ✅ Pass | |
| Border radius | ✅ Pass | |
| Clip path | ❌ Missing | Issue #7 |
| Face detect toggle | ✅ Pass | Present with V1 note |
| Variable metadata | ❌ Missing | U11 scope |

### Rectangle Layer Panel (U9)

| Control | Status | Note |
|---------|--------|------|
| Solid/Gradient toggle | ✅ Pass | |
| Solid color | ✅ Pass | |
| Gradient type (linear/radial) | ✅ Pass | |
| Gradient angle | ✅ Pass | |
| Gradient stops add/remove | ✅ Pass | |
| Gradient stop color | ✅ Pass | |
| Gradient stop position (%) | ✅ Pass | |
| Border radius | ✅ Pass | |
| Border add/remove | ✅ Pass | |
| Border color | ✅ Pass | |
| Border width | ✅ Pass | |
| Border style (solid/dashed/dotted) | ✅ Pass | |
| Variable metadata | ❌ Missing | U11 scope |

### Geometry Block (U10)

| Control | Status | Note |
|---------|--------|------|
| W (width) | ✅ Pass | Integer-snapped |
| H (height) | ✅ Pass | |
| X | ✅ Pass | |
| Y | ✅ Pass | |
| Angle (rotateZ) | ✅ Pass | |
| Opacity | ✅ Pass | |
| Rotate X/Y/Z (3D) | ❌ Missing | Issue #4; only rotateZ (Angle) is exposed |
| Skew X/Y | ❌ Missing | Issue #3 |
| Lock Aspect Ratio | ✅ Pass | Image + rectangle only |
| Constraints H pins (left/right/center/left_right/scale) | ✅ Pass | |
| Constraints V pins (top/bottom/center/top_bottom/scale) | ✅ Pass | |

### End-to-End Chain

| Step | Status | Note |
|------|--------|------|
| Select layer (left panel) | ✅ Pass | |
| Select layer (canvas click) | ❌ Fail | Issue #2 — background always selected |
| Move via drag | ✅ Pass | After selecting from left panel |
| Resize via handles | ✅ Pass | |
| Rotate | ✅ Pass | |
| Edit property → DOM renderer updates in real time | ✅ Pass | |
| Undo last op | ✅ Pass | Simplified op log |
| Redo | ✅ Pass | |
| Save → PATCH /api/.../templates/[id] | ✅ Pass | Sends `layer_template + schema_version: 2` |
| Saved template renders via sharp renderer | ✅ Pass | `compositeLayerBased()` works (E8) |
| Generate preview button in editor | ❌ Missing | Stream A (A3) not built; no in-editor preview |

---

## Recommended Fix Sequence Before U11

Ordered by severity / blocking impact:

1. **[Blocker] Issue #2 — Canvas click-selection** — reverse the Konva `Rect` render order. One-line change, high impact. Without this, the editor is not navigable on canvas.

2. **[Major] Issue #1 — Platform layout / full-viewport** — apply `position: fixed; inset: 0; z-50` to EditorShell root, or restructure the platform layout to support bypass pages. Without this, the editor is cramped and scrollable on any screen size.

3. **[Major] Issue #3 — Skew X/Y controls** — add two number inputs to GeometryPanel. Low effort, closes a spec gap that affects all layer types.

4. **[Major] Issue #11 — Variable metadata UI** — required for N-Series auto-form (Stream B). Add collapsible "Variable" section to all three type panels. This is U11's stated scope.

5. **[Minor] Issues #4, #5, #6 — rotate X/Y/Z, word-break, italic** — small additions to existing panels.

6. **[Minor] Issue #7 — Clip path** — text input for SVG path string.

7. **[Minor] Issue #9 — Design token violations** — replace hardcoded hex values in CanvasContent and EditorCanvas.

8. **[Minor] Issue #10 — font_weight cast** — clean up TypeScript workaround.

9. **[Minor] Issue #12 — Initial scale flash** — initialise scale from layout measurement before first render.

10. **[Minor] Issue #8 — Image upload placeholder** — disabled button with tooltip; real upload blocked on Stream A.

---

## Backlog Items (Not In Scope — Log Only)

| Item | Reason deferred | Target stream/slice |
|------|----------------|---------------------|
| Image source picker (AI generator / iStock library in Source panel) | New feature; asset resolver not wired to generation pipeline | Stream A (A3) + separate UI slice |
| U12 — Font picker slide-out (sections, search, custom/brand fonts) | Planned U-slice, not built | U12 |
| U13 — Color picker (hex + alpha + recent swatches) | Planned U-slice, not built | U13 |
| U14 — New layer (+) menu | Planned U-slice; button present as placeholder | U14 |
| U15 — Variant switcher | Planned U-slice | U15 |
| U19 — Live preview (DOM renderer in preview mode) | Planned U-slice | U19 |
| Group assignment (Add to Group in ⋯ menu) | Groups not implemented | Post-V1 |
| face_detect real implementation | V1 manual focal point only; auto-detect reserved | Post-V1 |
| `toTemplate()` runtime type validation | `row.definition as TemplateDefinition` cast has no runtime guard; caused the white-screen crash on the list page. Follow-up: add `typeof def.compositionType === 'string'` guard or discriminated union type. | Hardening pass |

---

## Tier 1 UAT Investigation — 2026-05-31

### Methodology

All findings below come from direct code trace of the files in `components/image/editor/` and `lib/image/`. No assumptions.

---

### Item 1 & 2: Canvas drag/resize — live feedback broken

**Root cause:** `KonvaInteractionLayer.onDragMove` only runs `computeSnap` and repositions the Konva Rect; it never dispatches to `EditorContext`. `onDragEnd` is the first dispatch. So during the entire drag gesture:

- The transparent Konva Rect (handles) moves visually with the mouse.
- The DOM content (`CanvasContent` divs) stays frozen at the old `layer.x / layer.y` — model hasn't changed yet.
- The Geometry panel X/Y fields stay at the old values.

After `onDragEnd` fires, `dispatch(update_layer)` updates the model, `CanvasContent` re-renders at the new position, and the Geometry panel updates. The user experiences a "snap" at release rather than smooth tracking.

Exact same issue for resize: `onTransformEnd` fires once, nothing live during the transform gesture.

**Fix:** Add `update_layer_live` action to `EditorContext` — identical to `update_layer` but does NOT push to `state.past` (no undo entry). Dispatch it from `onDragMove` with current x,y, and from a new `onTransform` handler with current x,y,w,h. `onDragEnd` / `onTransformEnd` dispatch the regular `update_layer` (creates the single undoable op). To prevent the model→Konva sync `useEffect` from fighting the Transformer during live resize, guard it with an `isTransforming` ref.

---

### Item 3: Panel → Canvas (typing Geometry fields)

**Root cause check:** When typing in `NumInput`, `up({ x: v })` dispatches `update_layer`. Reducer updates `state.template.layers`. Two things happen in parallel:

1. `CanvasContent` re-renders from the new `template.layers` — DOM div moves. ✓  
2. `KonvaInteractionLayer` `useEffect([template.layers])` fires → `node.x(layer.x)` etc. — Konva Rect moves. ✓

**Verdict: Panel → Canvas works correctly for all Geometry fields (X, Y, W, H, Angle, Opacity, Skew).** No fix needed.

---

### Item 4: Visibility toggle

**Root cause check:** The ⋯ context menu in `LayerRow` dispatches `update_layer({ hide: !layer.hide })`. `CanvasContent` renders `if (layer.hide) return null` per layer. `KonvaInteractionLayer` sets `listening={!layer.hide}` on the Rect.

**Verdict: Wired correctly.** The toggle is only reachable via the ⋯ context menu — there's no direct eye-icon in the layer list. This is a UX gap (Tier 3 polish, not a wiring bug).

---

### Item 5: All controls — state write-back audit

Traced every `onChange` handler in all five panel files. **All controls dispatch correctly.** Specific findings:

| Control | Write-back | Notes |
|---------|-----------|-------|
| All typography (font, size, weight, color, kerning, line-height, transforms, decoration, direction) | ✅ | |
| Text fit (enabled, min, max, max_lines) | ✅ | Nested patch: `{ text_fit: {...layer.text_fit, enabled: v} }` — correctly preserves other text_fit fields |
| Text box padding | ✅ | |
| Secondary style (color, font) | ✅ | |
| Per-line background (all 6 fields) | ✅ | |
| Text content textarea | ✅ | |
| Image source URL | ✅ | |
| hide_when_empty | ✅ | |
| Fill (cover/contain) | ✅ | |
| Anchor X/Y | ✅ | |
| Tint color | ✅ | |
| border_radius (image) | ✅ | |
| Rectangle fill (solid/gradient) | ✅ | |
| Gradient stops (color, position, add, remove) | ✅ | Creates new array correctly |
| border_radius (rect) | ✅ | |
| Border (add, color, width, style, remove) | ✅ | |
| Constraint pins (H and V) | ✅ | Nested patch: `{ constraints: {...layer.constraints, horizontal: v} }` |
| Variable metadata (label, required, default, category, help) | ✅ | VarMetadataPanel clears `var` when label is empty |
| Geometry (W, H, X, Y, Angle, Opacity, Skew X, Skew Y) | ✅ | |
| Lock aspect ratio | ✅ | |

**No broken write-backs found.** One housekeeping note: `update_template_name` does NOT add to the undo stack — renaming the template cannot be undone. Not a Tier 1 blocker.

---

### Item 6: Undo/redo

**Root cause check:** `update_layer` builds `Op[]` via `Object.entries(action.patch)`. For nested-object patches (e.g. `{ text_fit: {...} }`), `key="text_fit"`, `from=layer.text_fit`, `to=new_text_fit`. Undo correctly restores the entire old object. For multi-field patches (drag end writes x+y), both ops are in one `Op[]` group and undo reverses both atomically.

**Verdict: Undo/redo works correctly for all `update_layer` dispatches.** The single exception is drag/resize: since the current implementation only writes to the model on `onDragEnd`/`onTransformEnd`, undo captures one op per gesture (not per pixel), which is correct behaviour.

After fixing Item 1 (live drag via `update_layer_live`), undo must still work: `update_layer_live` must NOT push to `past`; `onDragEnd`'s `update_layer` pushes one op capturing pre-drag → post-drag.

---

### Item 7: Save → reload persistence

**Root cause check:** Full chain traced:
1. `EditorHeader.handleSave` → `PATCH /api/platform/image/templates/{id}` with `{ layer_template: template, schema_version: 2 }` ✓  
2. API route → `update_template({ layerTemplate: template })` (D4) → `update_image_template(p_schema_version=2, p_definition=template)` RPC (D2) ✓  
3. DB stores `definition = template JSONB`, `schema_version = 2` ✓  
4. On reload: `list_templates()` → `toTemplate()` → `row.schema_version === 2` → `resolvedTemplate = row.definition as Template` ✓  
5. `EditTemplatePage` detects `schemaVersion === 2` → `<EditorShell template={template.resolvedTemplate} .../>` ✓  

**Verdict: Save → reload works correctly.**

---

### Tier 1 Fix Plan

**One PR:** Add `update_layer_live` to `EditorContext` + wire it in `KonvaInteractionLayer` for both drag and resize. This is the **only code fix needed for Tier 1** — all other items are correctly implemented.

**Scope of change:**
- `components/image/editor/EditorContext.tsx` — add `update_layer_live` action (no undo push)
- `components/image/editor/KonvaInteractionLayer.tsx` — dispatch `update_layer_live` from `onDragMove` and new `onTransform`; guard sync useEffect from fighting live Transformer


---

## Tier 2 UAT Investigation — 2026-05-31

### Item 1: Per-layer actions (⋯ menu)

**Code traced:** All five actions in `LayerRow.tsx` dispatch to `EditorContext` and are correctly wired:

| Action | Dispatch | Persists |
|--------|---------|---------|
| Lock/Unlock | `update_layer({ locked: !layer.locked })` | ✓ via save |
| Hide/Show | `update_layer({ hide: !layer.hide })` | ✓ |
| Rename | `update_layer({ name: newName })` with slug validation | ✓ |
| Duplicate | `add_layer(copy, index)` — inserts above original in top-first order | ✓ |
| Delete | `remove_layer(layerId)` | ✓ |

**Verdict: All actions work correctly. No fix needed.**

Note: locked layers show `draggable={false}` on Konva Rects; the visual lock icon (🔒) appears in the layer row. CanvasContent does not reduce opacity for locked layers (cosmetic gap, Tier 3).

---

### Item 2: + Layer button

**Root cause:** `EditorLeftPanel.tsx` line 85: the `+ Layer` `<Button>` has NO `onClick` handler — it's a complete placeholder from U1. Clicking it does nothing.

**Fix:** Implement `AddLayerMenu` component — a Radix Popover with three options (Text, Image, Rectangle). Each creates a default Layer object and dispatches `add_layer` at index 0 (top of stack). Layer IDs use `${type}_${Date.now().toString(36)}`.

---

### Item 3: Snap/alignment guides

**Root cause A (bug): `guides.splice(findIndex(-1), 1)`.** In `GuideLines.ts` `computeSnap()`:

```typescript
guides.splice(guides.findIndex((g) => g.orientation === "V"), 1);
```

When no V-orientation guide exists yet, `findIndex` returns -1. `Array.splice(-1, 1)` removes the LAST element — potentially destroying an already-added H-orientation guide. This causes guides to disappear unpredictably when both axes snap near-simultaneously.

**Fix:** Guard with `!== -1` before splicing.

**Root cause B (missing UI): No guides toggle.** `KonvaInteractionLayer` reads `template.settings?.guides !== false` to enable snap, but `EditorLeftPanel` has no control to set `template.settings.guides`. The user can't disable guides from the editor.

**Fix:** Add a guides toggle button to the `EditorLeftPanel` footer (dispatch `update_template_settings`... actually use a simpler approach: add a `toggle_guides` action or dispatch `update_layer` equivalent for settings).

Actually the cleanest fix: add `update_settings` action to EditorContext that patches `template.settings`, and wire a toggle button in `EditorLeftPanel`.

---

### Item 4: Text Fit

**Root cause:** `CanvasContent.TextLayerEl` uses `layer.font_size` unconditionally (line 148). There is no text-fit computation in the DOM renderer. The `fitFontSize` binary-search algorithm lives only in `lib/image/compositing/layer-renderer.ts` (has `import "server-only"`) and runs at sharp-render time. The editor shows a static font size regardless of `text_fit.enabled`.

**Fix:** Extract `fitFontSize`, `wrapLayerText`, `measureTextWidth`, and `CHAR_RATIO` from `layer-renderer.ts` into a client-safe module (like `lib/image/secondary-style-parser.ts` was extracted). Then in `TextLayerEl`, when `layer.text_fit.enabled`, call the extracted `fitFontSize` to compute the display font size.

This ensures the editor preview matches the server-rendered image for text-fit layers.

---

### Tier 2 Fix Plan

| Fix | Severity | Files |
|-----|----------|-------|
| Add `+ Layer` menu (AddLayerMenu component) | Major | `EditorLeftPanel.tsx`, new `AddLayerMenu.tsx` |
| Fix `splice(-1)` bug in `computeSnap` | Major | `GuideLines.tsx` |
| Add guides toggle to EditorLeftPanel | Minor | `EditorLeftPanel.tsx`, `EditorContext.tsx` |
| Text-fit in DOM renderer | Major | New `lib/image/text-fit-utils.ts`, `CanvasContent.tsx` |


---

## Tier 2 Re-Investigation — 2026-05-31 (second UAT pass)

### Items 1, 2, 4, 5 — Status from previous session

These were investigated, fixed, and deployed in the previous Tier 2 pass:

| Item | Status | PR | Evidence |
|------|--------|----|---------|
| 1. Per-layer ⋯ actions | ✅ Working + persists | — | Code trace confirmed Lock/Hide/Rename/Duplicate/Delete all dispatch to EditorContext and survive save/reload via the full template JSON write path |
| 2. + Layer menu | ✅ Implemented | #1206 | AddLayerMenu component: Text/Image/Rectangle, unique names, inserted at index 0 |
| 4. Snap guides | ✅ Fixed + toggle | #1206/#1207 | splice(-1) bug fixed; toggle_guides action + UI toggle in left panel footer |
| 5. Text Fit auto-size | ✅ Fixed | #1208 | fitFontSize() now runs in CanvasContent via lib/image/text-fit-utils.ts; editor preview matches generated image |

---

### Item 3: Multiple image layers coexist

**Code trace — CanvasContent (DOM renderer):**

`renderOrder = [...template.layers].reverse()`. Each layer is wrapped in a `div style={{ position:"absolute", inset:0 }}` click-capture div containing an `ImageLayerEl` with explicit `left/top/width/height`. Multiple ImageLayerEl components render independently at their own canvas coordinates — no collision, no shared state. ✓

**Code trace — sharp renderer (renderTemplate):**

```typescript
for (const layer of [...layers].reverse()) {
  if (layer.type === "image") {
    overlay = await renderImageLayer(layer); // null on fetch failure
  }
  if (overlay) overlays.push(overlay);
}
const png = await canvas.composite(overlays).png().toBuffer();
```

Each image layer produces a separate `sharp.OverlayOptions` entry in the `overlays` array. `sharp.composite()` accepts multiple overlays and renders them in order (later entries appear on top). Multiple image layers composite independently with their own `left`/`top` positions. ✓

**Potential performance note (not a bug):** If two image layers share the same `image_url`, the renderer fetches the URL twice (no deduplication at the fetch level). Acceptable for V1 — optimisable later.

**Verdict: Multiple image layers coexist correctly in both the editor DOM renderer and the sharp renderer.** A template with a photo layer + decorative image layer + logo layer produces correct layered output with independent fill/anchor/tint per layer. No fix needed.

