# M1 — Design System Schema (retroactive)

## Status

Shipped. This plan is backfilled during M11-6 (audit close-out 2026-04-22) to give M1 the same documented risk-audit surface every milestone from M4 onward has.

## What it is

The schema + data layer every later milestone builds on. Three tables (`design_systems`, `design_components`, `design_templates`), RPCs for activation + archive, Zod-validated create/update, and `version_lock` optimistic locking.

M1 shipped before the parent-plan convention was formalised, so its risk audit originally lived implicitly in the test file comments. This retroactive plan documents what the tests actually prove.

## Scope (shipped in M1)

- **Migration 0002** `0002_m1a_design_system_schema.sql` — creates `design_systems` (id, site_id, version, status, tokens_css, base_styles, version_lock, timestamps), `design_components` (id, design_system_id, name, variant, category, html_template, css, content_schema, image_slots, version_lock), `design_templates` (id, design_system_id, page_type, name, composition, required_fields, seo_defaults, is_default, version_lock). UNIQUE constraints on `(site_id, version)`, `(design_system_id, name, variant)`, partial UNIQUE on `(design_system_id, page_type) WHERE is_default` for one-default-per-type. RLS policies for admin + operator + viewer roles.
- **Migration 0003** `0003_m1b_rpcs.sql` — `activate_design_system(ds_id, expected_version)` atomically flips one DS to `active` and archives the previous active per site. Optimistic-locked on `version_lock`.
- **Data layer** `lib/design-systems.ts`, `lib/components.ts`, `lib/templates.ts` — create / read / update / archive + Zod validation.
- **API routes** `/api/design-systems`, `/api/design-systems/[id]/components`, `/api/design-systems/[id]/templates` + `/api/sites/[id]/design-systems` — admin-gated, return the same `{ ok, data }` / `{ ok: false, error }` envelope every later milestone reuses.

## Out of scope (handled in later milestones)

- **Per-site DS activation workflow + admin UI.** Shipped partially in M2 (admin pages) and polished in M6-4 (UX-debt labels).
- **Runtime enforcement of DS composition in generated HTML.** Quality gates (`lib/quality-gates.ts`) shipped in M3-5; M11-4 added the HTML size gate.
- **Image slots → image library wiring.** Shipped in M4.
- **DS prompt injection into Anthropic calls.** `lib/system-prompt.ts` + `lib/design-system-prompt.ts` built in M1d + M3.

## Env vars required

None new. Supabase service role + URL already provisioned.

## Risks identified and mitigated

1. **Two operators racing the activate_design_system RPC.** → The RPC uses a single UPDATE wrapped in a transaction and optimistic-locked on `version_lock`. Loser sees `VERSION_CONFLICT`. Test: `lib/__tests__/design-systems.test.ts` "promotes a draft and archives the previous active atomically."

2. **Archive a DS that's referenced by live pages.** → `design_system_version` is an integer on the page; no FK. Pages retain their recorded version and regen works against whichever DS is currently active at regen time. Historical fidelity is operator responsibility — M7 documents the operator-facing consequence.

3. **Multiple active DSes per site.** → `activate_design_system` atomic flip. Schema alone doesn't constrain `status = 'active'` to one row per site — the RPC is the coordination point. Test coverage: "archives the previous active atomically" asserts exactly one active after promotion.

4. **Two components with the same (design_system_id, name, variant).** → UNIQUE index. Second insert returns `UNIQUE_VIOLATION`. Test: `components.test.ts` "returns UNIQUE_VIOLATION on duplicate (ds, name, variant)."

5. **Two defaults for the same (design_system_id, page_type).** → Partial UNIQUE index `WHERE is_default`. Test: `templates.test.ts` "returns UNIQUE_VIOLATION on second default for the same (ds, page_type)."

6. **RLS accidentally grants a viewer write access.** → M2b RLS policies ship the role matrix. Test: `m2b-rls.test.ts` covers every (role × table × operation) cell.

7. **Version_lock mismatch silently clobbers.** → Every update handler sends `expected_version` on request; the UPDATE's WHERE clause pins the row to that version. Mismatch returns `VERSION_CONFLICT` with `current_version` in details. Tests: "returns VERSION_CONFLICT on stale version_lock" on every table.

## Shipped sub-slices

M1 predates the sub-slice convention. Merged as a tight cluster:

- **M1a** — schema (migration 0002)
- **M1b** — RPCs (migration 0003)
- **M1c** — `lib/*` data layer
- **M1d** — prompt injection surface in `lib/system-prompt.ts`
- **M1e–f** — scope-prefix validator + CSS-scope linting

## Tests that prove each risk

| Risk | Test |
| --- | --- |
| 1, 3 | `lib/__tests__/design-systems.test.ts` activate-related blocks |
| 2 | Implicit — no FK; no constraint to violate |
| 4 | `components.test.ts` duplicate-name test |
| 5 | `templates.test.ts` second-default test |
| 6 | `m2b-rls.test.ts` |
| 7 | Per-table "VERSION_CONFLICT on stale version_lock" tests |

## Relationship to later milestones

- M2b layers RLS on top of the M1 tables.
- M3 reads M1's active DS to build the system prompt per batch slot.
- M6 admin UI surfaces the DS authoring forms (`CreateDesignSystemModal`, `TemplateFormModal`, `ComponentFormModal`).
- M7 regen re-runs Anthropic against whichever DS is currently active.
