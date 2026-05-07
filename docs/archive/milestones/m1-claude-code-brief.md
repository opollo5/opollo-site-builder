# Opollo Site Builder — M1 Implementation Brief

**For: Claude Code**
**From: Opollo (Steven)**
**Date: April 2026**
**Spec version: Technical Design v1.1 — reviewer feedback incorporated**

---

## 0. How to use this document

This is the handoff brief for Milestone 1 (Design System Infrastructure) of the next phase of Opollo Site Builder development.

**Read order:**

1. Section 1 — current state (what's already in production, so you don't break it)
2. Section 2 — **write-safety patterns (MANDATORY for this and every future milestone)**
3. Section 3 — M1 scope and design
4. Section 4 — acceptance criteria and sub-milestones

**Before writing any code:** confirm you've read sections 1-3 and propose your implementation plan with migration order. Wait for my approval before starting M1a.

**Critical:** Section 2 (write-safety patterns) applies to everything you build from now on, not just this milestone. Even though M1 doesn't involve workers or heavy concurrency, the patterns (optimistic locking, Zod validation, DB-enforced constraints) must be applied to every new table, route, and mutation added in M1.

---

## 1. Current state (baseline — what's already in production)

### 1.1 Stack

- **Framework:** Next.js 14.2.35 App Router, TypeScript strict mode
- **LLM:** Anthropic Claude Opus 4.7 via official SDK, with prompt caching
- **Database:** Supabase (Postgres 15), Sydney region
- **Hosting:** Vercel, auto-deploys from `main`
- **Auth:** HTTP Basic Auth via middleware (migrating to Supabase Auth in M2)
- **Encryption:** AES-256-GCM for credentials, `OPOLLO_MASTER_KEY` env var with `key_version` column for rotation

### 1.2 Existing Supabase tables

These are live in production. Don't drop or restructure them in M1 — M1 adds new tables alongside them.

- `sites` — one row per managed client site (id, name, wp_url, prefix, status)
- `site_credentials` — encrypted WP Application Password per site
- `site_context` — per-site context; has a `design_system_html` text field that M1 will eventually replace (but keep it as fallback)
- `pairing_codes` — for future WP plugin onboarding (unused in Stage 1)
- `page_history` — audit log of every page mutation
- `chat_sessions` — conversation state
- `chat_sessions_archive` — archive table (not yet populated)
- `health_checks` — exists but not yet populated (future Stage 2)

### 1.3 Existing API routes

- `/api/chat` — SSE streaming chat with tool use
- `/api/sites/register`, `/api/sites/list`, `/api/sites/[id]` — site CRUD
- `/api/tools/create_page`, `list_pages`, `get_page`, `update_page`, `publish_page`, `delete_page` — tool executors

### 1.4 Key architectural patterns established

- **AsyncLocalStorage for credentials.** `lib/wordpress.ts` sets a WpConfig in context at the top of the chat route. Tool executors call `readWpConfig()` instead of receiving credentials as arguments.
- **Compensating-delete for atomic site creation.** Supabase RLS + service-role means no SDK transactions; we use compensating deletes if the second insert fails.
- **Per-site prompt cache keys.** The system prompt's site-identity prefix varies the Anthropic cache key, so switching sites doesn't cache-collide.
- **Uniform tool executor signature.** Every tool in `lib/*-page.ts` follows `(input: ToolInput) => Promise<ToolResponse>`. Dispatched via `TOOL_EXECUTORS` map in `app/api/chat/route.ts`.

### 1.5 Code structure

```
opollo-site-builder/
├── app/
│   ├── api/
│   │   ├── chat/route.ts
│   │   ├── sites/
│   │   └── tools/
│   ├── admin/sites/page.tsx
│   └── page.tsx
├── components/
│   ├── SiteSwitcher.tsx
│   ├── SitesTable.tsx
│   ├── AddSiteModal.tsx
│   └── PreviewPane.tsx
├── lib/
│   ├── supabase.ts
│   ├── encryption.ts
│   ├── sites.ts
│   ├── wordpress.ts
│   ├── system-prompt.ts
│   └── create-page.ts (+ other tool executors)
├── supabase/migrations/
│   └── 0001_initial_schema.sql
└── middleware.ts
```

---

## 2. Write-safety patterns (MANDATORY — apply to every mutation from now on)

