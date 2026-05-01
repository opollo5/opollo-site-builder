import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// AUTH-FOUNDATION P4 — POST /api/auth/complete-login route.
//
// The fix this file pins: the `consumed` branch must return 200 and
// clear the local opollo_2fa_pending cookie even though the challenge
// was already consumed by another tab/device. Before the fix, the
// loser of a CAS race got 409 ALREADY_CONSUMED; the polling shell
// rendered a static "continue to admin" link whose click was bounced
// by middleware (this browser still had the pending cookie set), and
// the user got stuck in a "page loads for 1 second then nothing" loop.
//
// Other paths exercised: no-session, validation, user-mismatch,
// expired (410, no cookie clear), happy-path consume + cookie clear.
// ---------------------------------------------------------------------------

interface ChallengeRow {
  id: string;
  user_id: string;
  device_id: string;
  status: "pending" | "approved" | "expired" | "consumed";
  ua_string: string | null;
  ip_hash: string | null;
  created_at: string;
  expires_at: string;
  approved_at: string | null;
}

const mockState = vi.hoisted(() => ({
  sessionUserId: null as string | null,
  challenge: null as ChallengeRow | null,
  consumeOutcome: null as
    | { ok: true }
    | { ok: false; reason: "not_found" | "expired" | "not_approved" | "already_consumed" }
    | null,
  registerTrustedCalls: 0,
  cookieStore: new Map<string, string>(),
  cookieSets: [] as Array<{ name: string; value: string; maxAge?: number }>,
}));

vi.mock("@/lib/auth", () => ({
  createRouteAuthClient: () => ({
    auth: {
      getUser: async () => {
        if (mockState.sessionUserId) {
          return { data: { user: { id: mockState.sessionUserId } }, error: null };
        }
        return { data: { user: null }, error: { message: "no session" } };
      },
    },
  }),
}));

vi.mock("@/lib/2fa/challenges", () => ({
  lookupChallengeById: async (_id: string) => mockState.challenge,
  consumeChallenge: async (_id: string) => mockState.consumeOutcome,
}));

vi.mock("@/lib/2fa/devices", () => ({
  registerTrustedDevice: async () => {
    mockState.registerTrustedCalls += 1;
  },
}));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => {
      const value = mockState.cookieStore.get(name);
      return value === undefined ? undefined : { value };
    },
    set: (...args: unknown[]) => {
      if (typeof args[0] === "string") {
        const [name, value, options] = args as [string, string, { maxAge?: number } | undefined];
        mockState.cookieSets.push({ name, value, maxAge: options?.maxAge });
      } else {
        const opts = args[0] as { name: string; value: string; maxAge?: number };
        mockState.cookieSets.push({
          name: opts.name,
          value: opts.value,
          maxAge: opts.maxAge,
        });
      }
    },
  }),
  headers: () => new Headers(),
}));

vi.mock("@/lib/rate-limit", () => ({
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}));

