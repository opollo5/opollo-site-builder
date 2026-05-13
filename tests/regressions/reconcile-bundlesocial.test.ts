import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION — POST /api/admin/maintenance/reconcile-bundlesocial.
//
// Three divergence kinds and their fixes:
//   ghost   — BS has account, no DB row → disconnect BS account
//   phantom — DB has active row, BS empty → mark row 'disconnected'
//   mismatch — both sides, drift → re-sync DB from BS
//
// Tests assert (a) the scan produces the right divergence shape and
// (b) apply mode runs the right SDK / DB op per kind.
// ---------------------------------------------------------------------------

process.env.BUNDLE_VERIFY_INITIAL_WAIT_MS = "0";
process.env.BUNDLE_VERIFY_RETRY_WAIT_MS = "0";

const getByTypeSdkMock = vi.fn();
const disconnectSdkMock = vi.fn();
const insertEventMock = vi.fn(async () => ({ error: null }));
const updateMock = vi.fn();

// Per-table query state. The scan code reads profiles and companies for
// team-id resolution and the connections table for DB rows. Test sets
// dataByTable before each test.
const dataByTable: Record<string, unknown> = {};

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => ({
    socialAccount: {
      socialAccountGetByType: getByTypeSdkMock,
      socialAccountDisconnect: disconnectSdkMock,
    },
  }),
}));

vi.mock("@/lib/admin-api-gate", () => ({
  requireAdminForApi: async () => ({
    kind: "allow" as const,
    user: { id: "admin-test", email: "admin@test", role: "admin" },
  }),
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "social_connections") {
        return {
          select: () => ({
            data: dataByTable.social_connections,
            error: null,
            // For .not("bundle_social_team_id", "is", null) chains.
            not: () => ({
              data: dataByTable.social_connections,
              error: null,
            }),
          }),
          update: (vals: Record<string, unknown>) => ({
            eq: async (_col: string, _val: string) => {
              updateMock(vals);
              return { error: null };
            },
          }),
        };
      }
      if (table === "platform_social_profiles") {
        return {
          select: () => ({
            not: () => ({
              data: dataByTable.platform_social_profiles,
              error: null,
            }),
            data: dataByTable.platform_social_profiles,
            error: null,
          }),
        };
      }
      if (table === "platform_companies") {
        return {
          select: () => ({
            not: () => ({
              data: dataByTable.platform_companies,
              error: null,
            }),
            data: dataByTable.platform_companies,
            error: null,
          }),
        };
      }
      if (table === "platform_events") {
        return { insert: insertEventMock };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  }),
}));

import { POST } from "@/app/api/admin/maintenance/reconcile-bundlesocial/route";

// Valid UUIDv4-shaped fixtures (variant bits match Zod 4's UUID regex).
const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  getByTypeSdkMock.mockReset();
  disconnectSdkMock.mockReset();
  updateMock.mockReset();
  insertEventMock.mockClear();
  dataByTable.platform_social_profiles = [];
  dataByTable.platform_companies = [
    { id: COMPANY_ID, bundle_social_team_id: TEAM_ID },
  ];
  dataByTable.social_connections = [];
  // Default: BS returns null (no account) for every (team, platform).
  getByTypeSdkMock.mockResolvedValue(null);
  disconnectSdkMock.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

