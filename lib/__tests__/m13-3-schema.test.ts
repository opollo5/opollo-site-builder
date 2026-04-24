import { describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M13-3 schema tests — briefs.content_type CHECK + default.
//
// Pins the invariants the runner's MODE_CONFIGS dispatch relies on:
//
//   1. CHECK IN ('page','post') — rejects any other value at the schema
//      layer so a backfill bug can't slip an undefined mode in.
//   2. DEFAULT 'page' — existing M12 briefs (and any future INSERT that
//      forgets the column) get the safe page-mode behaviour without a
//      data-migration.
//   3. NOT NULL — the runner can assume the column is always present.
// ---------------------------------------------------------------------------

function unique(suffix: string): string {
  return `m13-3-schema-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertBrief(opts: {
  site_id: string;
  content_type?: string;
  allowError?: boolean;
}): Promise<{
  id: string | null;
  content_type: string | null;
  error: { code?: string; message: string } | null;
}> {
  const svc = getServiceRoleClient();
  const row: Record<string, unknown> = {
    site_id: opts.site_id,
    title: "Schema test brief",
    status: "parsed",
    source_storage_path: `m13-3-schema/${unique("path")}.md`,
    source_mime_type: "text/markdown",
    source_size_bytes: 256,
    source_sha256: "0".repeat(64),
    upload_idempotency_key: unique("idemp"),
  };
  if (opts.content_type !== undefined) row.content_type = opts.content_type;

  const { data, error } = await svc
    .from("briefs")
    .insert(row)
    .select("id, content_type")
    .single();
  if (error) {
    if (opts.allowError) {
      return {
        id: null,
        content_type: null,
        error: { code: error.code, message: error.message },
      };
    }
    throw new Error(`insertBrief failed: ${error.message}`);
  }
  return {
    id: data.id as string,
    content_type: data.content_type as string,
    error: null,
  };
}

describe("briefs.content_type — CHECK + default", () => {
  it("defaults to 'page' when the column is omitted", async () => {
    const site = await seedSite({ name: "CT1", prefix: "ct1b" });
    const res = await insertBrief({ site_id: site.id });
    expect(res.id).not.toBeNull();
    expect(res.content_type).toBe("page");
  });

  it("accepts explicit content_type='page'", async () => {
    const site = await seedSite({ name: "CT2", prefix: "ct2b" });
    const res = await insertBrief({ site_id: site.id, content_type: "page" });
    expect(res.id).not.toBeNull();
    expect(res.content_type).toBe("page");
  });

  it("accepts explicit content_type='post'", async () => {
    const site = await seedSite({ name: "CT3", prefix: "ct3b" });
    const res = await insertBrief({ site_id: site.id, content_type: "post" });
    expect(res.id).not.toBeNull();
    expect(res.content_type).toBe("post");
  });

  it("rejects an unknown content_type via the CHECK constraint", async () => {
    const site = await seedSite({ name: "CT4", prefix: "ct4b" });
    const res = await insertBrief({
      site_id: site.id,
      content_type: "video",
      allowError: true,
    });
    expect(res.error).not.toBeNull();
    expect(res.error?.message).toMatch(/content_type/i);
  });

  it("rejects content_type=NULL (NOT NULL constraint)", async () => {
    // Sending NULL explicitly. PostgREST serialises undefined by
    // omitting the key; passing null maps to SQL NULL.
    const svc = getServiceRoleClient();
    const site = await seedSite({ name: "CT5", prefix: "ct5b" });
    const { data, error } = await svc
      .from("briefs")
      .insert({
        site_id: site.id,
        title: "null-ct",
        status: "parsed",
        source_storage_path: `m13-3-schema/${unique("null")}.md`,
        source_mime_type: "text/markdown",
        source_size_bytes: 256,
        source_sha256: "0".repeat(64),
        upload_idempotency_key: unique("null"),
        content_type: null,
      })
      .select("id")
      .single();
    // NOT NULL + default behaviour: PostgREST treats explicit null as
    // NULL, which the NOT NULL constraint rejects.
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/content_type|not-null|null value/i);
  });
});
