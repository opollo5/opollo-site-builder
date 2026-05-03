# M16 — Site Graph Architecture
## Canonical structured data layer, deterministic renderer, WordPress publisher

## Status
Planned. Auto-continue is ON for this milestone. See §Autonomous build rules.

## What it is

Replaces the current "generate HTML and store it as truth" pattern with a
structured site graph — a canonical JSON page model, shared content records,
a route registry, and a deterministic renderer. HTML becomes a derived output.

This fixes every known production problem in one architectural change:

- Inconsistent multi-page output → components are typed and constrained
- Broken internal links → route refs replace URL strings structurally
- CTAs that drift across pages → shared_content records referenced by ID
- Colour that keeps disappearing → design tokens, never inline styles
- Expensive regeneration loops → section-level regen, not full-page

The generation pipeline changes from:
```
brief → LLM → HTML string → stored as canonical
```
to:
```
brief → Pass 0+1 (Sonnet, once) → SitePlan JSON
     → Pass 2 (Haiku, per page) → PageDocument JSON
     → Pass 3 (code, free)      → ValidationResult
     → Pass 4 (code, free)      → rendered HTML cached
```

M1–M12 infrastructure (worker machinery, auth, images, cost budgets,
observability) is unchanged. Only what flows through the pipeline changes.

## Autonomous build rules

Claude Code executes this milestone without operator input unless:
1. An env var is missing and cannot be defaulted.
2. An external service signup is required (none expected in M16).

**On every decision:** log it to `docs/M16-DECISIONS.md` in the format:
```
[SLICE] [TIMESTAMP] Decision: <what> | Reason: <why> | Alternative: <what was rejected>
```

**On every blocked step:** log to `docs/M16-DECISIONS.md` with tag `[BLOCKED]`,
continue with the next unblocked slice, return to the blocked step when unblocked.

**Never ask.** If the correct approach is ambiguous, pick the option that:
1. Copies more from an existing repo rather than inventing
2. Is simpler
3. Uses the cheaper model

**Auto-continue fires automatically** after each slice merges. No checkpoint
between slices. One checkpoint only: after M16-7 (full system working end-to-end)
before M16-8 (WordPress publisher update) — this is the only user-visible pause.

## Env vars required

