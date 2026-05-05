import Anthropic from "@anthropic-ai/sdk";

import { traceAnthropicCall } from "@/lib/langfuse";

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

// M12-4 — multi-modal content blocks. `content` on a user message can be
// either a plain string (existing callers — batch worker, text-only brief
// runner passes) or an array of content blocks mixing text + image. Image
// blocks are base64-inlined and never touch Storage or logs (see Risk #8
// of the M12 parent plan: visual review screenshot retention).
export type AnthropicTextBlock = { type: "text"; text: string };
export type AnthropicImageBlock = {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
    data: string;
  };
};
export type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock;

export type AnthropicRequest = {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string | Array<AnthropicContentBlock>;
  }>;
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
 *
 * M10: wrapped in a Langfuse span when LANGFUSE_* env vars are set.
 * No-op when unconfigured — tests + local dev stay identical.
 */
// Redact image bytes so screenshot data never lands in observability.
// Parent plan Risk #8: "No log line that includes screenshot bytes."
function redactMessagesForTrace(
  messages: AnthropicRequest["messages"],
): Array<{ role: string; content: unknown }> {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    return {
      role: m.role,
      content: m.content.map((block) =>
        block.type === "image"
          ? {
              type: "image",
              source: {
                type: "base64",
                media_type: block.source.media_type,
                data_bytes: block.source.data.length,
              },
            }
          : block,
      ),
    };
  });
}

export const defaultAnthropicCall: AnthropicCallFn = async (req) => {
  const span = traceAnthropicCall({
    name: "anthropic_messages_create",
    metadata: {
      model: req.model,
      idempotency_key: req.idempotency_key,
      max_tokens: req.max_tokens,
    },
    input: {
      system_prompt_bytes: req.system.length,
      messages: redactMessagesForTrace(req.messages),
    },
  });

  const client = getClient();
  let message;
  try {
    message = await client.messages.create(
      {
        model: req.model,
        max_tokens: req.max_tokens,
        system: req.system,
        messages: req.messages,
      },
      {
        headers: { "Idempotency-Key": req.idempotency_key },
        signal: AbortSignal.timeout(60_000),
      },
    );
  } catch (err) {
    span.fail(err instanceof Error ? err.message : String(err));
    throw err;
  }

  const textContent = message.content.filter(
    (b): b is Extract<typeof b, { type: "text" }> => b.type === "text",
  );
  const normalised: AnthropicResponse = {
    id: message.id,
    model: message.model,
    content: textContent.map((b) => ({ type: "text" as const, text: b.text })),
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

  // Cost is computed downstream (costCents / pricing table lives in
  // lib/anthropic-pricing.ts and varies per model). Pass 0 here; the
  // caller's span overlay via anthropic-pricing will override in a
  // future slice. For now the span captures tokens + response_id.
  span.end({
    response_id: normalised.id,
    model: normalised.model,
    input_tokens: normalised.usage.input_tokens,
    output_tokens: normalised.usage.output_tokens,
    cached_tokens:
      (normalised.usage.cache_read_input_tokens ?? 0) +
      (normalised.usage.cache_creation_input_tokens ?? 0),
    cost_cents: 0,
    output_text: textContent.map((b) => b.text).join("\n"),
  });

  return normalised;
};
