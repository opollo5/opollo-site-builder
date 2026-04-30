import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkAdminAccess } from "@/lib/admin-gate";
import {
  addPageManually,
  listLandingPagesForClient,
  setManagedFlag,
} from "@/lib/optimiser/landing-pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AddBody = z.object({
  url: z.string().url(),
  display_name: z.string().optional(),
});

const SelectBody = z.object({
  managed: z.array(z.string().uuid()),
  unmanaged: z.array(z.string().uuid()).optional(),
});

export async function GET(
  _req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const access = await checkAdminAccess();
  if (access.kind === "redirect") {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Not authorised" } },
      { status: 401 },
    );
  }
  const pages = await listLandingPagesForClient(ctx.params.id);
  return NextResponse.json({ ok: true, data: { pages } });
}

export async function POST(
  req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const access = await checkAdminAccess({ requiredRoles: ["super_admin", "admin"] });
  if (access.kind === "redirect") {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Not authorised" } },
      { status: 401 },
    );
  }
  let body;
  try {
    body = AddBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_BODY",
          message: err instanceof Error ? err.message : "Invalid body",
        },
      },
      { status: 400 },
    );
  }
  try {
    const page = await addPageManually({
      clientId: ctx.params.id,
      url: body.url,
      displayName: body.display_name,
      userId: access.user?.id ?? null,
    });
    return NextResponse.json({ ok: true, data: { page } }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "ADD_FAILED",
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 500 },
    );
  }
}

// Bulk select / unselect — applied at the end of step 5 of onboarding
// and reusable from the page browser (Slice 4) for ongoing management.
export async function PATCH(
  req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const access = await checkAdminAccess({ requiredRoles: ["super_admin", "admin"] });
  if (access.kind === "redirect") {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Not authorised" } },
      { status: 401 },
    );
  }
  let body;
  try {
    body = SelectBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_BODY",
          message: err instanceof Error ? err.message : "Invalid body",
        },
      },
      { status: 400 },
    );
  }
  const userId = access.user?.id ?? null;
  const managed = await setManagedFlag(ctx.params.id, body.managed, true, userId);
  const unmanaged = body.unmanaged?.length
    ? await setManagedFlag(ctx.params.id, body.unmanaged, false, userId)
    : { updated: 0 };
  return NextResponse.json({
    ok: true,
    data: {
      managed_updated: managed.updated,
      unmanaged_updated: unmanaged.updated,
    },
  });
}
