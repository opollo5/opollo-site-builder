import { NextResponse } from "next/server";
import type { ZodError, ZodType } from "zod";
import { logger } from "@/lib/logger";
import {
  errorCodeToStatus,
  type ApiResponse,
  type ToolError,
} from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// Shared HTTP helpers for M1e API routes. Every route is a thin wrapper:
// parse params + body, call the lib layer, return the ApiResponse at the
// matching HTTP status. These helpers keep the boilerplate identical across
// routes so a reader can skim 13 handlers and see the shape immediately.
// ---------------------------------------------------------------------------

// Known Next.js App Router UUID param shape. Matches validateUuidParam.
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function now(): string {
  return new Date().toISOString();
}

// Render an ApiResponse as an HTTP response at the conventional status.
export function respond<T>(result: ApiResponse<T>): NextResponse {
  const status = result.ok ? 200 : errorCodeToStatus(result.error.code);
  if (!result.ok) logger.error("route error response", { code: result.error.code, status });
  return NextResponse.json(result, { status });
}

// Render a standalone validation failure (Zod or hand-authored).
export function validationError(
  message: string,
  details?: Record<string, unknown>,
): NextResponse {
  const body: ToolError = {
    ok: false,
    error: {
      code: "VALIDATION_FAILED",
      message,
      details,
      retryable: false,
      suggested_action: "Correct the listed fields and retry.",
    },
    timestamp: now(),
  };
  return NextResponse.json(body, { status: 400 });
}

// Pull a UUID out of the route params or return a 400. Used by every
// [id]-style dynamic route.
export function validateUuidParam(
  raw: unknown,
  name: string,
):
  | { ok: true; value: string }
  | { ok: false; response: NextResponse } {
  if (typeof raw !== "string" || !UUID_RE.test(raw)) {
    return {
      ok: false,
      response: validationError(
        `Param "${name}" must be a UUID.`,
        { param: name, received: String(raw) },
      ),
    };
  }
  return { ok: true, value: raw };
}

// Safely read the request body as JSON; treat empty bodies as {} so simple
// POST/DELETE signatures don't have to hand-roll their own try/catch.
export async function readJsonBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Parse + validate with a Zod schema. Returns either the parsed data or a
// NextResponse with the standard VALIDATION_FAILED envelope.
export function parseBodyWith<T>(
  schema: ZodType<T>,
  body: unknown,
): { ok: true; data: T } | { ok: false; response: NextResponse } {
  if (body === undefined) {
    return {
      ok: false,
      response: validationError("Request body must be valid JSON."),
    };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: validationError(
        "Request body failed validation.",
        { issues: formatZodIssues(parsed.error) },
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

function formatZodIssues(err: ZodError): Array<{
  path: string;
  code: string;
  message: string;
}> {
  return err.issues.map((i) => ({
    path: i.path.join("."),
    code: i.code,
    message: i.message,
  }));
}

// Race a promise against a timeout; rejects with "Request timed out after Xms"
// if the promise doesn't settle first. Use for external calls (Anthropic, WP,
// Cloudflare) where a hanging request would drain the serverless function pool.
// Suggested ceilings: Anthropic 60 s, WordPress 30 s, Cloudflare 30 s.
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Request timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ]);
}
