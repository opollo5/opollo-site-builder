# LeadSource design system seed

Source of truth for the LeadSource design system as inserted by
`scripts/seed-leadsource.ts`. Every file under this directory is read by
the seed script and becomes a row in the `design_systems`,
`design_components`, or `design_templates` tables.

This directory is committed **except** `source/`, which holds the one-time
extraction artefact (`v2-stripe.html`) and is gitignored.

## Layout

```
seed/leadsource/
├── design-system.json       # meta: version, notes, file paths
├── tokens.css               # inserted into design_systems.tokens_css
├── base-styles.css          # inserted into design_systems.base_styles
├── components/              # one triplet per component (Phase 2)
│   ├── {name}.html
│   ├── {name}.css
│   └── {name}.schema.json
├── templates/               # one JSON file per template (Phase 2)
│   └── {name}.json
└── source/                  # gitignored — one-time extraction artefact
```

## Component triplet

`components/{name}.html`
```html
<section class="ls-hero-centered">
  <h1>{{headline}}</h1>
  <p>{{sub}}</p>
</section>
```

`components/{name}.css`
```css
.ls-hero-centered { padding: 4rem 1rem; text-align: center; }
```

`components/{name}.schema.json`
```json
{
  "category": "hero",
  "variant": "default",
  "content_schema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": ["headline", "sub"],
    "properties": {
      "headline": { "type": "string", "maxLength": 120 },
      "sub": { "type": "string", "maxLength": 280 }
    }
  },
  "image_slots": null,
  "usage_notes": "Hero for homepages. Keep sub under one sentence.",
  "preview_html": null
}
```

The filename stem (`{name}`) becomes `design_components.name`. It must
match the lowercase-kebab-case regex `^[a-z0-9-]+$` enforced by the Zod
schema in `lib/components.ts`.

## Template JSON

`templates/{name}.json`
```json
{
  "page_type": "homepage",
  "name": "homepage-default",
  "is_default": true,
  "composition": [
    { "component": "nav-default", "content_source": "site_context.menus" },
    { "component": "hero-centered", "content_source": "brief.hero" },
    { "component": "footer-default", "content_source": "site_context.footer" }
  ],
  "required_fields": { "hero": ["headline", "sub"] },
  "seo_defaults": { "title_suffix": " | LeadSource" }
}
```

Every component referenced in `composition[].component` must exist in the
`components/` directory — the seed script validates this before any
inserts run.

## Running the seed

See `scripts/README.md`. Short form:

```
supabase start
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  npx tsx scripts/seed-leadsource.ts --site-id <uuid>
```

The design system is created as `status = 'draft'`. Activation is a
separate, explicit step (post-M1d) — the script prints the exact SQL at
the end of a successful run.

## Phase status

- [x] **Phase 1 (M1c-skeleton)** — directory structure, placeholder
      `tokens.css` / `base-styles.css`, script with zero-component run.
- [ ] **Phase 2 (M1c-components)** — extract components from `source/v2-stripe.html`,
      produce every triplet + homepage template.
