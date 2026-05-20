"use client";

// ---------------------------------------------------------------------------
// logClientError — fire-and-forget client-side error sink.
//
// POSTs to POST /api/errors. Always resolves (never throws) — caller should
// not gate on the result. Returns the trace_id so callers can surface it.
// ---------------------------------------------------------------------------

interface LogClientErrorInput {
  component: string;
  severity: "critical" | "error" | "warning" | "info";
  message?: string;
  context?: Record<string, unknown>;
  stack?: string;
  traceId?: string;
  companyId?: string;
}

export async function logClientError(input: LogClientErrorInput): Promise<{ trace_id: string }> {
  const body: Record<string, unknown> = {
    component: input.component,
    severity: input.severity,
  };
  if (input.traceId) body.trace_id = input.traceId;
  if (input.message) body.message = input.message;
  if (input.context) body.context = input.context;
  if (input.stack) body.stack = input.stack;
  if (input.companyId) body.company_id = input.companyId;

  try {
    const res = await fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; data?: { trace_id: string } };
    if (json.ok && json.data?.trace_id) return { trace_id: json.data.trace_id };
  } catch {
    // Logging failure must not surface to users.
  }

  // Fallback: return the input trace_id or a local placeholder.
  return { trace_id: input.traceId ?? "unknown" };
}
