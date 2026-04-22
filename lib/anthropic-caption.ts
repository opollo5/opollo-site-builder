import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// ---------------------------------------------------------------------------
// M4-4 — Anthropic vision caption helper.
//
// Thin wrapper that sends a single image (by public URL) to Anthropic's
// messages endpoint and parses the response into {caption, alt_text, tags}.
//
// Design decisions:
//
//   1. Separate call surface from M3-4's text-only `AnthropicCallFn`.
//      Vision requests carry an array content block (image + text) while
//      M3's `AnthropicRequest.messages[].content` is typed `string`. Rather
//      than widen M3's type and refactor the batch worker, M4-4 ships its
//      own `AnthropicCaptionCallFn` type. Production uses the default
//      implementation; tests inject a stub that records the idempotency
//      key and returns canned output.
//
//   2. Idempotency-Key header is ALWAYS sent. The transfer item's
//      `anthropic_idempotency_key` (pre-computed in migration 0010) is
//      replayed on every retry so Anthropic returns the cached response
//      without re-billing within the 24h window.
//
//   3. Response shape is enforced by Zod. The model is asked for JSON;
//      anything else — prose preamble, malformed JSON, tags length out
//      of bounds — classifies as `CAPTION_PARSE_FAILED`. Cost is still
//      recorded (we paid for the tokens even on an unparseable reply).
//
//   4. Structural bounds encoded in the Zod schema are the mitigation for
//      risk #8 in docs/plans/m4.md (AI caption quality drift). Tightening
//      the bounds later is a config change, not a code change at every
//      call site.
// ---------------------------------------------------------------------------

// Cost-optimised model for captioning. Matches the $63 cost estimate for
// the 9k iStock seed in docs/plans/m4.md. Opus is overkill for a "what's
// in this image + three-to-ten tags" task.
export const CAPTION_MODEL = "claude-sonnet-4-6";

// Small output budget — the response is a JSON object with three short
// fields. Bump only if a structural assertion starts tripping on
// legitimate long captions.
export const CAPTION_MAX_TOKENS = 400;

// System prompt. Strict JSON only so the worker's parse step never has to
// strip markdown fences or prose. Bounds match the Zod schema below —
// keeping both in sync avoids drift where the prompt asks for one shape
// and validation rejects it.
export const CAPTION_SYSTEM_PROMPT = [
  "You are captioning images for a searchable image library.",
  "Respond with ONLY a JSON object. Do not wrap it in markdown, prose, or code fences.",
  "The JSON object must match this shape exactly:",
  "{",
  '  "caption": string,    // one or two sentences describing what is visible. 40 to 280 characters.',
  '  "alt_text": string,   // short accessible alt text. 10 to 200 characters.',
  '  "tags": string[]      // 3 to 10 short searchable tags, lowercase, single word or short phrase.',
  "}",
  "The caption describes the image visually; the alt_text is a shorter accessible summary;",
  "the tags are concrete keywords a person might type to find this image.",
].join("\n");

export const CAPTION_USER_PROMPT =
  "Caption the image above. Respond with the JSON object described in the system prompt.";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CaptionRequest = {
  image_url: string;
  idempotency_key: string;
  model?: string;
  max_tokens?: number;
};

export type CaptionUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

// Raw response from Anthropic, before parsing. Separate from the parsed
// caption payload so callers can always record the cost even on a parse
// failure — we paid for these tokens.
export type CaptionApiResponse = {
  id: string;
  model: string;
  raw_text: string;
  stop_reason: string | null;
  usage: CaptionUsage;
};

export type AnthropicCaptionCallFn = (
  req: CaptionRequest,
) => Promise<CaptionApiResponse>;

// ---------------------------------------------------------------------------
// Zod schema for the parsed caption payload.
//
// Length bounds encode risk #8 (caption quality drift). A response that
// falls outside these bounds doesn't get silently truncated / rejected
// in production — it classifies as CAPTION_VALIDATION_FAILED and the
// item goes terminal with cost recorded.
// ---------------------------------------------------------------------------

const captionPayloadSchema = z.object({
  caption: z.string().min(40).max(280),
  alt_text: z.string().min(10).max(200),
  tags: z
    .array(z.string().min(1).max(60))
    .min(3)
    .max(10),
});

export type CaptionPayload = z.infer<typeof captionPayloadSchema>;

