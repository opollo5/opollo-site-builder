import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// M15-7 Phase 3b — integration tests for app/api/tools/search_images/route.ts
//
// Pins the current "session-optional, rate-limited" behaviour.  Per M15-4
// finding #3 the route currently has no admin gate — when that ships these
// tests will need to update (intentional drift signal).
//
// External dependencies mocked: executeSearchImages, getCurrentUser,
// checkRateLimit.  No Supabase / Anthropic / WP at runtime.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before vi.mock calls.
// ---------------------------------------------------------------------------

const mockExecuteSearchImages = vi.hoisted(() => vi.fn());
const mockGetCurrentUser = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/search-images", () => ({
  executeSearchImages: mockExecuteSearchImages,
}));

vi.mock("@/lib/auth", () => ({
  createRouteAuthClient: () => ({}),
  getCurrentUser: mockGetCurrentUser,
}));

// Keep rateLimitExceeded from the actual module so the 429 envelope shape
// is real; only checkRateLimit is mocked.
vi.mock("@/lib/rate-limit", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/rate-limit")>(
      "@/lib/rate-limit",
    );
  return { ...actual, checkRateLimit: mockCheckRateLimit };
});

vi.mock("next/headers", () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
  headers: () => new Headers(),
}));

// ---------------------------------------------------------------------------
// Import route AFTER all vi.mock declarations.
// ---------------------------------------------------------------------------
import { POST } from "@/app/api/tools/search_images/route";
import {
  makeJsonRequest,
  makeMalformedRequest,
  makeSuccessEnvelope,
  makeValidationErrorEnvelope,
  RATE_LIMIT_DENIED,
} from "./_tools-route-helpers";

beforeEach(() => {
  mockExecuteSearchImages.mockReset();
  mockGetCurrentUser.mockReset().mockResolvedValue(null);
  mockCheckRateLimit.mockReset().mockResolvedValue({ ok: true, limit: 120, remaining: 119, reset: 0 });
});

describe("POST /api/tools/search_images", () => {
  it("200 — passes executor's success envelope through verbatim", async () => {
    const envelope = makeSuccessEnvelope({ images: [], total: 0 });
    mockExecuteSearchImages.mockResolvedValue(envelope);

    const req = makeJsonRequest({ query: "sunset" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(envelope);
    expect(mockExecuteSearchImages).toHaveBeenCalledOnce();
    expect(mockExecuteSearchImages).toHaveBeenCalledWith({ query: "sunset" });
  });

  it("400 — error envelope from executor, status from errorCodeToStatus", async () => {
    const envelope = makeValidationErrorEnvelope("missing query or tags");
    mockExecuteSearchImages.mockResolvedValue(envelope);

    const res = await POST(makeJsonRequest({ limit: 5 }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual(envelope);
  });

  it("malformed JSON body → executor receives {} fallback", async () => {
    const envelope = makeSuccessEnvelope({ images: [] });
    mockExecuteSearchImages.mockResolvedValue(envelope);

    const res = await POST(makeMalformedRequest());

    expect(mockExecuteSearchImages).toHaveBeenCalledWith({});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(envelope);
  });

  it("429 — rate-limit denial short-circuits; executor is never called", async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED);

    const res = await POST(makeJsonRequest({ query: "beach" }));

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(mockExecuteSearchImages).not.toHaveBeenCalled();
  });
});
