import { beforeEach, describe, expect, it, vi } from "vitest";

// LAYER 1 — Unit. Route handler auth + cross-tenant guard for the
// admin analytics dashboard endpoint.

const mockGate = vi.hoisted(() => vi.fn());
const mockGetProfile = vi.hoisted(() => vi.fn());
const mockGetDashboard = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api-gate", () => ({
  requireAdminForApi: mockGate,
}));

vi.mock("@/lib/platform/social/profiles", () => ({
  getProfileById: mockGetProfile,
}));

vi.mock("@/lib/platform/social/analytics-ingest", () => ({
  getProfileAnalyticsDashboard: mockGetDashboard,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET } from "@/app/api/admin/companies/[id]/social-profiles/[profileId]/analytics/dashboard/route";

const COMPANY_A = "a0a0a0a0-1111-4111-a111-111111111111";
const COMPANY_B = "b0b0b0b0-2222-4222-a222-222222222222";
const PROFILE_X = "c0c0c0c0-3333-4333-a333-333333333333";

function req(url: string): { req: Parameters<typeof GET>[0]; params: { id: string; profileId: string } } {
  // Pull params from URL pattern for the test fixture.
  const u = new URL(url);
  const segments = u.pathname.split("/");
  const idIdx = segments.indexOf("companies") + 1;
  const profileIdx = segments.indexOf("social-profiles") + 1;
  const id = segments[idIdx];
  const profileId = segments[profileIdx];
  return {
    req: new Request(url, { method: "GET" }) as Parameters<typeof GET>[0],
    params: { id, profileId },
  };
}

beforeEach(() => {
  mockGate.mockReset().mockResolvedValue({ kind: "allow" });
  mockGetProfile.mockReset();
  mockGetDashboard.mockReset();
});

describe("GET /api/admin/.../analytics/dashboard", () => {
  it("delegates 401 from the admin gate", async () => {
    mockGate.mockResolvedValue({
      kind: "deny",
      response: new Response("denied", { status: 401 }),
    });
    const { req: r, params } = req(
      `http://localhost/api/admin/companies/${COMPANY_A}/social-profiles/${PROFILE_X}/analytics/dashboard?range=30`,
    );
    const res = await GET(r, { params });
    expect(res.status).toBe(401);
    expect(mockGetProfile).not.toHaveBeenCalled();
  });

  it("400 when range is not 7/30/90", async () => {
    const { req: r, params } = req(
      `http://localhost/api/admin/companies/${COMPANY_A}/social-profiles/${PROFILE_X}/analytics/dashboard?range=14`,
    );
    const res = await GET(r, { params });
    expect(res.status).toBe(400);
  });

  it("404 when the profile doesn't exist", async () => {
    mockGetProfile.mockResolvedValue(null);
    const { req: r, params } = req(
      `http://localhost/api/admin/companies/${COMPANY_A}/social-profiles/${PROFILE_X}/analytics/dashboard?range=30`,
    );
    const res = await GET(r, { params });
    expect(res.status).toBe(404);
  });

  it("CROSS-TENANT: 404 when the profile belongs to a different company than the URL", async () => {
    mockGetProfile.mockResolvedValue({
      id: PROFILE_X,
      company_id: COMPANY_B, // different from the URL company A
      name: "Profile X",
      kind: "company",
      is_default: true,
      bundle_social_team_id: "team-x",
      created_at: "",
      updated_at: "",
    });
    const { req: r, params } = req(
      `http://localhost/api/admin/companies/${COMPANY_A}/social-profiles/${PROFILE_X}/analytics/dashboard?range=30`,
    );
    const res = await GET(r, { params });
    expect(res.status).toBe(404);
    expect(mockGetDashboard).not.toHaveBeenCalled();
  });

  it("200 with dashboard payload on happy path", async () => {
    mockGetProfile.mockResolvedValue({
      id: PROFILE_X,
      company_id: COMPANY_A,
      name: "Profile X",
      kind: "company",
      is_default: true,
      bundle_social_team_id: "team-x",
      created_at: "",
      updated_at: "",
    });
    mockGetDashboard.mockResolvedValue({
      profile_id: PROFILE_X,
      range_days: 30,
      total_impressions_period: 1000,
      total_impressions_previous_period: 500,
      total_impressions_delta_pct: 100,
      platforms: [],
      time_series: [],
      top_posts: [],
      active_imports: [],
      is_first_time: false,
    });
    const { req: r, params } = req(
      `http://localhost/api/admin/companies/${COMPANY_A}/social-profiles/${PROFILE_X}/analytics/dashboard?range=30`,
    );
    const res = await GET(r, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.range_days).toBe(30);
  });
});
