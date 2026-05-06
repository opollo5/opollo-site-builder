import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { conflict, internalError, notFound, readJsonBody, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { updateTenantBudget } from "@/lib/tenant-budgets";

// ---------------------------------------------------------------------------
// PATCH /api/admin/sites/[id]/budget — M8-5.
//
// Admin-only. Edit daily / monthly caps on tenant_cost_budgets.
// Optimistic-locked on version_lock; concurrent edits surface
// VERSION_CONFLICT (409) with the current server-side version.
//
// Caps must be non-negative integers ≤ 10M cents ($100,000). 0 is a
// valid paused-tenant state.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_CAP_CENTS = 10_000_000;

const PatchSchema = z
  .object({
    daily_cap_cents: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_CAP_CENTS)
      .optional(),
    monthly_cap_cents: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_CAP_CENTS)
      .optional(),
  })
  .refine(
    (p) =>
      p.daily_cap_cents !== undefined || p.monthly_cap_cents !== undefined,
    { message: "At least one of daily_cap_cents or monthly_cap_cents is required." },
  );

const BodySchema = z.object({
  expected_version: z.number().int().min(1),
  patch: PatchSchema,
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  // M15-4 #17: admin-only (NOT admin+operator like sibling routes).
  // Budget edits are financial controls — operator role can VIEW the
  // current usage on the site detail page but cannot raise / lower
  // caps. Tightening this rule needs an explicit role-policy decision,
  // not a drive-by widening.
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const rl = await checkRateLimit("admin_write", `user:${gate.user?.id ?? "unknown"}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  if (!UUID_RE.test(params.id)) {
    return validationError("Site id must be a UUID.");
  }

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return validationError("Body failed validation.", { issues: parsed.error.issues });
  }

  const result = await updateTenantBudget(
    params.id,
    parsed.data.expected_version,
    parsed.data.patch,
    gate.user?.id ?? null,
  );

  if (!result.ok) {
    logger.error("updateTenantBudget failed", { code: result.code });
    if (result.code === "VERSION_CONFLICT") {
      return conflict("VERSION_CONFLICT", result.message, result.details);
    }
    if (result.code === "NOT_FOUND") {
      return notFound(result.message);
    }
    return internalError(result.message);
  }

  revalidatePath(`/admin/sites/${params.id}`);

  return NextResponse.json(
    {
      ok: true,
      data: result.budget,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
