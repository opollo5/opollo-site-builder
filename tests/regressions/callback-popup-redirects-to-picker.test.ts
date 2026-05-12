import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION — popup OAuth callback redirects to in-popup channel picker
// (2026-05-13 UX change).
//
// Before: popup callback posted { connect: "needs_channel", connection_id }
//         to window.opener and closed the popup. The parent window opened
//         a ChannelPickerModal. Two-window UX.
//
// After:  popup callback 302s the popup ITSELF to
//         /connect/pick-channel?connection_id=<id>. Single-window UX.
//
// This test pins the new redirect target. Also asserts non-popup mode
// and non-channel-selection success keep their existing behaviour.
// ---------------------------------------------------------------------------

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: async () => ({
    kind: "allow" as const,
    userId: "user-test",
    supabase: {} as never,
  }),
}));

vi.mock("@/lib/platform/social/analytics-ingest", () => ({
  enqueuePostHistoryImport: vi.fn(),
}));

const syncMock = vi.fn();

vi.mock("@/lib/platform/social/connections", () => ({
  syncBundlesocialConnections: (...args: unknown[]) => syncMock(...args),
}));

// Supabase mock — returns the freshly-inserted pending_identity row for
// the most-recently-inserted lookup that the callback runs.
const supabaseFromMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => supabaseFromMock(table),
  }),
}));

import { GET } from "@/app/api/platform/social/connections/callback/route";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const CONNECTION_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

beforeEach(() => {
  syncMock.mockReset();
  syncMock.mockResolvedValue({
    ok: true,
    data: {
      inserted: 1,
      updated: 0,
      marked_disconnected: 0,
      unmapped_skipped: 0,
      cross_tenant_blocked: 0,
    },
    timestamp: new Date().toISOString(),
  });

  supabaseFromMock.mockReset();
  // Default: the connection-lookup chain returns the pending_identity row.
  supabaseFromMock.mockImplementation((table: string) => {
    if (table === "social_connections") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              gte: () => ({
                order: () => ({
                  limit: async () => ({
                    data: [{ id: CONNECTION_ID }],
                    error: null,
                  }),
                }),
              }),
            }),
            gte: () => ({
              not: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

function urlWith(params: Record<string, string>): string {
  const url = new URL("http://localhost/api/platform/social/connections/callback");
  url.searchParams.set("company_id", COMPANY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

describe("R-CALLBACK-POPUP-PICKER: in-popup channel picker redirect", () => {
  it("popup + linkedin-callback + sync-inserted → 302 to /connect/pick-channel", async () => {
    const res = await GET(
      new Request(urlWith({ popup: "1", "linkedin-callback": "true" })) as never,
    );
    expect(res.status).toBe(307);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/connect/pick-channel");
    expect(loc).toContain(`connection_id=${CONNECTION_ID}`);
  });

  it("popup + facebook-callback + sync-inserted → 302 to /connect/pick-channel", async () => {
    const res = await GET(
      new Request(urlWith({ popup: "1", "facebook-callback": "true" })) as never,
    );
    expect(res.status).toBe(307);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/connect/pick-channel");
    expect(loc).toContain(`connection_id=${CONNECTION_ID}`);
  });

  it("non-popup mode for needs_channel keeps non-popup redirect to /company/social/connections", async () => {
    const res = await GET(
      new Request(urlWith({ "linkedin-callback": "true" })) as never,
    );
    expect(res.status).toBe(307);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/company/social/connections");
    expect(loc).toContain("connect=needs_channel");
    expect(loc).toContain(`connection_id=${CONNECTION_ID}`);
  });

  it("popup + twitter-callback (non-channel-selection platform) → postMessage close, NOT picker redirect", async () => {
    // TWITTER is healthy on insert (no channel selection needed). The
    // callback should return the postMessage HTML, not redirect to the
    // picker page.
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "social_connections") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  order: () => ({
                    // No pending_identity row for TWITTER.
                    limit: async () => ({ data: [], error: null }),
                  }),
                }),
              }),
              gte: () => ({
                not: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    const res = await GET(
      new Request(urlWith({ popup: "1", "twitter-callback": "true" })) as never,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("postMessage");
    expect(html).toContain("window.close");
  });

  it("popup + sync inserted=0 → postMessage close (no picker redirect)", async () => {
    syncMock.mockResolvedValueOnce({
      ok: true,
      data: {
        inserted: 0,
        updated: 0,
        marked_disconnected: 0,
        unmapped_skipped: 0,
        cross_tenant_blocked: 0,
      },
      timestamp: new Date().toISOString(),
    });
    const res = await GET(
      new Request(urlWith({ popup: "1", "linkedin-callback": "true" })) as never,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("popup + sync error → postMessage close, NOT picker redirect", async () => {
    syncMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "bs down" },
      timestamp: new Date().toISOString(),
    });
    const res = await GET(
      new Request(urlWith({ popup: "1", "linkedin-callback": "true" })) as never,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("sync-failed");
  });
});
