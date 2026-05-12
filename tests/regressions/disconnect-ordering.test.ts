import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Make the L4 verify-loop's setTimeout windows zero so this test file
// doesn't pay the 2s + 5s wall-clock cost per retry case.
process.env.BUNDLE_VERIFY_INITIAL_WAIT_MS = "0";
process.env.BUNDLE_VERIFY_RETRY_WAIT_MS = "0";

// ---------------------------------------------------------------------------
// REGRESSION — Layer 6 disconnect ordering.
//
// Channel-selection flow (incident 2026-05-12): when a connection
// with a bound channel is disconnected, the order is:
//   1. unsetChannel (so drafts release back to drafts)
//   2. 200ms settle
//   3. socialAccountDisconnect
//   4. DELETE social_connections row
//
// Critical pin: DELETE happens regardless of upstream failures (the
// customer pressed disconnect — the row must go away from their UI),
// and unsetChannel runs BEFORE socialAccountDisconnect so bundle.social
// has a chance to release drafts cleanly.
// ---------------------------------------------------------------------------

const callOrder: string[] = [];

const unsetChannelSdkMock = vi.fn(async () => {
  callOrder.push("unsetChannel");
});
const disconnectSdkMock = vi.fn(async () => {
  callOrder.push("disconnect");
});
// L4 verify-then-delete: after the disconnect, the route calls
// socialAccountGetByType to confirm BS released the account. Returning
// null = clean (verify succeeds). Tests overriding this to return an
// account object simulate split-brain.
const getByTypeSdkMock = vi.fn(async () => {
  callOrder.push("verify-getByType");
  return null;
});
const deleteMock = vi.fn(async () => {
  callOrder.push("delete");
  return { error: null };
});
const insertEventMock = vi.fn(async () => ({ error: null }));

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => ({
    socialAccount: {
      socialAccountUnsetChannel: unsetChannelSdkMock,
      socialAccountDisconnect: disconnectSdkMock,
      socialAccountGetByType: getByTypeSdkMock,
    },
  }),
}));

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: async () => ({
    kind: "allow" as const,
    userId: "user-test",
    supabase: {} as never,
  }),
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "social_connections") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: connRow,
                error: null,
              }),
            }),
          }),
          delete: () => ({
            eq: deleteMock,
          }),
        };
      }
      if (table === "platform_social_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { bundle_social_team_id: "team-fixture" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "platform_events") {
        return {
          insert: insertEventMock,
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  }),
}));

import { POST } from "@/app/api/platform/social/connections/[id]/disconnect/route";

const CONNECTION_ID = "abcdef00-0000-0000-0000-aaaaaaaa0001";

let connRow: {
  id: string;
  company_id: string;
  profile_id: string;
  platform: string;
  bundle_social_account_id: string;
  status: string;
  is_personal_mode: boolean;
};

beforeEach(() => {
  callOrder.length = 0;
  unsetChannelSdkMock.mockClear();
  disconnectSdkMock.mockClear();
  getByTypeSdkMock.mockClear();
  getByTypeSdkMock.mockImplementation(async () => {
    callOrder.push("verify-getByType");
    return null;
  });
  deleteMock.mockClear();
  insertEventMock.mockClear();
  connRow = {
    id: CONNECTION_ID,
    company_id: "11111111-1111-1111-1111-111111111111",
    profile_id: "22222222-2222-2222-2222-222222222222",
    platform: "linkedin_personal",
    bundle_social_account_id: "bs-acct-1",
    status: "healthy",
    is_personal_mode: false,
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

async function callDisconnect(): Promise<Response> {
  return POST(new Request("http://localhost/x", { method: "POST" }) as never, {
    params: { id: CONNECTION_ID },
  });
}

describe("R-DISCONNECT: order is unset → disconnect → verify → DELETE", () => {
  it("channel-selection platform with bound channel: unset runs first, verify gates delete", async () => {
    const res = await callDisconnect();
    expect(res.status).toBe(200);
    expect(callOrder).toEqual([
      "unsetChannel",
      "disconnect",
      "verify-getByType",
      "delete",
    ]);
  });

  it("personal-mode LinkedIn skips unsetChannel (no channel bound)", async () => {
    connRow.is_personal_mode = true;
    const res = await callDisconnect();
    expect(res.status).toBe(200);
    expect(callOrder).toEqual(["disconnect", "verify-getByType", "delete"]);
  });

  it("non-channel-selection platform (X) skips unsetChannel", async () => {
    connRow.platform = "x";
    const res = await callDisconnect();
    expect(res.status).toBe(200);
    expect(callOrder).toEqual(["disconnect", "verify-getByType", "delete"]);
  });

  it("DELETE still runs when unsetChannel errors (verify still clean)", async () => {
    unsetChannelSdkMock.mockImplementationOnce(async () => {
      callOrder.push("unsetChannel");
      throw new Error("upstream fail");
    });
    const res = await callDisconnect();
    expect(res.status).toBe(200);
    expect(callOrder).toEqual([
      "unsetChannel",
      "disconnect",
      "verify-getByType",
      "delete",
    ]);
  });

  it("DELETE still runs when socialAccountDisconnect errors but verify is clean (idempotent)", async () => {
    disconnectSdkMock.mockImplementationOnce(async () => {
      callOrder.push("disconnect");
      throw new Error("upstream fail");
    });
    const res = await callDisconnect();
    expect(res.status).toBe(200);
    expect(callOrder).toEqual([
      "unsetChannel",
      "disconnect",
      "verify-getByType",
      "delete",
    ]);
  });

  it("SPLIT-BRAIN: BS still has account after disconnect → 409, NO delete, audit logged", async () => {
    // Simulate bundle.social NOT releasing the account after disconnect.
    // verify-getByType returns a non-null account on every call.
    getByTypeSdkMock.mockImplementation(async () => {
      callOrder.push("verify-getByType");
      return { id: "bs-acct-1" };
    });
    const res = await callDisconnect();
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_STATE");
    // The route MUST NOT delete the row when verify never goes clean.
    expect(callOrder).not.toContain("delete");
    // The route should have retried the disconnect once before giving up.
    // Final order: initial unset/disconnect + verify (still has) + retry
    // disconnect + verify (still has).
    expect(disconnectSdkMock).toHaveBeenCalledTimes(2);
  });

  it("SPLIT-BRAIN-RECOVERY: verify clean after one retry → delete proceeds", async () => {
    // First verify returns account, retry-disconnect runs, then second
    // verify returns null → clean → delete.
    let call = 0;
    getByTypeSdkMock.mockImplementation(async () => {
      callOrder.push("verify-getByType");
      call += 1;
      return call === 1 ? { id: "bs-acct-1" } : null;
    });
    const res = await callDisconnect();
    expect(res.status).toBe(200);
    expect(callOrder).toContain("delete");
    expect(disconnectSdkMock).toHaveBeenCalledTimes(2);
  });

  it("400 'Team does not have' is idempotent-success, not a failure", async () => {
    disconnectSdkMock.mockImplementationOnce(async () => {
      callOrder.push("disconnect");
      throw {
        name: "ApiError",
        status: 400,
        body: { message: "Team does not have a LINKEDIN account" },
      };
    });
    const res = await callDisconnect();
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data?: { upstream_disconnect_ok: boolean };
    };
    expect(json.ok).toBe(true);
    expect(json.data?.upstream_disconnect_ok).toBe(true);
  });
});
