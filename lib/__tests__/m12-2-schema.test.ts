import { describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M12-2 schema tests — briefs.brand_voice + briefs.design_direction.
//
// Pins that migration 0017 landed the two text columns as nullable with
// no default. Both must:
//   - accept NULL (upload path inserts rows before the operator fills them)
//   - accept empty string as distinct from NULL
//   - accept long text (but the commit route's 4 KB zod cap is a separate
//     layer — we do NOT assert the cap here; that belongs on the route test)
//   - round-trip verbatim through SELECT
//
// Complements lib/__tests__/m12-1-schema.test.ts which covers the briefs
// columns introduced in 0013.
//
// _setup.ts TRUNCATEs every table in beforeEach, so each test creates its
// own site + brief fresh. Do not hoist seedSite() into beforeAll — the
// truncate will wipe it.
// ---------------------------------------------------------------------------

function makeIdempKey(suffix: string): string {
  return `m12-2-schema-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeStoragePath(suffix: string): string {
  return `m12-2-schema/${suffix}/${Math.random().toString(36).slice(2, 10)}.md`;
}

async function insertBrief(opts: {
  site_id: string;
  brand_voice?: string | null;
  design_direction?: string | null;
}): Promise<{ id: string }> {
  const svc = getServiceRoleClient();
  const payload: Record<string, unknown> = {
    site_id: opts.site_id,
    title: "M12-2 test brief",
    status: "parsed",
    source_storage_path: makeStoragePath("b"),
    source_mime_type: "text/markdown",
    source_size_bytes: 256,
    source_sha256: "0".repeat(64),
    upload_idempotency_key: makeIdempKey("b"),
  };
  if (opts.brand_voice !== undefined) payload.brand_voice = opts.brand_voice;
  if (opts.design_direction !== undefined)
    payload.design_direction = opts.design_direction;
  const { data, error } = await svc
    .from("briefs")
    .insert(payload)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`insertBrief failed: ${error?.message ?? "no data"}`);
  }
  return { id: data.id as string };
}

describe("M12-2: briefs.brand_voice + briefs.design_direction", () => {
  it("inserts a brief with both fields NULL by default", async () => {
    const site = await seedSite();
    const { id } = await insertBrief({ site_id: site.id });
    const svc = getServiceRoleClient();
    const { data, error } = await svc
      .from("briefs")
      .select("brand_voice, design_direction")
      .eq("id", id)
      .single();
    expect(error).toBeNull();
    expect(data?.brand_voice).toBeNull();
    expect(data?.design_direction).toBeNull();
  });

  it("round-trips non-empty values", async () => {
    const site = await seedSite();
    const voice = "Warm, plain language. Second person default.";
    const direction = "Generous white space. Single CTA per section.";
    const { id } = await insertBrief({
      site_id: site.id,
      brand_voice: voice,
      design_direction: direction,
    });
    const svc = getServiceRoleClient();
    const { data } = await svc
      .from("briefs")
      .select("brand_voice, design_direction")
      .eq("id", id)
      .single();
    expect(data?.brand_voice).toBe(voice);
    expect(data?.design_direction).toBe(direction);
  });

  it("distinguishes empty string from NULL", async () => {
    const site = await seedSite();
    const { id } = await insertBrief({
      site_id: site.id,
      brand_voice: "",
      design_direction: null,
    });
    const svc = getServiceRoleClient();
    const { data } = await svc
      .from("briefs")
      .select("brand_voice, design_direction")
      .eq("id", id)
      .single();
    expect(data?.brand_voice).toBe("");
    expect(data?.design_direction).toBeNull();
  });

  it("accepts UPDATEs that set, clear, and re-set the fields", async () => {
    const site = await seedSite();
    const { id } = await insertBrief({ site_id: site.id });
    const svc = getServiceRoleClient();

    // Set both.
    const set = await svc
      .from("briefs")
      .update({
        brand_voice: "v1",
        design_direction: "d1",
      })
      .eq("id", id)
      .select("brand_voice, design_direction")
      .single();
    expect(set.error).toBeNull();
    expect(set.data?.brand_voice).toBe("v1");
    expect(set.data?.design_direction).toBe("d1");

    // Clear both to NULL.
    const clear = await svc
      .from("briefs")
      .update({
        brand_voice: null,
        design_direction: null,
      })
      .eq("id", id)
      .select("brand_voice, design_direction")
      .single();
    expect(clear.error).toBeNull();
    expect(clear.data?.brand_voice).toBeNull();
    expect(clear.data?.design_direction).toBeNull();

    // Set again with new values.
    const set2 = await svc
      .from("briefs")
      .update({
        brand_voice: "v2",
        design_direction: "d2",
      })
      .eq("id", id)
      .select("brand_voice, design_direction")
      .single();
    expect(set2.error).toBeNull();
    expect(set2.data?.brand_voice).toBe("v2");
    expect(set2.data?.design_direction).toBe("d2");
  });

  it("accepts multi-line prose with punctuation + whitespace", async () => {
    const site = await seedSite();
    const voice =
      "Line 1: be clear.\nLine 2: be brief.\n\nAvoid em-dashes — operators hate them.";
    const { id } = await insertBrief({
      site_id: site.id,
      brand_voice: voice,
    });
    const svc = getServiceRoleClient();
    const { data } = await svc
      .from("briefs")
      .select("brand_voice")
      .eq("id", id)
      .single();
    expect(data?.brand_voice).toBe(voice);
  });
});
