import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readJsonBody, validationError, internalError, notFound } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import {
  createPostMaster,
  listPostMasters,
  type SocialPostState,
} from "@/lib/platform/social/posts";

// ---------------------------------------------------------------------------
// S1-2 — HTTP API for social_post_master.
//
//   POST /api/platform/social/posts — create a new draft post.
//     Body: { company_id, master_text?, link_url?, source_type? }
//     Gate: canDo("create_post", company_id) — editor+.
//
//   GET /api/platform/social/posts?company_id=...&state=draft,approved
//     Gate: canDo("view_calendar", company_id) — viewer+.
//
// Errors follow the standard envelope shape used across the platform
// layer (lib/tool-schemas ApiResponse). State machine transitions
// (submit / approve / schedule / publish) live in their dedicated
// per-slice routes; this slice ships only the editorial CRUD surface.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATES: readonly SocialPostState[] = [
  "draft",
  "pending_client_approval",
  "approved",
  "rejected",
  "changes_requested",
  "scheduled",
  "publishing",
  "published",
  "failed",
];

const CreateSchema = z.object({
  company_id: z.string().uuid(),
  master_text: z.string().max(10_000).optional(),
  link_url: z.string().url().max(2048).optional(),
  source_type: z.enum(["manual", "csv", "cap", "api"]).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(
      "Body must be { company_id: uuid, master_text?: string, link_url?: string, source_type?: 'manual'|'csv'|'cap'|'api' }.",
      { issues: parsed.error.issues },
    );
  }

  const gate = await requireCanDoForApi(parsed.data.company_id, "create_post");
  if (gate.kind === "deny") return gate.response;

  const result = await createPostMaster({
    companyId: parsed.data.company_id,
    masterText: parsed.data.master_text ?? null,
    linkUrl: parsed.data.link_url ?? null,
    sourceType: parsed.data.source_type ?? "manual",
    createdBy: gate.userId,
  });

  if (!result.ok) {
    if (result.error.code === "VALIDATION_FAILED") return validationError(result.error.message);
    if (result.error.code === "NOT_FOUND") return notFound(result.error.message);
    return internalError(result.error.message);
  }

  return NextResponse.json(
    {
      ok: true,
      data: { post: result.data },
      timestamp: new Date().toISOString(),
    },
    { status: 201 },
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id");
  if (!companyId) {
    return validationError("company_id query parameter is required.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) {
    return validationError("company_id must be a UUID.");
  }

  const gate = await requireCanDoForApi(companyId, "view_calendar");
  if (gate.kind === "deny") return gate.response;

  const stateParam = url.searchParams.get("state");
  const states = stateParam
    ? stateParam
        .split(",")
        .map((s) => s.trim())
        .filter(
          (s): s is SocialPostState =>
            VALID_STATES.includes(s as SocialPostState),
        )
    : undefined;

  const limit = parseIntOr(url.searchParams.get("limit"));
  const offset = parseIntOr(url.searchParams.get("offset"));

  const result = await listPostMasters({
    companyId,
    states,
    limit: limit ?? undefined,
    offset: offset ?? undefined,
  });

  if (!result.ok) {
    if (result.error.code === "VALIDATION_FAILED") return validationError(result.error.message);
    return internalError(result.error.message);
  }

  return NextResponse.json(
    {
      ok: true,
      data: result.data,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}

function parseIntOr(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}
