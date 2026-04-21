import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { archiveSite, getSite, updateSiteBasics } from "@/lib/sites";
import {
  UpdateSiteBasicsSchema,
  errorCodeToStatus,
} from "@/lib/tool-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  // Never include credentials in a response served over HTTP. Internal
  // consumers (chat route) must call getSite directly with includeCredentials.
  const result = await getSite(params.id, { includeCredentials: false });
  const status = result.ok ? 200 : errorCodeToStatus(result.error.code);
  return NextResponse.json(result, { status });
}

// ---------------------------------------------------------------------------
// M2d UX cleanup — inline edit + soft-archive.
//
// PATCH updates operator-visible basics (name, wp_url). Credentials
// rotation is a separate slice.
// DELETE soft-archives by flipping status to 'removed'; listSites
// already filters those out and the partial unique-prefix index
// (WHERE status != 'removed') frees the prefix for re-use.
// ---------------------------------------------------------------------------

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return errorJson("VALIDATION_FAILED", "Site id must be a UUID.", 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = UpdateSiteBasicsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Body must be { name?, wp_url? } with at least one field.",
          details: { issues: parsed.error.issues },
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const result = await updateSiteBasics(params.id, parsed.data);
  if (result.ok) {
    revalidatePath("/admin/sites");
    revalidatePath(`/admin/sites/${params.id}`);
  }
  const status = result.ok ? 200 : errorCodeToStatus(result.error.code);
  return NextResponse.json(result, { status });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return errorJson("VALIDATION_FAILED", "Site id must be a UUID.", 400);
  }

  const result = await archiveSite(params.id);
  if (result.ok) {
    revalidatePath("/admin/sites");
    revalidatePath(`/admin/sites/${params.id}`);
  }
  const status = result.ok ? 200 : errorCodeToStatus(result.error.code);
  return NextResponse.json(result, { status });
}
