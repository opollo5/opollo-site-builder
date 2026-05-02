import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireAdminForApi();
  if (gate.kind === "deny") return gate.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = CreateCompanySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message:
            "Body must be { name: string, slug?: string, domain?: string|null, timezone?: string }.",
          details: { issues: parsed.error.issues },
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
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
    const code = result.error.code;
    const status =
      code === "VALIDATION_FAILED"
        ? 400
        : code === "ALREADY_EXISTS"
          ? 409
          : 500;
    if (status >= 500) {
      logger.error("admin.companies.create.failed", {
        code,
        message: result.error.message,
      });
    }
    return errorJson(code, result.error.message, status);
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