**Context:** The v1.0 spec was reviewed by a senior engineer who identified four must-fix issues clustered around write-safety: weak job locking, incomplete idempotency, no DB-level concurrency enforcement, and loose API validation. v1.1 addresses these with the patterns below. They're not optional. They apply to every new table, route, worker, and mutation.

**For M1 specifically:** the relevant patterns are optimistic locking (§2.4) and mandatory Zod validation (§2.5). The job locking and idempotency patterns apply in later milestones but the conventions need to be understood now.

### 2.1 Postgres-backed job locking (relevant for M3+ but document now)

Every background worker that claims a unit of work uses Postgres row-level locking with `SKIP LOCKED` semantics:

```sql
-- Standard job claim pattern
BEGIN;

SELECT id, ...
  FROM {job_table}
  WHERE status = 'queued'
    AND (locked_until IS NULL OR locked_until < now())
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

UPDATE {job_table}
  SET status = 'running',
      locked_by = $worker_id,
      locked_until = now() + interval '10 minutes',
      heartbeat_at = now(),
      started_at = coalesce(started_at, now())
  WHERE id = $claimed_id;

COMMIT;
```

Every job table has these columns:

```sql
locked_by       text,              -- worker identifier
locked_until    timestamptz,       -- claim expiry — heartbeat extends this
heartbeat_at    timestamptz        -- worker updates every 30s to prove liveness
```

Stale locks (`locked_until < now()`) are automatically reclaimable by the next polling worker. Dead workers cannot permanently strand a job.

### 2.2 Per-resource concurrency limits (DB-enforced, not application-enforced)

Where the domain requires "only one X per Y at a time," enforce at the schema level with partial unique indexes. Never rely on application logic that can race.