No new env vars. All of the following are already provisioned:
- `ANTHROPIC_API_KEY` — used by existing workers
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` — existing
- `CRON_SECRET` — existing, used by render worker cron
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — existing

If `ANTHROPIC_API_KEY` is absent, M16-4 and M16-5 will log `[BLOCKED]` and
auto-continue to M16-6. The blocked slices resume when the key is present.

## Sub-slice breakdown

| Slice | Scope | Write-safety | Blocks on |
|---|---|---|---|
| **M16-1** | Schema migration: `site_blueprints`, `route_registry`, `shared_content` tables. Add `page_document`, `html_is_stale`, `validation_result`, `wp_status` to `pages`. Add `puck_fields`, `default_props`, `allowed_ref_types` to `design_components`. RLS following M2b matrix. | High — new tables, additive columns. Existing rows and pipeline unaffected. | Nothing |
| **M16-2** | Types + constants: `lib/types/page-document.ts` (copied from Puck), `lib/models.ts` (model selection constants), `lib/generator-payload.ts` (payload builder with hard caps). Data layer: `lib/site-blueprint.ts`, `lib/route-registry.ts`, `lib/shared-content.ts` following M1 conventions. | Low — types and data layer only, no LLM calls. | M16-1 |
| **M16-3** | Component registry: `lib/component-registry.ts` with field schemas copied from Payload Website Template. Render functions populated from HyperUI (20 variants). CSS file `public/opollo-components.css`. Hero end-to-end first; pattern locked; remaining 19 variants copied from that pattern. | Medium — component registry is load-bearing for validator and renderer. Must be complete before M16-4. | M16-2 |
| **M16-4** | Site planner: `lib/site-planner.ts`. Pass 0+1 combined, one Sonnet call, returns `SitePlan` JSON. Stores to `site_blueprints`, `route_registry`, `shared_content`. Idempotency key on brief_id. Prompt locked — no iteration. | High — writes to three tables, Sonnet call billed. | M16-2 |
| **M16-5** | Page document generator: `lib/page-document-generator.ts`. Pass 2, Haiku call per page, returns `PageDocument` JSON. JSON parse failure → retry with error (max 2). Schema validation failure → retry with errors (max 2). One copy-quality critique + revise (both Haiku). Prompt locked. | High — billed Haiku calls, idempotency key per (brief_id, page_ordinal). | M16-3 + M16-4 |
| **M16-6** | Validator + resolver + renderer: `lib/page-validator.ts` (zero LLM), `lib/ref-resolver.ts` (one batch DB query), `lib/page-renderer.ts` (pure function). Render worker `lib/render-worker.ts` processes `html_is_stale = true` pages using M3 lease/heartbeat pattern. | Medium — renderer is pure function, worker follows existing pattern. | M16-3 + M16-5 |
| **M16-7** | Update `lib/batch-worker.ts` to run M16-4 once per job then M16-5 per page slot. Update M12's brief-runner to emit `PageDocument` instead of HTML. Preview iframe updated to use renderer output. Site plan review UI (`/admin/sites/[id]/blueprints/review`). Shared content manager (`/admin/sites/[id]/content`). Section prop editor (extends M12-5 run screen). Ref pickers. ← **CHECKPOINT: pause here for operator review before WP changes.** | High — changes what existing workers produce. | M16-4 + M16-5 + M16-6 |
| **M16-8** | WordPress publisher update: `lib/batch-publisher.ts` emits `theme.json`, header/footer template parts, synced CTA patterns, page body as Custom HTML block with `data-opollo-id` attributes. Redirect on slug change. Drift detection (hourly hash compare). | High — WP API calls, existing publisher is live. Must not break existing page publishes. | M16-7 |
| **M16-9** | E2E spec covering: upload brief → site plan review → approve → generate 3 pages → review sections → edit one prop → approve → publish to WP → verify WP status. Docs: `docs/patterns/site-graph.md`, `docs/patterns/page-document-generator.md`. Update `BACKLOG.md` M16 tracker. | Low — tests and docs only. | M16-8 |

## Model selection (enforced in `lib/models.ts`)

| Pass | Model | Reason |
|---|---|---|
| Pass 0+1 Site planning | `claude-sonnet-4-6` | One call per site. Most critical. Wrong here = wrong everywhere. |
| Pass 2 Page generation | `claude-haiku-4-5-20251001` | Structured JSON from tight schema. ~10× cheaper than Sonnet. |
| Pass 2 Self-critique | `claude-haiku-4-5-20251001` | JSON critique against explicit rules. Creativity not required. |
| Pass 2 Revise | `claude-haiku-4-5-20251001` | Constrained edit of structured data. |
| Section regen | `claude-haiku-4-5-20251001` | Single section, small context. |
| Validation | None | Pure TypeScript. Free. |
| Rendering | None | Pure function. Free. |

No other models. No Opus. Model constants live only in `lib/models.ts`.
Any worker that hardcodes a model string fails code review.

## Payload size caps (enforced in `lib/generator-payload.ts`)

```typescript
export const PAYLOAD_CAPS = {
  MAX_CTAS:          20,
  MAX_ROUTES:        20,
  MAX_SHARED_ITEMS:  20,  // per content_type
  MAX_IMAGES:        15,  // relevant subset only
  MAX_BRAND_VOICE_CHARS: 500,  // condensed rules, not full object
} as const;
```

These are enforced in code before any LLM payload is assembled.
Exceeding them truncates (sorted by priority/recency) with a warning logged.
Never silently passed through.

## Component system (locked for v1)

8 component types. 20 variants total. This is the complete list.
No additions without a milestone. No "flexible layout". No "custom section".

```
Hero        × 3 variants  (centered, split-right, split-left)
Features    × 3 variants  (grid-3, grid-2, list)
CTABanner   × 3 variants  (full-width, card, inline)
Content     × 3 variants  (prose, two-column, with-image)
Testimonial × 2 variants  (single, grid)
FAQ         × 2 variants  (accordion, list)
Stats       × 2 variants  (horizontal, grid)
Contact     × 2 variants  (form, details)
```

## HyperUI copy protocol

Source: https://www.hyperui.dev/components/marketing (MIT license)

**Build Hero/centered end-to-end first. Lock the pattern. Copy it for all others.**
Do not parallelise component HTML conversion. Inconsistency guaranteed if you do.

Steps for each component variant:
1. Go to the HyperUI URL for this component type
2. Click Code, copy the HTML
3. Replace hardcoded text with `${props.fieldName}` template literals
4. Replace Tailwind colour classes with CSS variables:
   - `bg-indigo-*` / `bg-blue-*` → `background-color: var(--opollo-color-primary)`
   - `text-gray-900` → `color: var(--opollo-color-text)`
   - `text-gray-500` → `color: var(--opollo-color-muted)`
   - `bg-gray-50` → `background-color: var(--opollo-color-bg-alt)`
   - `border-gray-200` → `border-color: var(--opollo-color-border)`
5. Wrap: `<div class="opollo-${type} opollo-${type}--${variant}" data-opollo-id="${sectionId}">`
6. Add the render function to the component registry

## Puck field component adaptation

**Wrap, do not gut.**

Source: https://github.com/measuredco/puck/tree/main/packages/core/src/components

Copy these 5 files into `components/puck-fields/`:
- `AutoField/index.tsx`
- `AutoField/fields/ArrayField.tsx`
- `AutoField/fields/ObjectField.tsx`
- `FieldLabel/index.tsx`
- `InputOrGroup/index.tsx`

Adaptation — keep internal logic intact, only change the interface boundary:
1. Replace `usePuck` / `PuckContext` imports with plain React props passed in from outside
2. Replace CSS-in-JS with Tailwind classes matching existing Opollo admin style
3. Change `onChange` to `(fieldName: string, value: unknown) => void`
4. Remove drag-and-drop from ArrayField; use shadcn `<Button>` for add/remove only
5. Do NOT rewrite the field type dispatch logic — it is correct and tested in Puck

## UI sources (install before writing any UI code)

```bash
npx shadcn@latest add table dialog sheet tabs badge command popover \
  select separator textarea input label switch toast skeleton \
  scroll-area collapsible radio-group card
