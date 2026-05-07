import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { deliveryUrl } from "@/lib/cloudflare-images";
import { readJsonBody, validationError } from "@/lib/http";
import {
  EmbeddingNotConfiguredError,
  embedText,
  vectorToLiteral,
} from "@/lib/images/embed";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/images/suggest — Spec 05 PR B.
//
// Hybrid keyword + semantic ranking for the post composer's "Suggested"
// featured-image tab. Replaces the existing FTS-only ranking that
// surfaces irrelevant logos / generic stock when the post body is
// short or vocabulary-mismatched.
//
// Algorithm:
//   1. Build keyword query from postTitle + first 500 chars of postBody.
//   2. Generate query embedding from postTitle + first 2000 chars of body.
//   3. Single SQL call to public.hybrid_search_images() — both rankings
//      blended via Reciprocal Rank Fusion in-database, top-N returned.
//
// Graceful degradation:
//   - If OPENAI_API_KEY is unset OR the embed call fails, the route runs
//     keyword-only (passing NULL for the vector). The RRF function copes.
//   - If a row's caption_embedding is NULL (backfill not yet run), it
//     simply doesn't appear in the semantic_results CTE; keyword side
//     can still surface it.
//
// Auth: same as the existing list endpoint — admin OR super_admin.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POST_BODY_KEYWORD_CHARS = 500;
const POST_BODY_EMBED_CHARS = 2000;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

const BodySchema = z.object({
  postTitle: z.string().max(500).optional(),
  postBody: z.string().max(50_000).optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  excludeIds: z.array(z.string().uuid()).max(100).default([]),
  // When the caller doesn't have title/body (e.g. saved post), pass the
  // postId and the server fetches title + content_brief from posts.
  postId: z.string().uuid().optional(),
});

