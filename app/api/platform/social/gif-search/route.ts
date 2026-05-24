import { NextResponse, type NextRequest } from "next/server";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { validationError } from "@/lib/http";

// ---------------------------------------------------------------------------
// GET /api/platform/social/gif-search?company_id=...&q=...&category=...
//
// Server-side GIPHY proxy so the API key never ships in the client bundle.
// Requires an authenticated session with edit_post permission on company_id.
//
// Returns a flat list of GIF results with preview + original URLs.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 24;

const CATEGORY_TERMS: Record<string, string> = {
  reactions: "reaction",
  sports: "sports",
  memes: "meme",
  animation: "animation",
  tech: "technology",
  stickers: "sticker",
};

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("company_id") ?? "";

  if (!UUID_RE.test(companyId)) {
    return validationError("company_id (uuid) is required.");
  }

  const gate = await requireCanDoForApi(companyId, "edit_post");
  if (gate.kind === "deny") return gate.response;

  const apiKey = process.env.NEXT_PUBLIC_GIPHY_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: { message: "GIFs are temporarily unavailable. Contact support." } },
      { status: 503 },
    );
  }

  const q = searchParams.get("q")?.trim() ?? "";
  const category = searchParams.get("category")?.toLowerCase() ?? "trending";
  const rawLimit = parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = Math.min(isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit, MAX_LIMIT);

  if (limit < 1) return validationError("limit must be >= 1.");

  const effectiveQuery = q || CATEGORY_TERMS[category] || "";
  const giphyUrl = effectiveQuery
    ? `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(effectiveQuery)}&limit=${limit}&rating=g`
    : `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(apiKey)}&limit=${limit}&rating=g`;

  let giphyRes: Response;
  try {
    giphyRes = await fetch(giphyUrl);
  } catch {
    return NextResponse.json(
      { ok: false, error: { message: "GIF search failed. Please try again." } },
      { status: 502 },
    );
  }

  if (!giphyRes.ok) {
    return NextResponse.json(
      { ok: false, error: { message: "GIF search unavailable." } },
      { status: 502 },
    );
  }

  const body = (await giphyRes.json()) as {
    data: Array<{
      id: string;
      title: string;
      images: {
        fixed_width: { url: string };
        fixed_width_still: { url: string };
        original: { url: string };
      };
    }>;
  };

  const results = (body.data ?? []).map((g) => ({
    id: g.id,
    title: g.title,
    preview_url: g.images.fixed_width_still.url,
    animated_url: g.images.fixed_width.url,
    original_url: g.images.original.url,
  }));

  return NextResponse.json({ ok: true, data: { results } });
}
