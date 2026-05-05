import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Route handler tests for PATCH and DELETE /api/sites/[id] (M15-6 #5-12).
//
// GET is already covered in lib/__tests__/sites-list.test.ts and
// lib/__tests__/sites-ux-cleanup.test.ts. This file covers the write
// handlers (PATCH basics + credentials, DELETE soft-archive).
// ---------------------------------------------------------------------------

const mockRequireAdminForApi = vi.hoisted(() => vi.fn());
const mockUpdateSiteBasics = vi.hoisted(() => vi.fn());
const mockUpdateSiteCredentials = vi.hoisted(() => vi.fn());
const mockGetSite = vi.hoisted(() => vi.fn());
const mockArchiveSite = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api-gate", () => ({
  requireAdminForApi: mockRequireAdminForApi,
}));

vi.mock("@/lib/sites", () => ({
  updateSiteBasics: mockUpdateSiteBasics,
  updateSiteCredentials: mockUpdateSiteCredentials,
  getSite: mockGetSite,
  archiveSite: mockArchiveSite,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
  headers: () => new Headers(),
}));

import { PATCH, DELETE } from "@/app/api/sites/[id]/route";

const GATE_ALLOW = {
  kind: "allow" as const,
  user: { id: "u1", email: "admin@test.com", role: "admin" as const },
};
const GATE_DENY = {
  kind: "deny" as const,
  response: new Response(
    JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED" } }),
    { status: 401 },
  ),
};

const VALID_UUID = "11111111-1111-1111-1111-111111111111";
const SITE_RECORD = {
  id: VALID_UUID,
  name: "Test Site",
  wp_url: "https://wp.example.com",
  prefix: "ts",
  status: "active",
  design_system_version: "1.0.0",
  plugin_version: null,
  last_successful_operation_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  brand_voice: null,
  design_direction: null,
  version_lock: 1,
  site_mode: null,
};

function makeRequest(method: string, body?: unknown): Request {
  return new Request(`http://localhost/api/sites/${VALID_UUID}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function makeParams(id: string = VALID_UUID) {
  return { params: { id } };
}

const SITES_OK = { ok: true as const, data: { site: SITE_RECORD, credentials: null } };

beforeEach(() => {
  mockRequireAdminForApi.mockReset().mockResolvedValue(GATE_ALLOW);
  mockUpdateSiteBasics.mockReset().mockResolvedValue({ ok: true, data: { site: SITE_RECORD } });
  mockUpdateSiteCredentials.mockReset().mockResolvedValue({ ok: true, data: {} });
  mockGetSite.mockReset().mockResolvedValue(SITES_OK);
  mockArchiveSite.mockReset().mockResolvedValue({ ok: true, data: { site: SITE_RECORD } });
});

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

describe("PATCH /api/sites/[id]", () => {
  it("401 — gate denies", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_DENY);

    const res = await PATCH(makeRequest("PATCH", { name: "New Name" }), makeParams());

    expect(res.status).toBe(401);
  });

  it("400 — invalid UUID param", async () => {
    const res = await PATCH(makeRequest("PATCH", { name: "x" }), makeParams("not-a-uuid"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("400 — malformed JSON body", async () => {
    const req = new Request(`http://localhost/api/sites/${VALID_UUID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "not json",
    });

    const res = await PATCH(req, makeParams());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("400 — empty body (no fields provided)", async () => {
    const res = await PATCH(makeRequest("PATCH", {}), makeParams());

    expect(res.status).toBe(400);
  });

  it("200 — updates basics (name)", async () => {
    const res = await PATCH(makeRequest("PATCH", { name: "Renamed Site" }), makeParams());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockUpdateSiteBasics).toHaveBeenCalledWith(
      VALID_UUID,
      expect.objectContaining({ name: "Renamed Site" }),
    );
    expect(mockUpdateSiteCredentials).not.toHaveBeenCalled();
  });

  it("200 — updates credentials (wp_user + wp_app_password)", async () => {
    const res = await PATCH(
      makeRequest("PATCH", { wp_user: "admin", wp_app_password: "pass word" }),
      makeParams(),
    );

    expect(res.status).toBe(200);
    expect(mockUpdateSiteCredentials).toHaveBeenCalledWith(
      VALID_UUID,
      expect.objectContaining({
        wp_user: "admin",
        wp_app_password: "password", // whitespace stripped
      }),
    );
  });

  it("500 — updateSiteBasics fails → propagates error", async () => {
    mockUpdateSiteBasics.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "DB failed", retryable: false, suggested_action: "" },
    });

    const res = await PATCH(makeRequest("PATCH", { name: "x" }), makeParams());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("500 — updateSiteCredentials fails → propagates error", async () => {
    mockUpdateSiteCredentials.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Encryption failed", retryable: false, suggested_action: "" },
    });

    const res = await PATCH(
      makeRequest("PATCH", { wp_user: "admin", wp_app_password: "newpass" }),
      makeParams(),
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

describe("DELETE /api/sites/[id]", () => {
  it("401 — gate denies", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_DENY);

    const res = await DELETE(makeRequest("DELETE"), makeParams());

    expect(res.status).toBe(401);
  });

  it("400 — invalid UUID param", async () => {
    const res = await DELETE(makeRequest("DELETE"), makeParams("not-a-uuid"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("200 — delegates to archiveSite and returns result", async () => {
    const res = await DELETE(makeRequest("DELETE"), makeParams());

    expect(res.status).toBe(200);
    expect(mockArchiveSite).toHaveBeenCalledWith(VALID_UUID);
  });

  it("404 — archiveSite returns NOT_FOUND", async () => {
    mockArchiveSite.mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "Site not found", retryable: false, suggested_action: "" },
    });

    const res = await DELETE(makeRequest("DELETE"), makeParams());

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});
