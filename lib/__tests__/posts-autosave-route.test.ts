import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Route handler unit tests for POST /api/sites/[id]/posts/[post_id]/autosave
// (Spec 14 PR B follow-up — partial-state autosave endpoint).
//
// Mocks admin-api-gate + supabase service-role client. Asserts UUID
// validation, body validation (must include at least one field), auth
// gate, slug-collision 409 mapping, and happy path.
// ---------------------------------------------------------------------------

const mockRequireAdminForApi = vi.hoisted(() => vi.fn());
const mockGetServiceRoleClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api-gate", () => ({
  requireAdminForApi: mockRequireAdminForApi,
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: mockGetServiceRoleClient,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
  headers: () => new Headers(),
}));

import { POST } from "@/app/api/sites/[id]/posts/[post_id]/autosave/route";

const GATE_ALLOW = {
  kind: "allow" as const,
  user: { id: "admin-1", email: "admin@test.com", role: "super_admin" as const },
};
const GATE_DENY = {
  kind: "deny" as const,
  response: new Response(
    JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED" } }),
    { status: 401 },
  ),
};

const SITE_ID = "11111111-1111-1111-1111-111111111111";
const POST_ID = "22222222-2222-2222-2222-222222222222";
const INVALID_ID = "not-a-uuid";

function makeRequest(body: unknown): Request {
  return new Request(
    `http://localhost/api/sites/${SITE_ID}/posts/${POST_ID}/autosave`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function makeCtx(siteId = SITE_ID, postId = POST_ID) {
  return { params: { id: siteId, post_id: postId } };
}

interface MockSupabaseUpdateResult {
  data: { id: string; version_lock: number; updated_at: string } | null;
  error: { code?: string; message: string } | null;
}

function mockSupabaseUpdate(result: MockSupabaseUpdateResult): void {
  const chain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  mockGetServiceRoleClient.mockReturnValue({
    from: vi.fn().mockReturnValue(chain),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/sites/[id]/posts/[post_id]/autosave", () => {
  it("401 when auth gate denies", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_DENY);
    const res = await POST(makeRequest({ title: "x" }), makeCtx());
    expect(res.status).toBe(401);
  });

  it("400 VALIDATION_FAILED when site id is not a UUID", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_ALLOW);
    const res = await POST(
      makeRequest({ title: "x" }),
      makeCtx(INVALID_ID, POST_ID),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION_FAILED");
  });

  it("400 VALIDATION_FAILED when post id is not a UUID", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_ALLOW);
    const res = await POST(
      makeRequest({ title: "x" }),
      makeCtx(SITE_ID, INVALID_ID),
    );
    expect(res.status).toBe(400);
  });

  it("400 VALIDATION_FAILED when body is empty", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_ALLOW);
    const res = await POST(makeRequest({}), makeCtx());
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION_FAILED");
  });

  it("400 VALIDATION_FAILED when body includes unknown keys", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_ALLOW);
    const res = await POST(
      makeRequest({ title: "x", unknown_field: "y" }),
      makeCtx(),
    );
    expect(res.status).toBe(400);
  });

  it("400 VALIDATION_FAILED when slug fails the regex", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_ALLOW);
    const res = await POST(
      makeRequest({ slug: "Bad Slug With Spaces" }),
      makeCtx(),
    );
    expect(res.status).toBe(400);
  });

  it("404 when supabase returns no row (post missing / wrong site / published)", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_ALLOW);
    mockSupabaseUpdate({ data: null, error: null });
    const res = await POST(makeRequest({ title: "x" }), makeCtx());
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("NOT_FOUND");
  });

  it("409 UNIQUE_VIOLATION when slug collides on the site", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_ALLOW);
    mockSupabaseUpdate({
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });
    const res = await POST(
      makeRequest({ slug: "taken-slug" }),
      makeCtx(),
    );
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("UNIQUE_VIOLATION");
  });

  it("500 INTERNAL_ERROR on other supabase failures", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_ALLOW);
    mockSupabaseUpdate({
      data: null,
      error: { code: "42P01", message: "relation does not exist" },
    });
    const res = await POST(makeRequest({ title: "x" }), makeCtx());
    expect(res.status).toBe(500);
  });

  it("200 OK on happy path; returns id + version_lock + updated_at", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_ALLOW);
    mockSupabaseUpdate({
      data: {
        id: POST_ID,
        version_lock: 7,
        updated_at: "2026-05-08T00:00:00Z",
      },
      error: null,
    });
    const res = await POST(
      makeRequest({
        title: "Autosaved",
        slug: "autosaved",
        excerpt: "Snip",
        meta_title: null,
        metadata: { foo: "bar" },
        generated_html: "<p>hello</p>",
      }),
      makeCtx(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { id: string; version_lock: number };
    };
    expect(json.ok).toBe(true);
    expect(json.data.id).toBe(POST_ID);
    expect(json.data.version_lock).toBe(7);
  });

  it("accepts a single-field patch (just generated_html)", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_ALLOW);
    mockSupabaseUpdate({
      data: {
        id: POST_ID,
        version_lock: 1,
        updated_at: "2026-05-08T00:00:00Z",
      },
      error: null,
    });
    const res = await POST(
      makeRequest({ generated_html: "<p>hi</p>" }),
      makeCtx(),
    );
    expect(res.status).toBe(200);
  });
});
