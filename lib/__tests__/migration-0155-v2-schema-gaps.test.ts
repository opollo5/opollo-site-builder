import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Migration 0155 — V2 schema gaps (link_url + source_type).
//
// Verifies:
//   1. social_post_drafts.link_url column accepts a URL string.
//   2. social_post_drafts.source_type column accepts valid enum values.
//   3. social_post_drafts.source_type CHECK rejects unknown values.
//   4. Both columns are nullable (existing drafts not affected).
// ---------------------------------------------------------------------------

const COMPANY_ID = "00001550-0000-0000-0000-000000000001";
const USER_ID    = "00001550-0000-0000-0000-000000000002";

async function seedCompany() {
  const svc = getServiceRoleClient();
  await svc.from("platform_companies").delete().eq("id", COMPANY_ID);
  const { error } = await svc.from("platform_companies").insert({
    id: COMPANY_ID,
    name: "M0155 Test Co",
    slug: "m0155-test-co",
    is_opollo_internal: false,
    timezone: "UTC",
    approval_default_rule: "any_one",
  });
  if (error) throw new Error(`seed company: ${error.message}`);
}

beforeAll(async () => {
  await seedCompany();
});

afterAll(async () => {
  const svc = getServiceRoleClient();
  await svc.from("platform_companies").delete().eq("id", COMPANY_ID);
});

describe("Migration 0155 — social_post_drafts schema gaps", () => {
  it("accepts link_url on a draft row", async () => {
    const svc = getServiceRoleClient();
    const { data, error } = await svc
      .from("social_post_drafts")
      .insert({
        company_id: COMPANY_ID,
        created_by: USER_ID,
        updated_by: USER_ID,
        link_url: "https://example.com/blog/post-1",
      })
      .select("id, link_url")
      .single();

    expect(error, `insert error: ${error?.message}`).toBeNull();
    expect(data?.link_url).toBe("https://example.com/blog/post-1");

    if (data?.id) {
      await svc.from("social_post_drafts").delete().eq("id", data.id);
    }
  });

  it("accepts valid source_type values", async () => {
    const svc = getServiceRoleClient();
    for (const source_type of ["manual", "csv", "cap", "api"] as const) {
      const { data, error } = await svc
        .from("social_post_drafts")
        .insert({
          company_id: COMPANY_ID,
          created_by: USER_ID,
          updated_by: USER_ID,
          source_type,
        })
        .select("id, source_type")
        .single();

      expect(error, `insert failed for source_type='${source_type}': ${error?.message}`).toBeNull();
      expect(data?.source_type).toBe(source_type);

      if (data?.id) {
        await svc.from("social_post_drafts").delete().eq("id", data.id);
      }
    }
  });

  it("rejects an unknown source_type (CHECK constraint)", async () => {
    const svc = getServiceRoleClient();
    const { error } = await svc
      .from("social_post_drafts")
      .insert({
        company_id: COMPANY_ID,
        created_by: USER_ID,
        updated_by: USER_ID,
        source_type: "unknown_value" as string,
      })
      .select("id")
      .single();

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/check.*constraint|violates/i);
  });

  it("both columns are nullable (existing draft creation succeeds without them)", async () => {
    const svc = getServiceRoleClient();
    const { data, error } = await svc
      .from("social_post_drafts")
      .insert({
        company_id: COMPANY_ID,
        created_by: USER_ID,
        updated_by: USER_ID,
      })
      .select("id, link_url, source_type")
      .single();

    expect(error, `insert error: ${error?.message}`).toBeNull();
    expect(data?.link_url).toBeNull();
    expect(data?.source_type).toBeNull();

    if (data?.id) {
      await svc.from("social_post_drafts").delete().eq("id", data.id);
    }
  });
});
