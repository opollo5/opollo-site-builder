import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Route handler unit tests for POST /api/admin/batch (M3-2).
// Tests the HTTP envelope: auth gate, rate limit, idempotency key, body
// parsing, createBatchJob delegation, and status-code mapping.
// ---------------------------------------------------------------------------

const mockRequireAdminForApi = vi.hoisted(() => vi.fn());
const mockCreateBatchJob = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockRateLimitExceeded = vi.hoisted(() => vi.fn());
const mockGetClientIp = vi.hoisted(() => vi.fn(() => "127.0.0.1"));

vi.mock("@/lib/admin-api-gate", () => ({
  requireAdminForApi: mockRequireAdminForApi,
}));

vi.mock("@/lib/batch-jobs", () => ({
  createBatchJob: mockCreateBatchJob,
}));

vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>(
    "@/lib/rate-limit",
  );
  return {
    ...actual,
    checkRateLimit: mockCheckRateLimit,
    rateLimitExceeded: mockRateLimitExceeded,
    getClientIp: mockGetClientIp,
  };
});

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
  headers: () => new Headers(),
}));

import { POST } from "@/app/api/admin/batch/route";

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
const RL_OK = { ok: true as const, limit: 10, remaining: 9, reset: 0 };
const RL_DENIED = {
  ok: false as const,
  limit: 10,
  remaining: 0 as const,
  reset: Date.now() + 60_000,
  retryAfterSec: 30,
};

const SITE_UUID = "11111111-1111-1111-1111-111111111111";
const TEMPLATE_UUID = "22222222-2222-2222-2222-222222222222";
const JOB_UUID = "33333333-3333-3333-3333-333333333333";
const IDEMPOTENCY_KEY = "test-idem-key-001";

function makeRequest(
  body: unknown,
  idempotencyKey: string | null = IDEMPOTENCY_KEY,
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (idempotencyKey !== null) {
    headers["idempotency-key"] = idempotencyKey;
  }
  return new Request("http://localhost/api/admin/batch", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  site_id: SITE_UUID,
  template_id: TEMPLATE_UUID,
  slots: [{ inputs: { title: "Page 1" } }],
};

const JOB_RESULT_CREATED = {
  ok: true as const,
  data: {
    id: JOB_UUID,
    site_id: SITE_UUID,
    template_id: TEMPLATE_UUID,
    status: "queued",
    requested_count: 1,
    idempotency_replay: false,
  },
};

const JOB_RESULT_REPLAY = {
  ok: true as const,
  data: {
    ...JOB_RESULT_CREATED.data,
    idempotency_replay: true,
  },
};

beforeEach(() => {
  mockRequireAdminForApi.mockReset().mockResolvedValue(GATE_ALLOW);
  mockCheckRateLimit.mockReset().mockResolvedValue(RL_OK);
  mockRateLimitExceeded.mockReset().mockReturnValue(
    new Response(JSON.stringify({ ok: false, error: { code: "RATE_LIMITED" } }), { status: 429 }),
  );
  mockCreateBatchJob.mockReset().mockResolvedValue(JOB_RESULT_CREATED);
});

describe("POST /api/admin/batch — auth", () => {
  it("returns 401 when gate denies", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_DENY);
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it("calls requireAdminForApi with correct roles", async () => {
    await POST(makeRequest(VALID_BODY));
    expect(mockRequireAdminForApi).toHaveBeenCalledWith({
      roles: ["super_admin", "admin"],
    });
  });
});

describe("POST /api/admin/batch — rate limit", () => {
  it("returns 429 when rate limit exceeded", async () => {
    mockCheckRateLimit.mockResolvedValue(RL_DENIED);
    mockRateLimitExceeded.mockReturnValue(
      new Response("{}", { status: 429 }),
    );
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(429);
    expect(mockRateLimitExceeded).toHaveBeenCalledWith(RL_DENIED);
  });
});

describe("POST /api/admin/batch — idempotency key validation", () => {
  it("returns 400 when Idempotency-Key header is missing", async () => {
    const res = await POST(makeRequest(VALID_BODY, null));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 when Idempotency-Key header is blank", async () => {
    const res = await POST(makeRequest(VALID_BODY, "   "));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("POST /api/admin/batch — body validation", () => {
  it("returns 400 on malformed JSON body", async () => {
    const req = new Request("http://localhost/api/admin/batch", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": IDEMPOTENCY_KEY,
      },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("POST /api/admin/batch — happy path", () => {
  it("returns 201 on first create", async () => {
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(JOB_UUID);
    expect(body.data.idempotency_replay).toBe(false);
  });

  it("returns 200 on idempotency replay", async () => {
    mockCreateBatchJob.mockResolvedValue(JOB_RESULT_REPLAY);
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.idempotency_replay).toBe(true);
  });

  it("passes trimmed idempotency key and body fields to createBatchJob", async () => {
    await POST(makeRequest(VALID_BODY, "  key-with-spaces  "));
    expect(mockCreateBatchJob).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotency_key: "key-with-spaces",
        site_id: SITE_UUID,
        template_id: TEMPLATE_UUID,
        created_by: "u1",
      }),
    );
  });
});

describe("POST /api/admin/batch — createBatchJob error mapping", () => {
  it("returns 404 on TEMPLATE_NOT_FOUND", async () => {
    mockCreateBatchJob.mockResolvedValue({
      ok: false,
      error: { code: "TEMPLATE_NOT_FOUND", message: "not found", details: {} },
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("TEMPLATE_NOT_FOUND");
  });

  it("returns 409 on TEMPLATE_NOT_ACTIVE", async () => {
    mockCreateBatchJob.mockResolvedValue({
      ok: false,
      error: { code: "TEMPLATE_NOT_ACTIVE", message: "inactive", details: {} },
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(409);
  });

  it("returns 422 on IDEMPOTENCY_KEY_CONFLICT", async () => {
    mockCreateBatchJob.mockResolvedValue({
      ok: false,
      error: { code: "IDEMPOTENCY_KEY_CONFLICT", message: "conflict", details: {} },
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(422);
  });

  it("returns 500 on INTERNAL_ERROR", async () => {
    mockCreateBatchJob.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "db error", details: {} },
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(500);
  });
});