async function callReconcile(body: Record<string, unknown>): Promise<Response> {
  return POST(
    new Request("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
  );
}

describe("R-RECONCILE-BUNDLESOCIAL", () => {
  it("CLEAN: no divergences when BS and DB agree (both empty)", async () => {
    const res = await callReconcile({
      apply: false,
      team_ids: [TEAM_ID],
      platforms: ["LINKEDIN"],
    });
    const body = (await res.json()) as {
      ok: boolean;
      data: { divergences: unknown[]; applied: boolean };
    };
    expect(body.ok).toBe(true);
    expect(body.data.divergences).toEqual([]);
    expect(body.data.applied).toBe(false);
  });

  it("GHOST scan: BS has account, no DB row → divergence kind='ghost'", async () => {
    getByTypeSdkMock.mockResolvedValueOnce({
      id: "ghost-acct-1",
      externalId: "urn:li:org:99",
      displayName: "Ghost Co",
    });
    const res = await callReconcile({
      apply: false,
      team_ids: [TEAM_ID],
      platforms: ["LINKEDIN"],
    });
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        divergences: Array<{
          kind: string;
          team_id: string;
          platform: string;
          bundle_account_id: string | null;
        }>;
      };
    };
    expect(body.data.divergences).toHaveLength(1);
    expect(body.data.divergences[0]?.kind).toBe("ghost");
    expect(body.data.divergences[0]?.bundle_account_id).toBe("ghost-acct-1");
    // Read-only — no disconnect issued.
    expect(disconnectSdkMock).not.toHaveBeenCalled();
  });

  it("GHOST apply: disconnect SDK called and audit logged", async () => {
    getByTypeSdkMock.mockResolvedValue({
      id: "ghost-acct-2",
      externalId: null,
      displayName: null,
    });
    const res = await callReconcile({
      apply: true,
      team_ids: [TEAM_ID],
      platforms: ["LINKEDIN"],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        apply_results: Array<{ ok: boolean; action: string }>;
      };
    };
    expect(body.data.apply_results[0]?.ok).toBe(true);
    expect(body.data.apply_results[0]?.action).toBe("ghost_disconnected");
    expect(disconnectSdkMock).toHaveBeenCalledWith({
      requestBody: { type: "LINKEDIN", teamId: TEAM_ID },
    });
    // Audit is fire-and-forget; allow microtasks to flush.
    await new Promise((r) => setTimeout(r, 10));
    expect(insertEventMock).toHaveBeenCalled();
  });

  it("PHANTOM scan: DB has active row, BS returns null → divergence kind='phantom'", async () => {
    dataByTable.social_connections = [
      {
        id: "ddddeeee-0000-0000-0000-000000000001",
        bundle_social_account_id: "stale-bs-1",
        company_id: COMPANY_ID,
        platform: "linkedin_personal",
        display_name: "Stale",
        external_account_id: null,
        external_user_id: "urn:li:person:stale",
        profile_id: null,
        status: "healthy",
      },
    ];
    // BS returns null for LINKEDIN.
    const res = await callReconcile({
      apply: false,
      team_ids: [TEAM_ID],
      platforms: ["LINKEDIN"],
    });
    const body = (await res.json()) as {
      data: {
        divergences: Array<{
          kind: string;
          db_row_id: string | null;
        }>;
      };
    };
    expect(body.data.divergences).toHaveLength(1);
    expect(body.data.divergences[0]?.kind).toBe("phantom");
    expect(body.data.divergences[0]?.db_row_id).toBe(
      "ddddeeee-0000-0000-0000-000000000001",
    );
  });

  it("PHANTOM apply: DB row marked status='disconnected'", async () => {
    dataByTable.social_connections = [
      {
        id: "ddddeeee-0000-0000-0000-000000000002",
        bundle_social_account_id: "stale-bs-2",
        company_id: COMPANY_ID,
        platform: "linkedin_personal",
        display_name: "Stale-2",
        external_account_id: null,
        external_user_id: null,
        profile_id: null,
        status: "healthy",
      },
    ];
    const res = await callReconcile({
      apply: true,
      team_ids: [TEAM_ID],
      platforms: ["LINKEDIN"],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { apply_results: Array<{ ok: boolean; action: string }> };
    };
    expect(body.data.apply_results[0]?.action).toBe(
      "phantom_marked_disconnected",
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "disconnected" }),
    );
    // disconnected rows are excluded from active-row consideration, so
    // we expect to have set status, disconnected_at, and last_error.
    expect(updateMock.mock.calls[0]?.[0]).toMatchObject({
      status: "disconnected",
      last_error: expect.stringContaining("reconcile"),
    });
  });

  it("DISCONNECTED DB rows are excluded from phantom detection", async () => {
    dataByTable.social_connections = [
      {
        id: "ddddeeee-0000-0000-0000-000000000003",
        bundle_social_account_id: "already-dc",
        company_id: COMPANY_ID,
        platform: "linkedin_personal",
        display_name: null,
        external_account_id: null,
        external_user_id: null,
        profile_id: null,
        status: "disconnected",
      },
    ];
    const res = await callReconcile({
      apply: false,
      team_ids: [TEAM_ID],
      platforms: ["LINKEDIN"],
    });
    const body = (await res.json()) as {
      data: { divergences: unknown[] };
    };
    expect(body.data.divergences).toEqual([]);
  });
});
