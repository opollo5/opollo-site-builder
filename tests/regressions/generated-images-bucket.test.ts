import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// REGRESSION: generated-images bucket migration is correctly specified.
//
// The `generated-images` bucket was absent from production and from all
// migrations when the image-generation pipeline launched (recon §6a). This
// test pins the key properties of the 0158 migration so a future editor
// can't silently remove or misconfigure the bucket.
// ---------------------------------------------------------------------------

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/0158_create_generated_images_bucket.sql",
);

describe("0158: generated-images bucket migration", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");

  it("creates the bucket with id 'generated-images'", () => {
    expect(sql).toMatch(/'generated-images'/);
    expect(sql).toMatch(/INSERT INTO storage\.buckets/);
  });

  it("bucket is private (public = false)", () => {
    // The INSERT has columns (id, name, public, ...) and VALUES (..., false, ...).
    // Check: `false` appears as a VALUES entry and `true` is not set for public.
    expect(sql).toMatch(/^\s*false,/m);
    expect(sql).not.toMatch(/public.*true/);
  });

  it("file size limit is 10 MB", () => {
    expect(sql).toMatch(/10485760/);
  });

  it("allows jpeg, png, webp MIME types", () => {
    expect(sql).toMatch(/image\/jpeg/);
    expect(sql).toMatch(/image\/png/);
    expect(sql).toMatch(/image\/webp/);
  });

  it("defines a read-only RLS policy for authenticated users", () => {
    expect(sql).toMatch(/CREATE POLICY generated_images_company_read/);
    expect(sql).toMatch(/FOR SELECT/);
    expect(sql).toMatch(/TO authenticated/);
  });

  it("RLS policy scopes reads to the user's company_id prefix", () => {
    expect(sql).toMatch(/platform_company_users/);
    expect(sql).toMatch(/pcu\.company_id = \(storage\.foldername\(name\)\)\[1\]::uuid/);
  });

  it("uses ON CONFLICT DO NOTHING to be idempotent", () => {
    expect(sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
  });
});
