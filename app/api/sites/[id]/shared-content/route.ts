import { z } from "zod";
import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  createSharedContent,
  listSharedContent,
} from "@/lib/shared-content";
import {
  parseBodyWith,
  readJsonBody,
  respond,
  validateUuidParam,
} from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: { id: string } };

// GET /api/sites/[id]/shared-content
export async function GET(_req: Request, ctx: RouteContext) {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const param = validateUuidParam(ctx.params.id, "id");
  if (!param.ok) return param.response;

  return respond(await listSharedContent(param.value));
}

const CONTENT_TYPES = ["cta", "testimonial", "service", "faq", "stat", "offer"] as const;

const CreateBodySchema = z.object({
  content_type: z.enum(CONTENT_TYPES),
  label:        z.string().min(1).max(200),
  content:      z.record(z.string(), z.unknown()).optional().default({}),
  created_by:   z.string().uuid().nullable().optional(),
});

// POST /api/sites/[id]/shared-content
export async function POST(req: Request, ctx: RouteContext) {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const param = validateUuidParam(ctx.params.id, "id");
  if (!param.ok) return param.response;

  const parsed = parseBodyWith(CreateBodySchema, await readJsonBody(req));
  if (!parsed.ok) return parsed.response;

  return respond(
    await createSharedContent({
      site_id:      param.value,
      content_type: parsed.data.content_type,
      label:        parsed.data.label,
      content:      parsed.data.content,
      created_by:   parsed.data.created_by ?? null,
    }),
  );
}
