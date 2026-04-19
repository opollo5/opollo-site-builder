# scripts/

Operator scripts that run outside the Next.js request path. Executed via
`npx tsx <script>` against a live Supabase.

## seed-leadsource.ts

Inserts the LeadSource design system (tokens, components, templates) out
of `seed/leadsource/` as a new DRAFT design system on a target site.

**Does not activate.** Activation is a separate step — once M1d ships
`FEATURE_DESIGN_SYSTEM_V2`, an operator runs the SQL printed at the end
of a successful seed to flip the new design system to active.

### Prerequisites

- Local Supabase stack running (`supabase start`)
- A `sites` row already exists on the target DB that this design system
  will attach to (the script validates the FK via the standard
  `createDesignSystem` code path)
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exported

### Usage

```bash
# Pick up env from the local Supabase stack:
eval "$(supabase status --output env | sed 's/^/export /')"

# or equivalent — any method that populates SUPABASE_URL and
# SUPABASE_SERVICE_ROLE_KEY before invocation.

npx tsx scripts/seed-leadsource.ts --site-id <uuid>
```

Options:

| Flag           | Required | Default                  | Meaning |
|----------------|----------|--------------------------|---------|
| `--site-id`    | yes      | —                        | UUID of the `sites.id` row to attach to. |
| `--version`    | no       | `design-system.json`'s `version` | Integer version for this design system. Unique per site. |
| `--seed-dir`   | no       | `<repo>/seed/leadsource` | Alternate seed directory (useful for testing). |
| `--help`, `-h` | no       | —                        | Print usage and exit. |

### What it does, in order

1. Validates CLI args and env (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
2. Reads `design-system.json`, `tokens.css`, `base-styles.css`.
3. Discovers components: every filename stem in `components/` with a full
   triplet of `.html` + `.css` + `.schema.json`. Missing any of the three
   is a hard error before any DB write.
4. Discovers templates: every `*.json` in `templates/`.
5. **Pre-flight composition check.** Every `composition[].component` in
   every template must reference a component declared in `components/`.
   Broken templates fail here with a clear message, no partial seed.
6. Creates the design system row (status = `'draft'`).
7. Inserts each component in sorted order.
8. Inserts each template in sorted order.
9. Prints the SQL you'd run to activate the draft when you're ready.

### Exit codes

- `0` — all inserts succeeded.
- `1` — any validation, env, filesystem, or Supabase error. The script
  stops at the first error; later inserts don't run. The DS row may have
  been created — check with `SELECT id, version, status FROM
  design_systems WHERE site_id = '<uuid>'` and archive the partial
  draft before re-running.

### Phase 1 vs Phase 2 (M1c)

- **Phase 1** (merged): script + skeleton seed directory with empty
  `components/` and `templates/`.
- **Phase 2** (this PR): 12 component triplets + `homepage-default`
  template + populated `tokens.css` / `base-styles.css` extracted from
  `seed/leadsource/source/v2-stripe.html`. Running the script now seeds
  the real LeadSource design system as a DRAFT, pending activation after
  M1d ships `FEATURE_DESIGN_SYSTEM_V2`.

## Component naming convention

Component names are lowercase kebab-case, enforced by the Zod regex
`^[a-z0-9-]+$` in `lib/components.ts`. The first segment is usually
(but not strictly required to be) the category — component names are
meant to read like a one-line outline of what the thing is, so the
category hint up front is pragmatic.

### Examples

| Name                       | Category      | Why                                       |
|----------------------------|---------------|-------------------------------------------|
| `nav-default`              | `nav`         | Default top nav. Variant suffix.          |
| `hero-with-showcase`       | `hero`        | Hero that includes a product showcase.    |
| `trust-logo-strip`         | `trust`       | Logo strip → obvious atom.                |
| `value-columns-3`          | `value`       | 3 = column count baked into the name.     |
| `honest-line-contrast`     | `quote`       | Category is `quote`; name reads its role. |
| `how-it-works-3-steps`     | `process`     | Canonical "how it works" with 3 steps.    |
| `before-after-compare`     | `compare`     | Side-by-side comparison.                  |
| `urgency-band`             | `urgency`     | Amber band shape.                         |
| `wordpress-install-block`  | `integration` | Integration block for a specific tool.    |
| `pricing-teaser-3-tier`    | `pricing`     | 3 = tier count.                           |
| `final-cta-dark`           | `cta`         | Dark variant of the final CTA.            |
| `footer-default`           | `footer`      | Default footer shape.                     |

### Good patterns

- `hero-centered` · `hero-with-showcase` · `hero-split-form` — shape or contents in the name, not a variant suffix
- `pricing-teaser-3-tier` · `pricing-teaser-4-tier` — count in the name when it changes the structural invariants
- `nav-default` · `nav-dark` — variant only in the name when the layout is identical and only tonal/treatment differs

### Avoid

- `HeroBanner` / `nav_primary` — wrong case
- `hero-1` / `value-v2` — numeric versioning belongs in the design system `version`, not the component name
- `main-navigation` — verbose synonym; `nav-default` is the convention
- Prefixes with the site scope like `ls-hero-centered` — scoping is enforced by CSS class prefixes, not component names

### Categories in use (M1c)

`nav`, `hero`, `trust`, `value`, `quote`, `process`, `compare`, `urgency`,
`integration`, `pricing`, `cta`, `footer`. New categories should be added
deliberately — prefer reusing an existing one where the shape matches.
