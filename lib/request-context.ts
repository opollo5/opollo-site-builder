import { AsyncLocalStorage } from "node:async_hooks";

// ---------------------------------------------------------------------------
// Request-scoped context propagated via AsyncLocalStorage.
//
// The logger (lib/logger.ts) reads these fields and attaches them to
// every JSON log line emitted inside the scope. The M3 batch worker
// plants { job_id, slot_id } before calling processSlot*; Next.js route
// handlers plant { request_id } via withRequestContext in lib/http.ts.
//
// Edge runtime note: node:async_hooks is supported on Vercel's Edge
// runtime as of 2024 (experimental but stable in practice). If we hit
// an Edge surface that rejects it we'll fall back to explicit argument
// threading — not worth the ergonomic hit pre-emptively.
// ---------------------------------------------------------------------------

export interface RequestContext {
  request_id?: string;
  job_id?: string;
  slot_id?: string;
  user_id?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext {
  return storage.getStore() ?? {};
}

export function runWithContext<T>(
  context: RequestContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  const parent = storage.getStore() ?? {};
  return storage.run({ ...parent, ...context }, fn);
}
