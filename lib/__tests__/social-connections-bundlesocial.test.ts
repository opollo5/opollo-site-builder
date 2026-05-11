import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// ---------------------------------------------------------------------------
// S1-16 — syncBundlesocialConnections against a mocked bundle.social SDK.
//
// Why mock the SDK: tests must run in CI without
// BUNDLE_SOCIAL_API / BUNDLE_SOCIAL_TEAMID being real. We replace
// `lib/bundlesocial`'s factories with stubs and assert:
//
//   sync: pass-1 INSERT new (with attribution), UPDATE existing
//   (refresh status to healthy + display_name); pass-2 mark
//   missing remote rows as disconnected; respect attribution-off
//   to skip inserts; map LINKEDIN/FACEBOOK/TWITTER/GOOGLE_BUSINESS;
//   skip unmapped types.
// ---------------------------------------------------------------------------

const mockClient = {
  socialAccount: {
    socialAccountCreatePortalLink: vi.fn(),
    // resolveIdentityFingerprint calls this; return realistic identity so
    // sync.ts marks accounts "healthy" rather than "pending_identity".
    socialAccountGetByType: vi.fn().mockResolvedValue({
      externalId: "ext-acct-mock",
      userId: "user-mock",
    }),
  },
  team: {
    teamGetTeam: vi.fn(),
  },
};

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => mockClient,
  getBundlesocialTeamId: () => "team-test-1",
}));

vi.mock("@/lib/platform/social/bundle-social/provision", () => ({
  getOrCreateBundleSocialTeam: vi.fn().mockResolvedValue("team-test-1"),
}));

import { syncBundlesocialConnections } from "@/lib/platform/social/connections";
import { getServiceRoleClient } from "@/lib/supabase";

const COMPANY_A_ID = "abcdef00-0000-0000-0000-aaaaaaaa1616";
const COMPANY_B_ID = "abcdef00-0000-0000-0000-bbbbbbbb1616";

async function seedCompany(id: string, slug: string): Promise<void> {
  const svc = getServiceRoleClient();
  const result = await svc.from("platform_companies").insert({
    id,
    name: `Co ${slug}`,
    slug,
    domain: `${slug}.test`,
    is_opollo_internal: false,
    timezone: "Australia/Melbourne",
    approval_default_rule: "any_one",
  });
  if (result.error) {
    throw new Error(
      `seed company ${slug}: ${result.error.code ?? "?"} ${result.error.message}`,
    );
  }
}

