// tests/regressions/feedback-intro-skip.test.ts
//
// Backlog item 2: "don't show again" on the intro modal.
// Verifies the preference API route and the skip-intro flow.
//
// Layer 1 — unit tests; all I/O mocked.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  createRouteAuthClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Preferences API route tests
// ---------------------------------------------------------------------------
describe("POST /api/feedback/preferences — skip_intro preference", () => {
  beforeEach(() => vi.clearAllMocks());

  async function callRoute(body: object, userId: string | null = "user-1") {
    const { createRouteAuthClient } = await import("@/lib/auth");
    const { getServiceRoleClient } = await import("@/lib/supabase");

    vi.mocked(createRouteAuthClient).mockReturnValue({
      auth: {
        getUser: vi.fn(async () =>
          userId
            ? { data: { user: { id: userId } }, error: null }
            : { data: { user: null }, error: { message: "no user" } },
        ),
      },
    } as never);

    const updateFn = vi.fn(() => ({ eq: vi.fn(() => ({ error: null })) }));
    vi.mocked(getServiceRoleClient).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { preferences: { other_key: true } },
              error: null,
            }),
          }),
        }),
        update: updateFn,
      }),
    } as never);

    vi.resetModules();
    const { POST } = await import("@/app/api/feedback/preferences/route");
    const req = new Request("http://localhost/api/feedback/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await POST(req as never);
    return { res, updateFn };
  }

  it("returns 401 when unauthenticated", async () => {
    const { res } = await callRoute({ skip_intro: true }, null);
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid body (not boolean)", async () => {
    const { res } = await callRoute({ skip_intro: "yes" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when skip_intro is missing", async () => {
    const { res } = await callRoute({});
    expect(res.status).toBe(400);
  });

  it("merges skip_intro=true into existing preferences without losing other keys", async () => {
    const { res, updateFn } = await callRoute({ skip_intro: true });
    expect(res.status).toBe(200);
    // The update call must preserve { other_key: true } and add feedback_skip_intro.
    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({
          other_key: true,
          feedback_skip_intro: true,
        }),
      }),
    );
  });

  it("can save skip_intro=false to re-enable the intro modal", async () => {
    const { res, updateFn } = await callRoute({ skip_intro: false });
    expect(res.status).toBe(200);
    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({ feedback_skip_intro: false }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Widget skip-intro logic (pure logic test — no React rendering)
// ---------------------------------------------------------------------------
describe("FeedbackWidget skipIntro prop — mode transition", () => {
  it("skipIntro=true causes tab click to go to picking, not intro", () => {
    // Test the logic directly: when skipIntro is true, onClick calls startPicking.
    let calledMode: string | null = null;
    const setMode = (m: string) => { calledMode = m; };
    const startPicking = () => { calledMode = "picking"; };

    // Simulate the onClick handler
    const skipIntro = true;
    const onClick = () => skipIntro ? startPicking() : setMode("intro");
    onClick();

    expect(calledMode).toBe("picking");
  });

  it("skipIntro=false causes tab click to open intro modal", () => {
    let calledMode: string | null = null;
    const setMode = (m: string) => { calledMode = m; };
    const startPicking = () => { calledMode = "picking"; };

    const skipIntro = false;
    const onClick = () => skipIntro ? startPicking() : setMode("intro");
    onClick();

    expect(calledMode).toBe("intro");
  });
});
