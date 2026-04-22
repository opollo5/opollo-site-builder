import { Langfuse } from "langfuse";

// ---------------------------------------------------------------------------
// M10 — Langfuse LLM observability.
//
// Thin wrapper over the Langfuse SDK, gated on the three env vars so
// tests + dev without a project run pure-no-op. Surface:
//
//   getLangfuseClient() → Langfuse | null
//     Lazy singleton. Null when env isn't set; otherwise a client
//     reused across calls so spans can link into the same trace when
//     the caller threads a trace id.
//
//   flushLangfuse() → Promise<void>
//     Awaits in-flight event posts. Called by the self-probe route
//     so the verification waits for ingest confirmation rather than
//     returning before the trace is visible.
//
// Integration pattern: the Anthropic wrapper (lib/anthropic-call.ts)
// wraps each generation call in a trace. The production default path
// handles this automatically; test stubs stay Langfuse-free.
// ---------------------------------------------------------------------------

let cachedClient: Langfuse | null | undefined = undefined;

export function getLangfuseClient(): Langfuse | null {
  if (cachedClient !== undefined) return cachedClient;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    cachedClient = null;
    return null;
  }
  cachedClient = new Langfuse({
    publicKey,
    secretKey,
    baseUrl: process.env.LANGFUSE_HOST ?? "https://us.cloud.langfuse.com",
  });
  return cachedClient;
}

export async function flushLangfuse(): Promise<void> {
  const client = getLangfuseClient();
  if (!client) return;
  await client.flushAsync();
}

/**
 * Reset helper — exposed only for tests that need to re-evaluate the
 * env vars after mutation.
 */
export function __resetLangfuseClientForTests(): void {
  cachedClient = undefined;
}

// ---------------------------------------------------------------------------
// traceAnthropicCall — span wrapper for the Anthropic generation call.
//
// The caller supplies a name ("batch_slot_generate", "regen_page",
// etc.) and a metadata object keyed by whatever identifiers make the
// trace actionable (job_id, slot_index, site_id, page_id). Returns a
// handle with `end()` which the caller invokes after the SDK call
// returns, passing the response so token + cost fields land on the
// span.
//
// When Langfuse isn't configured, the handle is a no-op with
// matching shape. Caller code stays identical.
// ---------------------------------------------------------------------------

export type LangfuseSpanHandle = {
  /**
   * Finalise the span with the Anthropic response. Cost is computed
   * at the callsite (we don't want to duplicate the pricing table
   * across modules) — the caller passes it in.
   */
  end(opts: {
    response_id: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cached_tokens?: number;
    cost_cents: number;
    output_text?: string;
  }): void;
  /**
   * Record a failure on the span. Caller invokes this instead of
   * end() when the Anthropic call throws.
   */
  fail(message: string): void;
  /**
   * The trace id, if the span created one. Useful for the self-probe
   * response so verification can show "here's where to look."
   */
  readonly traceId: string | null;
};

export type TraceAnthropicCallOptions = {
  name: string;
  metadata?: Record<string, unknown>;
  input?: unknown;
};

export function traceAnthropicCall(
  opts: TraceAnthropicCallOptions,
): LangfuseSpanHandle {
  const client = getLangfuseClient();
  if (!client) {
    return {
      end() {},
      fail() {},
      traceId: null,
    };
  }
  const trace = client.trace({
    name: opts.name,
    metadata: opts.metadata,
    input: opts.input,
  });
  const generation = trace.generation({
    name: opts.name,
    input: opts.input,
    metadata: opts.metadata,
  });
  let closed = false;
  return {
    end(payload) {
      if (closed) return;
      closed = true;
      try {
        generation.end({
          output: payload.output_text,
          usage: {
            input: payload.input_tokens,
            output: payload.output_tokens,
            total: payload.input_tokens + payload.output_tokens,
            unit: "TOKENS",
          },
          model: payload.model,
          metadata: {
            response_id: payload.response_id,
            cost_cents: payload.cost_cents,
            cached_tokens: payload.cached_tokens ?? 0,
          },
        });
      } catch {
        // Langfuse errors must not break the caller's request path.
      }
    },
    fail(message) {
      if (closed) return;
      closed = true;
      try {
        generation.end({ level: "ERROR", statusMessage: message });
      } catch {
        // swallow
      }
    },
    get traceId() {
      return trace.id ?? null;
    },
  };
}
