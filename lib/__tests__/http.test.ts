import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  conflict,
  forbidden,
  internalError,
  invalidState,
  notFound,
  parseBodyWith,
  readJsonBody,
  respond,
  routeError,
  validateUuidParam,
  validationError,
  withTimeout,
} from "@/lib/http";

// ---------------------------------------------------------------------------
// M15-6 #20 — lib/http.ts unit tests.
//
// lib/http is now the central request/response utility for every route.
// It replaced ~30 local `errorJson()` helpers during the M15-4 #14 sweep.
// These tests pin the HTTP status, error code, and body shape for each
// helper so a future refactor has a signal before it reaches CI route tests.
//
// Note: this file lives in lib/__tests__/ to share the vitest.config.ts
// setup, but none of the helpers under test require Supabase.
// ---------------------------------------------------------------------------

// Pull JSON out of a Response/NextResponse — both implement the Fetch API
// Response interface in Node 18+, so .json() works without a mock.
async function json(res: Response): Promise<unknown> {
  return res.json();
}

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const INVALID_UUID_STRINGS = ["not-a-uuid", "", "123", null, undefined, 42];

// ---------------------------------------------------------------------------
// Named error helpers
// ---------------------------------------------------------------------------

describe("validationError", () => {
  it("returns 400 with VALIDATION_FAILED code", async () => {
    const res = validationError("Name is required.");
    expect(res.status).toBe(400);
    const body = (await json(res)) as {
      ok: boolean;
      error: { code: string; message: string; retryable: boolean };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.message).toBe("Name is required.");
    expect(body.error.retryable).toBe(false);
  });

  it("includes details when provided", async () => {
    const res = validationError("Bad input.", { field: "email" });
    const body = (await json(res)) as { error: { details: unknown } };
    expect(body.error.details).toEqual({ field: "email" });
  });

  it("omits details when not provided", async () => {
    const res = validationError("Required.");
    const body = (await json(res)) as { error: { details?: unknown } };
    expect(body.error.details).toBeUndefined();
  });
});

