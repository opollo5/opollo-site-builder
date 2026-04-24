import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// M15-7 Phase 3b — integration tests for app/api/tools/get_page/route.ts
// ---------------------------------------------------------------------------

const mockExecuteGetPage = vi.hoisted(() => vi.fn());
const mockGetCurrentUser = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/get-page", () => ({
  executeGetPage: mockExecuteGetPage,
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

import { POST } from "@/app/api/tools/get_page/route";
import {
  makeJsonRequest,
  makeMalformedRequest,
  makeSuccessEnvelope,
  makeValidationErrorEnvelope,
  RATE_LIMIT_DENIED,
} from "./_tools-route-helpers";

beforeEach(() => {
  mockExecuteGetPage.mockReset();
  mockGetCurrentUser.mockReset().mockResolvedValue(null);
  mockCheckRateLimit.mockReset().mockResolvedValue({ ok: true, limit: 120, remaining: 119, reset: 0 });
});

const VALID_BODY = { page_id: 7 };

describe("POST /api/tools/get_page", () => {
  it("200 — passes executor's success envelope through verbatim", async () => {
    const envelope = makeSuccessEnvelope({
      page_id: 7,
      title: "Sample Page",
      slug: "sample-page",
      content: "<p>Hello world</p>",
      meta_description: "A sample page for testing purposes here.",
      status: "draft",
      parent_id: null,
      modified_date: "2026-04-01T00:00:00Z",
    });
    mockExecuteGetPage.mockResolvedValue(envelope);

    const res = await POST(makeJsonRequest(VALID_BODY));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(envelope);
    expect(mockExecuteGetPage).toHaveBeenCalledOnce();
    expect(mockExecuteGetPage).toHaveBeenCalledWith(VALID_BODY);
  });

  it("400 — executor error envelope, status from errorCodeToStatus", async () => {
    const envelope = makeValidationErrorEnvelope("page_id must be a positive integer");
    mockExecuteGetPage.mockResolvedValue(envelope);

    const res = await POST(makeJsonRequest({ page_id: -1 }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual(envelope);
  });

  it("malformed JSON body → executor receives {} fallback", async () => {
    const envelope = makeSuccessEnvelope({ page_id: 0, title: "", slug: "", content: "", meta_description: "", status: "draft", parent_id: null, modified_date: "" });
    mockExecuteGetPage.mockResolvedValue(envelope);

    const res = await POST(makeMalformedRequest());

    expect(mockExecuteGetPage).toHaveBeenCalledWith({});
    expect(res.status).toBe(200);
  });

  it("429 — rate-limit denial; executor is never called", async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED);

    const res = await POST(makeJsonRequest(VALID_BODY));

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(mockExecuteGetPage).not.toHaveBeenCalled();
  });
});
