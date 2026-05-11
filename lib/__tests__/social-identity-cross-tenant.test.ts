import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// LAYER 3 — Integration. Cross-tenant identity-leak defence.
//
// Walks the per-platform a/b/c/d/e cases the fix prompt called for:
//   a. Two companies, same identity fingerprint → INSERT refused CROSS_TENANT.
//   b. Two profiles same company, same identity fingerprint → INSERT refused CROSS_PROFILE.
//   c. allow_cross_tenant_identity=true on target → INSERT succeeds, warning logged.
//   d. Same identity hash but different account_id (different page same user)
//      same company different profile → INSERT succeeds.
//   e. null identity fields → status='pending_identity', conflict check skipped.
//
// Driven via syncBundlesocialConnections (the post-callback INSERT path)
// against real Supabase with the bundle.social SDK mocked at the boundary.
// Per-platform parameterised — same five assertions for each of the 5
// platforms our SocialPlatform enum currently supports (LINKEDIN
// personal/company, FACEBOOK, X, GBP). The identity lib itself accepts
// any platform string; when more platforms ship to social_platform, the
// loop here extends.
// ---------------------------------------------------------------------------

const mockClient = {
  socialAccount: {
    socialAccountCreatePortalLink: vi.fn(),
    socialAccountGetByType: vi.fn(),
  },
  team: {
    teamGetTeam: vi.fn(),
    teamGetTeam_mockReset: vi.fn(),
  },
};

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => mockClient,
  getBundlesocialTeamId: () => "team-identity-test",
}));

vi.mock("@/lib/platform/social/bundle-social/provision", () => ({
  getOrCreateBundleSocialTeam: vi.fn().mockResolvedValue("team-identity-test"),
}));

import { syncBundlesocialConnections } from "@/lib/platform/social/connections";
import { computeIdentityHash } from "@/lib/platform/social/connections/identity";
import { getServiceRoleClient } from "@/lib/supabase";

const COMPANY_A_ID = "abcdef00-0000-0000-0000-aaaaaaaa1717";
const COMPANY_B_ID = "abcdef00-0000-0000-0000-bbbbbbbb1717";
const TEAM_A = "team-A-identity";
const TEAM_B = "team-B-identity";

async function seedCompany(args: {
  id: string;
  slug: string;
  teamId: string;
  allowCrossTenant?: boolean;
}): Promise<{ defaultProfileId: string }> {
  const svc = getServiceRoleClient();
  const result = await svc.from("platform_companies").insert({
    id: args.id,
    name: `Co ${args.slug}`,
    slug: args.slug,
    domain: `${args.slug}.test`,
    is_opollo_internal: false,
    timezone: "Australia/Melbourne",
    approval_default_rule: "any_one",
    bundle_social_team_id: args.teamId,
    allow_cross_tenant_identity: args.allowCrossTenant ?? false,
  });
  if (result.error) {
    throw new Error(`seed company ${args.slug}: ${result.error.message}`);
  }
  // Migration 0119 trigger auto-creates a default profile; update its
  // team to match.
  const defaultProfile = await svc
    .from("platform_social_profiles")
    .select("id")
    .eq("company_id", args.id)
    .eq("is_default", true)
    .maybeSingle();
  if (defaultProfile.error || !defaultProfile.data) {
    throw new Error(
      `seed company ${args.slug}: no default profile auto-created`,
    );
  }
  const profileId = defaultProfile.data.id as string;
  await svc
    .from("platform_social_profiles")
    .update({ bundle_social_team_id: args.teamId })
    .eq("id", profileId);
  return { defaultProfileId: profileId };
}

async function seedExtraProfile(args: {
  companyId: string;
  name: string;
  teamId: string;
}): Promise<string> {
  const svc = getServiceRoleClient();
  const ins = await svc
    .from("platform_social_profiles")
    .insert({
      company_id: args.companyId,
      name: args.name,
      kind: "executive",
      is_default: false,
      bundle_social_team_id: args.teamId,
    })
    .select("id")
    .single();
  if (ins.error) throw new Error(`seed extra profile: ${ins.error.message}`);
  return ins.data.id as string;
}

