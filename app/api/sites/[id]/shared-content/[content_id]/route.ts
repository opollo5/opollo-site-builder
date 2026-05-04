import { z } from "zod";
import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  softDeleteSharedContent,
  updateSharedContent,
} from "@/lib/shared-content";
import {
  parseBodyWith,
  readJsonBody,
  respond,
  validateUuidParam,
} from "@/lib/http";

export const runtime = "nodejs";

type RouteContext = { params: { id: string; content_id: string } };

const UpdateBodySchema = z.object({
  version_lock: z.number().int().nonnegative(),
  label:        z.string().min(1).max(200).optional(),
  content:      z.record(z.string(), z.unknown()).optional(),
  updated_by:   z.string().uuid().nullable().optional(),
});

// PATCH /api/sites/[id]/shared-content/[content_id]
export async function PATCH(req: Request, ctx: RouteContext) {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const siteParam = validateUuidParam(ctx.params.id, "id");
  if (!siteParam.ok) return siteParam.response;

  const idParam = validateUuidParam(ctx.params.content_id, "content_id");
  if (!idParam.ok) return idParam.response;

  const parsed = parseBodyWith(UpdateBodySchema, await readJsonBody(req));
  if (!parsed.ok) return parsed.response;

  const { version_lock, ...patch } = parsed.data;
  return respond(await updateSharedContent(idParam.value, patch, version_lock));
}

const DeleteBodySchema = z.object({
  deleted_by: z.string().uuid().nullable().optional(),
});

// DELETE /api/sites/[id]/shared-content/[content_id]
export async function DELETE(req: Request, ctx: RouteContext) {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const siteParam = validateUuidParam(ctx.params.id, "id");
  if (!siteParam.ok) return siteParam.response;

  const idParam = validateUuidParam(ctx.params.content_id, "content_id");
  if (!idParam.ok) return idParam.response;

  const parsed = parseBodyWith(DeleteBodySchema, await readJsonBody(req));
  if (!parsed.ok) return parsed.response;

  return respond(
    await softDeleteSharedContent(idParam.value, parsed.data.deleted_by ?? null),
  );
}
