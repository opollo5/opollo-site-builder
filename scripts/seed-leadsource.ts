#!/usr/bin/env -S npx tsx
/**
 * seed-leadsource.ts
 *
 * Reads the LeadSource design system out of ../seed/leadsource/ and inserts
 * it via the M1b data layer as a new DRAFT design system on the target site.
 *
 *   npx tsx scripts/seed-leadsource.ts --site-id <uuid> [--version <n>] [--seed-dir <path>]
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment
 * (from `supabase status --output json` against a running local stack).
 *
 * The script does NOT activate the seeded design system. Activation is a
 * separate operator step — post-M1d, once FEATURE_DESIGN_SYSTEM_V2 is live.
 * The script prints the exact SQL to run for activation at the end of a
 * successful run.
 *
 * Phase 1 (M1c-skeleton) state:
 *   - Inserts the design system with placeholder tokens.css / base-styles.css.
 *   - Iterates empty components/ and templates/ directories — zero inserts.
 *   - Prints instructions explaining that Phase 2 will populate content.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDesignSystem, type DesignSystem } from "../lib/design-systems";
import { createComponent } from "../lib/components";
import { createTemplate } from "../lib/templates";
import type { ApiResponse } from "../lib/tool-schemas";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DesignSystemMeta = {
  version: number;
  notes?: string;
  tokens_css_file?: string;
  base_styles_file?: string;
  components_dir?: string;
  templates_dir?: string;
};

type ComponentSchemaFile = {
  category: string;
  variant?: string | null;
  content_schema: Record<string, unknown>;
  image_slots?: Record<string, unknown> | null;
  usage_notes?: string | null;
  preview_html?: string | null;
};

type TemplateFile = {
  page_type: string;
  name: string;
  is_default?: boolean;
  composition: Array<{ component: string; content_source: string } & Record<string, unknown>>;
  required_fields: Record<string, unknown>;
  seo_defaults?: Record<string, unknown> | null;
};

type Args = {
  siteId: string;
  version?: number;
  seedDir: string;
};

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--site-id":
        out.siteId = value;
        i++;
        break;
      case "--version":
        out.version = Number(value);
        if (!Number.isInteger(out.version) || out.version < 1) {
          die(`--version must be a positive integer, got ${JSON.stringify(value)}`);
        }
        i++;
        break;
      case "--seed-dir":
        out.seedDir = value;
        i++;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      default:
        die(`Unknown argument: ${flag}`);
    }
  }
  if (!out.siteId) die("Missing required --site-id <uuid>");
  if (!out.seedDir) {
    const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
    out.seedDir = path.resolve(scriptsDir, "..", "seed", "leadsource");
  }
  return out as Args;
}

function printUsage(): void {
  console.log(
    `
seed-leadsource.ts — insert the LeadSource design system as a DRAFT.

Usage:
  npx tsx scripts/seed-leadsource.ts --site-id <uuid> [--version <n>] [--seed-dir <path>]

Options:
  --site-id   UUID of the sites.id row to attach this design system to. Required.
  --version   Integer version number for this design system (default: value in
              design-system.json). Must not collide with an existing (site_id,
              version) pair — if it does, the insert returns UNIQUE_VIOLATION.
  --seed-dir  Directory containing design-system.json, tokens.css, etc.
              Defaults to <repo>/seed/leadsource.

Env:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — both required, from
  \`supabase status --output json\` when the local stack is running.

`.trim(),
  );
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function readText(p: string): string {
  return fs.readFileSync(p, "utf8");
}

function readJson<T>(p: string): T {
  return JSON.parse(readText(p)) as T;
}

type ComponentTriplet = {
  name: string;
  htmlPath: string;
  cssPath: string;
  schemaPath: string;
};

// Discovers components by grouping files in <dir> by filename stem. A name
// must have all three of .html, .css, and .schema.json to be considered a
// complete component. Anything less is a hard error — we never half-seed.
function discoverComponents(dir: string): ComponentTriplet[] {
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => !f.startsWith("."));
  const stems = new Map<string, { html?: string; css?: string; schema?: string }>();

  for (const f of files) {
    const full = path.join(dir, f);
    if (f.endsWith(".schema.json")) {
      const stem = f.slice(0, -".schema.json".length);
      set(stems, stem, "schema", full);
    } else if (f.endsWith(".html")) {
      const stem = f.slice(0, -".html".length);
      set(stems, stem, "html", full);
    } else if (f.endsWith(".css")) {
      const stem = f.slice(0, -".css".length);
      set(stems, stem, "css", full);
    } else if (f !== ".gitkeep" && f !== "README.md") {
      die(`Unexpected file in ${dir}: ${f}`);
    }
  }

  const triplets: ComponentTriplet[] = [];
  for (const [stem, parts] of stems) {
    if (!parts.html || !parts.css || !parts.schema) {
      die(
        `Component "${stem}" is missing one of the triplet files. Found: ` +
          JSON.stringify(parts),
      );
    }
    triplets.push({
      name: stem,
      htmlPath: parts.html,
      cssPath: parts.css,
      schemaPath: parts.schema,
    });
  }
  triplets.sort((a, b) => a.name.localeCompare(b.name));
  return triplets;
}

function set(
  m: Map<string, { html?: string; css?: string; schema?: string }>,
  stem: string,
  key: "html" | "css" | "schema",
  value: string,
): void {
  const cur = m.get(stem) ?? {};
  cur[key] = value;
  m.set(stem, cur);
}

function discoverTemplates(dir: string): Array<{ name: string; path: string }> {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      name: f.slice(0, -".json".length),
      path: path.join(dir, f),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Composition validation — every composition[].component must refer to a
// component this run actually seeded (by name). We check before any inserts
// so a broken template can't leave a partially-seeded draft behind.
// ---------------------------------------------------------------------------

function validateCompositions(
  componentNames: Set<string>,
  templates: Array<{ name: string; path: string }>,
): void {
  const errors: string[] = [];
  for (const t of templates) {
    const body = readJson<TemplateFile>(t.path);
    if (!Array.isArray(body.composition)) {
      errors.push(`Template ${t.name}: composition is not an array.`);
      continue;
    }
    for (let i = 0; i < body.composition.length; i++) {
      const entry = body.composition[i];
      if (!componentNames.has(entry.component)) {
        errors.push(
          `Template ${t.name}: composition[${i}].component "${entry.component}" is not declared in components/.`,
        );
      }
    }
  }
  if (errors.length > 0) {
    die(
      "Composition validation failed:\n" +
        errors.map((e) => `  - ${e}`).join("\n"),
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function envCheck(): void {
  const missing: string[] = [];
  if (!process.env.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) {
    die(
      `Missing env: ${missing.join(", ")}. Run \`supabase status --output json\` and export the values.`,
    );
  }
}

function die(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function unwrap<T>(res: ApiResponse<T>, label: string): T {
  if (res.ok) return res.data;
  const d = res.error.details
    ? ` (details: ${JSON.stringify(res.error.details)})`
    : "";
  die(`${label}: ${res.error.code} — ${res.error.message}${d}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  envCheck();

  const metaPath = path.join(args.seedDir, "design-system.json");
  if (!fs.existsSync(metaPath)) {
    die(`design-system.json not found at ${metaPath}`);
  }
  const meta = readJson<DesignSystemMeta>(metaPath);

  const tokensFile = meta.tokens_css_file ?? "tokens.css";
  const baseFile = meta.base_styles_file ?? "base-styles.css";
  const componentsDir = path.join(
    args.seedDir,
    meta.components_dir ?? "components",
  );
  const templatesDir = path.join(
    args.seedDir,
    meta.templates_dir ?? "templates",
  );

  const tokensCss = readText(path.join(args.seedDir, tokensFile));
  const baseStyles = readText(path.join(args.seedDir, baseFile));

  const components = discoverComponents(componentsDir);
  const templates = discoverTemplates(templatesDir);

  // Pre-flight composition check. Fails before any DB writes.
  validateCompositions(
    new Set(components.map((c) => c.name)),
    templates,
  );

  console.log(`Seeding LeadSource design system from ${args.seedDir}`);
  console.log(
    `  site_id   : ${args.siteId}`,
  );
  console.log(
    `  version   : ${args.version ?? meta.version}`,
  );
  console.log(`  components: ${components.length}`);
  console.log(`  templates : ${templates.length}`);
  console.log();

  // 1. Create the design system (DRAFT).
  const dsInput = {
    site_id: args.siteId,
    version: args.version ?? meta.version,
    tokens_css: tokensCss,
    base_styles: baseStyles,
    notes: meta.notes ?? null,
  };
  const ds = unwrap<DesignSystem>(
    await createDesignSystem(dsInput),
    "createDesignSystem",
  );
  console.log(
    `[ok] design_system  ${ds.id}  version=${ds.version}  status=${ds.status}  version_lock=${ds.version_lock}`,
  );

  // 2. Create each component.
  for (const c of components) {
    const html = readText(c.htmlPath);
    const css = readText(c.cssPath);
    const schema = readJson<ComponentSchemaFile>(c.schemaPath);
    const comp = unwrap(
      await createComponent({
        design_system_id: ds.id,
        name: c.name,
        variant: schema.variant ?? null,
        category: schema.category,
        html_template: html,
        css,
        content_schema: schema.content_schema,
        image_slots: schema.image_slots ?? null,
        usage_notes: schema.usage_notes ?? null,
        preview_html: schema.preview_html ?? null,
      }),
      `createComponent(${c.name})`,
    );
    console.log(`[ok] component     ${comp.id}  ${c.name}`);
  }

  // 3. Create each template.
  for (const t of templates) {
    const body = readJson<TemplateFile>(t.path);
    const tmpl = unwrap(
      await createTemplate({
        design_system_id: ds.id,
        page_type: body.page_type,
        name: body.name,
        composition: body.composition,
        required_fields: body.required_fields,
        seo_defaults: body.seo_defaults ?? null,
        is_default: body.is_default ?? false,
      }),
      `createTemplate(${t.name})`,
    );
    console.log(`[ok] template      ${tmpl.id}  ${body.page_type}/${body.name}`);
  }

  // 4. Summary + activation instructions.
  console.log();
  console.log(
    `Seed complete. Design system is DRAFT — no user-facing change until it's activated.`,
  );
  if (components.length === 0) {
    console.log(
      `Heads-up: no components were seeded — this is expected during M1c Phase 1 (skeleton).`,
    );
    console.log(
      `Phase 2 will populate seed/leadsource/components/ and seed/leadsource/templates/.`,
    );
  }
  console.log();
  console.log(`To activate when ready, run against the same Postgres:`);
  console.log(
    `  SELECT activate_design_system('${ds.id}'::uuid, ${ds.version_lock}::int);`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