describe("notFound", () => {
  it("returns 404 with NOT_FOUND", async () => {
    const res = notFound("Resource not found.");
    expect(res.status).toBe(404);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("internalError", () => {
  it("returns 500 with INTERNAL_ERROR", async () => {
    const res = internalError("Something went wrong.");
    expect(res.status).toBe(500);
    const body = (await json(res)) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Something went wrong.");
  });
});

describe("forbidden", () => {
  it("returns 403 with FORBIDDEN", async () => {
    const res = forbidden("Insufficient permissions.");
    expect(res.status).toBe(403);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

describe("invalidState", () => {
  it("returns 409 with INVALID_STATE", async () => {
    const res = invalidState("Cannot perform this action in current state.");
    expect(res.status).toBe(409);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_STATE");
  });
});

describe("conflict", () => {
  it("returns 409 for ALREADY_EXISTS with the supplied message", async () => {
    const res = conflict("ALREADY_EXISTS", "Slug taken.");
    expect(res.status).toBe(409);
    const body = (await json(res)) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("ALREADY_EXISTS");
    expect(body.error.message).toBe("Slug taken.");
  });

  it("includes details when provided", async () => {
    const res = conflict("ALREADY_EXISTS", "Email taken.", { email: "a@b.com" });
    const body = (await json(res)) as { error: { details: unknown } };
    expect(body.error.details).toEqual({ email: "a@b.com" });
  });

  it("uses errorCodeToStatus for codes with a non-409 mapping", async () => {
    // BUDGET_EXCEEDED maps to 429 (rate-limit / budget family).
    const res = conflict("BUDGET_EXCEEDED", "Over budget.");
    expect(res.status).toBe(429);
  });
});

describe("routeError", () => {
  it("returns the correct status for NOT_FOUND", async () => {
    const res = routeError("NOT_FOUND", "Page gone.");
    expect(res.status).toBe(404);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 500 for INTERNAL_ERROR", async () => {
    const res = routeError("INTERNAL_ERROR", "Unexpected.");
    expect(res.status).toBe(500);
  });

  it("includes optional details", async () => {
    const res = routeError("VALIDATION_FAILED", "Bad.", { hint: "check x" });
    const body = (await json(res)) as { error: { details: unknown } };
    expect(body.error.details).toEqual({ hint: "check x" });
  });
});

// ---------------------------------------------------------------------------
// respond — ApiResponse → HTTP response
// ---------------------------------------------------------------------------

describe("respond", () => {
  it("returns 200 with body intact for ok:true", async () => {
    const result = {
      ok: true as const,
      data: { id: "abc", value: 42 },
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    const res = respond(result);
    expect(res.status).toBe(200);
    const body = (await json(res)) as typeof result;
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe("abc");
  });

  it("maps NOT_FOUND to 404 for ok:false", async () => {
    const result = {
      ok: false as const,
      error: {
        code: "NOT_FOUND" as const,
        message: "Missing.",
        retryable: false,
        suggested_action: "Check the ID.",
      },
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    const res = respond(result);
    expect(res.status).toBe(404);
  });

  it("maps VALIDATION_FAILED to 400 for ok:false", async () => {
    const result = {
      ok: false as const,
      error: {
        code: "VALIDATION_FAILED" as const,
        message: "Bad input.",
        retryable: false,
        suggested_action: "Fix and retry.",
      },
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    expect(respond(result).status).toBe(400);
  });

  it("maps INTERNAL_ERROR to 500 for ok:false", async () => {
    const result = {
      ok: false as const,
      error: {
        code: "INTERNAL_ERROR" as const,
        message: "Oops.",
        retryable: false,
        suggested_action: "Retry.",
      },
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    expect(respond(result).status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// validateUuidParam
// ---------------------------------------------------------------------------

describe("validateUuidParam", () => {
  it("returns ok:true for a valid UUID v4", () => {
    const result = validateUuidParam(VALID_UUID, "id");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(VALID_UUID);
  });

  it("accepts uppercase UUID characters (case-insensitive regex)", () => {
    const upper = VALID_UUID.toUpperCase();
    const result = validateUuidParam(upper, "id");
    expect(result.ok).toBe(true);
  });

  it.each(INVALID_UUID_STRINGS)(
    "returns ok:false with 400 for invalid input %j",
    async (raw) => {
      const result = validateUuidParam(raw, "siteId");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(400);
        const body = (await json(result.response)) as {
          error: { code: string; details: { param: string } };
        };
        expect(body.error.code).toBe("VALIDATION_FAILED");
        expect(body.error.details.param).toBe("siteId");
      }
    },
  );
});

// ---------------------------------------------------------------------------
// readJsonBody
// ---------------------------------------------------------------------------

describe("readJsonBody", () => {
  function makeRequest(body: string): Request {
    return new Request("http://localhost/test", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("parses a valid JSON object", async () => {
    const req = makeRequest('{"name":"test","count":3}');
    const body = await readJsonBody(req);
    expect(body).toEqual({ name: "test", count: 3 });
  });

  it("parses a valid JSON array", async () => {
    const req = makeRequest('[1,2,3]');
    const body = await readJsonBody(req);
    expect(body).toEqual([1, 2, 3]);
  });

  it("returns {} for an empty body", async () => {
    const req = makeRequest("");
    const body = await readJsonBody(req);
    expect(body).toEqual({});
  });

  it("returns undefined for malformed JSON", async () => {
    const req = makeRequest("not-valid-json");
    const body = await readJsonBody(req);
    expect(body).toBeUndefined();
  });

  it("returns undefined for partial JSON", async () => {
    const req = makeRequest('{"key":');
    const body = await readJsonBody(req);
    expect(body).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseBodyWith
// ---------------------------------------------------------------------------

describe("parseBodyWith", () => {
  const schema = z.object({
    name: z.string().min(1),
    count: z.number().int().positive(),
  });

  it("returns ok:true with typed data for a conforming body", () => {
    const result = parseBodyWith(schema, { name: "Alice", count: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe("Alice");
      expect(result.data.count).toBe(5);
    }
  });

  it("returns ok:false with 400 when body is undefined (JSON parse failure signal)", async () => {
    const result = parseBodyWith(schema, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = (await json(result.response)) as { error: { message: string } };
      expect(body.error.message).toMatch(/json/i);
    }
  });

  it("returns ok:false with 400 and Zod issues for a schema violation", async () => {
    const result = parseBodyWith(schema, { name: "", count: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = (await json(result.response)) as {
        error: { details: { issues: Array<{ path: string; message: string }> } };
      };
      expect(body.error.details.issues.length).toBeGreaterThan(0);
    }
  });

  it("returns ok:false with 400 for missing required fields", async () => {
    const result = parseBodyWith(schema, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------

describe("withTimeout", () => {
  it("resolves with the promise value when it settles before the deadline", async () => {
    const result = await withTimeout(Promise.resolve("done"), 500);
    expect(result).toBe("done");
  });

  it("rejects with a timeout error when the promise hangs past the deadline", async () => {
    const hanging = new Promise<never>(() => undefined);
    await expect(withTimeout(hanging, 20)).rejects.toThrow(/timed out/i);
  });

  it("propagates promise rejections normally (not as a timeout)", async () => {
    const failing = Promise.reject(new Error("original error"));
    await expect(withTimeout(failing, 500)).rejects.toThrow("original error");
  });
});
