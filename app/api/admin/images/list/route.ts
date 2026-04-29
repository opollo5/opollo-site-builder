import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { deliveryUrl } from "@/lib/cloudflare-images";
import {
  LIST_IMAGES_DEFAULT_LIMIT,
  LIST_IMAGES_MAX_LIMIT,
  listImages,
  type ImageListItem,
} from "@/lib/image-library";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// GET /api/admin/images/list — BP-4.
//
// Polled by the image picker modal. Wraps lib/image-library.listImages
// with FTS search + pagination. Caller pre-computes the Cloudflare
// delivery URL server-side because the client doesn't have access to
// CLOUDFLARE_IMAGES_HASH.
//
// Query params:
//   q             — free-text search (caption + alt + filename, FTS)
//   for_post      — post UUID. Server reads post.title + content_brief
//                   and builds an FTS query weighted 3× toward title.
//                   Returns top-N suggestions. Falls back to recent
//                   images when the post has no title/content yet.
//   suggest_from  — alternative to for_post: callers without a saved
//                   post id (e.g. the BlogPostComposer's pre-save
//                   draft) pass `${title} ${body-snippet}` directly.
//                   Title-vs-body weighting is the caller's job.
//   limit         — capped at LIST_IMAGES_MAX_LIMIT
//   offset        — non-negative integer
//
// Precedence: for_post > suggest_from > q. Each is an alternative
// FTS query source; only one applies.
//
// Auth: admin OR operator (matches the BP-3 entry-point's role policy).
// Soft-deleted images excluded by default.
// ---------------------------------------------------------------------------

const SUGGEST_DEFAULT_LIMIT = 5;
const POST_BODY_SNIPPET_CHARS = 400;
const TITLE_WEIGHT = 3;

interface SuggestionResolution {
  query: string | undefined;
  /** Returned to the client so the UI can label "Suggested for: <title>". */
  basedOn: string | null;
  /** True when the post had nothing parseable; client should fall back to recent. */
  emptyContext: boolean;
}

/**
 * Build an FTS query string from a post's title + body, weighting the
 * title 3× by repeating its terms. PostgreSQL FTS doesn't apply
 * tsquery weights without setweight on the source vector — repeating
 * the title text in the query is the operator-friendly fallback that
 * gets the same effect (more title-term matches → higher ts_rank).
 */
function composeSuggestionQuery(
  title: string | null,
  body: string | null,
): string {
  const titleText = (title ?? "").trim();
  const bodyText = (body ?? "").trim().slice(0, POST_BODY_SNIPPET_CHARS);
  const parts: string[] = [];
  if (titleText) {
    for (let i = 0; i < TITLE_WEIGHT; i++) parts.push(titleText);
  }
  if (bodyText) parts.push(bodyText);
  return parts.join(" ").trim();
}

async function resolvePostSuggestion(
  postId: string,
): Promise<SuggestionResolution> {
  const svc = getServiceRoleClient();
  const { data } = await svc
    .from("posts")
    .select("title, content_brief")
    .eq("id", postId)
    .is("deleted_at", null)
    .maybeSingle();
  const title = (data?.title as string | null) ?? null;
  // content_brief is jsonb in the schema; stringify a portion if so.
  let body: string | null = null;
  if (data?.content_brief !== undefined && data?.content_brief !== null) {
    body =
      typeof data.content_brief === "string"
        ? data.content_brief
        : JSON.stringify(data.content_brief);
  }
  const query = composeSuggestionQuery(title, body);
  return {
    query: query.length > 0 ? query : undefined,
    basedOn: title,
    emptyContext: query.length === 0,
  };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface ImagePickerEntry extends ImageListItem {
  delivery_url: string | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
  if (gate.kind === "deny") return gate.response;

  const url = new URL(req.url);
  const rawQ = url.searchParams.get("q");
  const rawForPost = url.searchParams.get("for_post");
  const rawSuggestFrom = url.searchParams.get("suggest_from");
  const rawLimit = url.searchParams.get("limit");
  const rawOffset = url.searchParams.get("offset");

  // Resolve the FTS query — for_post > suggest_from > q.
  let q: string | undefined;
  let basedOn: string | null = null;
  let emptyContext = false;
  let suggestionMode = false;
  if (rawForPost && /^[0-9a-f-]{36}$/i.test(rawForPost)) {
    const resolved = await resolvePostSuggestion(rawForPost);
    q = resolved.query;
    basedOn = resolved.basedOn;
    emptyContext = resolved.emptyContext;
    suggestionMode = true;
  } else if (rawSuggestFrom && rawSuggestFrom.trim().length > 0) {
    q = rawSuggestFrom.trim();
    suggestionMode = true;
  } else if (rawQ && rawQ.trim().length > 0) {
    q = rawQ.trim();
  }

  const limit = (() => {
    if (!rawLimit) {
      return suggestionMode ? SUGGEST_DEFAULT_LIMIT : LIST_IMAGES_DEFAULT_LIMIT;
    }
    const n = Number(rawLimit);
    if (!Number.isFinite(n) || n < 1) return LIST_IMAGES_DEFAULT_LIMIT;
    return Math.min(LIST_IMAGES_MAX_LIMIT, Math.floor(n));
  })();
  const offset = (() => {
    if (!rawOffset) return 0;
    const n = Number(rawOffset);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  })();

  // Suggestion mode with empty post context → fall back to recent
  // images (listImages's default sort is created_at desc).
  const result = await listImages({
    query: emptyContext ? undefined : q,
    limit,
    offset,
    deleted: false,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ...result },
      {
        status: 500,
        headers: { "cache-control": "no-store" },
      },
    );
  }

  const items: ImagePickerEntry[] = result.data.items.map((item) => ({
    ...item,
    delivery_url: item.cloudflare_id ? deliveryUrl(item.cloudflare_id) : null,
  }));

  return NextResponse.json(
    {
      ok: true,
      data: {
        items,
        total: result.data.total,
        limit: result.data.limit,
        offset: result.data.offset,
        // R1-5 — suggestion context. UI uses this to render the
        // "Suggested for: <title>" affordance + the
        // "no-content-yet, showing recent" fallback copy.
        suggestion:
          suggestionMode || basedOn !== null
            ? {
                based_on: basedOn,
                fallback_to_recent: emptyContext,
              }
            : null,
      },
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
