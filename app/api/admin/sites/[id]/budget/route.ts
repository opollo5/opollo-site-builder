import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { updateTenantBudget } from "@/lib/tenant-budgets";
import { errorCodeToStatus } from "@/lib/tool-schemas";

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

function errorJson(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false, ...(details ? { details } : {}) },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  // M15-4 #17: admin-only (NOT admin+operator like sibling routes).
  // Budget edits are financial controls — operator role can VIEW the
  // current usage on the site detail page but cannot raise / lower
  // caps. Tightening this rule needs an explicit role-policy decision,
  // not a drive-by widening.
  const gate = await requireAdminForApi();
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
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Body failed validation.",
          details: { issues: parsed.error.issues },
          retryable: false, // VALIDATION_FAILED is not retryable — same input loops forever (M15-4 #5)
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const result = await updateTenantBudget(
    params.id,
    parsed.data.expected_version,
    parsed.data.patch,
    gate.user?.id ?? null,
  );

  if (!result.ok) {
    const status = errorCodeToStatus(
      result.code === "VERSION_CONFLICT"
        ? "VERSION_CONFLICT"
        : result.code === "NOT_FOUND"
          ? "NOT_FOUND"
          : "INTERNAL_ERROR",
    );
    return errorJson(result.code, result.message, status, result.details);
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
