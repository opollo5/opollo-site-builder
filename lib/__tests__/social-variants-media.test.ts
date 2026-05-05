import { beforeEach, describe, expect, it } from "vitest";

import { upsertVariant } from "@/lib/platform/social/variants";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// S1-24 — upsertVariant with media_asset_ids guard.
// ---------------------------------------------------------------------------

const COMPANY_A = "abcdef00-0000-0000-0000-aaaaaaaa2424";
const COMPANY_B = "abcdef00-0000-0000-0000-bbbbbbbb2424";

async function seedCompanyAndPost(companyId: string): Promise<string> {
  const svc = getServiceRoleClient();
  const co = await svc.from("platform_companies").insert({
    id: companyId,
    name: `S1-24 ${companyId.slice(-4)}`,
    slug: `s1-24-${companyId.slice(-4)}`,
    domain: `s1-24-${companyId.slice(-4)}.test`,
    is_opollo_internal: false,
    timezone: "Australia/Melbourne",
    approval_default_rule: "any_one",
  });
  if (co.error) throw new Error(`seed company: ${co.error.message}`);

  const master = await svc
    .from("social_post_master")
    .insert({
      company_id: companyId,
      state: "draft",
      source_type: "manual",
      master_text: "hi",
    })
    .select("id")
    .single();
  if (master.error) throw new Error(`seed master: ${master.error.message}`);
  return master.data.id as string;
}

async function seedAsset(companyId: string): Promise<string> {
  const svc = getServiceRoleClient();
  const r = await svc
    .from("social_media_assets")
    .insert({
      company_id: companyId,
      storage_path: `s1-24/${Math.random().toString(36).slice(2, 10)}`,
      mime_type: "image/jpeg",
      bytes: 1,
      source_url: "https://cdn.test/x.jpg",
    })
    .select("id")
    .single();
  if (r.error) throw new Error(`seed asset: ${r.error.message}`);
  return r.data.id as string;
}

beforeEach(async () => {
  // truncateAll runs first; we just seed afresh.
});

describe("upsertVariant — media_asset_ids", () => {
  it("attaches media ids that belong to the company", async () => {
    const postId = await seedCompanyAndPost(COMPANY_A);
    const assetId = await seedAsset(COMPANY_A);

    const result = await upsertVariant({
      postMasterId: postId,
      companyId: COMPANY_A,
      platform: "linkedin_personal",
      variantText: null,
      mediaAssetIds: [assetId],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.media_asset_ids).toEqual([assetId]);
  });

  it("rejects ids that belong to another company", async () => {
    const postId = await seedCompanyAndPost(COMPANY_A);
    await seedCompanyAndPost(COMPANY_B);
    const otherAssetId = await seedAsset(COMPANY_B);

    const result = await upsertVariant({
      postMasterId: postId,
      companyId: COMPANY_A,
      platform: "linkedin_personal",
      variantText: null,
      mediaAssetIds: [otherAssetId],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("clears existing media when [] is passed", async () => {
    const postId = await seedCompanyAndPost(COMPANY_A);
    const a = await seedAsset(COMPANY_A);
    const b = await seedAsset(COMPANY_A);

    await upsertVariant({
      postMasterId: postId,
      companyId: COMPANY_A,
      platform: "x",
      variantText: "first",
      mediaAssetIds: [a, b],
    });
    const second = await upsertVariant({
      postMasterId: postId,
      companyId: COMPANY_A,
      platform: "x",
      variantText: "second",
      mediaAssetIds: [],
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.media_asset_ids).toEqual([]);
    expect(second.data.variant_text).toBe("second");
  });

  it("preserves existing media when undefined is passed", async () => {
    const postId = await seedCompanyAndPost(COMPANY_A);
    const a = await seedAsset(COMPANY_A);

    await upsertVariant({
      postMasterId: postId,
      companyId: COMPANY_A,
      platform: "facebook_page",
      variantText: "with media",
      mediaAssetIds: [a],
    });
    const second = await upsertVariant({
      postMasterId: postId,
      companyId: COMPANY_A,
      platform: "facebook_page",
      variantText: "text-only edit",
      // mediaAssetIds omitted
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.media_asset_ids).toEqual([a]);
    expect(second.data.variant_text).toBe("text-only edit");
  });
});
