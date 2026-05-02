import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { extractDesignFromUrl } from "@/lib/copy-existing-extract";
import { getServiceRoleClient } from "@/lib/supabase";

// POST /api/admin/sites/[id]/setup/extract
//
// Runs the copy-existing extraction (CSS + HTML scrape + Microlink
// screenshot) and returns the snapshot. Does NOT persist — the
// operator reviews + edits in the wizard before /save commits the
// row.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BodySchema = z
  .object({
    extra_pages: z.array(z.string().url()).max(5).optional(),
  })
  .optional();

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({
    roles: ["super_admin", "admin"] as const,
  });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Site id must be a UUID.",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Body validation failed.",
          details: { issues: parsed.error.issues },
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const supabase = getServiceRoleClient();
  const siteRow = await supabase
    .from("sites")
    .select("id, wp_url, site_mode")
    .eq("id", params.id)
    .maybeSingle();

  if (siteRow.error || !siteRow.data) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Site not found.",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 404 },
    );
  }

  const site = siteRow.data as { id: string; wp_url: string; site_mode: string | null };
  if (site.site_mode !== "copy_existing") {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_STATE",
          message:
            "Extraction is only available for sites in copy_existing mode. Set the site mode via /onboarding first.",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 409 },
    );
  }

  const result = await extractDesignFromUrl(site.wp_url, {
    existingPages: parsed.data?.extra_pages,
  });

  return NextResponse.json(
    { ok: true, data: result, timestamp: new Date().toISOString() },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
