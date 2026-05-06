import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  checkViolation,
  fkViolation,
  guardImpl,
  internalError,
  mapPgError,
  notFound,
  uniqueViolation,
  validationFailed,
  versionConflict,
} from "@/lib/design-system-errors";

// ---------------------------------------------------------------------------
// M15-6 #21 — lib/design-system-errors.ts unit tests.
//
// This module is the SQLSTATE → ApiResponse mapping layer shared by every
// design-system CRUD function. Testing it pins:
//   1. The error code for each SQLSTATE so a refactor doesn't silently
//      reclassify a version_lock collision as an internal error.
//   2. The mapPgError switch so new SQLSTATE additions don't fall through
//      to the generic internal-error path accidentally.
//   3. guardImpl's try/catch so an unexpected throw is always wrapped in
//      INTERNAL_ERROR rather than letting the caller surface a stack trace.
// ---------------------------------------------------------------------------

const PG_ERR = {
  code: "23505",
  message: "Key (slug)=(my-slug) already exists.",
  details: 'Key (slug)=(my-slug) already exists.',
  hint: null,
};

// ---------------------------------------------------------------------------
// Named factory helpers
// ---------------------------------------------------------------------------

describe("notFound", () => {
  it("returns NOT_FOUND with the resource + id in the message and details", () => {
    const res = notFound("design_system", "ds-1");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("NOT_FOUND");
      expect(res.error.message).toContain("design_system");
      expect(res.error.message).toContain("ds-1");
      expect(res.error.details).toMatchObject({ resource: "design_system", id: "ds-1" });
    }
  });
});

describe("versionConflict", () => {
  it("returns VERSION_CONFLICT with resource + expected_version_lock in details", () => {
    const res = versionConflict("component", "comp-42", 7);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("VERSION_CONFLICT");
      expect(res.error.message).toContain("comp-42");
      expect(res.error.details).toMatchObject({
        resource: "component",
        id: "comp-42",
        expected_version_lock: 7,
      });
    }
  });
});

describe("uniqueViolation", () => {
  it("returns UNIQUE_VIOLATION with pg error details", () => {
    const res = uniqueViolation("template", PG_ERR);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("UNIQUE_VIOLATION");
      expect(res.error.details).toMatchObject({
        resource: "template",
        sqlstate: "23505",
        pg_message: expect.stringContaining("my-slug"),
      });
    }
  });

  it("omits null-ish fields from pg error details", () => {
    const res = uniqueViolation("ds", { code: "23505", message: "dup" });
    if (!res.ok) {
      expect(res.error.details).not.toHaveProperty("pg_hint");
      expect(res.error.details).not.toHaveProperty("pg_details");
    }
  });
});

describe("fkViolation", () => {
  it("returns FK_VIOLATION with pg error details", () => {
    const err = { code: "23503", message: "FK constraint failed" };
    const res = fkViolation("component", err);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("FK_VIOLATION");
      expect(res.error.details).toMatchObject({ resource: "component", sqlstate: "23503" });
    }
  });
});

describe("checkViolation", () => {
  it("returns VALIDATION_FAILED for a DB-level check violation", () => {
    const err = { code: "23514", message: "version_lock must be >= 1" };
    const res = checkViolation("design_system", err);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("VALIDATION_FAILED");
      expect(res.error.details).toMatchObject({ sqlstate: "23514" });
    }
  });
});

