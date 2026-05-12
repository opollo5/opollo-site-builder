import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION — callback platform-prefixed param recognition.
//
// Bug from docs/incidents/2026-05-12-linkedin-connect-flow-broken.md:
// the callback used to find() against only four generic strings
// (not-enough-permissions, not-enough-pages, auth-failed, user-cancelled).
// bundle.social actually sends platform-prefixed params:
//   <platform>-callback={true|error}
//   <platform>-not-enough-channels|permissions|pages|accounts|servers|workspaces
// All platform-prefixed params dropped through to the noop branch.
//
// This test pins: every platform-prefixed error param now maps to a
// matching ?reason= redirect. New platforms only need adding to the
// PLATFORM_KEYS list — error handling stays generic.
// ---------------------------------------------------------------------------

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: async () => ({
    kind: "allow" as const,
    userId: "user-test",
    supabase: {} as never,
  }),
}));

vi.mock("@/lib/platform/social/connections", () => ({
  syncBundlesocialConnections: vi.fn().mockResolvedValue({
    ok: true,
    data: {
      inserted: 0,
      updated: 0,
      marked_disconnected: 0,
      unmapped_skipped: 0,
      cross_tenant_blocked: 0,
    },
    timestamp: new Date().toISOString(),
  }),
}));

import { syncBundlesocialConnections } from "@/lib/platform/social/connections";

vi.mock("@/lib/platform/social/analytics-ingest", () => ({
  enqueuePostHistoryImport: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => ({
            order: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

import { GET } from "@/app/api/platform/social/connections/callback/route";

const COMPANY = "11111111-1111-1111-1111-111111111111";

function urlWith(params: Record<string, string>): string {
  const url = new URL("http://localhost/api/platform/social/connections/callback");
  url.searchParams.set("company_id", COMPANY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

async function reasonFor(params: Record<string, string>): Promise<{
  connect: string | null;
  reason: string | null;
  location: string;
}> {
  const res = await GET(new Request(urlWith(params)) as never);
  const location = res.headers.get("location") ?? "";
  const loc = new URL(location, "http://localhost");
  return {
    connect: loc.searchParams.get("connect"),
    reason: loc.searchParams.get("reason"),
    location,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("R-CALLBACK: platform-prefixed callback=error params surface as error", () => {
  for (const platform of [
    "linkedin",
    "facebook",
    "instagram",
    "twitter",
    "youtube",
    "google_business",
    "tiktok",
    "pinterest",
    "threads",
    "reddit",
    "bluesky",
    "mastodon",
    "discord",
    "slack",
  ]) {
    it(`${platform}-callback=error → connect=error&reason=auth-failed`, async () => {
      const out = await reasonFor({ [`${platform}-callback`]: "error" });
      expect(out.connect).toBe("error");
      expect(out.reason).toBe("auth-failed");
    });
  }
});

describe("R-CALLBACK: platform-prefixed error-suffix params surface their reason", () => {
  it("linkedin-not-enough-channels → reason=not-enough-channels", async () => {
    const out = await reasonFor({ "linkedin-not-enough-channels": "true" });
    expect(out.connect).toBe("error");
    expect(out.reason).toBe("not-enough-channels");
  });

  it("linkedin-not-enough-permissions → reason=not-enough-permissions", async () => {
    const out = await reasonFor({ "linkedin-not-enough-permissions": "true" });
    expect(out.connect).toBe("error");
    expect(out.reason).toBe("not-enough-permissions");
  });

  it("facebook-not-enough-pages → reason=not-enough-pages", async () => {
    const out = await reasonFor({ "facebook-not-enough-pages": "true" });
    expect(out.connect).toBe("error");
    expect(out.reason).toBe("not-enough-pages");
  });

  it("instagram-not-enough-accounts → reason=not-enough-accounts", async () => {
    const out = await reasonFor({ "instagram-not-enough-accounts": "true" });
    expect(out.connect).toBe("error");
    expect(out.reason).toBe("not-enough-accounts");
  });

  it("discord-not-enough-servers → reason=not-enough-servers", async () => {
    const out = await reasonFor({ "discord-not-enough-servers": "true" });
    expect(out.connect).toBe("error");
    expect(out.reason).toBe("not-enough-servers");
  });

  it("slack-not-enough-workspaces → reason=not-enough-workspaces", async () => {
    const out = await reasonFor({ "slack-not-enough-workspaces": "true" });
    expect(out.connect).toBe("error");
    expect(out.reason).toBe("not-enough-workspaces");
  });

  it("youtube-not-enough-channels → reason=not-enough-channels", async () => {
    const out = await reasonFor({ "youtube-not-enough-channels": "true" });
    expect(out.connect).toBe("error");
    expect(out.reason).toBe("not-enough-channels");
  });
});

describe("R-CALLBACK: legacy generic keys still recognised", () => {
  it("not-enough-permissions (no platform prefix) still maps", async () => {
    const out = await reasonFor({ "not-enough-permissions": "true" });
    expect(out.connect).toBe("error");
    expect(out.reason).toBe("not-enough-permissions");
  });

  it("auth-failed (no platform prefix) still maps", async () => {
    const out = await reasonFor({ "auth-failed": "true" });
    expect(out.connect).toBe("error");
    expect(out.reason).toBe("auth-failed");
  });

  it("user-cancelled (no platform prefix) still maps", async () => {
    const out = await reasonFor({ "user-cancelled": "true" });
    expect(out.connect).toBe("error");
    expect(out.reason).toBe("user-cancelled");
  });
});

describe("R-CALLBACK: success path is unaffected by absent error params", () => {
  it("no platform params + sync.inserted=0 → connect=noop", async () => {
    const out = await reasonFor({});
    expect(out.connect).toBe("noop");
  });
});

describe("R-CALLBACK: noop+already-connected surfaces attempted_platform", () => {
  it("linkedin-callback=true + sync.updated=1 → noop with attempted_platform=linkedin", async () => {
    // Bug-fix 2026-05-12: when the user re-connects a platform they already
    // have, the callback surfaces the platform so the UI can show an
    // actionable "already connected" banner and highlight the blocking row.
    vi.mocked(syncBundlesocialConnections as unknown as MockInstance).mockResolvedValueOnce({
      ok: true,
      data: {
        inserted: 0,
        updated: 1,
        marked_disconnected: 0,
        unmapped_skipped: 0,
        cross_tenant_blocked: 0,
      },
      timestamp: new Date().toISOString(),
    });
    const out = await reasonFor({ "linkedin-callback": "true" });
    expect(out.connect).toBe("noop");
    const loc = new URL(out.location, "http://localhost");
    expect(loc.searchParams.get("attempted_platform")).toBe("linkedin");
  });

  it("linkedin-callback=true + sync.updated=0 → plain noop (no attempted_platform)", async () => {
    // When there was no update either, don't add the platform hint — the
    // user may just have a delay on the bundle.social side.
    const out = await reasonFor({ "linkedin-callback": "true" });
    expect(out.connect).toBe("noop");
    const loc = new URL(out.location, "http://localhost");
    expect(loc.searchParams.get("attempted_platform")).toBeNull();
  });
});
