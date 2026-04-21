import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// M3-4 — Anthropic call wrapper.
//
// Thin layer over @anthropic-ai/sdk that pins two invariants for the
// batch worker:
//
//   1. Idempotency-Key header is ALWAYS sent on batch calls. The
//      slot's `anthropic_idempotency_key` (computed deterministically
//      in M3-2) is replayed on every retry. Anthropic's server-side
//      idempotency cache returns the original response without
//      billing again if the request lands inside the 24h window.
//
//   2. The concrete call function is dependency-injected through
//      processSlotAnthropic. Tests substitute a stub that records
//      the request + returns a canned response — that lets the
//      concurrency / reconciliation tests run in CI without any
//      real Anthropic credentials or network.
// ---------------------------------------------------------------------------

export type AnthropicRequest = {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  idempotency_key: string;
};

export type AnthropicResponse = {
  id: string;
  model: string;
  content: Array<{ type: "text"; text: string }>;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
};

export type AnthropicCallFn = (req: AnthropicRequest) => Promise<AnthropicResponse>;

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Required by the batch worker's generating step.",
    );
  }
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

/**
 * The production Anthropic call. processSlotAnthropic takes this as a
 * default and substitutes a stub in tests.
 */
export const defaultAnthropicCall: AnthropicCallFn = async (req) => {
  const client = getClient();
  const message = await client.messages.create(
    {
      model: req.model,
      max_tokens: req.max_tokens,
      system: req.system,
      messages: req.messages,
    },
    {
      headers: { "Idempotency-Key": req.idempotency_key },
    },
  );

  // Normalise to a minimal shape so tests don't need to mock the full
  // SDK response.
  return {
    id: message.id,
    model: message.model,
    content: message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => ({ type: "text" as const, text: b.text })),
    stop_reason: message.stop_reason ?? null,
    usage: {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      cache_creation_input_tokens:
        message.usage.cache_creation_input_tokens ?? undefined,
      cache_read_input_tokens:
        message.usage.cache_read_input_tokens ?? undefined,
    },
  };
};
