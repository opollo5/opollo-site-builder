import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import type { Database } from "@/types/supabase";

// ---------------------------------------------------------------------------
// Spec 05 — image caption embedding helper.
//
// Calls OpenAI's text-embedding-3-small model directly via fetch. Returns a
// 1536-dim vector ready to be written to image_library.caption_embedding
// (pgvector column from migration 0108).
//
// Why bare fetch and not the openai SDK:
//   - One endpoint, no streaming, no tool use → SDK overhead isn't earned.
//   - Avoids adding a new top-level npm dep + bundle bytes for a single call.
//
// Why text-embedding-3-small:
//   - 1536 dimensions, $0.02 per 1M tokens — backfilling the 9k iStock
//     library costs roughly $0.10 total.
//   - OpenAI documents it as production-grade and competitive on retrieval
//     benchmarks against larger models for this kind of short-doc use.
//
// Cost is tracked at the call-site via logger payloads; no central cost
// ledger like Anthropic transfers because this isn't a billed-per-page
// operation in the M3/M4 sense — it runs once per image at ingest, and
// once per suggestion query (sub-cent, drowned by Cloudflare egress).
// ---------------------------------------------------------------------------

const OPENAI_EMBED_ENDPOINT = "https://api.openai.com/v1/embeddings";
const OPENAI_EMBED_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

// OpenAI rejects inputs > 8192 tokens. Tokens ≈ chars / 4 for English; cap
// at 24000 chars defensively (~6k tokens) so we never round-trip a 400.
const MAX_INPUT_CHARS = 24000;

export class EmbeddingNotConfiguredError extends Error {
  readonly code = "EMBEDDING_NOT_CONFIGURED";
  constructor(message = "OPENAI_API_KEY is not set; embeddings disabled.") {
    super(message);
    this.name = "EmbeddingNotConfiguredError";
  }
}

export class EmbeddingCallError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "EmbeddingCallError";
    this.code = code;
    this.status = status;
  }
}

export interface ImageEmbedInput {
  caption?: string | null;
  alt?: string | null;
  tags?: readonly string[] | null;
  filename?: string | null;
  title?: string | null;
}

/**
 * Build the deterministic input string for embedding an image. Title gets
 * a leading position because operators describe the subject there; alt + tags
 * round out the keyword surface; filename is last because it's frequently
 * just a hash for stock photography.
 *
 * Returns null when there's nothing meaningful to embed (all fields empty).
 */
export function composeImageEmbeddingInput(input: ImageEmbedInput): string | null {
  const parts: string[] = [];
  const push = (s: string | null | undefined) => {
    if (typeof s === "string") {
      const t = s.trim();
      if (t) parts.push(t);
    }
  };
  push(input.title);
  push(input.caption);
  push(input.alt);
  if (input.tags && input.tags.length > 0) {
    const joined = input.tags
      .map((t) => (typeof t === "string" ? t.trim() : ""))
      .filter(Boolean)
      .join(", ");
    if (joined) parts.push(`Tags: ${joined}`);
  }
  push(input.filename);
  if (parts.length === 0) return null;
  return parts.join(". ").replace(/\s+/g, " ").slice(0, MAX_INPUT_CHARS);
}

/**
 * Generate an embedding for a single text input. Returns a 1536-element
 * number array. Throws `EmbeddingNotConfiguredError` when OPENAI_API_KEY
 * isn't set so callers can degrade gracefully.
 */
