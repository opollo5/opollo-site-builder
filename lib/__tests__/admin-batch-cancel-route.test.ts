import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Route handler unit tests for POST /api/admin/batch/[id]/cancel (M3-8).
// Tests auth gate, UUID validation, idempotent re-cancel, INVALID_STATE,
// FORBIDDEN for cross-operator cancel, and happy-path success.
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

import { POST } from "@/app/api/admin/batch/[id]/cancel/route";

const GATE_ALLOW_ADMIN = {
  kind: "allow" as const,
  user: { id: "admin-1", email: "admin@test.com", role: "admin" as const },
};
const GATE_ALLOW_OPERATOR = {
  kind: "allow" as const,
  user: { id: "op-1", email: "op@test.com", role: "operator" as const },
};
const GATE_DENY = {
  kind: "deny" as const,
  response: new Response(
    JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED" } }),
    { status: 401 },
  ),
};

const JOB_UUID = "11111111-1111-1111-1111-111111111111";
const OTHER_UUID = "22222222-2222-2222-2222-222222222222";
const INVALID_ID = "not-a-uuid";

function makeRequest(id = JOB_UUID): Request {
  return new Request(`http://localhost/api/admin/batch/${id}/cancel`, {
    method: "POST",
  });
}

function makeCtx(id = JOB_UUID) {
  return { params: { id } };
}

// Supabase query chain mock builders
function buildReadMock(existing: unknown, readErr: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: readErr });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });

  const insertResolve = vi.fn().mockResolvedValue({ error: null });
  const insert = vi.fn().mockReturnValue(insertResolve);

  const updateEqPending = vi.fn().mockResolvedValue({ error: null });
  const updateEqJob = vi.fn().mockReturnValue({ error: null });
  const updateFn = vi.fn()
    .mockReturnValueOnce({ eq: updateEqJob })
    .mockReturnValueOnce({ eq: vi.fn().mockReturnValue({ eq: updateEqPending }) });

  const from = vi.fn((table: string) => {
    if (table === "generation_jobs") {
      return { select, update: updateFn };
    }
    if (table === "generation_job_pages") {
      return { update: updateFn };
    }
    if (table === "generation_events") {
      return { insert };
    }
    return { select, update: updateFn, insert };
  });

  return { from };
}

function buildFullSuccessMock(existing: { id: string; status: string; cancel_requested_at: null; created_by: string }) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null });
  const selectEq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ selectEq });

  // generation_jobs update chain
  const jobUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const jobUpdate = vi.fn().mockReturnValue({ eq: jobUpdateEq });

  // generation_job_pages update chain (eq + eq)
  const pagesUpdateEq2 = vi.fn().mockResolvedValue({ error: null });
  const pagesUpdateEq1 = vi.fn().mockReturnValue({ eq: pagesUpdateEq2 });
  const pagesUpdate = vi.fn().mockReturnValue({ eq: pagesUpdateEq1 });

  // generation_events insert
  const evtInsert = vi.fn().mockResolvedValue({ error: null });

  const from = vi.fn((table: string) => {
    if (table === "generation_jobs") return { select, update: jobUpdate };
    if (table === "generation_job_pages") return { update: pagesUpdate };
    if (table === "generation_events") return { insert: evtInsert };
    return {};
  });

  return { from };
}

beforeEach(() => {
  mockRequireAdminForApi.mockReset().mockResolvedValue(GATE_ALLOW_ADMIN);
  mockGetServiceRoleClient.mockReset();
});

describe("POST /api/admin/batch/[id]/cancel — auth", () => {
  it("returns 401 when gate denies", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_DENY);
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(401);
  });
});

describe("POST /api/admin/batch/[id]/cancel — UUID validation", () => {
  it("returns 400 when job id is not a UUID", async () => {
    const res = await POST(makeRequest(INVALID_ID), makeCtx(INVALID_ID));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("POST /api/admin/batch/[id]/cancel — not found", () => {
  it("returns 404 when job does not exist", async () => {
    mockGetServiceRoleClient.mockReturnValue(buildReadMock(null));
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("POST /api/admin/batch/[id]/cancel — FORBIDDEN", () => {
  it("returns 403 when operator tries to cancel another operator's job", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_ALLOW_OPERATOR);
    mockGetServiceRoleClient.mockReturnValue(
      buildReadMock({
        id: JOB_UUID,
        status: "queued",
        cancel_requested_at: null,
        created_by: OTHER_UUID,
      }),
    );
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("allows operator to cancel their own job", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_ALLOW_OPERATOR);
    const existing = {
      id: JOB_UUID,
      status: "queued",
      cancel_requested_at: null,
      created_by: "op-1",
    };
    mockGetServiceRoleClient.mockReturnValue(buildFullSuccessMock(existing));
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(200);
  });
});

describe("POST /api/admin/batch/[id]/cancel — idempotent", () => {
  it("returns 200 with changed: false when already cancelled", async () => {
    mockGetServiceRoleClient.mockReturnValue(
      buildReadMock({
        id: JOB_UUID,
        status: "cancelled",
        cancel_requested_at: "2026-01-01T00:00:00Z",
        created_by: "admin-1",
      }),
    );
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.changed).toBe(false);
    expect(body.data.status).toBe("cancelled");
  });
});

describe("POST /api/admin/batch/[id]/cancel — INVALID_STATE", () => {
  it.each(["succeeded", "failed"])(
    "returns 409 for terminal status %s",
    async (status) => {
      mockGetServiceRoleClient.mockReturnValue(
        buildReadMock({
          id: JOB_UUID,
          status,
          cancel_requested_at: null,
          created_by: "admin-1",
        }),
      );
      const res = await POST(makeRequest(), makeCtx());
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_STATE");
    },
  );
});

describe("POST /api/admin/batch/[id]/cancel — happy path", () => {
  it("returns 200 with changed: true on successful cancel", async () => {
    const existing = {
      id: JOB_UUID,
      status: "queued",
      cancel_requested_at: null,
      created_by: "admin-1",
    };
    mockGetServiceRoleClient.mockReturnValue(buildFullSuccessMock(existing));
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.changed).toBe(true);
    expect(body.data.status).toBe("cancelled");
  });

  it.each(["queued", "running", "partial"])(
    "allows cancellation of status: %s",
    async (status) => {
      const existing = {
        id: JOB_UUID,
        status,
        cancel_requested_at: null,
        created_by: "admin-1",
      };
      mockGetServiceRoleClient.mockReturnValue(buildFullSuccessMock(existing));
      const res = await POST(makeRequest(), makeCtx());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.changed).toBe(true);
    },
  );
});