describe("internalError", () => {
  it("returns INTERNAL_ERROR with the supplied message", () => {
    const res = internalError("DB connection lost");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("INTERNAL_ERROR");
      expect(res.error.message).toBe("DB connection lost");
    }
  });

  it("includes optional details", () => {
    const res = internalError("Query failed", { table: "design_systems" });
    if (!res.ok) {
      expect(res.error.details).toEqual({ table: "design_systems" });
    }
  });

  it("omits details when not provided", () => {
    const res = internalError("Oops");
    if (!res.ok) expect(res.error.details).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mapPgError — SQLSTATE routing
// ---------------------------------------------------------------------------

describe("mapPgError", () => {
  it("maps 23505 to UNIQUE_VIOLATION", () => {
    const res = mapPgError("template", { code: "23505", message: "dup key" });
    if (!res.ok) expect(res.error.code).toBe("UNIQUE_VIOLATION");
  });

  it("maps 23503 to FK_VIOLATION", () => {
    const res = mapPgError("component", { code: "23503", message: "fk" });
    if (!res.ok) expect(res.error.code).toBe("FK_VIOLATION");
  });

  it("maps 23514 to VALIDATION_FAILED", () => {
    const res = mapPgError("design_system", { code: "23514", message: "check" });
    if (!res.ok) expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("maps PT409 to VERSION_CONFLICT (RPC optimistic-lock code)", () => {
    const res = mapPgError("design_system", { code: "PT409", message: "lock" });
    if (!res.ok) expect(res.error.code).toBe("VERSION_CONFLICT");
  });

  it("maps 40001 to VERSION_CONFLICT (legacy serialisation failure alias)", () => {
    const res = mapPgError("design_system", { code: "40001", message: "serial" });
    if (!res.ok) expect(res.error.code).toBe("VERSION_CONFLICT");
  });

  it("maps P0002 to NOT_FOUND (RPC no_data_found)", () => {
    const res = mapPgError("template", { code: "P0002", message: "row not found" });
    if (!res.ok) expect(res.error.code).toBe("NOT_FOUND");
  });

  it("maps unknown SQLSTATE codes to INTERNAL_ERROR", () => {
    const res = mapPgError("design_system", { code: "99999", message: "unknown" });
    if (!res.ok) expect(res.error.code).toBe("INTERNAL_ERROR");
  });

  it("maps null code to INTERNAL_ERROR", () => {
    const res = mapPgError("design_system", { code: null, message: "no code" });
    if (!res.ok) expect(res.error.code).toBe("INTERNAL_ERROR");
  });
});

// ---------------------------------------------------------------------------
// validationFailed — Zod issue formatting
// ---------------------------------------------------------------------------

describe("validationFailed", () => {
  const schema = z.object({
    name: z.string().min(1),
    version: z.number().positive(),
  });

  it("returns VALIDATION_FAILED with formatted Zod issues", () => {
    const parseResult = schema.safeParse({ name: "", version: -1 });
    expect(parseResult.success).toBe(false);
    if (!parseResult.success) {
      const res = validationFailed("design_system", parseResult.error);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("VALIDATION_FAILED");
        expect(res.error.message).toContain("design_system");
        const details = res.error.details as {
          issues: Array<{ path: string; code: string; message: string }>;
        };
        expect(details.issues.length).toBeGreaterThan(0);
        expect(details.issues[0]).toHaveProperty("path");
        expect(details.issues[0]).toHaveProperty("code");
        expect(details.issues[0]).toHaveProperty("message");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// guardImpl — try/catch wrapper
// ---------------------------------------------------------------------------

describe("guardImpl", () => {
  it("returns the successful ApiResponse when impl resolves", async () => {
    const result = await guardImpl("component", async () => ({
      ok: true as const,
      data: { id: "c1" },
      timestamp: "2026-01-01T00:00:00.000Z",
    }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe("c1");
  });

  it("returns INTERNAL_ERROR when impl throws an Error", async () => {
    const result = await guardImpl("template", async () => {
      throw new Error("DB timeout");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.error.message).toContain("DB timeout");
    }
  });

  it("returns INTERNAL_ERROR when impl throws a non-Error", async () => {
    const result = await guardImpl("design_system", async () => {
      throw "string error"; // non-Error throw for defensive coverage
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.error.message).toContain("string error");
    }
  });

  it("passes through ok:false results from impl unchanged", async () => {
    const result = await guardImpl("component", async () =>
      notFound("component", "c-99"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });
});
