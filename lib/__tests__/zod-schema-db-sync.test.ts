import { Client } from "pg";
import { describe, expect, it, afterAll } from "vitest";

import { UpdateDesignComponentSchema } from "@/lib/components";
import { UpdateDesignSystemSchema } from "@/lib/design-systems";
import { UpdateDesignTemplateSchema } from "@/lib/templates";

// ---------------------------------------------------------------------------
// M15 defense-in-depth — Zod ↔ DB column sync (Schema audit finding #11).
//
// Three update paths do `.update({ ...parsed.data, version_lock: ... })`
// where `parsed.data` is the output of a Zod `.parse()` on request body:
//
//   - updateDesignSystem  / UpdateDesignSystemSchema  / design_systems
//   - updateComponent     / UpdateDesignComponentSchema / design_components
//   - updateTemplate      / UpdateDesignTemplateSchema  / design_templates
//
// If a developer adds a field to the Zod schema without migrating the
// matching table column, the next PATCH with that field in the body
// fails at runtime with PGRST204 (column not found). Lint + typecheck
// both pass because Zod keys are strings, not a type of the DB schema.
//
// These tests read the live table's column list from information_schema
// and assert every Zod-schema key is present. Zod's inner type has to
// be unwrapped because `.refine()` wraps the shape in a ZodEffects — we
// reach through to the underlying ZodObject.
// ---------------------------------------------------------------------------

const DB_URL =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let pgClient: Client | null = null;

async function getClient(): Promise<Client> {
  if (pgClient) return pgClient;
  pgClient = new Client({ connectionString: DB_URL });
  await pgClient.connect();
  return pgClient;
}

afterAll(async () => {
  if (pgClient) {
    await pgClient.end();
    pgClient = null;
  }
});

async function columnsFor(table: string): Promise<Set<string>> {
  const client = await getClient();
  const res = await client.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Set(res.rows.map((r) => r.column_name));
}

// Unwrap a `.refine()` wrapper so we can read the underlying shape keys.
// Zod exposes the inner schema on `._def.schema` for ZodEffects instances;
// a plain ZodObject exposes the shape via `.shape`.
function zodKeys(schema: unknown): string[] {
  // ZodEffects → unwrap
  const inner =
    (schema as { _def?: { schema?: unknown } })._def?.schema ?? schema;
  const shape = (inner as { shape?: Record<string, unknown> }).shape;
  if (!shape) {
    throw new Error(
      "zodKeys: could not read schema shape — Zod internals changed?",
    );
  }
  return Object.keys(shape);
}

async function hasCheckConstraint(
  table: string,
  constraint: string,
): Promise<boolean> {
  const client = await getClient();
  const res = await client.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = $1
          AND c.conname = $2
          AND c.contype = 'c'
     ) AS exists`,
    [table, constraint],
  );
  return res.rows[0]?.exists === true;
}

describe("version_lock CHECK constraints (migration 0015)", () => {
  // Per M15 schema audit finding #9 — five tables shipped without the
  // `CHECK (version_lock >= 1)` their siblings carry. 0015 adds them.
  it.each([
    ["image_library", "image_library_version_lock_positive"],
    ["briefs", "briefs_version_lock_positive"],
    ["brief_pages", "brief_pages_version_lock_positive"],
    ["brief_runs", "brief_runs_version_lock_positive"],
    ["site_conventions", "site_conventions_version_lock_positive"],
  ])("%s has %s", async (table, constraint) => {
    expect(await hasCheckConstraint(table, constraint)).toBe(true);
  });
});

describe("Zod ↔ DB column sync (defense-in-depth)", () => {
  it("UpdateDesignSystemSchema keys ⊆ design_systems columns", async () => {
    const zodFields = zodKeys(UpdateDesignSystemSchema);
    const dbCols = await columnsFor("design_systems");
    for (const field of zodFields) {
      expect(dbCols.has(field), `design_systems missing column: ${field}`).toBe(
        true,
      );
    }
  });

  it("UpdateDesignComponentSchema keys ⊆ design_components columns", async () => {
    const zodFields = zodKeys(UpdateDesignComponentSchema);
    const dbCols = await columnsFor("design_components");
    for (const field of zodFields) {
      expect(
        dbCols.has(field),
        `design_components missing column: ${field}`,
      ).toBe(true);
    }
  });

  it("UpdateDesignTemplateSchema keys ⊆ design_templates columns", async () => {
    const zodFields = zodKeys(UpdateDesignTemplateSchema);
    const dbCols = await columnsFor("design_templates");
    for (const field of zodFields) {
      expect(
        dbCols.has(field),
        `design_templates missing column: ${field}`,
      ).toBe(true);
    }
  });
});
