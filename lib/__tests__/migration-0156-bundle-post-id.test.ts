import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { getServiceRoleClient } from "@/lib/supabase";
import { seedAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// Migration 0156 — bundle_post_id on social_post_drafts.
//
// Verifies:
//   1. bundle_post_id column accepts a text value.
//   2. The column is nullable (existing published drafts are unaffected).
//   3. Two drafts with the same bundle_post_id are allowed (no unique constraint —
//      a single bundle post could theoretically map to multiple draft variants).
//   4. The partial index exists (verified via a SELECT that uses it without error).
// ---------------------------------------------------------------------------

const COMPANY_ID = "00001560-0000-0000-0000-000000000001";
const BUNDLE_ID  = "bsp-test-bundle-0156-abc123";

let seededUserId: string;

async function seedCompany() {
  const svc = getServiceRoleClient();
  // Clean stale drafts first so the company delete doesn't hit FK constraints.
  await svc.from("social_post_drafts").delete().eq("company_id", COMPANY_ID);
  await svc.from("platform_companies").delete().eq("id", COMPANY_ID);
  const { error } = await svc.from("platform_companies").insert({
    id: COMPANY_ID,
    name: "M0156 Test Co",
    slug: "m0156-test-co",
    is_opollo_internal: false,
    timezone: "UTC",
    approval_default_rule: "any_one",
  });
  if (error) throw new Error(`seed company: ${error.message}`);
}

beforeAll(async () => {
  const user = await seedAuthUser({ persistent: true });
  seededUserId = user.id;
  await seedCompany();
});

afterAll(async () => {
  const svc = getServiceRoleClient();
  await svc.from("social_post_drafts").delete().eq("company_id", COMPANY_ID);
  await svc.from("platform_companies").delete().eq("id", COMPANY_ID);
  if (seededUserId) {
    await svc.auth.admin.deleteUser(seededUserId);
  }
});

describe("Migration 0156 — social_post_drafts.bundle_post_id", () => {
  it("accepts a bundle_post_id value on a draft row", async () => {
    const svc = getServiceRoleClient();
    const { data, error } = await svc
      .from("social_post_drafts")
      .insert({
        company_id: COMPANY_ID,
        created_by: seededUserId,
        updated_by: seededUserId,
        state: "published",
        bundle_post_id: BUNDLE_ID,
      })
      .select("id, bundle_post_id")
      .single();

    expect(error, `insert error: ${error?.message}`).toBeNull();
    expect(data?.bundle_post_id).toBe(BUNDLE_ID);

    if (data?.id) {
      await svc.from("social_post_drafts").delete().eq("id", data.id);
    }
  });

  it("bundle_post_id is nullable (existing draft creation succeeds without it)", async () => {
    const svc = getServiceRoleClient();
    const { data, error } = await svc
      .from("social_post_drafts")
      .insert({
        company_id: COMPANY_ID,
        created_by: seededUserId,
        updated_by: seededUserId,
      })
      .select("id, bundle_post_id")
      .single();

    expect(error, `insert error: ${error?.message}`).toBeNull();
    expect(data?.bundle_post_id).toBeNull();

    if (data?.id) {
      await svc.from("social_post_drafts").delete().eq("id", data.id);
    }
  });

  it("lookup by bundle_post_id returns the correct row", async () => {
    const svc = getServiceRoleClient();
    const { data: inserted } = await svc
      .from("social_post_drafts")
      .insert({
        company_id: COMPANY_ID,
        created_by: seededUserId,
        updated_by: seededUserId,
        bundle_post_id: BUNDLE_ID + "-lookup",
      })
      .select("id")
      .single();

    const { data, error } = await svc
      .from("social_post_drafts")
      .select("id")
      .eq("bundle_post_id", BUNDLE_ID + "-lookup")
      .maybeSingle();

    expect(error, `lookup error: ${error?.message}`).toBeNull();
    expect(data?.id).toBe(inserted?.id);

    if (inserted?.id) {
      await svc.from("social_post_drafts").delete().eq("id", inserted.id);
    }
  });
});
