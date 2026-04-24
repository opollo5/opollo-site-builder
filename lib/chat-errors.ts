import type { APIError } from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// M15-4 — chat streaming error sanitization.
//
// The chat route runs a Server-Sent Events stream. When it throws mid-stream,
// we need to (a) log the full diagnostic to our own logger so operators can
// investigate, and (b) tell the browser client that something broke. The
// browser payload must NOT contain the raw error message, the raw Anthropic
// API error body, or any stack trace — those surfaces leak infrastructure
// detail (model names, quota state, schema names, internal file paths) to
// every chat user, including non-admins.
//
// The safe payload only carries an opaque error code, a static user-facing
// message, and our internal request_id so support can correlate the browser
// complaint with the server log entry. See docs/ENDPOINT_AUDIT_2026-04-24.md
// finding #1 for the leak that triggered this.
//
// Design note: `buildSafeSseErrorPayload` INTENTIONALLY does not accept the
// error. That makes it structurally impossible for a future change to
// accidentally pipe err.message into the response — the function has
// nothing to pipe. The diagnostic is produced separately by
// `buildChatErrorDiagnostic` and is consumed only by the logger.
// ---------------------------------------------------------------------------

export const SAFE_CHAT_ERROR_CODE = "INTERNAL_ERROR" as const;

export const SAFE_CHAT_ERROR_MESSAGE =
  "The chat service encountered an internal error. Please try again. " +
  "If the problem persists, reference this request id when contacting support.";

export interface ChatErrorDiagnostic {
  model: string;
  message: string;
  name: string | undefined;
  status: number | undefined;
  anthropic_request_id: string | undefined;
  body: unknown;
  stack: string | undefined;
  // Index signature so logger.error (which expects Record<string, unknown>)
  // can accept this object without a cast.
  [key: string]: unknown;
}

export interface SafeChatSseErrorPayload {
  code: typeof SAFE_CHAT_ERROR_CODE;
  message: string;
  request_id: string | null;
}

/**
 * Build the full diagnostic object for the server-side logger. Includes every
 * piece of context that helps an operator debug the failure — raw error
 * message, error class name, Anthropic API status + request id, raw API
 * error body, and the stack trace.
 *
 * This output MUST NOT reach the browser. It is consumed exclusively by
 * `logger.error(...)`, which writes to stdout + (optionally) Axiom.
 */
export function buildChatErrorDiagnostic(
  err: unknown,
  model: string,
  anthropicErr: APIError | null,
): ChatErrorDiagnostic {
  return {
    model,
    message: err instanceof Error ? err.message : String(err),
    name: err instanceof Error ? err.name : undefined,
    status: anthropicErr?.status,
    anthropic_request_id: anthropicErr?.requestID ?? undefined,
    body: anthropicErr?.error,
    stack: err instanceof Error ? err.stack : undefined,
  };
}

/**
 * Build the SSE error payload the browser receives. Takes ONLY the
 * request_id — intentionally does not accept the error itself. The payload
 * is constant-shape across every failure mode: one opaque code, one static
 * message, one request_id for correlation.
 *
 * The request_id is the same id middleware stamps on every response as
 * `x-request-id`; clients can read it from the SSE body or the response
 * header to file a support request.
 */
export function buildSafeSseErrorPayload(
  requestId: string | null,
): SafeChatSseErrorPayload {
  return {
    code: SAFE_CHAT_ERROR_CODE,
    message: SAFE_CHAT_ERROR_MESSAGE,
    request_id: requestId,
  };
}