beforeEach(() => {
  mockClient.socialAccount.socialAccountCreatePortalLink.mockReset();
  mockClient.socialAccount.socialAccountGetByType.mockReset();
  mockClient.socialAccount.socialAccountGetByType.mockResolvedValue({
    externalId: "ext-acct-mock",
    userId: "user-mock",
  });
  mockClient.team.teamGetTeam.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("syncBundlesocialConnections", () => {
  it("INSERTs new accounts with attribution and skips unmapped types", async () => {
    await seedCompany(COMPANY_A_ID, "s1-16-acme");

    mockClient.team.teamGetTeam.mockResolvedValueOnce({
      socialAccounts: [
        {
          id: "ba_li_1",
          type: "LINKEDIN",
          displayName: "Acme LI",
          avatarUrl: "https://cdn/li.png",
        },
        {
          id: "ba_x_1",
          type: "TWITTER",
          username: "acme",
        },
        {
          id: "ba_unknown_1",
          type: "PINTEREST",
          displayName: "should be skipped",
        },
      ],
    });

    const result = await syncBundlesocialConnections({
      companyId: COMPANY_A_ID,
      attributeNewToCompanyId: COMPANY_A_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.inserted).toBe(2);
    expect(result.data.updated).toBe(0);
    expect(result.data.marked_disconnected).toBe(0);
    expect(result.data.unmapped_skipped).toBe(1);

    const svc = getServiceRoleClient();
    const rows = await svc
      .from("social_connections")
      .select("platform, bundle_social_account_id, display_name, status")
      .eq("company_id", COMPANY_A_ID)
      .order("bundle_social_account_id");
    expect(rows.error).toBeNull();
    expect(rows.data?.length).toBe(2);
    expect(rows.data?.[0]?.platform).toBe("linkedin_personal");
    expect(rows.data?.[0]?.display_name).toBe("Acme LI");
    expect(rows.data?.[0]?.status).toBe("healthy");
    expect(rows.data?.[1]?.platform).toBe("x");
    expect(rows.data?.[1]?.display_name).toBe("acme");
  });

  it("UPDATEs existing rows back to healthy + refreshes display_name", async () => {
    await seedCompany(COMPANY_A_ID, "s1-16-acme");
    const svc = getServiceRoleClient();
    const seed = await svc
      .from("social_connections")
      .insert({
        company_id: COMPANY_A_ID,
        platform: "linkedin_personal",
        bundle_social_account_id: "ba_li_existing",
        display_name: "Old Name",
        status: "auth_required",
        last_error: "old token expired",
      })
      .select("id")
      .single();
    expect(seed.error).toBeNull();

    mockClient.team.teamGetTeam.mockResolvedValueOnce({
      socialAccounts: [
        {
          id: "ba_li_existing",
          type: "LINKEDIN",
          displayName: "Fresh Name",
          avatarUrl: "https://cdn/fresh.png",
        },
      ],
    });

    const result = await syncBundlesocialConnections({ companyId: COMPANY_A_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.updated).toBe(1);
    expect(result.data.inserted).toBe(0);

    const after = await svc
      .from("social_connections")
      .select("display_name, status, last_error, avatar_url")
      .eq("id", seed.data?.id)
      .single();
    expect(after.data?.display_name).toBe("Fresh Name");
    expect(after.data?.status).toBe("healthy");
    expect(after.data?.last_error).toBeNull();
    expect(after.data?.avatar_url).toBe("https://cdn/fresh.png");
  });

  it("marks rows missing from remote as disconnected", async () => {
    await seedCompany(COMPANY_A_ID, "s1-16-acme");
    const svc = getServiceRoleClient();
    const seed = await svc
      .from("social_connections")
      .insert({
        company_id: COMPANY_A_ID,
        platform: "x",
        bundle_social_account_id: "ba_orphan",
        display_name: "Was Here",
        status: "healthy",
      })
      .select("id")
      .single();
    expect(seed.error).toBeNull();

    mockClient.team.teamGetTeam.mockResolvedValueOnce({
      socialAccounts: [],
    });

    const result = await syncBundlesocialConnections({ companyId: COMPANY_A_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.marked_disconnected).toBe(1);
    expect(result.data.updated).toBe(0);

    const after = await svc
      .from("social_connections")
      .select("status, disconnected_at")
      .eq("id", seed.data?.id)
      .single();
    expect(after.data?.status).toBe("disconnected");
    expect(after.data?.disconnected_at).not.toBeNull();
  });

  it("does not insert new accounts without attribution (health-only mode)", async () => {
    mockClient.team.teamGetTeam.mockResolvedValueOnce({
      socialAccounts: [
        {
          id: "ba_floater",
          type: "TWITTER",
          username: "floater",
        },
      ],
    });

    const result = await syncBundlesocialConnections({ companyId: COMPANY_A_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.inserted).toBe(0);

    const svc = getServiceRoleClient();
    const rows = await svc
      .from("social_connections")
      .select("id")
      .eq("bundle_social_account_id", "ba_floater");
    expect(rows.data?.length).toBe(0);
  });

  it("does not double-flip a row already marked disconnected", async () => {
    await seedCompany(COMPANY_B_ID, "s1-16-beta");
    const svc = getServiceRoleClient();
    await svc.from("social_connections").insert({
      company_id: COMPANY_B_ID,
      platform: "facebook_page",
      bundle_social_account_id: "ba_already_dc",
      status: "disconnected",
    });

    mockClient.team.teamGetTeam.mockResolvedValueOnce({
      socialAccounts: [],
    });

    const result = await syncBundlesocialConnections({ companyId: COMPANY_B_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.marked_disconnected).toBe(0);
  });

  it("returns INTERNAL_ERROR when teamGetTeam throws", async () => {
    mockClient.team.teamGetTeam.mockRejectedValueOnce(new Error("HTTP 500"));
    const result = await syncBundlesocialConnections({ companyId: COMPANY_A_ID });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INTERNAL_ERROR");
    expect(result.error.message).toContain("HTTP 500");
  });
});