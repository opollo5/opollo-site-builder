import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// M14-1 — POST /api/ops/reset-admin-password.
//
// Unit-level test — mocks the service-role client end to end. No
// Supabase instance required. Matrix:
//
//   1. OPOLLO_EMERGENCY_KEY unset / too short → 503.
//   2. Missing / wrong key → 401.
//   3. Malformed body (bad email, short password, missing fields) → 400.
//   4. Target email not found in opollo_users → 404.
//   5. Target found but role != admin → 403.
//   6. Supabase lookup errors → 500.
//   7. supabase.auth.admin.updateUserById errors → 500.
//   8. Happy path → 200 with single updateUserById call.
//   9. Password never appears in logger invocations.
//  10. Email is normalised to lowercase before the auth admin call.
// ---------------------------------------------------------------------------

type OpolloUserRow = {
  id: string;
  role: string;
  revoked_at: string | null;
};

type LookupResult = {
  data: OpolloUserRow | null;
  error: { message: string } | null;
};

type UpdateResult = {
  error: { message: string } | null;
};

const mockState = vi.hoisted(() => ({
  lookupResult: null as LookupResult | null,
  lookupCalls: [] as Array<{ column: string; value: string }>,
  selectColumns: [] as string[],
  isCalls: [] as Array<{ column: string; value: unknown }>,
  updateResult: { error: null } as UpdateResult,
  updateCalls: [] as Array<{ userId: string; attributes: { password: string } }>,
}));

// Columns actually present on opollo_users as of migration 0006.
// If the route .select()s or .is()-filters on anything outside this
// set, the mock fails loudly — a unit-level tripwire for the
// "queries a column the table doesn't have" class of bug that
// shipped in the original M14-1 and only surfaced in production.
const OPOLLO_USERS_COLUMNS = new Set([
  "id",
  "email",
  "display_name",
  "role",
  "created_at",
  "revoked_at",
]);

function assertValidColumnList(cols: string): void {
  for (const col of cols.split(",").map((c) => c.trim()).filter(Boolean)) {
    if (!OPOLLO_USERS_COLUMNS.has(col)) {
      throw new Error(
        `reset-admin-password.test: route selected non-existent opollo_users column "${col}". ` +
          `Valid columns: ${[...OPOLLO_USERS_COLUMNS].join(", ")}.`,
      );
    }
  }
}

