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

- **Phase 1 (this PR)**: script + skeleton seed directory with empty
  `components/` and `templates/`. Running the script creates a design
  system row with placeholder `tokens.css` / `base-styles.css` and zero
  components. Useful as a smoke test that the full M1b data-layer code
  path is wired end-to-end.
- **Phase 2 (next PR)**: `v2-stripe.html` extracted into real component
  triplets and a `homepage-default` template. Running the script then
  seeds the real LeadSource design system.
