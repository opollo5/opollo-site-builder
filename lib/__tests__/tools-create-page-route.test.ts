import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// M15-7 Phase 3b — integration tests for app/api/tools/create_page/route.ts
//
// Pins current session-optional, rate-limited behaviour.  Per M15-4
// finding #3, create_page is a write route that currently lacks an admin
// gate — intentional drift signal for a future fix slice.
// ---------------------------------------------------------------------------

const mockExecuteCreatePage = vi.hoisted(() => vi.fn());
const mockGetCurrentUser = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/create-page", () => ({
  executeCreatePage: mockExecuteCreatePage,
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

import { POST } from "@/app/api/tools/create_page/route";
import {
  makeJsonRequest,
  makeMalformedRequest,
  makeSuccessEnvelope,
  makeValidationErrorEnvelope,
  RATE_LIMIT_DENIED,
} from "./_tools-route-helpers";

beforeEach(() => {
  mockExecuteCreatePage.mockReset();
  mockGetCurrentUser.mockReset().mockResolvedValue(null);
  mockCheckRateLimit.mockReset().mockResolvedValue({ ok: true, limit: 120, remaining: 119, reset: 0 });
});

const VALID_BODY = {
  title: "My Test Page",
  slug: "my-test-page",
  content: "x".repeat(200),
  meta_description: "y".repeat(50),
  template_type: "generic",
  ds_version: "1.0.0",
};

describe("POST /api/tools/create_page", () => {
  it("200 — passes executor's success envelope through verbatim", async () => {
    const envelope = makeSuccessEnvelope({
      page_id: 42,
      preview_url: "https://wp.example.com/?p=42",
      admin_url: "https://wp.example.com/wp-admin/post.php?post=42",
      slug: "my-test-page",
      status: "draft",
    });
    mockExecuteCreatePage.mockResolvedValue(envelope);

    const res = await POST(makeJsonRequest(VALID_BODY));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(envelope);
    expect(mockExecuteCreatePage).toHaveBeenCalledOnce();
    expect(mockExecuteCreatePage).toHaveBeenCalledWith(VALID_BODY);
  });

  it("400 — executor error envelope, status from errorCodeToStatus", async () => {
    const envelope = makeValidationErrorEnvelope("title too short");
    mockExecuteCreatePage.mockResolvedValue(envelope);

    const res = await POST(makeJsonRequest({ title: "x" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual(envelope);
  });

  it("malformed JSON body → executor receives {} fallback", async () => {
    const envelope = makeSuccessEnvelope({ page_id: 1, slug: "fallback", status: "draft", preview_url: "", admin_url: "" });
    mockExecuteCreatePage.mockResolvedValue(envelope);

    const res = await POST(makeMalformedRequest());

    expect(mockExecuteCreatePage).toHaveBeenCalledWith({});
    expect(res.status).toBe(200);
  });

  it("429 — rate-limit denial; executor is never called", async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED);

    const res = await POST(makeJsonRequest(VALID_BODY));

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(mockExecuteCreatePage).not.toHaveBeenCalled();
  });
});
