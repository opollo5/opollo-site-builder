import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Route handler unit tests for GET + POST /api/sites/[id]/blueprints (M16).
// Tests auth gate, UUID validation, body parsing, and lib delegation.
// ---------------------------------------------------------------------------

const mockRequireAdminForApi = vi.hoisted(() => vi.fn());
const mockGetSiteBlueprint = vi.hoisted(() => vi.fn());
const mockRunSitePlanner = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api-gate", () => ({
  requireAdminForApi: mockRequireAdminForApi,
}));

vi.mock("@/lib/site-blueprint", () => ({
  getSiteBlueprint: mockGetSiteBlueprint,
}));

vi.mock("@/lib/site-planner", () => ({
  runSitePlanner: mockRunSitePlanner,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
  headers: () => new Headers(),
}));

import { GET, POST } from "@/app/api/sites/[id]/blueprints/route";

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

const SITE_UUID = "11111111-1111-1111-1111-111111111111";
const BRIEF_UUID = "22222222-2222-2222-2222-222222222222";
const BLUEPRINT_UUID = "33333333-3333-3333-3333-333333333333";
const INVALID_ID = "not-a-uuid";

function makeCtx(id = SITE_UUID) {
  return { params: { id } };
}

const BLUEPRINT_STUB = {
  id: BLUEPRINT_UUID,
  site_id: SITE_UUID,
  brief_id: BRIEF_UUID,
  sections: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const BLUEPRINT_API_RESPONSE = {
  ok: true as const,
  data: BLUEPRINT_STUB,
  timestamp: "2026-01-01T00:00:00Z",
};

const PLANNER_RESULT_OK = {
  ok: true as const,
  blueprint: BLUEPRINT_STUB,
  cached: false,
};

beforeEach(() => {
  mockRequireAdminForApi.mockReset().mockResolvedValue(GATE_ALLOW);
  mockGetSiteBlueprint.mockReset().mockResolvedValue(BLUEPRINT_API_RESPONSE);
  mockRunSitePlanner.mockReset().mockResolvedValue(PLANNER_RESULT_OK);
});

// ─── GET tests ───────────────────────────────────────────────────────────────

describe("GET /api/sites/[id]/blueprints — auth", () => {
  it("returns 401 when gate denies", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_DENY);
    const req = new Request(`http://localhost/api/sites/${SITE_UUID}/blueprints`);
    const res = await GET(req, makeCtx());
    expect(res.status).toBe(401);
  });
});

describe("GET /api/sites/[id]/blueprints — UUID validation", () => {
  it("returns 400 when site id is not a UUID", async () => {
    const req = new Request(`http://localhost/api/sites/${INVALID_ID}/blueprints`);
    const res = await GET(req, makeCtx(INVALID_ID));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});

describe("GET /api/sites/[id]/blueprints — happy path", () => {
  it("delegates to getSiteBlueprint and returns its response", async () => {
    const req = new Request(`http://localhost/api/sites/${SITE_UUID}/blueprints`);
    const res = await GET(req, makeCtx());
    expect(mockGetSiteBlueprint).toHaveBeenCalledWith(SITE_UUID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(BLUEPRINT_UUID);
  });

  it("returns null data when no blueprint exists", async () => {
    mockGetSiteBlueprint.mockResolvedValue({
      ok: true,
      data: null,
      timestamp: "2026-01-01T00:00:00Z",
    });
    const req = new Request(`http://localhost/api/sites/${SITE_UUID}/blueprints`);
    const res = await GET(req, makeCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeNull();
  });
});

// ─── POST tests ──────────────────────────────────────────────────────────────

describe("POST /api/sites/[id]/blueprints — auth", () => {
  it("returns 401 when gate denies", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_DENY);
    const req = new Request(`http://localhost/api/sites/${SITE_UUID}/blueprints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief_id: BRIEF_UUID }),
    });
    const res = await POST(req, makeCtx());
    expect(res.status).toBe(401);
  });
});

describe("POST /api/sites/[id]/blueprints — UUID validation", () => {
  it("returns 400 when site id is not a UUID", async () => {
    const req = new Request(`http://localhost/api/sites/${INVALID_ID}/blueprints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief_id: BRIEF_UUID }),
    });
    const res = await POST(req, makeCtx(INVALID_ID));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/sites/[id]/blueprints — body validation", () => {
  it("returns 400 when body is malformed JSON", async () => {
    const req = new Request(`http://localhost/api/sites/${SITE_UUID}/blueprints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const res = await POST(req, makeCtx());
    expect(res.status).toBe(400);
  });

  it("returns 400 when brief_id is missing", async () => {
    const req = new Request(`http://localhost/api/sites/${SITE_UUID}/blueprints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req, makeCtx());
    expect(res.status).toBe(400);
  });

  it("returns 400 when brief_id is not a UUID", async () => {
    const req = new Request(`http://localhost/api/sites/${SITE_UUID}/blueprints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief_id: "not-a-uuid" }),
    });
    const res = await POST(req, makeCtx());
    expect(res.status).toBe(400);
  });
});

describe("POST /api/sites/[id]/blueprints — happy path", () => {
  it("calls runSitePlanner with correct args and returns 200", async () => {
    const req = new Request(`http://localhost/api/sites/${SITE_UUID}/blueprints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief_id: BRIEF_UUID }),
    });
    const res = await POST(req, makeCtx());
    expect(mockRunSitePlanner).toHaveBeenCalledWith({
      siteId: SITE_UUID,
      briefId: BRIEF_UUID,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.blueprint.id).toBe(BLUEPRINT_UUID);
    expect(body.data.cached).toBe(false);
  });

  it("returns cached: true when planner returns a cached blueprint", async () => {
    mockRunSitePlanner.mockResolvedValue({
      ...PLANNER_RESULT_OK,
      cached: true,
    });
    const req = new Request(`http://localhost/api/sites/${SITE_UUID}/blueprints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief_id: BRIEF_UUID }),
    });
    const res = await POST(req, makeCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.cached).toBe(true);
  });
});

describe("POST /api/sites/[id]/blueprints — planner errors", () => {
  it("returns 422 when planner returns an error", async () => {
    mockRunSitePlanner.mockResolvedValue({
      ok: false,
      error: { code: "SITE_NOT_FOUND", message: "Site not found." },
    });
    const req = new Request(`http://localhost/api/sites/${SITE_UUID}/blueprints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief_id: BRIEF_UUID }),
    });
    const res = await POST(req, makeCtx());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("SITE_NOT_FOUND");
  });
});
