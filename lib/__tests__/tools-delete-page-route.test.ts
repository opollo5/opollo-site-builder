import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Integration tests for app/api/tools/delete_page/route.ts
//
// delete_page is a destructive write route gated by requireAdminForApi
// (M15-4 #3 fix). Tests verify auth gate, rate limit, JSON parse guard, and
// executor delegation.
// ---------------------------------------------------------------------------

const mockExecuteDeletePage = vi.hoisted(() => vi.fn());
const mockRequireAdminForApi = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/delete-page", () => ({
  executeDeletePage: mockExecuteDeletePage,
}));

vi.mock("@/lib/admin-api-gate", () => ({
  requireAdminForApi: mockRequireAdminForApi,
}));

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

import { POST } from "@/app/api/tools/delete_page/route";
import {
  makeJsonRequest,
  makeMalformedRequest,
  makeSuccessEnvelope,
  makeValidationErrorEnvelope,
  RATE_LIMIT_DENIED,
} from "./_tools-route-helpers";

const GATE_ALLOW = { kind: "allow" as const, user: { id: "user-1", email: "admin@test.com", role: "admin" as const } };

beforeEach(() => {
  mockExecuteDeletePage.mockReset();
  mockRequireAdminForApi.mockReset().mockResolvedValue(GATE_ALLOW);
  mockCheckRateLimit.mockReset().mockResolvedValue({ ok: true, limit: 120, remaining: 119, reset: 0 });
});

const VALID_BODY = { page_id: 99, user_confirmed: true };

describe("POST /api/tools/delete_page", () => {
  it("200 — passes executor's success envelope through verbatim", async () => {
    const envelope = makeSuccessEnvelope({ page_id: 99, status: "trash" as const });
    mockExecuteDeletePage.mockResolvedValue(envelope);

    const res = await POST(makeJsonRequest(VALID_BODY));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(envelope);
    expect(mockExecuteDeletePage).toHaveBeenCalledOnce();
    expect(mockExecuteDeletePage).toHaveBeenCalledWith(VALID_BODY);
  });

  it("400 — executor error envelope, status from errorCodeToStatus", async () => {
    const envelope = makeValidationErrorEnvelope("user_confirmed must be true");
    mockExecuteDeletePage.mockResolvedValue(envelope);

    const res = await POST(makeJsonRequest({ page_id: 1 }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual(envelope);
  });

  it("400 — malformed JSON body returns VALIDATION_FAILED; executor not called", async () => {
    const res = await POST(makeMalformedRequest());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(mockExecuteDeletePage).not.toHaveBeenCalled();
  });

  it("401 — auth gate denial; executor is never called", async () => {
    mockRequireAdminForApi.mockResolvedValue({
      kind: "deny" as const,
      response: new Response(JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED" } }), { status: 401 }),
    });

    const res = await POST(makeJsonRequest(VALID_BODY));

    expect(res.status).toBe(401);
    expect(mockExecuteDeletePage).not.toHaveBeenCalled();
  });

  it("429 — rate-limit denial; executor is never called", async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED);

    const res = await POST(makeJsonRequest(VALID_BODY));

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(mockExecuteDeletePage).not.toHaveBeenCalled();
  });
});
