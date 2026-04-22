# Pattern — Extract design system

## When to use it

Onboarding a new client's front-end (HTML + CSS bundle) into the structured design-system registry (`design_systems` / `design_components` / `design_templates`). LeadSource was M1c; Planet6 and every subsequent client reuses this shape.

Don't use for: editing a design system that's already in the registry (that goes through the normal admin surface). Don't use for extracting brand tokens for a new design from scratch — the pattern assumes you have an existing production site to mirror.

## Required files

| File | Role |
| --- | --- |
| `seed/<client>/tokens.css` | CSS variables for colours, spacing, typography. |
| `seed/<client>/base-styles.css` | Global reset / element defaults — not tied to any component. |
| `seed/<client>/components/<component-name>/template.html` | HTML skeleton for the component. Handlebars-style `{{var}}` holes for dynamic content. |
| `seed/<client>/components/<component-name>/styles.css` | Component-scoped CSS. Every class prefixed with the site's scope prefix. |
| `seed/<client>/components/<component-name>/meta.json` | `{ name, variant?, category, purpose, usage_notes, content_schema, image_slots }`. |
| `seed/<client>/templates/<template-name>.json` | `{ name, page_type, is_default, composition: [{ component_id, slot_name }] }`. |
| `scripts/seed-<client>-design-system.ts` | Idempotent seed script. Runs under `tsx`; reads the files, inserts into the DB via service-role. |
| `lib/__tests__/class-registry.test.ts` extension | Add acceptance tests asserting every real component's classes validate against the registry. |

## Scaffolding

### Scope prefix

Every new client gets a 2–4-char scope prefix. Auto-generated server-side when a `sites` row is created (see the algorithm in `lib/scope-prefix.ts` + the now-removed "scope prefix" UI field). Every CSS class in the seed must start with `<prefix>-`.

Examples:
- LeadSource → `ls-card`, `ls-hero`, `ls-btn`.
- Planet6 → `p6-card`, `p6-hero`, `p6-btn`.

The `validateScopedCss(prefix, css)` helper in `lib/scope-prefix.ts` enforces this. The seed script must pass every component's CSS through it before insert — catches hand-typed rogue classes.

### Component extraction

For each reusable block on the source site:

1. **Pick a name.** `kebab-case`, descriptive. Examples: `hero-with-showcase`, `pricing-teaser-3-tier`, `final-cta-dark`.
2. **Extract the HTML.** Copy the rendered markup, replace dynamic values with `{{placeholder}}` holes. Keep structural classes; drop one-off inline styles.
3. **Extract the CSS.** Find every selector targeting that block. Namespace them all with the scope prefix. Prefer class selectors over element or id selectors.
4. **Author `meta.json`**:
   ```json
   {
     "name": "hero-with-showcase",
     "variant": null,
     "category": "hero",
     "purpose": "Landing-page hero with product preview on the right.",
     "usage_notes": "Use at the top of marketing landing pages. Pairs with `nav-default`.",
     "content_schema": {
       "type": "object",
       "required": ["headline", "subheadline", "cta_label", "cta_href"],
       "properties": {
         "headline": { "type": "string", "maxLength": 80 },
         "subheadline": { "type": "string", "maxLength": 200 },
         "cta_label": { "type": "string", "maxLength": 30 },
         "cta_href": { "type": "string", "format": "uri-reference" }
       }
     },
     "image_slots": [
       { "key": "product_preview", "alt_required": true }
     ]
   }
   ```
5. **Verify against the registry.** Run the class-registry tests locally after updating the fixtures.

### Template extraction

For each canonical page type (`landing`, `product`, `about`, `pricing`):

1. Identify the typical composition: e.g. `nav → hero → trust strip → value props → social proof → pricing → CTA → footer`.
2. Write the composition JSON:
   ```json
   {
     "name": "canonical-landing",
     "page_type": "landing",
     "is_default": true,
     "composition": [
       { "component_id": "nav-default", "slot_name": "top" },
       { "component_id": "hero-with-showcase", "slot_name": "hero" },
       { "component_id": "trust-logo-strip", "slot_name": "social-proof-1" },
       ...
     ],
     "seo_defaults": {
       "meta_description_template": "{{client}} — {{page_title}}"
     }
   }
   ```
3. `is_default: true` on exactly one template per `(design_system, page_type)`. A DB CHECK + UNIQUE partial-index enforces it; see `lib/__tests__/templates.test.ts`.

### Seed script