export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new EmbeddingNotConfiguredError();

  const trimmed = text.trim().slice(0, MAX_INPUT_CHARS);
  if (!trimmed) throw new EmbeddingCallError("EMPTY_INPUT", "Cannot embed an empty string.");

  const res = await fetch(OPENAI_EMBED_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_EMBED_MODEL,
      input: trimmed,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const code =
      res.status === 401
        ? "UNAUTHORIZED"
        : res.status === 429
          ? "RATE_LIMITED"
          : res.status >= 500
            ? "UPSTREAM_5XX"
            : "UPSTREAM_REJECTED";
    throw new EmbeddingCallError(
      code,
      `OpenAI embeddings call failed (${res.status}): ${detail.slice(0, 200)}`,
      res.status,
    );
  }

  const json = (await res.json().catch(() => null)) as
    | { data?: Array<{ embedding?: unknown }> }
    | null;
  const vec = json?.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingCallError(
      "MALFORMED_RESPONSE",
      `OpenAI returned an unexpected embedding shape (length=${
        Array.isArray(vec) ? vec.length : "n/a"
      }).`,
    );
  }
  return vec as number[];
}

/**
 * Generate an embedding for an image's caption-side metadata. Convenience
 * wrapper around `embedText` + `composeImageEmbeddingInput`. Returns null
 * when there's nothing to embed (empty caption / alt / tags / filename).
 */
export async function embedImageCaption(
  input: ImageEmbedInput,
): Promise<number[] | null> {
  const text = composeImageEmbeddingInput(input);
  if (!text) return null;
  return embedText(text);
}

/**
 * Format a JS number array as a pgvector literal string ("[0.1,0.2,...]").
 * Supabase's PostgREST client doesn't natively serialise the vector type;
 * passing the literal works in `update()` payloads and as a `?` parameter
 * to raw SQL.
 */
export function vectorToLiteral(vec: readonly number[]): string {
  return `[${vec.join(",")}]`;
}

// Service-role client surface — same type as `getServiceRoleClient()`.
type SupabaseLike = SupabaseClient<Database>;

/**
 * Best-effort: generate the embedding and write it to image_library.
 * Logs warnings on failure rather than throwing — caller is the upload
 * happy path and we never block on an embedding round-trip.
 *
 * No-op (with debug log) when OPENAI_API_KEY isn't set, so the upload
 * happy path stays green in environments without embedding configured.
 */
export async function embedAndStoreImage(
  imageId: string,
  input: ImageEmbedInput,
  supabase: SupabaseLike,
): Promise<void> {
  try {
    const vec = await embedImageCaption(input);
    if (!vec) {
      logger.debug("image.embed.skipped_empty_input", { image_id: imageId });
      return;
    }
    const { error } = await supabase
      .from("image_library")
      .update({
        caption_embedding: vectorToLiteral(vec),
        updated_at: new Date().toISOString(),
      })
      .eq("id", imageId);
    if (error) {
      logger.warn("image.embed.persist_failed", {
        image_id: imageId,
        error: error.message ?? String(error),
      });
      return;
    }
    logger.debug("image.embed.stored", { image_id: imageId });
  } catch (err) {
    if (err instanceof EmbeddingNotConfiguredError) {
      logger.debug("image.embed.disabled", { image_id: imageId });
      return;
    }
    logger.warn("image.embed.failed", {
      image_id: imageId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Read the current caption / alt / tags / title / filename for an image
 * from the database, then embed + persist. Useful from PATCH / reextract
 * paths where the caller doesn't want to thread the latest fields through.
 *
 * Best-effort. Logs warnings on failure rather than throwing.
 */
export async function refreshImageEmbedding(
  imageId: string,
  supabase: SupabaseLike,
): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("image_library")
      .select("caption, alt_text, tags, title, filename")
      .eq("id", imageId)
      .maybeSingle();
    if (error) {
      logger.warn("image.embed.read_failed", {
        image_id: imageId,
        error: error.message ?? String(error),
      });
      return;
    }
    if (!data) return;
    await embedAndStoreImage(
      imageId,
      {
        caption: (data.caption as string | null) ?? null,
        alt: (data.alt_text as string | null) ?? null,
        tags: (data.tags as string[] | null) ?? null,
        title: (data.title as string | null) ?? null,
        filename: (data.filename as string | null) ?? null,
      },
      supabase,
    );
  } catch (err) {
    logger.warn("image.embed.refresh_failed", {
      image_id: imageId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
