import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION — bundle.social new-format callback params (?success= / ?error=)
//
// bundle.social deployed a new OAuth callback format on 2026-05-18:
//   OLD: ?<platform>-callback=true|error  /  ?<platform>-<error-suffix>
//   NEW: ?success=<code>                  /  ?error=<code>
//
// Where <code> is the same string that was previously the param NAME.
// Both formats must continue to work (backward compat + new format).
//
// Documented success codes (all platforms):
//   linkedin-callback, facebook-callback, instagram-callback,
//   instagram-direct-callback, twitter-callback, youtube-callback,
//   google-business-callback, tiktok-callback, pinterest-callback,
//   threads-callback, reddit-callback, bluesky-callback,
//   mastodon-callback, discord-callback, slack-callback
//
// Documented error codes:
//   <platform>-callback         (generic auth fail)
//   <platform>-not-enough-channels / permissions / pages / accounts /
//     servers / workspaces
//   instagram-not-professional-account  (new in 2026-05-18 deploy)
//   google-business-callback    (note: hyphenated, not underscore)
//
// Unknown codes:
//   Neither success nor error param matches a known code →
//   connect=error&reason=unknown-callback-code + platform_events row.
// ---------------------------------------------------------------------------

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: async () => ({
    kind: "allow" as const,
    userId: "user-test",
    supabase: {} as never,
  }),
}));

const syncMock = vi.fn();
vi.mock("@/lib/platform/social/connections", () => ({
  syncBundlesocialConnections: (...args: unknown[]) => syncMock(...args),
}));

vi.mock("@/lib/platform/social/analytics-ingest", () => ({
  enqueuePostHistoryImport: vi.fn(),
}));

const platformEventInsertMock = vi.fn();
const supabaseFromMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => supabaseFromMock(table),
  }),
}));

import { GET } from "@/app/api/platform/social/connections/callback/route";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const CONNECTION_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

