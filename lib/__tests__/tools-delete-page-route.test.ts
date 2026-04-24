import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// M15-7 Phase 3b — integration tests for app/api/tools/delete_page/route.ts
//
// delete_page is a destructive write route that currently has no admin gate
// (M15-4 finding #3).  These tests pin that behaviour as an intentional
// drift signal for a future auth-tightening fix slice.
// ---------------------------------------------------------------------------

const mockExecuteDeletePage = vi.hoisted(() => vi.fn());
const mockGetCurrentUser = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/delete-page", () => ({
  executeDeletePage: mockExecuteDeletePage,
}));

vi.mock("@/lib/auth", () => ({
  createRouteAuthClient: () => ({}),
  getCurrentUser: mockGetCurrentUser,
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

beforeEach(() => {
  mockExecuteDeletePage.mockReset();
  mockGetCurrentUser.mockReset().mockResolvedValue(null);
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

  it("malformed JSON body → executor receives {} fallback", async () => {
    const envelope = makeSuccessEnvelope({ page_id: 0, status: "trash" as const });
    mockExecuteDeletePage.mockResolvedValue(envelope);

    const res = await POST(makeMalformedRequest());

    expect(mockExecuteDeletePage).toHaveBeenCalledWith({});
    expect(res.status).toBe(200);
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
