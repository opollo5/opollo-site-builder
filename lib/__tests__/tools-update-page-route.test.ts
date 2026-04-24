import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// M15-7 Phase 3b — integration tests for app/api/tools/update_page/route.ts
//
// update_page is a write route that currently has no admin gate (M15-4
// finding #3).  Tests pin current session-optional behaviour as an
// intentional drift signal for a future auth-tightening fix slice.
// ---------------------------------------------------------------------------

const mockExecuteUpdatePage = vi.hoisted(() => vi.fn());
const mockGetCurrentUser = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/update-page", () => ({
  executeUpdatePage: mockExecuteUpdatePage,
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

import { POST } from "@/app/api/tools/update_page/route";
import {
  makeJsonRequest,
  makeMalformedRequest,
  makeSuccessEnvelope,
  makeValidationErrorEnvelope,
  RATE_LIMIT_DENIED,
} from "./_tools-route-helpers";

beforeEach(() => {
  mockExecuteUpdatePage.mockReset();
  mockGetCurrentUser.mockReset().mockResolvedValue(null);
  mockCheckRateLimit.mockReset().mockResolvedValue({ ok: true, limit: 120, remaining: 119, reset: 0 });
});

const VALID_BODY = {
  page_id: 11,
  title: "Updated Title Here",
  change_scope: "minor_edit",
};

describe("POST /api/tools/update_page", () => {
  it("200 — passes executor's success envelope through verbatim", async () => {
    const envelope = makeSuccessEnvelope({
      page_id: 11,
      status: "draft",
      modified_date: "2026-04-24T00:00:00Z",
    });
    mockExecuteUpdatePage.mockResolvedValue(envelope);

    const res = await POST(makeJsonRequest(VALID_BODY));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(envelope);
    expect(mockExecuteUpdatePage).toHaveBeenCalledOnce();
    expect(mockExecuteUpdatePage).toHaveBeenCalledWith(VALID_BODY);
  });

  it("400 — executor error envelope, status from errorCodeToStatus", async () => {
    const envelope = makeValidationErrorEnvelope("change_scope is required");
    mockExecuteUpdatePage.mockResolvedValue(envelope);

    const res = await POST(makeJsonRequest({ page_id: 11, title: "x" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual(envelope);
  });

  it("malformed JSON body → executor receives {} fallback", async () => {
    const envelope = makeSuccessEnvelope({ page_id: 0, status: "draft", modified_date: "" });
    mockExecuteUpdatePage.mockResolvedValue(envelope);

    const res = await POST(makeMalformedRequest());

    expect(mockExecuteUpdatePage).toHaveBeenCalledWith({});
    expect(res.status).toBe(200);
  });

  it("429 — rate-limit denial; executor is never called", async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED);

    const res = await POST(makeJsonRequest(VALID_BODY));

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(mockExecuteUpdatePage).not.toHaveBeenCalled();
  });
});