async function resolveTitleAndBody(
  postId: string | undefined,
  fallbackTitle: string,
  fallbackBody: string,
): Promise<{ title: string; body: string }> {
  if (!postId) return { title: fallbackTitle, body: fallbackBody };
  const svc = getServiceRoleClient();
  const { data } = await svc
    .from("posts")
    .select("title, content_brief")
    .eq("id", postId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return { title: fallbackTitle, body: fallbackBody };
  const title =
    typeof data.title === "string" && data.title.trim()
      ? data.title
      : fallbackTitle;
  let body = fallbackBody;
  if (data.content_brief !== null && data.content_brief !== undefined) {
    body =
      typeof data.content_brief === "string"
        ? data.content_brief
        : JSON.stringify(data.content_brief);
  }
  return { title, body };
}

interface SuggestImage {
  id: string;
  url: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
  altText: string | null;
  filename: string | null;
  title: string | null;
  score: number;
  keywordScore: number;
  semanticScore: number;
}

function composeKeywordQuery(title: string, body: string): string {
  const t = title.trim();
  const b = body.trim().slice(0, POST_BODY_KEYWORD_CHARS);
  // Repeat title 3x to weight it heavier in ts_rank_cd; same trick as the
  // existing list endpoint's composeSuggestionQuery.
  const parts: string[] = [];
  if (t) parts.push(t, t, t);
  if (b) parts.push(b);
  return parts.join(" ").trim();
}

function composeEmbedInput(title: string, body: string): string {
  const t = title.trim();
  const b = body.trim().slice(0, POST_BODY_EMBED_CHARS);
  return [t, b].filter(Boolean).join(". ").slice(0, POST_BODY_EMBED_CHARS + 500);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const raw = await readJsonBody(req);
  if (raw === undefined) return validationError("Body must be valid JSON.");
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return validationError("Body failed validation.", { issues: parsed.error.issues });
  }
  const { limit, excludeIds, postId } = parsed.data;

  // Resolve title + body. postId takes precedence (saved post case) — the
  // server reads from posts so the client doesn't have to ship a body.
  const resolved = await resolveTitleAndBody(
    postId,
    parsed.data.postTitle ?? "",
    parsed.data.postBody ?? "",
  );
  const postTitle = resolved.title;
  const postBody = resolved.body;

  // Empty input → 200 with no images. Caller's UI shows the "start typing"
  // empty state. No DB round-trip, no embedding call.
  if (!postTitle.trim() && !postBody.trim()) {
    return NextResponse.json(
      {
        ok: true,
        data: { images: [], queryEmbedded: false, keywordOnly: true },
        timestamp: new Date().toISOString(),
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }

  const keywordQuery = composeKeywordQuery(postTitle, postBody);
  const embedInput = composeEmbedInput(postTitle, postBody);

  // Try to embed the query. Failures degrade to keyword-only.
  let queryVectorLiteral: string | null = null;
  let embedFailureReason: string | null = null;
  if (embedInput) {
    try {
      const vec = await embedText(embedInput);
      queryVectorLiteral = vectorToLiteral(vec);
    } catch (err) {
      if (err instanceof EmbeddingNotConfiguredError) {
        embedFailureReason = "not_configured";
      } else {
        embedFailureReason = err instanceof Error ? err.message : String(err);
        logger.warn("images.suggest.embed_failed", {
          post_id: postId,
          error: embedFailureReason,
        });
      }
    }
  }

  if (!keywordQuery && !queryVectorLiteral) {
    // Both sides empty → no DB call. Defensive: shouldn't happen given the
    // earlier "both empty" early-return.
    return NextResponse.json(
      {
        ok: true,
        data: { images: [], queryEmbedded: false, keywordOnly: true },
        timestamp: new Date().toISOString(),
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }

  const t0 = Date.now();
  const svc = getServiceRoleClient();
  const { data, error } = await svc.rpc("hybrid_search_images", {
    p_keyword_query: keywordQuery || null,
    p_query_vector: queryVectorLiteral,
    p_limit: limit,
    p_exclude_ids: excludeIds,
  });
  const elapsedMs = Date.now() - t0;

  if (error) {
    logger.error("images.suggest.rpc_failed", {
      error: error.message,
      post_id: postId,
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Suggestion query failed.",
          retryable: true,
          suggested_action: "Retry; if the failure persists, check the RPC logs.",
        },
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as Array<{
    id: string;
    cloudflare_id: string | null;
    filename: string | null;
    title: string | null;
    caption: string | null;
    alt_text: string | null;
    tags: string[] | null;
    hybrid_score: number;
    keyword_score: number;
    semantic_score: number;
  }>;

  const images: SuggestImage[] = rows.map((r) => {
    const url = r.cloudflare_id ? deliveryUrl(r.cloudflare_id) : null;
    return {
      id: r.id,
      url,
      thumbnailUrl: url,
      caption: r.caption,
      altText: r.alt_text,
      filename: r.filename,
      title: r.title,
      score: Number(r.hybrid_score) || 0,
      keywordScore: Number(r.keyword_score) || 0,
      semanticScore: Number(r.semantic_score) || 0,
    };
  });

  // Telemetry: structured log of the query for tuning. Top 5 ids + scores
  // is plenty to see why a query went sideways without ballooning log size.
  logger.info("images.suggest.query", {
    post_id: postId,
    has_title: postTitle.trim().length > 0,
    body_chars: postBody.length,
    keyword_query_chars: keywordQuery.length,
    query_embedded: queryVectorLiteral !== null,
    keyword_only: queryVectorLiteral === null,
    embed_failure: embedFailureReason,
    elapsed_ms: elapsedMs,
    result_count: images.length,
    top: images.slice(0, 5).map((i) => ({
      id: i.id,
      score: Number(i.score.toFixed(4)),
      kw: Number(i.keywordScore.toFixed(4)),
      sem: Number(i.semanticScore.toFixed(4)),
    })),
  });

  return NextResponse.json(
    {
      ok: true,
      data: {
        images,
        queryEmbedded: queryVectorLiteral !== null,
        keywordOnly: queryVectorLiteral === null,
        elapsedMs,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
