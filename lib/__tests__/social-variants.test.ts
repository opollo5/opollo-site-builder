import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { createPostMaster } from "@/lib/platform/social/posts";
import {
  listVariants,
  SUPPORTED_PLATFORMS,
  upsertVariant,
} from "@/lib/platform/social/variants";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// S1-4: lib-layer tests for social_post_variant.
//
// Same test bed shape as social-posts.test.ts. Permission checks live
// at the route layer; these tests cover the data + state-machine
// invariants only.
// ---------------------------------------------------------------------------

const COMPANY_A_ID = "abcdef00-0000-0000-0000-cccccccccccc";
const COMPANY_B_ID = "abcdef00-0000-0000-0000-dddddddddddd";

describe("lib/platform/social/variants", () => {
  let creator: SeededAuthUser;

  beforeAll(async () => {
    creator = await seedAuthUser({
      email: "s1-4-creator@opollo.test",
      persistent: true,
    });
  });

  beforeEach(async () => {
    const svc = getServiceRoleClient();

    const companies = await svc
      .from("platform_companies")
      .insert([
        {
          id: COMPANY_A_ID,
          name: "Acme Co",
          slug: "s1-4-acme",
          domain: "s1-4-acme.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
        },
        {
          id: COMPANY_B_ID,
          name: "Beta Inc",
          slug: "s1-4-beta",
          domain: "s1-4-beta.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
        },
      ])
      .select("id");
    if (companies.error) {
      throw new Error(
        `seed companies: ${companies.error.code ?? "?"} ${companies.error.message}`,
      );
    }

    const user = await svc
      .from("platform_users")
      .insert({
        id: creator.id,
        email: creator.email,
        full_name: "Creator",
        is_opollo_staff: false,
      })
      .select("id");
    if (user.error) {
      throw new Error(
        `seed creator: ${user.error.code ?? "?"} ${user.error.message}`,
      );
    }

    const membership = await svc
      .from("platform_company_users")
      .insert({
        company_id: COMPANY_A_ID,
        user_id: creator.id,
        role: "editor",
      })
      .select("id");
    if (membership.error) {
      throw new Error(
        `seed membership: ${membership.error.code ?? "?"} ${membership.error.message}`,
      );
    }
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    if (creator) await svc.auth.admin.deleteUser(creator.id);
  });

  async function createDraftPost(masterText = "master copy") {
    const created = await createPostMaster({
      companyId: COMPANY_A_ID,
      masterText,
      createdBy: creator.id,
    });
    if (!created.ok) {
      throw new Error(`createDraftPost helper: ${created.error.code}`);
    }
    return created.data;
  }

  describe("listVariants", () => {
    it("returns master_text + resolved entries for every supported platform when no variants exist", async () => {
      const post = await createDraftPost("hello acme");
      const result = await listVariants({
        postMasterId: post.id,
        companyId: COMPANY_A_ID,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.masterText).toBe("hello acme");
      expect(result.data.postState).toBe("draft");
      expect(result.data.resolved).toHaveLength(SUPPORTED_PLATFORMS.length);
      for (const r of result.data.resolved) {
        expect(r.variant).toBeNull();
        expect(r.effective_text).toBe("hello acme");
      }
    });

    it("returns the override as effective_text when is_custom=true", async () => {
      const post = await createDraftPost("master");
      const upserted = await upsertVariant({
        postMasterId: post.id,
        companyId: COMPANY_A_ID,
        platform: "linkedin_personal",
        variantText: "linkedin override",
      });
      expect(upserted.ok).toBe(true);

      const result = await listVariants({
        postMasterId: post.id,
        companyId: COMPANY_A_ID,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const li = result.data.resolved.find((r) => r.platform === "linkedin_personal");
      expect(li).toBeDefined();
      expect(li?.variant?.is_custom).toBe(true);
      expect(li?.effective_text).toBe("linkedin override");
      // Other platforms still fall back to master.
      const fb = result.data.resolved.find((r) => r.platform === "facebook_page");
      expect(fb?.effective_text).toBe("master");
    });

    it("returns NOT_FOUND for cross-company access", async () => {
      const post = await createDraftPost();
      const result = await listVariants({
        postMasterId: post.id,
        companyId: COMPANY_B_ID,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });
  });

  describe("upsertVariant", () => {
    it("inserts a new variant on first call (is_custom=true)", async () => {
      const post = await createDraftPost();
      const result = await upsertVariant({
        postMasterId: post.id,
        companyId: COMPANY_A_ID,
        platform: "x",
        variantText: "X-specific copy",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.variant_text).toBe("X-specific copy");
      expect(result.data.is_custom).toBe(true);
      expect(result.data.platform).toBe("x");
    });

    it("idempotent on (post_master_id, platform): second call updates the same row", async () => {
      const post = await createDraftPost();
      const first = await upsertVariant({
        postMasterId: post.id,
        companyId: COMPANY_A_ID,
        platform: "linkedin_company",
        variantText: "v1",
      });
      const second = await upsertVariant({
        postMasterId: post.id,
        companyId: COMPANY_A_ID,
        platform: "linkedin_company",
        variantText: "v2",
      });
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(first.data.id).toBe(second.data.id); // Same row
      expect(second.data.variant_text).toBe("v2");

      // And the schema-level UNIQUE means there's exactly one row.
      const svc = getServiceRoleClient();
      const rows = await svc
        .from("social_post_variant")
        .select("id")
        .eq("post_master_id", post.id)
        .eq("platform", "linkedin_company");
      expect(rows.error).toBeNull();
      expect(rows.data?.length).toBe(1);
    });

    it("clearing variant_text resets is_custom to false (fall back to master)", async () => {
      const post = await createDraftPost("master");
      const overridden = await upsertVariant({
        postMasterId: post.id,
        companyId: COMPANY_A_ID,
        platform: "facebook_page",
        variantText: "fb-only",
      });
      expect(overridden.ok).toBe(true);

      const cleared = await upsertVariant({
        postMasterId: post.id,
        companyId: COMPANY_A_ID,
        platform: "facebook_page",
        variantText: null,
      });
      expect(cleared.ok).toBe(true);
      if (!cleared.ok) return;
      expect(cleared.data.is_custom).toBe(false);
      expect(cleared.data.variant_text).toBeNull();

      // listVariants should now show master_text as effective.
      const list = await listVariants({
        postMasterId: post.id,
        companyId: COMPANY_A_ID,
      });
      expect(list.ok).toBe(true);
      if (!list.ok) return;
      const fb = list.data.resolved.find((r) => r.platform === "facebook_page");
      expect(fb?.effective_text).toBe("master");
    });

    it("rejects upsert when parent post is not draft (INVALID_STATE)", async () => {
      const post = await createDraftPost();
      const svc = getServiceRoleClient();
      await svc
        .from("social_post_master")
        .update({ state: "approved" })
        .eq("id", post.id);

      const result = await upsertVariant({
        postMasterId: post.id,
        companyId: COMPANY_A_ID,
        platform: "gbp",
        variantText: "should fail",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_STATE");
    });

    it("returns NOT_FOUND for cross-company access", async () => {
      const post = await createDraftPost();
      const result = await upsertVariant({
        postMasterId: post.id,
        companyId: COMPANY_B_ID,
        platform: "x",
        variantText: "should fail",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });

    it("rejects unsupported platform with VALIDATION_FAILED", async () => {
      const post = await createDraftPost();
      const result = await upsertVariant({
        postMasterId: post.id,
        companyId: COMPANY_A_ID,
        // @ts-expect-error — exercising runtime guard against bad enum
        platform: "instagram",
        variantText: "nope",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects variant_text exceeding the cap with VALIDATION_FAILED", async () => {
      const post = await createDraftPost();
      const result = await upsertVariant({
        postMasterId: post.id,
        companyId: COMPANY_A_ID,
        platform: "x",
        variantText: "x".repeat(10_001),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_FAILED");
    });
  });
});