function urlWith(params: Record<string, string>): string {
  const url = new URL(
    "http://localhost/api/platform/social/connections/callback",
  );
  url.searchParams.set("company_id", COMPANY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

type RedirectOut = { connect: string | null; reason: string | null; location: string };

async function redirect(params: Record<string, string>): Promise<RedirectOut> {
  const res = await GET(new Request(urlWith(params)) as never);
  const location = res.headers.get("location") ?? "";
  const loc = new URL(location, "http://localhost");
  return {
    connect: loc.searchParams.get("connect"),
    reason:  loc.searchParams.get("reason"),
    location,
  };
}

async function popupHtml(params: Record<string, string>): Promise<string> {
  const res = await GET(
    new Request(urlWith({ ...params, popup: "1" })) as never,
  );
  return res.text();
}

function makeNoopSync() {
  syncMock.mockResolvedValue({
    ok: true,
    data: { inserted: 0, updated: 0, marked_disconnected: 0, unmapped_skipped: 0, cross_tenant_blocked: 0 },
    timestamp: new Date().toISOString(),
  });
}

function makeInsertedSync() {
  syncMock.mockResolvedValue({
    ok: true,
    data: { inserted: 1, updated: 0, marked_disconnected: 0, unmapped_skipped: 0, cross_tenant_blocked: 0 },
    timestamp: new Date().toISOString(),
  });
}

beforeEach(() => {
  syncMock.mockReset();
  makeNoopSync();

  platformEventInsertMock.mockReset();
  platformEventInsertMock.mockResolvedValue({ error: null });

  supabaseFromMock.mockReset();
  supabaseFromMock.mockImplementation((table: string) => {
    if (table === "social_connections") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              gte: () => ({
                order: () => ({
                  limit: async () => ({ data: [{ id: CONNECTION_ID }], error: null }),
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
    if (table === "platform_events") {
      return { insert: platformEventInsertMock };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// Suite 1 — NEW FORMAT ?success=<code>
// ===========================================================================

describe("R-CALLBACK-NEW: ?success=<code> success params", () => {
  const successCases: Array<[string, string]> = [
    ["linkedin-callback",         "linkedin"],
    ["facebook-callback",         "facebook"],
    ["instagram-callback",        "instagram"],
    ["instagram-direct-callback", "instagram"],
    ["twitter-callback",          "twitter"],
    ["youtube-callback",          "youtube"],
    ["google-business-callback",  "google_business"],
    ["tiktok-callback",           "tiktok"],
    ["pinterest-callback",        "pinterest"],
    ["threads-callback",          "threads"],
    ["reddit-callback",           "reddit"],
    ["bluesky-callback",          "bluesky"],
    ["mastodon-callback",         "mastodon"],
    ["discord-callback",          "discord"],
    ["slack-callback",            "slack"],
  ];

  for (const [code, _platform] of successCases) {
    it(`?success=${code} → runs sync (success path, no error redirect)`, async () => {
      makeNoopSync();
      const out = await redirect({ success: code });
      // Success path: connect=noop (no new row, but no error either).
      expect(out.connect).not.toBe("error");
      // Sync must have been called.
      expect(syncMock).toHaveBeenCalledTimes(1);
    });
  }

  it("?success=linkedin-callback + sync inserted → connect=success (non-channel-selection check)", async () => {
    makeInsertedSync();
    // Twitter is not a channel-selection platform — inserted=1 → success (not needs_channel).
    // Use twitter-callback to test the plain success path.
    const out = await redirect({ success: "twitter-callback" });
    expect(out.connect).toBe("success");
  });

  it("?success=linkedin-callback + sync inserted=1 → needs_channel (channel-selection platform)", async () => {
    makeInsertedSync();
    const out = await redirect({ success: "linkedin-callback" });
    // LinkedIn is a channel-selection platform → connect=needs_channel when inserted=1.
    expect(out.connect).toBe("needs_channel");
  });

  it("?success=google-business-callback + sync inserted=1 → needs_channel", async () => {
    makeInsertedSync();
    const out = await redirect({ success: "google-business-callback" });
    expect(out.connect).toBe("needs_channel");
  });
});

// ===========================================================================
// Suite 2 — NEW FORMAT ?error=<code>
// ===========================================================================

describe("R-CALLBACK-NEW: ?error=<code> error params", () => {
  const errorCases: Array<[string, string]> = [
    // Generic auth fail via ?error=<platform>-callback
    ["linkedin-callback",                    "auth-failed"],
    ["facebook-callback",                    "auth-failed"],
    ["twitter-callback",                     "auth-failed"],
    ["google-business-callback",             "auth-failed"],
    ["instagram-direct-callback",            "auth-failed"],
    // Specific error suffixes
    ["linkedin-not-enough-channels",         "not-enough-channels"],
    ["linkedin-not-enough-permissions",      "not-enough-permissions"],
    ["facebook-not-enough-pages",            "not-enough-pages"],
    ["instagram-not-enough-accounts",        "not-enough-accounts"],
    ["discord-not-enough-servers",           "not-enough-servers"],
    ["slack-not-enough-workspaces",          "not-enough-workspaces"],
    ["youtube-not-enough-channels",          "not-enough-channels"],
    // New error code from 2026-05-18 bundle.social deploy
    ["instagram-not-professional-account",   "not-professional-account"],
  ];

  for (const [code, reason] of errorCases) {
    it(`?error=${code} → connect=error&reason=${reason}`, async () => {
      const out = await redirect({ error: code });
      expect(out.connect).toBe("error");
      expect(out.reason).toBe(reason);
      // Sync must NOT have been called — OAuth never completed.
      expect(syncMock).not.toHaveBeenCalled();
    });
  }

  it("?error=<platform>-callback in popup mode → postMessage HTML with connect=error", async () => {
    const html = await popupHtml({ error: "linkedin-callback" });
    expect(html).toContain('"connect":"error"');
    expect(html).toContain("window.close");
    // Reason in the postMessage payload.
    expect(html).toContain("auth-failed");
  });

  it("?error=instagram-not-professional-account in popup → postMessage HTML with reason", async () => {
    const html = await popupHtml({ error: "instagram-not-professional-account" });
    expect(html).toContain('"connect":"error"');
    expect(html).toContain("not-professional-account");
  });
});

// ===========================================================================
// Suite 3 — Unknown codes
// ===========================================================================

describe("R-CALLBACK-NEW: unknown codes → error + platform_events log", () => {
  it("?success=unknown-xyz → connect=error, reason=unknown-callback-code", async () => {
    const out = await redirect({ success: "unknown-xyz" });
    expect(out.connect).toBe("error");
    expect(out.reason).toBe("unknown-callback-code");
    // Sync must NOT run — we don't know what happened.
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("?error=unknown-xyz → connect=error, reason=unknown-callback-code", async () => {
    const out = await redirect({ error: "unknown-xyz" });
    expect(out.connect).toBe("error");
    expect(out.reason).toBe("unknown-callback-code");
  });

  it("unknown code logs to platform_events as unknown_oauth_callback", async () => {
    await redirect({ success: "unknown-xyz" });
    expect(platformEventInsertMock).toHaveBeenCalledTimes(1);
    const [insertedRow] = platformEventInsertMock.mock.calls[0] as [Record<string, unknown>];
    expect(insertedRow.event_type).toBe("unknown_oauth_callback");
    expect((insertedRow.payload as Record<string, unknown>).code).toBe("unknown-xyz");
  });

  it("?success=unknown in popup mode → postMessage HTML with reason=unknown-callback-code", async () => {
    const html = await popupHtml({ success: "unknown-xyz" });
    expect(html).toContain('"connect":"error"');
    expect(html).toContain("unknown-callback-code");
  });
});

// ===========================================================================
// Suite 4 — OLD FORMAT still works (backward compat)
// ===========================================================================

describe("R-CALLBACK-NEW: old format still recognised after 2026-05-18 deploy", () => {
  it("?linkedin-callback=true → success path (old format)", async () => {
    makeNoopSync();
    const out = await redirect({ "linkedin-callback": "true" });
    expect(out.connect).not.toBe("error");
    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it("?linkedin-callback=error → connect=error&reason=auth-failed (old format)", async () => {
    const out = await redirect({ "linkedin-callback": "error" });
    expect(out.connect).toBe("error");
    expect(out.reason).toBe("auth-failed");
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("?linkedin-not-enough-channels → reason=not-enough-channels (old format)", async () => {
    const out = await redirect({ "linkedin-not-enough-channels": "true" });
    expect(out.connect).toBe("error");
    expect(out.reason).toBe("not-enough-channels");
  });

  it("?not-enough-permissions (legacy generic, no platform prefix) still maps", async () => {
    const out = await redirect({ "not-enough-permissions": "true" });
    expect(out.connect).toBe("error");
    expect(out.reason).toBe("not-enough-permissions");
  });

  it("?user-cancelled (legacy generic) still maps", async () => {
    const out = await redirect({ "user-cancelled": "true" });
    expect(out.connect).toBe("error");
    expect(out.reason).toBe("user-cancelled");
  });
});

// ===========================================================================
// Suite 5 — ?success= takes precedence; sync still runs for noop detection
// ===========================================================================

describe("R-CALLBACK-NEW: ?success= noop / already-connected detection", () => {
  it("?success=linkedin-callback + sync.updated=1 → noop with attempted_platform=linkedin", async () => {
    (syncMock as unknown as MockInstance).mockResolvedValueOnce({
      ok: true,
      data: { inserted: 0, updated: 1, marked_disconnected: 0, unmapped_skipped: 0, cross_tenant_blocked: 0 },
      timestamp: new Date().toISOString(),
    });
    const out = await redirect({ success: "linkedin-callback" });
    expect(out.connect).toBe("noop");
    const loc = new URL(out.location, "http://localhost");
    expect(loc.searchParams.get("attempted_platform")).toBe("linkedin");
  });

  it("?success=twitter-callback + sync.inserted=1 → connect=success", async () => {
    makeInsertedSync();
    const out = await redirect({ success: "twitter-callback" });
    expect(out.connect).toBe("success");
  });
});
