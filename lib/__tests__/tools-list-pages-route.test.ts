import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Integration tests for app/api/tools/list_pages/route.ts
//
// M15-4 #11 update: upgraded from session-optional to requireAdminForApi;
// runWithWpCredentials context now seeded from optional site_id in body.
// ---------------------------------------------------------------------------

const mockExecuteListPages = vi.hoisted(() => vi.fn());
const mockRequireAdminForApi = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockResolveToolWpCreds = vi.hoisted(() => vi.fn());
const mockRunWithWpCredentials = vi.hoisted(() => vi.fn());

vi.mock("@/lib/list-pages", () => ({
  executeListPages: mockExecuteListPages,
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

vi.mock("@/lib/tools-wp-creds", () => ({
  resolveToolWpCreds: mockResolveToolWpCreds,
}));

vi.mock("@/lib/wordpress", () => ({
  runWithWpCredentials: mockRunWithWpCredentials,
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
  headers: () => new Headers(),
}));

import { POST } from "@/app/api/tools/list_pages/route";
import {
  makeJsonRequest,
  makeMalformedRequest,
  makeSuccessEnvelope,
  makeValidationErrorEnvelope,
  RATE_LIMIT_DENIED,
} from "./_tools-route-helpers";

const GATE_ALLOW = { kind: "allow" as const, user: { id: "user-1", email: "admin@test.com", role: "admin" as const } };

beforeEach(() => {
  mockExecuteListPages.mockReset();
  mockRequireAdminForApi.mockReset().mockResolvedValue(GATE_ALLOW);
  mockCheckRateLimit.mockReset().mockResolvedValue({ ok: true, limit: 120, remaining: 119, reset: 0 });
  mockResolveToolWpCreds.mockReset().mockResolvedValue({ ok: true, creds: undefined });
  mockRunWithWpCredentials.mockReset().mockImplementation((_creds: unknown, fn: () => unknown) => fn());
});

const VALID_BODY = { status: "draft" };

describe("POST /api/tools/list_pages", () => {
  it("200 — passes executor's success envelope through verbatim", async () => {
    const envelope = makeSuccessEnvelope({
      pages: [
        {
          page_id: 5,
          title: "Draft Page",
          slug: "draft-page",
          status: "draft",
          parent_id: null,
          modified_date: "2026-04-01T00:00:00Z",
        },
      ],
    });
    mockExecuteListPages.mockResolvedValue(envelope);

    const res = await POST(makeJsonRequest(VALID_BODY));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(envelope);
    expect(mockExecuteListPages).toHaveBeenCalledOnce();
  });

  it("400 — executor error envelope, status from errorCodeToStatus", async () => {
    const envelope = makeValidationErrorEnvelope("invalid status value");
    mockExecuteListPages.mockResolvedValue(envelope);

    const res = await POST(makeJsonRequest({ status: "unknown-status" }));

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
    expect(mockExecuteListPages).not.toHaveBeenCalled();
  });

  it("401 — auth gate denial; executor is never called", async () => {
    mockRequireAdminForApi.mockResolvedValue({
      kind: "deny" as const,
      response: new Response(JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED" } }), { status: 401 }),
    });

    const res = await POST(makeJsonRequest(VALID_BODY));

    expect(res.status).toBe(401);
    expect(mockExecuteListPages).not.toHaveBeenCalled();
  });

  it("429 — rate-limit denial; executor is never called", async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED);

    const res = await POST(makeJsonRequest(VALID_BODY));

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(mockExecuteListPages).not.toHaveBeenCalled();
  });

  it("site_id provided — resolveToolWpCreds called and creds seeded into runWithWpCredentials", async () => {
    const fakeCreds = { wp_url: "https://wp.example.com", wp_user: "admin", wp_app_password: "pass" };
    mockResolveToolWpCreds.mockResolvedValue({ ok: true, creds: fakeCreds });
    const envelope = makeSuccessEnvelope({ pages: [] });
    mockExecuteListPages.mockResolvedValue(envelope);

    const res = await POST(makeJsonRequest({ ...VALID_BODY, site_id: "site-uuid-1" }));

    expect(res.status).toBe(200);
    expect(mockResolveToolWpCreds).toHaveBeenCalledWith("site-uuid-1");
    expect(mockRunWithWpCredentials).toHaveBeenCalledWith(fakeCreds, expect.any(Function));
  });

  it("site_id leads to NOT_FOUND — 404 returned; executor not called", async () => {
    mockResolveToolWpCreds.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND" } }), { status: 404 }),
    });

    const res = await POST(makeJsonRequest({ ...VALID_BODY, site_id: "missing-site" }));

    expect(res.status).toBe(404);
    expect(mockExecuteListPages).not.toHaveBeenCalled();
  });
});
