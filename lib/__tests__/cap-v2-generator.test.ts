import { describe, expect, it, vi, beforeAll, beforeEach, afterAll } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";
import { generateCAPPosts } from "@/lib/platform/social/cap/generator";
import { seedAuthUser } from "./_auth-helpers";
import type { AnthropicCallFn } from "@/lib/anthropic-call";

// ---------------------------------------------------------------------------
// CAP generator V2 integration test.
//
// Verifies that generateCAPPosts writes to social_post_drafts (V2) with the
// correct state, source_type, and content. Does NOT call real Anthropic or
// Ideogram APIs — AnthropicCallFn is stubbed, IDEOGRAM_API_KEY is absent.
// ---------------------------------------------------------------------------

vi.mock("@/lib/platform/brand/get", () => ({
  getActiveBrandProfile: vi.fn().mockResolvedValue(null),
}));

const COMPANY_ID = "00000500-0000-0000-0000-000000000001";
let seededUserId: string;

async function seedCompany() {
  const svc = getServiceRoleClient();
  await svc.from("social_post_drafts").delete().eq("company_id", COMPANY_ID);
  await svc.from("platform_companies").delete().eq("id", COMPANY_ID);
  const { error } = await svc.from("platform_companies").insert({
    id: COMPANY_ID,
    name: "CAP V2 Test Co",
    slug: "cap-v2-test-co",
    is_opollo_internal: false,
    timezone: "UTC",
    approval_default_rule: "any_one",
  });
  if (error) throw new Error(`seed company: ${error.message}`);
}

function makeCannedCallFn(masterText: string, variants: Record<string, string>): AnthropicCallFn {
  const json = JSON.stringify({ posts: [{ master_text: masterText, variants }] });
  return vi.fn().mockResolvedValue({
    id: "msg_test",
    model: "claude-sonnet-4-6",
    content: [{ type: "text" as const, text: json }],
    stop_reason: "end_turn",
    usage: { input_tokens: 50, output_tokens: 100 },
  });
}

beforeAll(async () => {
  const user = await seedAuthUser({ persistent: true });
  seededUserId = user.id;
});

beforeEach(async () => {
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

describe("CAP generator — V2 social_post_drafts", () => {
  it("creates a draft row with state=draft and source_type=cap", async () => {
    const svc = getServiceRoleClient();
    const masterText = "Grow your business with confidence this season.";
    const callFn = makeCannedCallFn(masterText, {
      linkedin_company: "LinkedIn version of the post.",
      x: "X version #growth",
    });

    const result = await generateCAPPosts(
      { companyId: COMPANY_ID, platforms: ["linkedin_company", "x"], count: 1, triggeredBy: seededUserId },
      callFn,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].draftId).toBeTruthy();
    expect(result.posts[0].masterText).toBe(masterText);

    const { data: draft, error } = await svc
      .from("social_post_drafts")
      .select("id, state, source_type, content, platform_variants")
      .eq("company_id", COMPANY_ID)
      .single();

    expect(error, `draft fetch error: ${error?.message}`).toBeNull();
    expect(draft?.state).toBe("draft");
    expect(draft?.source_type).toBe("cap");
    expect(draft?.content).toBe(masterText);
    expect(draft?.id).toBe(result.posts[0].draftId);

    const variants = draft?.platform_variants as Record<string, { content: string }>;
    expect(variants?.linkedin_company?.content).toBe("LinkedIn version of the post.");
    expect(variants?.x?.content).toBe("X version #growth");
  });

  it("returns ALL_FAILED when Claude response has empty master_text", async () => {
    const callFn = makeCannedCallFn("", {});
    const result = await generateCAPPosts(
      { companyId: COMPANY_ID, count: 1, triggeredBy: seededUserId },
      callFn,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ALL_FAILED");
  });

  it("creates multiple draft rows when count > 1", async () => {
    const json = JSON.stringify({
      posts: [
        { master_text: "Post one content.", variants: { x: "Tweet one." } },
        { master_text: "Post two content.", variants: { x: "Tweet two." } },
      ],
    });
    const callFn = vi.fn().mockResolvedValue({
      id: "msg_multi",
      model: "claude-sonnet-4-6",
      content: [{ type: "text" as const, text: json }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 200 },
    }) as AnthropicCallFn;

    const result = await generateCAPPosts(
      { companyId: COMPANY_ID, platforms: ["x"], count: 2, triggeredBy: seededUserId },
      callFn,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts).toHaveLength(2);

    const svc = getServiceRoleClient();
    const { data: drafts } = await svc
      .from("social_post_drafts")
      .select("id, source_type, state")
      .eq("company_id", COMPANY_ID);

    expect(drafts).toHaveLength(2);
    expect(drafts?.every((d) => d.state === "draft")).toBe(true);
    expect(drafts?.every((d) => d.source_type === "cap")).toBe(true);
  });
});
