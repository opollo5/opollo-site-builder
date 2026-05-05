import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Route handler tests for PATCH|DELETE /api/admin/images/[id] and
// POST /api/admin/images/[id]/restore (M15-6 #5-12).
//
// Covers auth gate, UUID validation, body validation, delegation, and
// error propagation for all three handlers.
// ---------------------------------------------------------------------------

const mockRequireAdminForApi = vi.hoisted(() => vi.fn());
const mockUpdateImageMetadata = vi.hoisted(() => vi.fn());
const mockSoftDeleteImage = vi.hoisted(() => vi.fn());
const mockRestoreImage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api-gate", () => ({
  requireAdminForApi: mockRequireAdminForApi,
}));

vi.mock("@/lib/image-library", () => ({
  updateImageMetadata: mockUpdateImageMetadata,
  softDeleteImage: mockSoftDeleteImage,
  restoreImage: mockRestoreImage,
  IMAGE_CAPTION_MAX: 1000,
  IMAGE_ALT_TEXT_MAX: 300,
  IMAGE_TAG_MAX_LEN: 60,
  IMAGE_TAGS_MAX_COUNT: 20,
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

import { PATCH, DELETE } from "@/app/api/admin/images/[id]/route";
import { POST as RESTORE } from "@/app/api/admin/images/[id]/restore/route";

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

const VALID_UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function makeRequest(method: string, body?: unknown): Request {
  return new Request(`http://localhost/api/admin/images/${VALID_UUID}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function makeParams(id: string = VALID_UUID) {
  return { params: { id } };
}

const IMAGE_RESULT = {
  ok: true as const,
  data: { id: VALID_UUID, caption: "A photo", alt_text: "photo", tags: [] },
  timestamp: new Date().toISOString(),
};

beforeEach(() => {
  mockRequireAdminForApi.mockReset().mockResolvedValue(GATE_ALLOW);
  mockUpdateImageMetadata.mockReset().mockResolvedValue(IMAGE_RESULT);
  mockSoftDeleteImage.mockReset().mockResolvedValue(IMAGE_RESULT);
  mockRestoreImage.mockReset().mockResolvedValue(IMAGE_RESULT);
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/images/[id]
// ---------------------------------------------------------------------------

describe("PATCH /api/admin/images/[id]", () => {
  it("401 — gate denies", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_DENY);

    const res = await PATCH(
      makeRequest("PATCH", { expected_version: 1, patch: { caption: "x" } }) as Parameters<typeof PATCH>[0],
      makeParams(),
    );

    expect(res.status).toBe(401);
  });

  it("400 — invalid UUID param", async () => {
    const res = await PATCH(
      makeRequest("PATCH", { expected_version: 1, patch: { caption: "x" } }) as Parameters<typeof PATCH>[0],
      makeParams("not-a-uuid"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("400 — malformed JSON body", async () => {
    const req = new Request(`http://localhost/api/admin/images/${VALID_UUID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{bad json",
    });

    const res = await PATCH(req as Parameters<typeof PATCH>[0], makeParams());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("400 — body missing expected_version", async () => {
    const res = await PATCH(
      makeRequest("PATCH", { patch: { caption: "x" } }) as Parameters<typeof PATCH>[0],
      makeParams(),
    );

    expect(res.status).toBe(400);
  });

  it("400 — patch has no editable fields", async () => {
    const res = await PATCH(
      makeRequest("PATCH", { expected_version: 1, patch: {} }) as Parameters<typeof PATCH>[0],
      makeParams(),
    );

    expect(res.status).toBe(400);
  });

  it("200 — updates caption", async () => {
    const res = await PATCH(
      makeRequest("PATCH", { expected_version: 1, patch: { caption: "New caption" } }) as Parameters<typeof PATCH>[0],
      makeParams(),
    );

    expect(res.status).toBe(200);
    expect(mockUpdateImageMetadata).toHaveBeenCalledWith(
      VALID_UUID,
      expect.objectContaining({
        expected_version: 1,
        updated_by: "user-1",
        patch: expect.objectContaining({ caption: "New caption" }),
      }),
    );
  });

  it("200 — deduplicates tags before passing to updateImageMetadata", async () => {
    const res = await PATCH(
      makeRequest("PATCH", {
        expected_version: 1,
        patch: { tags: ["cat", "cat", "dog"] },
      }) as Parameters<typeof PATCH>[0],
      makeParams(),
    );

    expect(res.status).toBe(200);
    const call = mockUpdateImageMetadata.mock.calls[0][1];
    expect(call.patch.tags).toEqual(["cat", "dog"]);
  });

  it("409 — VERSION_CONFLICT propagated", async () => {
    mockUpdateImageMetadata.mockResolvedValue({
      ok: false,
      error: { code: "VERSION_CONFLICT", message: "Stale version", retryable: false, suggested_action: "" },
      timestamp: new Date().toISOString(),
    });

    const res = await PATCH(
      makeRequest("PATCH", { expected_version: 1, patch: { caption: "x" } }) as Parameters<typeof PATCH>[0],
      makeParams(),
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("VERSION_CONFLICT");
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/images/[id]
// ---------------------------------------------------------------------------

describe("DELETE /api/admin/images/[id]", () => {
  it("401 — gate denies", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_DENY);

    const res = await DELETE(
      makeRequest("DELETE") as Parameters<typeof DELETE>[0],
      makeParams(),
    );

    expect(res.status).toBe(401);
  });

  it("400 — invalid UUID param", async () => {
    const res = await DELETE(
      makeRequest("DELETE") as Parameters<typeof DELETE>[0],
      makeParams("bad-id"),
    );

    expect(res.status).toBe(400);
  });

  it("200 — delegates to softDeleteImage with deleted_by from gate user", async () => {
    const res = await DELETE(
      makeRequest("DELETE") as Parameters<typeof DELETE>[0],
      makeParams(),
    );

    expect(res.status).toBe(200);
    expect(mockSoftDeleteImage).toHaveBeenCalledWith(VALID_UUID, {
      deleted_by: "user-1",
    });
  });

  it("409 — IMAGE_IN_USE propagated", async () => {
    mockSoftDeleteImage.mockResolvedValue({
      ok: false,
      error: { code: "IMAGE_IN_USE", message: "Image used by 2 sites", retryable: false, suggested_action: "" },
      timestamp: new Date().toISOString(),
    });

    const res = await DELETE(
      makeRequest("DELETE") as Parameters<typeof DELETE>[0],
      makeParams(),
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("IMAGE_IN_USE");
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/images/[id]/restore
// ---------------------------------------------------------------------------

describe("POST /api/admin/images/[id]/restore", () => {
  it("401 — gate denies", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_DENY);

    const res = await RESTORE(
      makeRequest("POST") as Parameters<typeof RESTORE>[0],
      makeParams(),
    );

    expect(res.status).toBe(401);
  });

  it("400 — invalid UUID param", async () => {
    const res = await RESTORE(
      makeRequest("POST") as Parameters<typeof RESTORE>[0],
      makeParams("bad-id"),
    );

    expect(res.status).toBe(400);
  });

  it("200 — delegates to restoreImage with restored_by from gate user", async () => {
    const res = await RESTORE(
      makeRequest("POST") as Parameters<typeof RESTORE>[0],
      makeParams(),
    );

    expect(res.status).toBe(200);
    expect(mockRestoreImage).toHaveBeenCalledWith(VALID_UUID, {
      restored_by: "user-1",
    });
  });

  it("404 — NOT_FOUND propagated", async () => {
    mockRestoreImage.mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "Image not found", retryable: false, suggested_action: "" },
      timestamp: new Date().toISOString(),
    });

    const res = await RESTORE(
      makeRequest("POST") as Parameters<typeof RESTORE>[0],
      makeParams(),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