function assertValidColumn(col: string): void {
  if (!OPOLLO_USERS_COLUMNS.has(col)) {
    throw new Error(
      `reset-admin-password.test: route filtered on non-existent opollo_users column "${col}". ` +
        `Valid columns: ${[...OPOLLO_USERS_COLUMNS].join(", ")}.`,
    );
  }
}

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from(_table: string) {
      return {
        select(cols: string) {
          mockState.selectColumns.push(cols);
          assertValidColumnList(cols);
          return {
            eq(column: string, value: string) {
              assertValidColumn(column);
              mockState.lookupCalls.push({ column, value });
              return {
                is(col: string, val: unknown) {
                  assertValidColumn(col);
                  mockState.isCalls.push({ column: col, value: val });
                  return {
                    maybeSingle: async () => {
                      if (!mockState.lookupResult) {
                        throw new Error(
                          "reset-admin-password.test: lookupResult not set",
                        );
                      }
                      return mockState.lookupResult;
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    auth: {
      admin: {
        updateUserById: async (
          userId: string,
          attributes: { password: string },
        ): Promise<UpdateResult> => {
          mockState.updateCalls.push({ userId, attributes });
          return mockState.updateResult;
        },
      },
    },
  }),
}));

const loggerCalls = vi.hoisted(() => ({
  info: [] as Array<[string, Record<string, unknown> | undefined]>,
  warn: [] as Array<[string, Record<string, unknown> | undefined]>,
  error: [] as Array<[string, Record<string, unknown> | undefined]>,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: (_msg: string, _fields?: Record<string, unknown>) => {},
    info: (msg: string, fields?: Record<string, unknown>) => {
      loggerCalls.info.push([msg, fields]);
    },
    warn: (msg: string, fields?: Record<string, unknown>) => {
      loggerCalls.warn.push([msg, fields]);
    },
    error: (msg: string, fields?: Record<string, unknown>) => {
      loggerCalls.error.push([msg, fields]);
    },
  },
}));

import { POST as resetAdminPasswordPOST } from "@/app/api/ops/reset-admin-password/route";

const KEY_32 = "0123456789abcdef0123456789abcdef";
const WRONG_KEY_32 = "ffffffffffffffffffffffffffffffff";
const VALID_PASSWORD = "correct-horse-battery-staple";

const ADMIN_UUID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

function makeRequest(
  body: unknown,
  init?: { key?: string; auth?: "custom" | "bearer" },
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (init?.key) {
    if (init.auth === "bearer") {
      headers["authorization"] = `Bearer ${init.key}`;
    } else {
      headers["x-opollo-emergency-key"] = init.key;
    }
  }
  return new Request(
    "http://localhost:3000/api/ops/reset-admin-password",
    {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}

const originalEnvKey = process.env.OPOLLO_EMERGENCY_KEY;

beforeEach(() => {
  mockState.lookupResult = {
    data: {
      id: ADMIN_UUID,
      role: "admin",
      revoked_at: null,
    },
    error: null,
  };
  mockState.lookupCalls = [];
  mockState.selectColumns = [];
  mockState.isCalls = [];
  mockState.updateResult = { error: null };
  mockState.updateCalls = [];
  loggerCalls.info.length = 0;
  loggerCalls.warn.length = 0;
  loggerCalls.error.length = 0;
});

afterEach(() => {
  if (originalEnvKey === undefined) {
    delete process.env.OPOLLO_EMERGENCY_KEY;
  } else {
    process.env.OPOLLO_EMERGENCY_KEY = originalEnvKey;
  }
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Auth surface
// ---------------------------------------------------------------------------

describe("POST /api/ops/reset-admin-password: authentication", () => {
  it("returns 503 when OPOLLO_EMERGENCY_KEY is unset", async () => {
    delete process.env.OPOLLO_EMERGENCY_KEY;
    const res = await resetAdminPasswordPOST(
      makeRequest(
        { email: "hi@opollo.com", new_password: VALID_PASSWORD },
        { key: KEY_32 },
      ),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("EMERGENCY_NOT_CONFIGURED");
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it("returns 503 when OPOLLO_EMERGENCY_KEY is shorter than 32 chars", async () => {
    process.env.OPOLLO_EMERGENCY_KEY = "too-short";
    const res = await resetAdminPasswordPOST(
      makeRequest(
        { email: "hi@opollo.com", new_password: VALID_PASSWORD },
        { key: "too-short" },
      ),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("EMERGENCY_NOT_CONFIGURED");
  });

  it("returns 401 when no key header is present", async () => {
    process.env.OPOLLO_EMERGENCY_KEY = KEY_32;
    const res = await resetAdminPasswordPOST(
      makeRequest({ email: "hi@opollo.com", new_password: VALID_PASSWORD }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when the key is wrong (same length)", async () => {
    process.env.OPOLLO_EMERGENCY_KEY = KEY_32;
    const res = await resetAdminPasswordPOST(
      makeRequest(
        { email: "hi@opollo.com", new_password: VALID_PASSWORD },
        { key: WRONG_KEY_32 },
      ),
    );
    expect(res.status).toBe(401);
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it("returns 401 when the key is wrong (different length)", async () => {
    process.env.OPOLLO_EMERGENCY_KEY = KEY_32;
    const res = await resetAdminPasswordPOST(
      makeRequest(
        { email: "hi@opollo.com", new_password: VALID_PASSWORD },
        { key: `${KEY_32}-extra` },
      ),
    );
    expect(res.status).toBe(401);
  });

  it("accepts the key via Authorization: Bearer", async () => {
    process.env.OPOLLO_EMERGENCY_KEY = KEY_32;
    const res = await resetAdminPasswordPOST(
      makeRequest(
        { email: "hi@opollo.com", new_password: VALID_PASSWORD },
        { key: KEY_32, auth: "bearer" },
      ),
    );
    expect(res.status).toBe(200);
    expect(mockState.updateCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Body validation
// ---------------------------------------------------------------------------

describe("POST /api/ops/reset-admin-password: validation", () => {
  beforeEach(() => {
    process.env.OPOLLO_EMERGENCY_KEY = KEY_32;
  });

  it("returns 400 when body has no email", async () => {
    const res = await resetAdminPasswordPOST(
      makeRequest({ new_password: VALID_PASSWORD }, { key: KEY_32 }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 when body has no new_password", async () => {
    const res = await resetAdminPasswordPOST(
      makeRequest({ email: "hi@opollo.com" }, { key: KEY_32 }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when email is malformed", async () => {
    const res = await resetAdminPasswordPOST(
      makeRequest(
        { email: "not-an-email", new_password: VALID_PASSWORD },
        { key: KEY_32 },
      ),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when new_password is shorter than 12 chars", async () => {
    const res = await resetAdminPasswordPOST(
      makeRequest(
        { email: "hi@opollo.com", new_password: "short-11-ch" },
        { key: KEY_32 },
      ),
    );
    expect(res.status).toBe(400);
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it("returns 400 when body is not JSON", async () => {
    const req = new Request(
      "http://localhost:3000/api/ops/reset-admin-password",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opollo-emergency-key": KEY_32,
        },
        body: "not-json",
      },
    );
    const res = await resetAdminPasswordPOST(req);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Target guard
// ---------------------------------------------------------------------------

describe("POST /api/ops/reset-admin-password: target guard", () => {
  beforeEach(() => {
    process.env.OPOLLO_EMERGENCY_KEY = KEY_32;
  });

  it("returns 404 when no opollo_users row matches the email", async () => {
    mockState.lookupResult = { data: null, error: null };
    const res = await resetAdminPasswordPOST(
      makeRequest(
        { email: "ghost@opollo.com", new_password: VALID_PASSWORD },
        { key: KEY_32 },
      ),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it("returns 403 when the matching user is an operator", async () => {
    mockState.lookupResult = {
      data: { id: ADMIN_UUID, role: "admin", revoked_at: null },
      error: null,
    };
    const res = await resetAdminPasswordPOST(
      makeRequest(
        { email: "op@opollo.com", new_password: VALID_PASSWORD },
        { key: KEY_32 },
      ),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it("returns 403 when the matching user is a viewer", async () => {
    mockState.lookupResult = {
      data: { id: ADMIN_UUID, role: "user", revoked_at: null },
      error: null,
    };
    const res = await resetAdminPasswordPOST(
      makeRequest(
        { email: "v@opollo.com", new_password: VALID_PASSWORD },
        { key: KEY_32 },
      ),
    );
    expect(res.status).toBe(403);
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it("normalises email to lowercase for the opollo_users lookup", async () => {
    const res = await resetAdminPasswordPOST(
      makeRequest(
        { email: "HI@Opollo.COM", new_password: VALID_PASSWORD },
        { key: KEY_32 },
      ),
    );
    expect(res.status).toBe(200);
    expect(mockState.lookupCalls).toEqual([
      { column: "email", value: "hi@opollo.com" },
    ]);
  });

  it("filters on revoked_at (not deleted_at) — opollo_users has no soft-delete column", async () => {
    // Regression pin: the original M14-1 shipped a query against
    // opollo_users.deleted_at which is not a column on that table
    // (soft-delete is scoped to mutable content tables per BACKLOG
    // schema-hygiene). The mock's `assertValidColumn` fails the
    // test if any non-existent column is ever selected or filtered.
    await resetAdminPasswordPOST(
      makeRequest(
        { email: "hi@opollo.com", new_password: VALID_PASSWORD },
        { key: KEY_32 },
      ),
    );
    expect(mockState.isCalls).toEqual([
      { column: "revoked_at", value: null },
    ]);
    expect(mockState.selectColumns).toEqual(["id, role, revoked_at"]);
  });
});

describe("POST /api/ops/reset-admin-password: revoked admin is refused", () => {
  beforeEach(() => {
    process.env.OPOLLO_EMERGENCY_KEY = KEY_32;
  });

  it("returns 404 when the matching admin has a non-null revoked_at", async () => {
    // The route filters `.is('revoked_at', null)` at the query layer,
    // so a revoked admin surfaces as "no matching row" → NOT_FOUND.
    // Simulates that by returning `data: null` from the mock — the
    // same shape Supabase returns when the .is() predicate excludes
    // every row.
    mockState.lookupResult = { data: null, error: null };
    const res = await resetAdminPasswordPOST(
      makeRequest(
        { email: "revoked-admin@opollo.com", new_password: VALID_PASSWORD },
        { key: KEY_32 },
      ),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(mockState.updateCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Supabase failures
// ---------------------------------------------------------------------------

describe("POST /api/ops/reset-admin-password: supabase errors", () => {
  beforeEach(() => {
    process.env.OPOLLO_EMERGENCY_KEY = KEY_32;
  });

  it("returns 500 when the opollo_users lookup errors", async () => {
    mockState.lookupResult = {
      data: null,
      error: { message: "connection reset" },
    };
    const res = await resetAdminPasswordPOST(
      makeRequest(
        { email: "hi@opollo.com", new_password: VALID_PASSWORD },
        { key: KEY_32 },
      ),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.retryable).toBe(true);
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it("returns 500 when supabase.auth.admin.updateUserById errors", async () => {
    mockState.updateResult = { error: { message: "auth service down" } };
    const res = await resetAdminPasswordPOST(
      makeRequest(
        { email: "hi@opollo.com", new_password: VALID_PASSWORD },
        { key: KEY_32 },
      ),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(mockState.updateCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("POST /api/ops/reset-admin-password: happy path", () => {
  beforeEach(() => {
    process.env.OPOLLO_EMERGENCY_KEY = KEY_32;
  });

  it("returns 200 and calls updateUserById exactly once with the new password", async () => {
    const res = await resetAdminPasswordPOST(
      makeRequest(
        { email: "hi@opollo.com", new_password: VALID_PASSWORD },
        { key: KEY_32 },
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.email).toBe("hi@opollo.com");
    expect(body.data.user_id).toBe(ADMIN_UUID);

    expect(mockState.updateCalls).toHaveLength(1);
    expect(mockState.updateCalls[0]).toEqual({
      userId: ADMIN_UUID,
      attributes: { password: VALID_PASSWORD },
    });
  });

  it("never logs the password in any logger invocation", async () => {
    await resetAdminPasswordPOST(
      makeRequest(
        { email: "hi@opollo.com", new_password: VALID_PASSWORD },
        { key: KEY_32 },
      ),
    );

    const allLogPayloads = [
      ...loggerCalls.info,
      ...loggerCalls.warn,
      ...loggerCalls.error,
    ];
    expect(allLogPayloads.length).toBeGreaterThan(0);

    const serialised = JSON.stringify(allLogPayloads);
    expect(serialised).not.toContain(VALID_PASSWORD);
  });

  it("emits a success log entry with email and user_id (no password)", async () => {
    await resetAdminPasswordPOST(
      makeRequest(
        { email: "hi@opollo.com", new_password: VALID_PASSWORD },
        { key: KEY_32 },
      ),
    );
    const success = loggerCalls.info.find(
      ([msg]) => msg === "ops_reset_admin_password_success",
    );
    expect(success).toBeDefined();
    const [, fields] = success as [string, Record<string, unknown>];
    expect(fields).toMatchObject({
      email: "hi@opollo.com",
      user_id: ADMIN_UUID,
      outcome: "reset",
    });
    expect(Object.values(fields as Record<string, unknown>)).not.toContain(
      VALID_PASSWORD,
    );
  });
});

