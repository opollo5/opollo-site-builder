import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Integration tests for app/api/tools/publish_page/route.ts
//
// publish_page is a write route (draft → publish) gated by requireAdminForApi
// (M15-4 #3 fix). Tests verify auth gate, rate limit, JSON parse guard, and
// executor delegation.
// ---------------------------------------------------------------------------

const mockExecutePublishPage = vi.hoisted(() => vi.fn());
const mockRequireAdminForApi = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/publish-page", () => ({
  executePublishPage: mockExecutePublishPage,
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

import { POST } from "@/app/api/tools/publish_page/route";
import {
  makeJsonRequest,
  makeMalformedRequest,
  makeSuccessEnvelope,
  makeValidationErrorEnvelope,
  RATE_LIMIT_DENIED,
} from "./_tools-route-helpers";

const GATE_ALLOW = { kind: "allow" as const, user: { id: "user-1", email: "admin@test.com", role: "admin" as const } };

beforeEach(() => {
  mockExecutePublishPage.mockReset();
  mockRequireAdminForApi.mockReset().mockResolvedValue(GATE_ALLOW);
  mockCheckRateLimit.mockReset().mockResolvedValue({ ok: true, limit: 120, remaining: 119, reset: 0 });
});

const VALID_BODY = { page_id: 55 };

describe("POST /api/tools/publish_page", () => {
  it("200 — passes executor's success envelope through verbatim", async () => {
    const envelope = makeSuccessEnvelope({
      page_id: 55,
      status: "publish",
      published_url: "https://wp.example.com/my-page/",
    });
    mockExecutePublishPage.mockResolvedValue(envelope);

    const res = await POST(makeJsonRequest(VALID_BODY));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(envelope);
    expect(mockExecutePublishPage).toHaveBeenCalledOnce();
    expect(mockExecutePublishPage).toHaveBeenCalledWith(VALID_BODY);
  });

  it("400 — executor error envelope, status from errorCodeToStatus", async () => {
    const envelope = makeValidationErrorEnvelope("page_id must be a positive integer");
    mockExecutePublishPage.mockResolvedValue(envelope);

    const res = await POST(makeJsonRequest({ page_id: 0 }));

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
    expect(mockExecutePublishPage).not.toHaveBeenCalled();
  });

  it("401 — auth gate denial; executor is never called", async () => {
    mockRequireAdminForApi.mockResolvedValue({
      kind: "deny" as const,
      response: new Response(JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED" } }), { status: 401 }),
    });

    const res = await POST(makeJsonRequest(VALID_BODY));

    expect(res.status).toBe(401);
    expect(mockExecutePublishPage).not.toHaveBeenCalled();
  });

  it("429 — rate-limit denial; executor is never called", async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED);

    const res = await POST(makeJsonRequest(VALID_BODY));

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(mockExecutePublishPage).not.toHaveBeenCalled();
  });
});
