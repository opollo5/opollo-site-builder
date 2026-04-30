import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  archiveSite,
  getSite,
  updateSiteBasics,
  updateSiteCredentials,
} from "@/lib/sites";
import {
  UpdateSiteBasicsSchema,
  errorCodeToStatus,
} from "@/lib/tool-schemas";

// AUTH-FOUNDATION P2.3 — PATCH body can carry credential rotation
// alongside basics. Empty/omitted credential fields preserve the
// stored values; new values are encrypted and replace the row.
const PatchBodySchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    wp_url: z.string().url().optional(),
    wp_user: z.string().min(1).max(100).optional(),
    wp_app_password: z.string().min(1).max(200).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, {
    message: "At least one field must be provided.",
  });

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
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
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
  const parsed = PatchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message:
            "Body must contain at least one of { name, wp_url, wp_user, wp_app_password }.",
          details: { issues: parsed.error.issues },
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  // Two writes: basics (sites table) + credentials (site_credentials).
  // Run basics first; if creds fail, basics still landed (operator
  // can retry the credential rotation independently).
  const basicsPatch = UpdateSiteBasicsSchema.safeParse({
    ...(parsed.data.name !== undefined && { name: parsed.data.name }),
    ...(parsed.data.wp_url !== undefined && { wp_url: parsed.data.wp_url }),
  });
  if (basicsPatch.success) {
    const basicsResult = await updateSiteBasics(params.id, basicsPatch.data);
    if (!basicsResult.ok) {
      return NextResponse.json(basicsResult, {
        status: errorCodeToStatus(basicsResult.error.code),
      });
    }
  }

  if (
    parsed.data.wp_user !== undefined ||
    parsed.data.wp_app_password !== undefined
  ) {
    const credsResult = await updateSiteCredentials(params.id, {
      wp_user: parsed.data.wp_user,
      // Strip whitespace from the WP Application Password — operators
      // paste them as `abcd efgh …`. Mirror the test-connection
      // helper's normalisation so a tested-then-saved credential set
      // stores the same bytes.
      wp_app_password:
        parsed.data.wp_app_password !== undefined
          ? parsed.data.wp_app_password.replace(/\s+/g, "")
          : undefined,
    });
    if (!credsResult.ok) {
      return NextResponse.json(credsResult, {
        status: errorCodeToStatus(credsResult.error.code),
      });
    }
  }

  // Re-read the site for the response payload — keeps the wire shape
  // consistent with the previous PATCH (which returned the SiteRecord).
  const refreshed = await getSite(params.id, { includeCredentials: false });
  if (refreshed.ok) {
    revalidatePath("/admin/sites");
    revalidatePath(`/admin/sites/${params.id}`);
  }
  const status = refreshed.ok ? 200 : errorCodeToStatus(refreshed.error.code);
  return NextResponse.json(
    refreshed.ok
      ? { ok: true, data: refreshed.data.site, timestamp: new Date().toISOString() }
      : refreshed,
    { status },
  );
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
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