Model on the M1c LeadSource seed scaffold. Shape:

```ts
// scripts/seed-<client>-design-system.ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { getServiceRoleClient } from "@/lib/supabase";
import { validateScopedCss } from "@/lib/scope-prefix";

const CLIENT = "<client-slug>";
const ROOT = join(process.cwd(), "seed", CLIENT);

async function main() {
  const svc = getServiceRoleClient();

  // 1. Resolve the site row + prefix.
  const { data: site } = await svc.from("sites").select("id, prefix").eq("slug", CLIENT).single();
  if (!site) throw new Error(`No site row for ${CLIENT}. Register the site first.`);

  // 2. Upsert the design_systems row at the next version.
  // 3. For each component: validateScopedCss(prefix, css) → insert.
  // 4. For each template: verify composition references exist → insert.
  //
  // All three steps are idempotent: ON CONFLICT do nothing / update.
  // Re-running the script leaves the DB in the same state.
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run with `npx tsx scripts/seed-<client>-design-system.ts`. Idempotent so CI + local + staging + prod all tolerate repeat runs.

## Required tests

1. **Class-registry acceptance.** Extend `lib/__tests__/class-registry.test.ts` with a `<client>-seed-acceptance` describe block that loads each component's HTML + CSS and asserts `validateHtmlClasses(...)` returns `valid: true`. Prevents rogue classes slipping in.
2. **Scope-prefix validation.** Extend `lib/__tests__/scope-prefix.test.ts` asserting every shipped component's CSS passes `validateScopedCss(prefix, css)`.
3. **Seed script idempotency.** Run the seed twice in a test; assert row counts are identical.
4. **Template composition integrity.** For each template, load the composition and assert every referenced `component_id` exists in the same design-system.

## Standard PR structure

Follow [`ship-sub-slice.md`](./ship-sub-slice.md). Title shape:

`feat(m<slice>): extract <client> design system`

E.g. `feat(m1c): extract LeadSource design system`.

Description specifically calls out:

- **Scope prefix** chosen + why (auto-generated or hand-picked).
- **Components extracted** — list each with a one-liner.
- **Templates extracted** — list each with the `page_type`.
- **Class-registry coverage** — "N components × M classes, all validate clean."
- **Unknown classes flagged** — if any component had ambiguous classes you decided to drop, note which and why.

## Known pitfalls

- **Inline `style="..."` attributes in the HTML.** Layer-3 class-registry validation can't catch rule drift inside inline styles. Move them into the component's CSS and reference by class; keeps behaviour auditable.
- **Class selectors without the prefix.** `validateScopedCss` rejects these; the error is per-line. Don't add an allow-list exception — fix the CSS. Common cause: copy-paste from the source site's legacy CSS kept a bare `h1` or `.btn` selector.
- **Compound selectors that use the prefix only on the first token.** `.ls-card.dark` fails — every class in the selector must be prefixed. Fix: rename to `.ls-card.ls-card--dark`.
- **Handlebars `{{if ...}}` blocks inside class attributes.** The class-registry HTML extractor handles these (see `lib/class-registry.ts`), but they have to be well-formed. Malformed `{{#if}}` with no matching `{{/if}}` silently pollutes the extracted class set.
- **Dup `is_default: true`** across templates for the same `(design_system, page_type)`. The UNIQUE partial-index fires 23505; seed script should ON CONFLICT take the most-recent. Verify by running the seed twice.
- **`content_schema` too loose.** `"type": "string"` with no maxLength is a path to LLM-generated essays. Always cap with `maxLength` on free-text fields.
- **Image slots that say `alt_required: false`.** Layer-3 quality gate fails the page if any `<img>` lacks a meaningful alt. If a decorative image legitimately has empty alt, use `alt_required: "decorative"` (needs schema extension) — don't silently allow `alt=""` in the schema.
- **Seed script inserting before site row exists.** Seed depends on `sites.id` + `sites.prefix`. Script should fail loud with a message ("register the site first") rather than silently no-op.

## Pointers

- Shipped example: LeadSource — `seed/leadsource/` + `scripts/seed-leadsource-design-system.ts` (if present; else the M1c PR).
- Related: [`new-migration.md`](./new-migration.md) (if the new client's schema needs a bump), [`new-admin-page.md`](./new-admin-page.md) (editing after seed).
- `lib/scope-prefix.ts` — CSS validation.
- `lib/class-registry.ts` — HTML-vs-registry validation.
