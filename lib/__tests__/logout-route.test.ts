import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// M2c-2 — /logout.
//
// Pins the behaviour matrix of the logout route handler:
//   - POST and GET both redirect to /login with 303 See Other.
//   - signOut is called on the SSR client so auth cookies clear.
//   - If signOut throws (Supabase down), the route still redirects —
//     users must never land on a bare /logout with no navigation path
//     back to /login.
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  signOut: vi.fn().mockResolvedValue({ error: null }),
  failConstruction: false,
}));

vi.mock("@/lib/auth", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    createRouteAuthClient: () => {
      if (mockState.failConstruction) {
        throw new Error("simulated SSR client construction failure");
      }
      return {
        auth: {
          signOut: mockState.signOut,
        },
      };
    },
  };
});

const logoutRoute = await import("@/app/logout/route");

function makeRequest(method: "GET" | "POST"): NextRequest {
  return new NextRequest("http://localhost:3000/logout", { method });
}

beforeEach(() => {
  mockState.signOut = vi.fn().mockResolvedValue({ error: null });
  mockState.failConstruction = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/logout", () => {
  it("POST redirects to /login with 303 and calls signOut", async () => {
    const res = await logoutRoute.POST(makeRequest("POST"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/login");
    expect(mockState.signOut).toHaveBeenCalledTimes(1);
  });

  it("GET redirects to /login with 303 and calls signOut", async () => {
    const res = await logoutRoute.GET(makeRequest("GET"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/login");
    expect(mockState.signOut).toHaveBeenCalledTimes(1);
  });

  it("still redirects to /login when SSR client construction throws", async () => {
    mockState.failConstruction = true;
    const res = await logoutRoute.POST(makeRequest("POST"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/login");
    expect(mockState.signOut).not.toHaveBeenCalled();
  });

  it("still redirects to /login when signOut itself rejects", async () => {
    mockState.signOut = vi.fn().mockRejectedValue(new Error("supabase down"));
    const res = await logoutRoute.POST(makeRequest("POST"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/login");
  });
});