const { POST } = await import("@/app/api/auth/complete-login/route");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const CHALLENGE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeChallenge(overrides: Partial<ChallengeRow> = {}): ChallengeRow {
  return {
    id: CHALLENGE_ID,
    user_id: USER_ID,
    device_id: DEVICE_ID,
    status: "approved",
    ua_string: null,
    ip_hash: null,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    approved_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth/complete-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockState.sessionUserId = USER_ID;
  mockState.challenge = makeChallenge();
  mockState.consumeOutcome = { ok: true };
  mockState.registerTrustedCalls = 0;
  mockState.cookieStore = new Map();
  mockState.cookieSets = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/complete-login — happy path", () => {
  it("consumes an approved challenge, clears pending cookies, returns 200", async () => {
    mockState.challenge = makeChallenge({ status: "approved" });
    mockState.consumeOutcome = { ok: true };

    const res = await POST(
      makeRequest({ challenge_id: CHALLENGE_ID, trust_device: false }) as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { redirect_to: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data.redirect_to).toBe("/admin/sites");

    // Both pending cookies cleared (maxAge=0).
    const cleared = mockState.cookieSets.filter((c) => c.maxAge === 0);
    const names = new Set(cleared.map((c) => c.name));
    expect(names.has("opollo_2fa_pending")).toBe(true);
    expect(names.has("opollo_pending_device_id")).toBe(true);
    expect(mockState.registerTrustedCalls).toBe(0);
  });
});

describe("POST /api/auth/complete-login — already-consumed idempotency", () => {
  it("clears pending cookies + returns 200 with already_consumed=true when challenge.status='consumed'", async () => {
    mockState.challenge = makeChallenge({ status: "consumed" });
    // consumeChallenge should NOT be called on the already-consumed path,
    // so leave consumeOutcome at its default (would fail the test if hit).

    const res = await POST(
      makeRequest({ challenge_id: CHALLENGE_ID, trust_device: false }) as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { redirect_to: string; already_consumed?: boolean };
    };
    expect(body.ok).toBe(true);
    expect(body.data.redirect_to).toBe("/admin/sites");
    expect(body.data.already_consumed).toBe(true);

    // The whole point of the fix: this browser's pending cookie must
    // be cleared so middleware stops bouncing /admin/sites navigation.
    const cleared = mockState.cookieSets.filter((c) => c.maxAge === 0);
    const names = new Set(cleared.map((c) => c.name));
    expect(names.has("opollo_2fa_pending")).toBe(true);
    expect(names.has("opollo_pending_device_id")).toBe(true);
    expect(mockState.registerTrustedCalls).toBe(0);
  });

  it("treats a CAS-race already_consumed result as success too", async () => {
    // Lookup sees status=approved, but by the time we run consumeChallenge
    // a second tab has flipped it to consumed.
    mockState.challenge = makeChallenge({ status: "approved" });
    mockState.consumeOutcome = { ok: false, reason: "already_consumed" };

    const res = await POST(
      makeRequest({ challenge_id: CHALLENGE_ID, trust_device: false }) as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { already_consumed?: boolean };
    };
    expect(body.ok).toBe(true);
    expect(body.data.already_consumed).toBe(true);

    const cleared = mockState.cookieSets.filter((c) => c.maxAge === 0);
    expect(cleared.some((c) => c.name === "opollo_2fa_pending")).toBe(true);
  });
});

describe("POST /api/auth/complete-login — error paths", () => {
  it("401 UNAUTHORIZED when no session", async () => {
    mockState.sessionUserId = null;
    const res = await POST(
      makeRequest({ challenge_id: CHALLENGE_ID, trust_device: false }) as never,
    );
    expect(res.status).toBe(401);
  });

  it("400 VALIDATION_FAILED on bad body", async () => {
    const res = await POST(
      makeRequest({ challenge_id: "not-a-uuid", trust_device: false }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("404 when the challenge row doesn't exist", async () => {
    mockState.challenge = null;
    const res = await POST(
      makeRequest({ challenge_id: CHALLENGE_ID, trust_device: false }) as never,
    );
    expect(res.status).toBe(404);
  });

  it("403 FORBIDDEN when challenge belongs to another user", async () => {
    mockState.challenge = makeChallenge({ user_id: OTHER_USER });
    const res = await POST(
      makeRequest({ challenge_id: CHALLENGE_ID, trust_device: false }) as never,
    );
    expect(res.status).toBe(403);
    // No cookies should be cleared on the forbidden path — this might
    // be a stale cookie from a prior account on a shared browser, but
    // we don't trust the request body to drive cookie state for a user
    // we haven't authenticated.
    expect(mockState.cookieSets.filter((c) => c.maxAge === 0)).toHaveLength(0);
  });

  it("410 GONE when challenge expired before consume", async () => {
    mockState.challenge = makeChallenge({ status: "approved" });
    mockState.consumeOutcome = { ok: false, reason: "expired" };
    const res = await POST(
      makeRequest({ challenge_id: CHALLENGE_ID, trust_device: false }) as never,
    );
    expect(res.status).toBe(410);
    // Expired path doesn't clear the pending cookie — the user needs
    // to start over via /login (which clears via the logout redirect).
    expect(mockState.cookieSets.filter((c) => c.maxAge === 0)).toHaveLength(0);
  });

  it("409 NOT_APPROVED when challenge is still pending", async () => {
    mockState.challenge = makeChallenge({ status: "pending" });
    mockState.consumeOutcome = { ok: false, reason: "not_approved" };
    const res = await POST(
      makeRequest({ challenge_id: CHALLENGE_ID, trust_device: false }) as never,
    );
    expect(res.status).toBe(409);
  });
});
