import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { extractCssFromUrl } from "@/lib/design-discovery/extract-css";
import { fetchMicrolinkScreenshot } from "@/lib/design-discovery/microlink";
import { readJsonBody } from "@/lib/http";

// ---------------------------------------------------------------------------
// POST /api/admin/sites/[id]/setup/extract-design
//
// Driven by the Step-1 input surface. Operator pastes a reference URL
// (or "this is our existing site" URL) and we fetch a snapshot of the
// design tokens we can see plus a Microlink screenshot URL for the
// before/after panel later. Microlink failure is silent — we fall
// back to CSS-only extraction per the brief.
//
// Body: { url: string }
// Returns:
//   { ok: true, data: { swatches, fonts, layout_tags, visual_tone_tags,
//                       screenshot_url } }
//   { ok: false, error: { code, message } }
//
// Rate limiting is reused from the existing test_connection bucket —
// the abuse profile is the same (operator pastes a URL, we fetch it).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BodySchema = z.object({
  url: z.string().min(1).max(500),
});

function errorJson(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return errorJson("VALIDATION_FAILED", "Site id must be a UUID.", 400);
  }

  const body = await readJsonBody(req);
  if (body === undefined) return errorJson("VALIDATION_FAILED", "Request body must be valid JSON.", 400);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Body must include { url: string }.",
          details: { issues: parsed.error.issues },
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  // Run CSS extraction + Microlink in parallel. Both have their own
  // timeouts; whichever finishes first lands in the response shape.
  const [css, microlink] = await Promise.all([
    extractCssFromUrl(parsed.data.url),
    fetchMicrolinkScreenshot(parsed.data.url),
  ]);

  if (!css.fetch_ok && !microlink.ok) {
    // Both failed → return a soft error so the form can show "Could
    // not fetch that URL. Try pasting your copy directly instead."
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "FETCH_FAILED",
          message:
            css.fetch_error ||
            microlink.error ||
            "Could not reach the URL. Try pasting your copy directly instead.",
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        swatches: css.swatches,
        fonts: css.fonts,
        layout_tags: css.layout_tags,
        visual_tone_tags: css.visual_tone_tags,
        screenshot_url: microlink.screenshot_url,
        source_url: css.fetched_url,
        fetched_at: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