```

| Screen | Primary source | Key components |
|---|---|---|
| Site Plan Review | shadcn | `<Tabs>` `<Table>` `<Collapsible>` `<Card>` `<Input>` |
| Section prop editor | Puck AutoField (adapted) | `<AutoField>` `<Sheet>` from shadcn |
| Ref pickers | shadcn Combobox example (copy verbatim, change data source) | `<Command>` `<Popover>` |
| Shared content manager | Copy M5 pattern entirely | M5 list + edit modal |
| Design tokens editor | shadcn | `<Input type="color">` `<Select>` `<RadioGroup>` |
| Sidebar additions | Existing M2 `<NavItem>` | Copy, change href + label |

## Risks identified and mitigated

1. **Pass 0+1 produces a wrong site plan; all pages inherit the error.**
   → Site plan review screen is a hard gate. Page generation cannot be triggered
   without operator approval of the SitePlan. The `site_blueprints` row has
   `status: 'draft' | 'approved'`; `lib/batch-worker.ts` checks `status = 'approved'`
   before running any page slots.
   Test: batch job enqueued against a `draft` blueprint → `BLUEPRINT_NOT_APPROVED`.

2. **LLM returns invalid JSON for PageDocument.**
   → JSON.parse wrapped in try/catch. On failure: retry with the parse error and
   the offending string appended to the prompt. Max 2 retries (Haiku). Third failure
   → page status `failed`, `failure_code: 'JSON_PARSE_FAILED'`. Never stored.
   Test: mock Anthropic to return invalid JSON twice, then valid → page succeeds on
   third attempt with 3 total Haiku calls.

3. **LLM hallucinates a routeRef or ctaRef that does not exist.**
   → Validator (Pass 3) catches `BROKEN_ROUTE_REF` / `BROKEN_CTA_REF`. Page held
   in `awaiting_review` with error displayed in the section prop editor. Operator
   can reassign the ref using the ref picker without regenerating.
   Test: insert a PageDocument with a non-existent ctaRef → validation returns error,
   page stays `awaiting_review`, no WP publish triggered.

4. **LLM writes a hardcoded URL string in props (e.g. `"/contact"`).**
   → Validator checks every string prop value for `/` or `http` prefix.
   `HARDCODED_URL` error blocks approval.
   Test: insert a PageDocument with `props.ctaLink = "/contact"` → validation
   returns `HARDCODED_URL` error.

5. **Render worker races with the batch generator on the same page.**
   → Render worker checks `html_is_stale = true` using `SELECT FOR UPDATE SKIP LOCKED`.
   Generator sets `html_is_stale = true` only after storing the complete `page_document`.
   Two workers cannot process the same page simultaneously.
   Test: two concurrent render worker ticks on the same page → exactly one renders,
   the other skips.

6. **Component type in PageDocument does not exist in the registry.**
   → Validator checks `INVALID_COMPONENT_TYPE` before any render attempt.
   Renderer throws hard on unknown type rather than silently producing empty HTML.
   Test: PageDocument with `type: "UnknownBlock"` → validator error, render throws.

7. **Payload size grows over time, Haiku starts producing bad JSON.**
   → `lib/generator-payload.ts` enforces `PAYLOAD_CAPS` constants at assembly time.
   Logged as `warn` when truncation fires so the operator can see it.
   Test: seed 25 CTAs, assemble payload → only 20 CTAs in output, warning logged.

8. **Existing pages have no `page_document` (generated_html only).**
   → Migration adds columns as nullable. Existing pipeline still writes
   `generated_html` directly. The `page_document` path is additive — old pages
   work exactly as before. New pages use the new path. No forced backfill.

9. **theme.json push conflicts with existing WP theme styles.**
   → Publisher sends a partial theme.json using WordPress's merge semantics.
   Only Opollo-managed keys are written: `settings.color.palette`,
   `settings.typography.fontSizes`, `settings.spacing`. Other keys untouched.
   Test: WP stub asserts the PATCH body only contains the Opollo token keys.

10. **WP-side edits create drift after Opollo publishes.**
    → Drift detector (hourly cron, M16-8) compares `route_registry.wp_content_hash`
    against the WP `/opollo/v1/pages/{id}/hash` endpoint. Mismatch →
    `pages.wp_status = 'drift_detected'`. Operator sees three choices:
    Accept WP, Overwrite, Compare. Never auto-overwrite.

11. **Section regen produces a section inconsistent with surrounding sections.**
    → Section regen prompt includes the full existing `page_document` (all other
    sections) as read-only context. The LLM rewrites only the target section.
    The regenerated section must still pass full-page validation before approval.

12. **Model tier drift — Opus spend.**
    → `lib/models.ts` is the only place model names exist. All workers import
    from it. Any hardcoded model string fails the `no-hardcoded-model` ESLint rule
    added in M16-2. Guard: test asserting every Anthropic call in the codebase
    uses a value from `MODELS`.

13. **Puck component adaptation introduces subtle bugs in nested fields.**
    → Wrap, do not gut. Internal field dispatch logic is left intact.
    Only the context/onChange interface changes at the boundary.
    Test: render `<AutoField>` with an `array` field, add an item, remove an item,
    assert state is correct after each operation.

14. **CSS variable substitution misses a Tailwind class in a HyperUI component.**
    → A visual regression test renders each component variant with default props
    and takes a snapshot. Any change to the snapshot requires explicit approval.
    Additionally: a CSS lint rule flags any `text-*`, `bg-*`, or `border-*` Tailwind
    colour class left in the component HTML output.

## Relationship to existing patterns

- **M16-1** follows `docs/patterns/new-migration.md` exactly. Three new tables +
  additive columns on existing tables. RLS matrix follows M2b. Soft-delete on
  `shared_content`. `version_lock` on all three new tables.

- **M16-2** data layer files follow `lib/design-systems.ts` (M1) as the reference
  implementation. Zod validation at create/update, `version_lock` optimistic locking,
  `updated_by` populated from session, `revalidatePath` on mutations.

- **M16-3** component registry is a new shape. If a second component registry is
  ever needed (e.g. email templates), promote to `docs/patterns/component-registry.md`.

- **M16-4** follows `lib/anthropic-call.ts` (M3) for the Anthropic SDK wrapper,
  `lib/langfuse.ts` (M10) for trace wrapping, M8's `reserveBudget` for cost gating.
  New: the Sonnet planning call shape. Promote to `docs/patterns/site-planner.md`
  if a second planning call type is ever needed.

- **M16-5** follows M12-3's multi-pass runner shape: idempotency key per
  (brief_id, page_ordinal, pass_kind, pass_number), event-log-first cost accounting.
  Same retry/backoff machinery as M3-7. Model selection from `lib/models.ts`.

- **M16-6** render worker follows `docs/patterns/background-worker-with-write-safety.md`
  (M3 proof-of-pattern). Validator is pure TypeScript — no new pattern needed.
  Renderer is a pure function — no new pattern needed.

- **M16-7** admin pages follow `docs/patterns/new-admin-page.md`. The section prop
  editor wrapping Puck AutoField is a new shape — document inline in the component
  file. The ref pickers are shadcn Combobox copies — no new pattern.

- **M16-8** extends `lib/batch-publisher.ts` (M3-6). New: theme.json compilation,
  template part push, synced pattern push. These are additive; existing page publish
  is unchanged in v1. Redirect logic follows M3-6's slug-adoption pattern.

## Sub-slice status tracker

Maintained in `docs/BACKLOG.md` under **M16 — site graph architecture**.

- `M16-1` — planned
- `M16-2` — planned
- `M16-3` — planned
- `M16-4` — planned
- `M16-5` — planned
- `M16-6` — planned
- `M16-7` — planned → **CHECKPOINT after this slice**
- `M16-8` — planned
- `M16-9` — planned

On M16-9 merge, auto-continue proceeds to M16 (scope TBD at checkpoint).
