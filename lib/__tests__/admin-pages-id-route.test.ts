import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Route handler tests for PATCH /api/admin/sites/[id]/pages/[pageId]
// (M15-6 #5-12).
//
// Covers auth gate, UUID validation, Zod body validation, delegation to
// updatePageMetadata, and error propagation (VERSION_CONFLICT,
// UNIQUE_VIOLATION, NOT_FOUND).
// ---------------------------------------------------------------------------

const mockRequireAdminForApi = vi.hoisted(() => vi.fn());
const mockUpdatePageMetadata = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api-gate", () => ({
  requireAdminForApi: mockRequireAdminForApi,
}));

vi.mock("@/lib/pages", () => ({
  updatePageMetadata: mockUpdatePageMetadata,
  PAGE_TITLE_MIN: 3,
  PAGE_TITLE_MAX: 200,
  PAGE_SLUG_MAX: 100,
  PAGE_SLUG_RE: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
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

import { PATCH } from "@/app/api/admin/sites/[id]/pages/[pageId]/route";

const GATE_ALLOW = {
  kind: "allow" as const,
  user: { id: "user-1", email: "admin@test.com", role: "admin" as const },
};
const GATE_DENY = {
  kind: "deny" as const,
  response: new Response(
    JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED" } }),
    { status: 401 },
  ),
};

const SITE_UUID = "11111111-1111-1111-1111-111111111111";
const PAGE_UUID = "22222222-2222-2222-2222-222222222222";

function makeRequest(body?: unknown): Request {
  return new Request(
    `http://localhost/api/admin/sites/${SITE_UUID}/pages/${PAGE_UUID}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
  );
}

function makeParams(siteId = SITE_UUID, pageId = PAGE_UUID) {
  return { params: { id: siteId, pageId } };
}

const PAGE_RESULT = {
  ok: true as const,
  data: {
    id: PAGE_UUID,
    site_id: SITE_UUID,
    title: "Updated Title",
    slug: "updated-title",
    version_lock: 2,
  },
  timestamp: new Date().toISOString(),
};

const VALID_BODY = {
  expected_version: 1,
  patch: { title: "Updated Title" },
};

beforeEach(() => {
  mockRequireAdminForApi.mockReset().mockResolvedValue(GATE_ALLOW);
  mockUpdatePageMetadata.mockReset().mockResolvedValue(PAGE_RESULT);
});

describe("PATCH /api/admin/sites/[id]/pages/[pageId]", () => {
  it("401 — gate denies", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_DENY);

    const res = await PATCH(makeRequest(VALID_BODY) as Parameters<typeof PATCH>[0], makeParams());

    expect(res.status).toBe(401);
  });

  it("400 — invalid site UUID", async () => {
    const res = await PATCH(
      makeRequest(VALID_BODY) as Parameters<typeof PATCH>[0],
      makeParams("not-a-uuid", PAGE_UUID),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("400 — invalid page UUID", async () => {
    const res = await PATCH(
      makeRequest(VALID_BODY) as Parameters<typeof PATCH>[0],
      makeParams(SITE_UUID, "not-a-uuid"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("400 — malformed JSON body", async () => {
    const req = new Request(`http://localhost/api/admin/sites/${SITE_UUID}/pages/${PAGE_UUID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{broken",
    });

    const res = await PATCH(req as Parameters<typeof PATCH>[0], makeParams());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("400 — missing expected_version", async () => {
    const res = await PATCH(
      makeRequest({ patch: { title: "x" } }) as Parameters<typeof PATCH>[0],
      makeParams(),
    );

    expect(res.status).toBe(400);
  });

  it("400 — patch has no fields", async () => {
    const res = await PATCH(
      makeRequest({ expected_version: 1, patch: {} }) as Parameters<typeof PATCH>[0],
      makeParams(),
    );

    expect(res.status).toBe(400);
  });

  it("400 — invalid slug pattern (uppercase)", async () => {
    const res = await PATCH(
      makeRequest({ expected_version: 1, patch: { slug: "My-Slug" } }) as Parameters<typeof PATCH>[0],
      makeParams(),
    );

    expect(res.status).toBe(400);
  });

  it("200 — delegates to updatePageMetadata with correct args", async () => {
    const res = await PATCH(makeRequest(VALID_BODY) as Parameters<typeof PATCH>[0], makeParams());

    expect(res.status).toBe(200);
    expect(mockUpdatePageMetadata).toHaveBeenCalledWith(
      SITE_UUID,
      PAGE_UUID,
      expect.objectContaining({
        expected_version: 1,
        updated_by: "user-1",
        patch: expect.objectContaining({ title: "Updated Title" }),
      }),
    );
  });

  it("200 — accepts valid slug patch", async () => {
    const res = await PATCH(
      makeRequest({ expected_version: 1, patch: { slug: "new-slug" } }) as Parameters<typeof PATCH>[0],
      makeParams(),
    );

    expect(res.status).toBe(200);
  });

  it("409 — VERSION_CONFLICT propagated", async () => {
    mockUpdatePageMetadata.mockResolvedValue({
      ok: false,
      error: {
        code: "VERSION_CONFLICT",
        message: "Stale version — current is 3",
        retryable: false,
        suggested_action: "Re-fetch the page and retry.",
      },
      timestamp: new Date().toISOString(),
    });

    const res = await PATCH(makeRequest(VALID_BODY) as Parameters<typeof PATCH>[0], makeParams());

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("VERSION_CONFLICT");
  });

  it("409 — UNIQUE_VIOLATION (slug conflict) propagated", async () => {
    mockUpdatePageMetadata.mockResolvedValue({
      ok: false,
      error: {
        code: "UNIQUE_VIOLATION",
        message: "Slug already taken",
        retryable: false,
        suggested_action: "Choose a different slug.",
      },
      timestamp: new Date().toISOString(),
    });

    const res = await PATCH(
      makeRequest({ expected_version: 1, patch: { slug: "taken-slug" } }) as Parameters<typeof PATCH>[0],
      makeParams(),
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("UNIQUE_VIOLATION");
  });

  it("404 — NOT_FOUND propagated", async () => {
    mockUpdatePageMetadata.mockResolvedValue({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Page not found",
        retryable: false,
        suggested_action: "",
      },
      timestamp: new Date().toISOString(),
    });

    const res = await PATCH(makeRequest(VALID_BODY) as Parameters<typeof PATCH>[0], makeParams());

    expect(res.status).toBe(404);
  });
});