// ---------------------------------------------------------------------------
// Error classification
//
// Retryability contract matches M3's batch worker:
//   - retryable: 429, 5xx, transient network. Worker defers with
//     retry_after. Same idempotency key on the retry → Anthropic may
//     return cached response.
//   - non-retryable: 400, 401, 403, 404, 422. Terminal fail. Cost
//     recorded if the call billed (parse failures, validation failures).
// ---------------------------------------------------------------------------

export type CaptionFailureCode =
  | "ANTHROPIC_RATE_LIMITED"
  | "ANTHROPIC_SERVER_ERROR"
  | "ANTHROPIC_NETWORK_ERROR"
  | "ANTHROPIC_CLIENT_ERROR"
  | "CAPTION_PARSE_FAILED"
  | "CAPTION_VALIDATION_FAILED";

export class CaptionCallError extends Error {
  public readonly code: CaptionFailureCode;
  public readonly retryable: boolean;
  public readonly httpStatus: number | null;

  constructor(
    code: CaptionFailureCode,
    message: string,
    opts: { retryable: boolean; httpStatus?: number | null } = {
      retryable: false,
    },
  ) {
    super(message);
    this.name = "CaptionCallError";
    this.code = code;
    this.retryable = opts.retryable;
    this.httpStatus = opts.httpStatus ?? null;
  }
}

export function classifyHttpStatus(
  status: number | null | undefined,
): {
  code: CaptionFailureCode;
  retryable: boolean;
} {
  if (status == null) {
    return { code: "ANTHROPIC_NETWORK_ERROR", retryable: true };
  }
  if (status === 429) {
    return { code: "ANTHROPIC_RATE_LIMITED", retryable: true };
  }
  if (status >= 500) {
    return { code: "ANTHROPIC_SERVER_ERROR", retryable: true };
  }
  return { code: "ANTHROPIC_CLIENT_ERROR", retryable: false };
}

// ---------------------------------------------------------------------------
// Default production call.
//
// Released from any pg client — the worker is expected to have advanced
// the item into 'captioning' before invoking this, then re-enter a tx
// to write the caption + advance state. Keeping the external call
// outside a pg transaction avoids holding a connection open for the
// full round-trip.
// ---------------------------------------------------------------------------

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Required by the transfer worker's captioning stage.",
    );
  }
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

export const defaultAnthropicCaptionCall: AnthropicCaptionCallFn = async (
  req,
) => {
  const client = getClient();
  try {
    const message = await client.messages.create(
      {
        model: req.model ?? CAPTION_MODEL,
        max_tokens: req.max_tokens ?? CAPTION_MAX_TOKENS,
        system: CAPTION_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "url", url: req.image_url },
              },
              {
                type: "text",
                text: CAPTION_USER_PROMPT,
              },
            ],
          },
        ],
      },
      {
        headers: { "Idempotency-Key": req.idempotency_key },
      },
    );

    const rawText = message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    return {
      id: message.id,
      model: message.model,
      raw_text: rawText,
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
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      const classified = classifyHttpStatus(err.status);
      throw new CaptionCallError(classified.code, err.message, {
        retryable: classified.retryable,
        httpStatus: err.status,
      });
    }
    throw new CaptionCallError(
      "ANTHROPIC_NETWORK_ERROR",
      err instanceof Error ? err.message : String(err),
      { retryable: true, httpStatus: null },
    );
  }
};

// ---------------------------------------------------------------------------
// Parse + validate
//
// The worker calls this after a successful API response. A throw from
// here is a non-retryable terminal failure — the model returned a
// response we can't act on, so replaying the same idempotency key
// would return the same unparseable reply.
// ---------------------------------------------------------------------------

export function parseCaptionPayload(rawText: string): CaptionPayload {
  let asJson: unknown;
  try {
    asJson = JSON.parse(rawText);
  } catch (err) {
    throw new CaptionCallError(
      "CAPTION_PARSE_FAILED",
      `Response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      { retryable: false },
    );
  }
  const parsed = captionPayloadSchema.safeParse(asJson);
  if (!parsed.success) {
    throw new CaptionCallError(
      "CAPTION_VALIDATION_FAILED",
      `Response failed structural validation: ${parsed.error.message}`,
      { retryable: false },
    );
  }
  return parsed.data;
}