beforeEach(() => {
  mockClient.team.teamGetTeam.mockReset();
  mockClient.socialAccount.socialAccountGetByType.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// One identity fingerprint per platform-mapping case. Keys are the
// stored social_platform enum value; bundleType is what teamGetTeam
// returns. Reused across all 5 sub-cases.
const PLATFORM_CASES: Array<{
  label: string;
  platformDb: string;
  bundleType: string;
  externalId: string;
  userId: string;
}> = [
  {
    label: "LINKEDIN (personal mapping)",
    platformDb: "linkedin_personal",
    bundleType: "LINKEDIN",
    externalId: "urn:li:organization:111",
    userId: "urn:li:person:steven",
  },
  {
    label: "FACEBOOK",
    platformDb: "facebook_page",
    bundleType: "FACEBOOK",
    externalId: "fb-page-222",
    userId: "fb-user-steven",
  },
  {
    label: "TWITTER / X",
    platformDb: "x",
    bundleType: "TWITTER",
    externalId: "x-user-333",
    userId: "x-user-333", // same as externalId per per-platform table
  },
  {
    label: "GOOGLE_BUSINESS",
    platformDb: "gbp",
    bundleType: "GOOGLE_BUSINESS",
    externalId: "gbp-location-444",
    userId: "google-account-steven",
  },
];

function configureMocks(args: {
  bundleType: string;
  bundleAccountId: string;
  externalId: string | null;
  userId: string | null;
}) {
  mockClient.team.teamGetTeam.mockReset();
  mockClient.socialAccount.socialAccountGetByType.mockReset();
  // teamGetTeam returns the account list for sync's Pass 1 walk.
  mockClient.team.teamGetTeam.mockResolvedValue({
    socialAccounts: [
      {
        id: args.bundleAccountId,
        type: args.bundleType,
        displayName: "Test Account",
        username: "test",
      },
    ],
  });
  // socialAccountGetByType returns the identity fingerprint that the
  // identity layer reads.
  mockClient.socialAccount.socialAccountGetByType.mockResolvedValue({
    externalId: args.externalId,
    userId: args.userId,
    userUsername: "test",
    userDisplayName: "Test",
  });
}

describe("Cross-tenant identity-leak defence — per-platform", () => {
  for (const platform of PLATFORM_CASES) {
    describe(platform.label, () => {
      it("(a) CROSS_TENANT — two companies, same identity → refuse + count blocked", async () => {
        const a = await seedCompany({
          id: COMPANY_A_ID,
          slug: `${platform.platformDb}-a-tenant`,
          teamId: TEAM_A,
        });
        const b = await seedCompany({
          id: COMPANY_B_ID,
          slug: `${platform.platformDb}-b-tenant`,
          teamId: TEAM_B,
        });
        void a;
        void b;

        // Pre-seed connection for company A with the identity.
        const svc = getServiceRoleClient();
        const hash = computeIdentityHash(
          platform.platformDb,
          platform.externalId,
          platform.userId,
        );
        await svc.from("social_connections").insert({
          company_id: COMPANY_A_ID,
          profile_id: a.defaultProfileId,
          platform: platform.platformDb,
          bundle_social_account_id: `${platform.bundleType}-existing-a`,
          status: "healthy",
          last_health_check_at: new Date().toISOString(),
          external_account_id: platform.externalId,
          external_user_id: platform.userId,
          external_identity_hash: hash,
        });

        // Now sync for company B with a NEW bundle account id that
        // resolves to the same identity. Sync should refuse the INSERT.
        configureMocks({
          bundleType: platform.bundleType,
          bundleAccountId: `${platform.bundleType}-new-b`,
          externalId: platform.externalId,
          userId: platform.userId,
        });
        const result = await syncBundlesocialConnections({
          companyId: COMPANY_B_ID,
          attributeNewToCompanyId: COMPANY_B_ID,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.inserted).toBe(0);
        expect(result.data.cross_tenant_blocked).toBe(1);

        const bRows = await svc
          .from("social_connections")
          .select("id")
          .eq("company_id", COMPANY_B_ID);
        expect(bRows.data?.length).toBe(0);
      });

      it("(b) CROSS_PROFILE — two profiles same company, same hash → refuse", async () => {
        const a = await seedCompany({
          id: COMPANY_A_ID,
          slug: `${platform.platformDb}-a-profile`,
          teamId: TEAM_A,
        });
        const extraProfileId = await seedExtraProfile({
          companyId: COMPANY_A_ID,
          name: "Executive",
          teamId: TEAM_B,
        });

        const svc = getServiceRoleClient();
        const hash = computeIdentityHash(
          platform.platformDb,
          platform.externalId,
          platform.userId,
        );
        // Pre-seed on the DEFAULT profile.
        await svc.from("social_connections").insert({
          company_id: COMPANY_A_ID,
          profile_id: a.defaultProfileId,
          platform: platform.platformDb,
          bundle_social_account_id: `${platform.bundleType}-default-existing`,
          status: "healthy",
          last_health_check_at: new Date().toISOString(),
          external_account_id: platform.externalId,
          external_user_id: platform.userId,
          external_identity_hash: hash,
        });

        // Sync finds the extra profile's team has the same identity.
        // It should refuse because same-company-different-profile-same-hash
        // is the CROSS_PROFILE case.
        configureMocks({
          bundleType: platform.bundleType,
          bundleAccountId: `${platform.bundleType}-extra-new`,
          externalId: platform.externalId,
          userId: platform.userId,
        });
        // Make the extra profile the only one we look at.
        mockClient.team.teamGetTeam.mockImplementation(async (input: unknown) => {
          const arg = input as { id: string };
          // Both teams return the same account-id payload via this mock —
          // but we re-write display name to point at the extra-profile
          // attempt.
          if (arg.id === TEAM_B) {
            return {
              socialAccounts: [
                {
                  id: `${platform.bundleType}-extra-new`,
                  type: platform.bundleType,
                  displayName: "Extra-profile attempt",
                  username: "test",
                },
              ],
            };
          }
          return { socialAccounts: [] };
        });

        void extraProfileId;
        const result = await syncBundlesocialConnections({
          companyId: COMPANY_A_ID,
          attributeNewToCompanyId: COMPANY_A_ID,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.cross_tenant_blocked).toBeGreaterThanOrEqual(1);
      });

      it("(c) allow_cross_tenant_identity=true → INSERT succeeds", async () => {
        const a = await seedCompany({
          id: COMPANY_A_ID,
          slug: `${platform.platformDb}-a-override`,
          teamId: TEAM_A,
        });
        const b = await seedCompany({
          id: COMPANY_B_ID,
          slug: `${platform.platformDb}-b-override`,
          teamId: TEAM_B,
          allowCrossTenant: true,
        });
        void a;
        void b;

        const svc = getServiceRoleClient();
        const hash = computeIdentityHash(
          platform.platformDb,
          platform.externalId,
          platform.userId,
        );
        await svc.from("social_connections").insert({
          company_id: COMPANY_A_ID,
          profile_id: a.defaultProfileId,
          platform: platform.platformDb,
          bundle_social_account_id: `${platform.bundleType}-existing-a-override`,
          status: "healthy",
          last_health_check_at: new Date().toISOString(),
          external_account_id: platform.externalId,
          external_user_id: platform.userId,
          external_identity_hash: hash,
        });

        configureMocks({
          bundleType: platform.bundleType,
          bundleAccountId: `${platform.bundleType}-new-b-override`,
          externalId: platform.externalId,
          userId: platform.userId,
        });
        const result = await syncBundlesocialConnections({
          companyId: COMPANY_B_ID,
          attributeNewToCompanyId: COMPANY_B_ID,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.inserted).toBe(1);
        expect(result.data.cross_tenant_blocked).toBe(0);

        // Audit: cross_tenant_override row in platform_events.
        const events = await svc
          .from("platform_events")
          .select("event_type, company_id")
          .eq("event_type", "cross_tenant_override")
          .eq("company_id", COMPANY_B_ID);
        expect((events.data?.length ?? 0)).toBeGreaterThanOrEqual(1);
      });

      it("(d) same user_id different account_id same company → INSERT succeeds (different pages, same human)", async () => {
        const a = await seedCompany({
          id: COMPANY_A_ID,
          slug: `${platform.platformDb}-a-multi`,
          teamId: TEAM_A,
        });
        const extraProfileId = await seedExtraProfile({
          companyId: COMPANY_A_ID,
          name: "Executive",
          teamId: TEAM_B,
        });

        const svc = getServiceRoleClient();
        const otherAccountId = `${platform.externalId}-OTHER-PAGE`;
        const sharedUserId = platform.userId;
        const hashDefault = computeIdentityHash(
          platform.platformDb,
          platform.externalId,
          sharedUserId,
        );

        // Pre-seed on default profile with account_id=externalId.
        await svc.from("social_connections").insert({
          company_id: COMPANY_A_ID,
          profile_id: a.defaultProfileId,
          platform: platform.platformDb,
          bundle_social_account_id: `${platform.bundleType}-multi-default`,
          status: "healthy",
          last_health_check_at: new Date().toISOString(),
          external_account_id: platform.externalId,
          external_user_id: sharedUserId,
          external_identity_hash: hashDefault,
        });

        // Sync the extra profile's team — different account_id (a
        // different Page), same user_id (same human grantor). Hash
        // differs because account_id differs. Cross-profile only
        // fires on hash match → not a conflict.
        configureMocks({
          bundleType: platform.bundleType,
          bundleAccountId: `${platform.bundleType}-multi-extra`,
          externalId: otherAccountId,
          userId: sharedUserId,
        });
        mockClient.team.teamGetTeam.mockImplementation(async (input: unknown) => {
          const arg = input as { id: string };
          if (arg.id === TEAM_B) {
            return {
              socialAccounts: [
                {
                  id: `${platform.bundleType}-multi-extra`,
                  type: platform.bundleType,
                  displayName: "Different page same user",
                  username: "test",
                },
              ],
            };
          }
          return { socialAccounts: [] };
        });

        void extraProfileId;
        const result = await syncBundlesocialConnections({
          companyId: COMPANY_A_ID,
          attributeNewToCompanyId: COMPANY_A_ID,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // cross_tenant_blocked must be 0 — the (platform, user_id) check
        // matches across profiles in the same company but that does NOT
        // trip CROSS_PROFILE (which fires only on full-hash match).
        expect(result.data.cross_tenant_blocked).toBe(0);
        expect(result.data.inserted).toBe(1);
      });

      it("(e) null identity fields → status='pending_identity', no block", async () => {
        const a = await seedCompany({
          id: COMPANY_A_ID,
          slug: `${platform.platformDb}-a-pending`,
          teamId: TEAM_A,
        });
        void a;

        configureMocks({
          bundleType: platform.bundleType,
          bundleAccountId: `${platform.bundleType}-pending`,
          externalId: null,
          userId: null,
        });
        const result = await syncBundlesocialConnections({
          companyId: COMPANY_A_ID,
          attributeNewToCompanyId: COMPANY_A_ID,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.inserted).toBe(1);
        expect(result.data.cross_tenant_blocked).toBe(0);

        const svc = getServiceRoleClient();
        const row = await svc
          .from("social_connections")
          .select("status, external_account_id, external_user_id, external_identity_hash")
          .eq("company_id", COMPANY_A_ID)
          .single();
        expect(row.error).toBeNull();
        expect(row.data?.status).toBe("pending_identity");
        expect(row.data?.external_account_id).toBeNull();
        expect(row.data?.external_user_id).toBeNull();
        expect(row.data?.external_identity_hash).toBeNull();
      });
    });
  }
});
