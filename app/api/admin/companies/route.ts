import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { readJsonBody, respond, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { createPlatformCompany } from "@/lib/platform/companies";

// POST /api/admin/companies — P3-2.
//
// Operator-only (requireAdminForApi). Customer companies are invite-only
// per BUILD.md; only Opollo staff create them. The route translates
// browser form input into createPlatformCompany() and revalidates the
// list page so the new row appears on next render.
//
// Errors:
//   400 VALIDATION_FAILED — body shape, name/slug constraints.
//   401 UNAUTHORIZED      — no session.
//   403 FORBIDDEN         — non-admin caller.
//   409 ALREADY_EXISTS    — slug collision (UNIQUE platform_companies.slug).
//   500 INTERNAL_ERROR    — DB failure.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateCompanySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(60).optional(),
  domain: z.string().max(253).optional().nullable(),
  timezone: z.string().min(1).max(64).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = CreateCompanySchema.safeParse(body);
  if (!parsed.success) {
    return validationError(
      "Body must be { name: string, slug?: string, domain?: string|null, timezone?: string }.",
      { issues: parsed.error.issues },
    );
  }

  const result = await createPlatformCompany({
    name: parsed.data.name,
    slug: parsed.data.slug,
    domain: parsed.data.domain ?? null,
    timezone: parsed.data.timezone,
    createdBy: gate.user?.id ?? null,
  });

  if (!result.ok) {
    if (result.error.code === "INTERNAL_ERROR") {
      logger.error("admin.companies.create.failed", {
        code: result.error.code,
        message: result.error.message,
      });
    }
    return respond(result);
  }

  // Revalidate the list page so the new company appears on next render.
  revalidatePath("/admin/companies");

  return NextResponse.json(
    {
      ok: true,
      data: { company: result.data },
      timestamp: new Date().toISOString(),
    },
    { status: 201 },
  );
}
