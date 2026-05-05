# Pattern — Site Graph Architecture (M16)

## When to use it

Any feature that reads or writes the structured site model: site plans, route registries, shared content, page documents, or the WordPress publisher for structured output.

Don't use for: the original brief-runner HTML pipeline (M3–M15). That path writes `generated_html` directly and is unchanged. New page generation goes through the M16 graph path.

## What it is

The site graph replaces HTML-as-canonical with a structured JSON page model. HTML becomes a derived output.

```
brief → Pass 0+1 (Sonnet, once) → SitePlan JSON
     → Pass 2 (Haiku, per page) → PageDocument JSON
     → Pass 3 (code, free)      → ValidationResult
     → Pass 4 (code, free)      → rendered HTML (cached)
     → publishSlot               → WordPress
```

The four new tables:

| Table | What it holds |
|---|---|
| `site_blueprints` | One row per site: `brand_name`, `route_plan`, `nav_items`, `footer_items`, `cta_catalogue`, `seo_defaults`. Status: `draft → approved`. |
| `route_registry` | One row per page: `slug`, `page_type`, `label`, `status`. Carries `wp_page_id` and `wp_content_hash` after publish. |
| `shared_content` | Reusable CTA / testimonial / etc. rows referenced by ID in `PageDocument`. Soft-deleted via `deleted_at`. |
| `pages` (extended) | Gains `page_document` (jsonb), `html_is_stale` (bool), `validation_result` (jsonb), `wp_status` (`not_uploaded → published → drift_detected`). |

## Key files

| File | Role |
|---|---|
| `lib/site-blueprint.ts` | CRUD for `site_blueprints`. `getSiteBlueprint`, `createSiteBlueprint`, `approveSiteBlueprint`, `revertSiteBlueprint`. |
| `lib/route-registry.ts` | `upsertRoutesFromPlan`, `listActiveRoutes`, `getRouteBySlug`. |
| `lib/shared-content.ts` | `listSharedContent`, `createSharedContent`, `updateSharedContent`, `deleteSharedContent` (soft-delete). |
| `lib/models.ts` | Model constants. Pass 0+1: Sonnet. Pass 2+critique+revise: Haiku. Never hardcode model strings. |
| `lib/generator-payload.ts` | Assembles the Anthropic payload with `PAYLOAD_CAPS` enforced before any LLM call. |
| `lib/page-validator.ts` | Pure TypeScript — zero LLM calls. Validates `PageDocument` field types, broken refs, hardcoded URLs, component type membership. |
| `lib/component-registry.ts` | 8 types × 20 variants. Render functions + field schemas. Source of truth for valid component types. |
| `lib/page-renderer.ts` | Pure function: `PageDocument → HTML string`. Calls component render functions, substitutes route refs, injects CSS variables. |
| `lib/gutenberg-format.ts` | `wrapInGutenbergBlock`, `isGutenbergCandidate`, `computeContentHash`. Used by `publishSlot` for M16 pages. |
| `lib/wp-global-styles.ts` | Compiles `design_tokens → theme.json` partial. Sends only Opollo-managed keys (`settings.color.palette`, `settings.typography.fontSizes`, `settings.spacing`). |
| `lib/wp-site-publish.ts` | Orchestrates site-level WP assets: theme tokens + shared content → WP Synced Patterns. |
| `lib/drift-detector.ts` | `runDriftDetector`: per-site hourly SHA-256 compare of WP raw content vs `route_registry.wp_content_hash`. |

## Data flow for a new site

```
1. Operator clicks "Generate site plan"
   → POST /api/sites/[id]/blueprints
   → lib/site-planner.ts (Pass 0+1, Sonnet)
   → Stores: site_blueprints (draft) + route_registry rows + shared_content rows

2. Operator reviews and approves the plan
   → POST /api/sites/[id]/blueprints/[id]/approve
   → site_blueprints.status = 'approved'

3. Batch job enqueued (requires approved blueprint)
   → lib/batch-worker.ts calls lib/page-document-generator.ts (Pass 2, Haiku)
   → Stores: pages.page_document, pages.html_is_stale = true

4. Render worker picks up html_is_stale = true pages
   → lib/render-worker.ts → lib/page-validator.ts → lib/page-renderer.ts
   → Stores: pages.generated_html, pages.html_is_stale = false

5. Publish step
   → publishSlot in lib/batch-publisher.ts
   → isGutenbergCandidate check → wrapInGutenbergBlock if true
   → WP create/update → pages.wp_status = 'published'
   → computeContentHash → route_registry.wp_content_hash

6. Site-level publish (once per site, operator-triggered)
   → POST /api/sites/[id]/blueprints/[id]/publish-site
   → publishSiteToWordPress: theme.json patch + shared content → WP Synced Patterns
```

## Write-safety rules

1. **Blueprint approval is the batch gate.** `lib/batch-worker.ts` checks `site_blueprints.status = 'approved'` before enqueuing page slots. A `draft` blueprint cannot trigger page generation.

2. **Idempotency key per (brief_id, page_ordinal, pass_kind, pass_number).** Re-processing a reaped slot reuses the same key. Never mint a fresh key on retry.

3. **publishSlot M16 path**: `generation_job_pages.pages_id` must be pre-set to the M16 `pages` row ID at slot insert time. `publishSlot` adopts that row (no INSERT), sets `wp_status = 'published'`, then fires the `computeContentHash` update as a post-commit task.

4. **`m16_route_id` is the M16 signal in `PublishContext`.** Its presence triggers: Gutenberg wrapping, conditional `wp_status` UPDATE, and `wp_content_hash` fire-and-forget.

5. **Drift detection never auto-overwrites.** `pages.wp_status = 'drift_detected'` is a flag only. The operator chooses: Accept WP / Overwrite / Compare. See `lib/drift-detector.ts`.

6. **theme.json patch isolation.** Publisher only sends `settings.color.palette.theme`, `settings.typography.fontSizes.theme`, and `settings.spacing.spacingScale`. Other theme keys are untouched.

## Testing shape

Pure-function tests (no DB): validator, renderer, `compileThemeJsonPatch`, `wrapInGutenbergBlock`, `sharedContentSlug`, `computeContentHash` — all in `lib/__tests__/`.

DB integration tests: `publishSlot` with pre-linked `pages_id` verifies `wp_status='published'` and 64-char `wp_content_hash`. `seedM16SlotAndPages` helper in `lib/__tests__/_helpers.ts` (or inline) sets up the pre-link.

E2E: `e2e/m16-site-graph.spec.ts` stubs all API calls via Playwright route interception and verifies the blueprint review and shared content admin pages.

## Admin routes

| Route | Purpose |
|---|---|
| `/admin/sites/[id]/blueprints/review` | Site plan review: brand name, route plan table, approve/revert buttons. |
| `/admin/sites/[id]/content` | Shared content manager: list + create/edit/soft-delete shared content rows. |
