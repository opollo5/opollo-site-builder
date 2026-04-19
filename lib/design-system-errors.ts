import type { ZodError } from "zod";
import type { ApiResponse, ToolError } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// SQLSTATE → ApiResponse mapping for the design-system data layer.
//
// Supabase/PostgREST surface Postgres errors via `.error.code`, which is the
// five-char SQLSTATE. We care about a narrow set:
//   23505 — unique_violation        → UNIQUE_VIOLATION
//   23503 — foreign_key_violation   → FK_VIOLATION
//   23514 — check_violation         → VALIDATION_FAILED (DB-level check)
//   40001 — serialization_failure   → VERSION_CONFLICT (used by our RPC to
//                                     signal optimistic-lock mismatch)
//   P0002 — no_data_found           → NOT_FOUND (RPC raised)
//
// Anything outside this set is treated as INTERNAL_ERROR — genuinely
// unexpected. We log, return 500-ish, and do not retry.
// ---------------------------------------------------------------------------

type SupabaseLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

function now(): string {
  return new Date().toISOString();
}

function toDetails(err: SupabaseLikeError): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (err.code) out.sqlstate = err.code;
  if (err.message) out.pg_message = err.message;
  if (err.details) out.pg_details = err.details;
  if (err.hint) out.pg_hint = err.hint;
  return out;
}

export function notFound(
  resource: string,
  id: string,
): ApiResponse<never> {
  return {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: `${resource} ${id} not found.`,
      details: { resource, id },
      retryable: false,
      suggested_action: "Verify the id. It may have been deleted or never existed.",
    },
    timestamp: now(),
  };
}

export function versionConflict(
  resource: string,
  id: string,
  expected: number,
): ApiResponse<never> {
  return {
    ok: false,
    error: {
      code: "VERSION_CONFLICT",
      message: `${resource} ${id} was modified by another operator. Expected version_lock ${expected} no longer matches.`,
      details: { resource, id, expected_version_lock: expected },
      retryable: false,
      suggested_action:
        "Reload the resource to see the current state, then reapply your change against the new version_lock.",
    },
    timestamp: now(),
  };
}

export function uniqueViolation(
  resource: string,
  pgError: SupabaseLikeError,
): ApiResponse<never> {
  return {
    ok: false,
    error: {
      code: "UNIQUE_VIOLATION",
      message: `${resource} violates a uniqueness constraint.`,
      details: { resource, ...toDetails(pgError) },
      retryable: false,
      suggested_action:
        "A row with these identifying fields already exists. Adjust the input or update the existing row.",
    },
    timestamp: now(),
  };
}

export function fkViolation(
  resource: string,
  pgError: SupabaseLikeError,
): ApiResponse<never> {
  return {
    ok: false,
    error: {
      code: "FK_VIOLATION",
      message: `${resource} references a row that does not exist.`,
      details: { resource, ...toDetails(pgError) },
      retryable: false,
      suggested_action:
        "Check that every referenced id (site_id, design_system_id, template_id, etc.) points to a live row.",
    },
    timestamp: now(),
  };
}

export function checkViolation(
  resource: string,
  pgError: SupabaseLikeError,
): ApiResponse<never> {
  return {
    ok: false,
    error: {
      code: "VALIDATION_FAILED",
      message: `${resource} failed a database-level check constraint.`,
      details: { resource, ...toDetails(pgError) },
      retryable: false,
      suggested_action:
        "Review the input — a field value violates a domain constraint enforced at the DB level.",
    },
    timestamp: now(),
  };
}

export function internalError(
  message: string,
  details?: Record<string, unknown>,
): ApiResponse<never> {
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message,
      details,
      retryable: false,
      suggested_action:
        "Unexpected database error. Check server logs and Supabase connectivity.",
    },
    timestamp: now(),
  };
}

// Map a supabase-js error object to the appropriate ApiResponse. `resource`
// is the logical name for the call site (e.g. "design_system", "component").
export function mapPgError(
  resource: string,
  err: SupabaseLikeError,
): ApiResponse<never> {
  switch (err.code) {
    case "23505":
      return uniqueViolation(resource, err);
    case "23503":
      return fkViolation(resource, err);
    case "23514":
      return checkViolation(resource, err);
    case "40001":
      // RPC's version_lock mismatch. The RPC doesn't know the expected
      // value, so we can't surface it here — callers should use
      // versionConflict() directly when they hold that context.
      return {
        ok: false,
        error: {
          code: "VERSION_CONFLICT",
          message: `${resource} optimistic lock mismatch.`,
          details: { resource, ...toDetails(err) },
          retryable: false,
          suggested_action:
            "Reload the resource to see the current state, then reapply your change against the new version_lock.",
        },
        timestamp: now(),
      };
    case "P0002":
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `${resource} not found.`,
          details: { resource, ...toDetails(err) },
          retryable: false,
          suggested_action:
            "Verify the id. It may have been deleted or never existed.",
        },
        timestamp: now(),
      };
    default:
      return internalError(
        `Unexpected database error on ${resource}: ${err.message ?? "unknown"}`,
        toDetails(err),
      );
  }
}

// Standardised Zod-failure response. Used at the top of every CRUD function
// before we touch the database.
export function validationFailed(
  resource: string,
  zodErr: ZodError,
): ApiResponse<never> {
  return {
    ok: false,
    error: {
      code: "VALIDATION_FAILED",
      message: `Input for ${resource} failed validation.`,
      details: {
        resource,
        issues: zodErr.issues.map((i) => ({
          path: i.path.join("."),
          code: i.code,
          message: i.message,
        })),
      },
      retryable: false,
      suggested_action:
        "Correct the listed fields and retry. See `details.issues` for the specific failures.",
    },
    timestamp: now(),
  };
}

// Wrap unexpected throws from an impl function in a uniform INTERNAL_ERROR
// envelope. Mirrors the pattern in lib/sites.ts.
export async function guardImpl<T>(
  resource: string,
  impl: () => Promise<ApiResponse<T>>,
): Promise<ApiResponse<T>> {
  try {
    return await impl();
  } catch (err) {
    return internalError(
      `Unhandled error in ${resource}: ${err instanceof Error ? err.message : String(err)}`,
    ) as ToolError;
  }
}