Example pattern (you'll use this for generation_jobs in M3 and transfer_jobs in M4):

```sql
CREATE UNIQUE INDEX one_running_gen_job_per_site
  ON generation_jobs(site_id)
  WHERE status = 'running';
```

Attempting a second running row returns a unique-violation. API catches it and returns 409 Conflict.

### 2.3 Idempotency keys at every write boundary

Every operation that mutates external state (WordPress writes, Cloudflare uploads, Anthropic billed calls) uses a stable idempotency key derived from the logical unit of work — not a per-attempt nonce.

Conventions (relevant in M3+):
- Create WP page: `generation_job_pages.id` as key; check `wp_page_id IS NOT NULL` before POST
- Update WP page: `page_edits.id` as key; PUT is naturally idempotent
- Upload WP media: `image_usage.id` as key; check `production_url IS NOT NULL` before upload

### 2.4 Optimistic concurrency for operator-edited resources (RELEVANT FOR M1)

Every table that multiple operators can edit carries a `version` column. In M1 this applies to `design_systems`, `design_components`, `design_templates`, and `pages`.

Every UPDATE includes a WHERE clause checking the expected version. Version mismatch returns 409 Conflict; UI shows "another operator changed this — reload."

```sql
-- Every updatable resource has:
ALTER TABLE {table} ADD COLUMN version integer NOT NULL DEFAULT 1;

-- Every update is conditional:
UPDATE {table}
  SET {fields},
      version = version + 1,
      updated_at = now()
  WHERE id = $id AND version = $expected_version
  RETURNING version;

-- Zero rows returned = conflict. API returns 409.
```

### 2.5 Input validation — Zod, mandatory (RELEVANT FOR M1)

Every API route begins with Zod validation. No exceptions. The pattern:

```typescript
import { z } from 'zod';

const BodySchema = z.object({
  site_id: z.string().uuid(),
  // ...
});

export async function POST(req: Request) {
  const raw = await req.json();
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({
      ok: false,
      code: 'VALIDATION_FAILED',
      message: 'Request body failed validation',
      details: parsed.error.issues,
    }, { status: 400 });
  }
  // proceed with parsed.data (fully typed)
}
```

The validated, parsed object is what gets stored — not the raw input.

### 2.6 Circuit breaker (DB-backed — relevant for M7 but document now)

Later milestones will add a `circuit_breakers` table. In-memory per-instance breakers are explicitly forbidden — they're ineffective under Vercel's multi-instance model. All breaker state lives in Postgres.

### 2.7 Honest failure reporting

Workers distinguish "this unit failed" from "the whole job failed." A job with 38 successes and 2 failures is `completed_with_failures`, not `failed`. UI surfaces the 2 failures with actionable errors.

---

## 3. M1 scope — Design System Infrastructure

### 3.1 Problem this milestone solves

Currently `site_context.design_system_html` is a single text field — whatever HTML the operator pastes gets injected into Claude's system prompt. No structure, no validation, no versioning, no component discovery.

This works for one hand-crafted homepage. It fails for batch generation of 40 pages. Claude needs a structured description of what components exist, what variants are available, what content they accept, and what composition rules apply.

### 3.2 Goals

- Structured, queryable component registry per site
- Design tokens separated from components — token changes propagate via CSS variables with no regeneration
- Page-type templates with composition rules
- Content contracts per component (JSON Schema)
- Semantic versioning — every page records its design system version
- Scope prefix isolation (LeadSource's `.ls-` cannot collide with Planet6's `.p6-`)

### 3.3 New tables (full DDL)

#### design_systems

```sql
CREATE TABLE design_systems (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id               uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  version               integer NOT NULL,
  status                text NOT NULL DEFAULT 'draft',  -- draft | active | archived
  tokens_css            text NOT NULL,                   -- :root { --ls-blue: ... } block
  base_styles           text NOT NULL,                   -- typography, spacing, primitives
  notes                 text,
  created_by            uuid REFERENCES opollo_users(id),  -- grandfathered NULL until M2
  created_at            timestamptz DEFAULT now(),
  activated_at          timestamptz,
  archived_at           timestamptz,
  version_lock          integer NOT NULL DEFAULT 1,      -- optimistic lock per §2.4

  CONSTRAINT one_version_per_site UNIQUE (site_id, version)
);

-- Only one active version per site
CREATE UNIQUE INDEX one_active_design_system
  ON design_systems(site_id) WHERE status = 'active';
```

Note: the column is `version_lock` not `version` because `version` is used for design system semantic versioning. Pick consistent naming across tables.

#### design_components

```sql
CREATE TABLE design_components (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_system_id      uuid NOT NULL REFERENCES design_systems(id) ON DELETE CASCADE,
  name                  text NOT NULL,                   -- 'hero-centered'
  variant               text,                            -- 'default', 'dark'
  category              text NOT NULL,                   -- 'hero' | 'feature' | ...
  html_template         text NOT NULL,                   -- Handlebars-like {{fields}}
  css                   text NOT NULL,                   -- scoped CSS
  content_schema        jsonb NOT NULL,                  -- JSON Schema
  image_slots           jsonb,
  usage_notes           text,
  preview_html          text,
  version_lock          integer NOT NULL DEFAULT 1,
  created_at            timestamptz DEFAULT now(),

  CONSTRAINT unique_component_per_ds UNIQUE (design_system_id, name, variant)
);

CREATE INDEX idx_design_components_ds_category
  ON design_components(design_system_id, category);
```

#### design_templates

```sql
CREATE TABLE design_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_system_id      uuid NOT NULL REFERENCES design_systems(id) ON DELETE CASCADE,
  page_type             text NOT NULL,                   -- 'homepage' | 'integration' | ...
  name                  text NOT NULL,
  composition           jsonb NOT NULL,                  -- ordered array of component refs
  required_fields       jsonb NOT NULL,
  seo_defaults          jsonb,
  is_default            boolean DEFAULT false,
  version_lock          integer NOT NULL DEFAULT 1,
  created_at            timestamptz DEFAULT now()
);

-- Only one default template per (design_system, page_type)
CREATE UNIQUE INDEX one_default_template_per_type
  ON design_templates(design_system_id, page_type)
  WHERE is_default = true;
```

#### pages

```sql
CREATE TABLE pages (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                   uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  wp_page_id                integer NOT NULL,
  slug                      text NOT NULL,
  title                     text NOT NULL,
  page_type                 text NOT NULL,
  template_id               uuid REFERENCES design_templates(id),
  design_system_version     integer NOT NULL,
  content_brief             jsonb,                       -- original brief
  content_structured        jsonb,                       -- parsed content (see M5)
  generated_html            text,
  status                    text DEFAULT 'draft',        -- draft | published
  last_edited_by            uuid REFERENCES opollo_users(id),
  version_lock              integer NOT NULL DEFAULT 1,
  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now(),

  CONSTRAINT unique_wp_page_per_site UNIQUE (site_id, wp_page_id)
);

CREATE INDEX idx_pages_site_status ON pages(site_id, status);
CREATE INDEX idx_pages_design_system_version
  ON pages(site_id, design_system_version);
```

### 3.4 Composition format (design_templates.composition)

Each template stores its composition as JSON — an ordered array of component references:

```json
[
  { "component": "nav-default", "content_source": "site_context.menus" },
  { "component": "hero-centered", "content_source": "brief.hero" },
  { "component": "trust-strip", "content_source": "site_context.trust_logos" },
  { "component": "value-columns-3", "content_source": "brief.value_columns" },
  { "component": "honest-line-dark", "content_source": "brief.honest_line" },
  { "component": "how-it-works-3-steps", "content_source": "brief.how_it_works" },
  { "component": "pricing-teaser-3-tier", "content_source": "brief.pricing_teaser" },
  { "component": "final-cta-dark", "content_source": "brief.final_cta" },
  { "component": "footer-default", "content_source": "site_context.footer" }
]
```

Each entry has `content_source` telling the generator where to pull field values from: `site_context.X` for site-wide content, `brief.X` for per-page content.

### 3.5 Content schema format (design_components.content_schema)

Every component stores JSON Schema describing its required fields:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["eyebrow", "headline", "sub", "primary_cta"],
  "properties": {
    "eyebrow": { "type": "string", "maxLength": 60 },
    "headline": { "type": "string", "maxLength": 120 },
    "sub": { "type": "string", "maxLength": 280 },
    "primary_cta": {
      "type": "object",
      "required": ["label", "href"],
      "properties": {
        "label": { "type": "string", "maxLength": 40 },
        "href": { "type": "string", "format": "uri-reference" }
      }
    }
  }
}
```

This schema drives three things: validation before commit, Claude's prompt (summarised for the LLM so it knows what fields to produce), and brief→component mapping (batch generator maps free-text brief to typed content).

### 3.6 CSS scoping — 3-layer enforcement

Every design system uses a client-specific class prefix stored on `sites.prefix` (e.g., `ls` for LeadSource). Three enforcement layers:

**Layer 1 — Linter (build time):** stylelint rule that rejects CSS with class selectors not matching the site's prefix. `.hero` fails. `.ls-hero` passes for LeadSource.

**Layer 2 — Validator (tool input):** When a component is added via admin UI, validate CSS against prefix pattern before DB insert.

**Layer 3 — Generator runtime:** When Claude generates a page (M3 milestone), validate that every class referenced in HTML exists in the component registry. Unknown classes fail the structural quality gate.

Design tokens also scoped via wrapper div:

```css
.ls-scope {
  --ls-blue: #185FA5;
  --ls-font-display: 'Inter Tight', sans-serif;
  /* ... */
}
```

Every generated page wraps content in `<div class="ls-scope">`. This lets multiple clients' CSS coexist without bleed.

### 3.7 System prompt integration — `buildSystemPromptForSite()` rewrite

Current: injects `design_system_html` as a single blob.

New: queries the registry and injects structured content:

```typescript
// lib/system-prompt.ts (revised)
export async function buildSystemPromptForSite(site: Site): Promise<string> {
  const ds = await getActiveDesignSystem(site.id);
  const components = await getComponentsForDS(ds.id);
  const templates = await getTemplatesForDS(ds.id);

  return `
# Site: ${site.name}
# Design system version: ${ds.version}
# Scope prefix: ${site.prefix}-

## Available components (${components.length} total)
${components.map(c => componentSummary(c)).join('\n')}

## Page templates
${templates.map(t => templateSummary(t)).join('\n')}

## Design tokens
${ds.tokens_css}

## Hard constraints
- Use only components listed above
- Wrap every page in <div class="${site.prefix}-scope">
- Never invent class names outside the registry
  `;
}
```

`componentSummary()` renders each component in compact form: name, variant, category, one-line purpose, fields from content_schema. Do NOT inline the full HTML templates — they'd blow the context window. Component HTML is fetched on demand when the generator is about to produce that component.

Keep the old HTML blob code path as a fallback, behind a feature flag `FEATURE_DESIGN_SYSTEM_V2`. If flag is false, use the legacy path. This lets us ship M1 incrementally.

### 3.8 API routes to add

- `GET /api/sites/[id]/design-systems` — list versions
- `POST /api/sites/[id]/design-systems` — create draft
- `POST /api/design-systems/[id]/activate` — activate (deactivates previous)
- `GET /api/design-systems/[id]/components` — list components
- `POST /api/design-systems/[id]/components` — add component (with Zod + CSS prefix validation)
- `PATCH /api/design-systems/[id]/components/[cid]` — update (with optimistic locking)
- `GET/POST /api/design-systems/[id]/templates` — template CRUD
- `GET /api/design-systems/[id]/preview` — component gallery

Every route: Zod validation at entry, uniform error response shape, optimistic locking via `version_lock` column on PATCH.

### 3.9 Admin UI routes to add

- `/admin/sites/[id]/design-system` — version manager (list versions, activate, new draft)
- `/admin/sites/[id]/design-system/components` — component grid browser + editor
- `/admin/sites/[id]/design-system/templates` — template list + composition editor
- `/admin/sites/[id]/design-system/preview` — rendered component gallery

Follow existing admin UI patterns — look at `components/SitesTable.tsx` for the table style and `components/AddSiteModal.tsx` for form patterns.

### 3.10 Opollo users table (added now, populated in M2)

The `opollo_users` table is referenced by `created_by` and `last_edited_by` columns. Create it in M1 even though Auth migration is M2:

```sql
CREATE TABLE opollo_users (
  id           uuid PRIMARY KEY,  -- will reference auth.users(id) after M2
  email        text UNIQUE NOT NULL,
  display_name text,
  role         text NOT NULL DEFAULT 'operator', -- admin | operator | viewer
  created_at   timestamptz DEFAULT now()
);
```

All `created_by` / `last_edited_by` columns should be `NULLABLE` in M1 so migrations don't fail on existing rows. In M2 we'll backfill and tighten to NOT NULL where appropriate.

---

## 4. Acceptance criteria for M1

Every item below must be ticked before M1 is closed:

- [ ] All 4 new tables created with migrations, plus `opollo_users` table
- [ ] Every new table has a tested rollback migration (run on fresh Supabase, confirm clean tear-down)
- [ ] Every new table has RLS policies (not just service-role bypass)
- [ ] LeadSource v2-stripe.html extracted into `design_components` + `design_templates` (one-time, collaborative with Claude in chat)
- [ ] Admin UI at `/admin/sites/[id]/design-system` shows versions, components, templates
- [ ] `buildSystemPromptForSite()` uses new tables when `FEATURE_DESIGN_SYSTEM_V2` flag is on, legacy blob path when off
- [ ] Scope prefix enforcement passes all 3 layers (linter, validator, runtime — runtime check is a helper function even though full use is in M3)
- [ ] Every new API route validates input with Zod — test coverage includes rejection of malformed bodies
- [ ] Every mutable table has a `version_lock` column and PATCH routes use it for optimistic locking
- [ ] No credentials logged at any level
- [ ] `.env.example` updated if any new env vars added

---

## 5. Proposed sub-milestone sequence (for your planning)

M1 is 2-3 weeks of work. Break into reviewable PRs:

- **M1a — Schema + migrations.** 5 new tables + rollback scripts + RLS policies. No UI, no code paths using them yet.
- **M1b — Data layer.** `lib/design-systems.ts`, `lib/components.ts`, `lib/templates.ts` with CRUD functions + Zod schemas + unit tests.
- **M1c — Extraction.** One-time task: extract LeadSource v2-stripe.html into components + templates. Collaborative session, I'll feed you the HTML.
- **M1d — System prompt rewrite.** Update `buildSystemPromptForSite()` to read from new tables behind `FEATURE_DESIGN_SYSTEM_V2` flag.
- **M1e — Admin UI.** Version manager, component browser, template editor.
- **M1f — Scope prefix enforcement.** 3-layer linter/validator/runtime.

Don't merge one giant M1 PR. Each slice is independently reviewable.

---

## 6. Things I don't want you to do without asking me

- Restructure any existing table (sites, site_credentials, site_context, etc.)
- Change the existing API routes' request/response shapes
- Modify `lib/wordpress.ts` — that's M3+ territory
- Skip Zod validation anywhere "because it's just a GET route"
- Skip optimistic locking anywhere "because M1 isn't concurrent"
- Inline more than ~50 lines of HTML into a prompt or code file — extract to a data file

---

## 7. What to do first

1. Read sections 1-3 of this doc in full.
2. Reply with your implementation plan for M1a (schema + migrations). Include:
   - Migration file numbering and order
   - RLS policy approach for each table
   - Any questions or ambiguities you want resolved before writing SQL
3. Wait for my approval before writing migrations.

Let's go.
