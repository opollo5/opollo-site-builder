import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { dbUuid, readJsonBody, validationError, internalError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import {
  listPostMasters,
  type SocialPostState,
} from "@/lib/platform/social/posts";
import { listConnections } from "@/lib/platform/social/connections";

// ---------------------------------------------------------------------------
// S1-2 — HTTP API for social_post_master / social_post_drafts.
//
//   POST /api/platform/social/posts — create a new draft post (V2 path:
//     writes to social_post_drafts). PR-07 V1→V2 migration.
//     Body: { company_id, master_text?, link_url?, source_type? }
//     Gate: canDo("create_post", company_id) — editor+.
//
//   GET /api/platform/social/posts?company_id=...&state=draft,approved
//     Gate: canDo("view_calendar", company_id) — viewer+.
//     Still reads from social_post_master (migrated in PR-15).
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
  company_id: dbUuid(),
  master_text: z.string().max(10_000).optional(),
  link_url: z.string().url().max(2048).optional(),
  source_type: z.enum(["manual", "csv", "cap", "api"]).optional(),
  // Optional: IDs of social_connections rows. For each, a variant row is
  // created with the connection's platform + connection_id set.
  connection_ids: z.array(z.string().uuid()).max(20).optional(),
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

  const { company_id: companyId, master_text, link_url, source_type, connection_ids } = parsed.data;

  const gate = await requireCanDoForApi(companyId, "create_post");
  if (gate.kind === "deny") return gate.response;

  const content = master_text?.trim() ?? null;
  const linkUrl = link_url?.trim() ?? null;

  if (content === null && linkUrl === null) {
    return validationError("A post must have at least master_text or link_url.");
  }

  // Resolve connection_ids to target_profiles. Only include IDs that belong
  // to this company (listConnections is company-scoped). V2 stores targets in
  // the target_profiles JSONB array instead of variant rows.
  let targetProfiles: Array<{ profile_id: string }> = [];
  if (connection_ids && connection_ids.length > 0) {
    const connectionsResult = await listConnections({ companyId });
    if (connectionsResult.ok) {
      const ownedIds = new Set(connectionsResult.data.connections.map((c) => c.id));
      targetProfiles = connection_ids
        .filter((id) => ownedIds.has(id))
        .map((id) => ({ profile_id: id }));
    }
  }

  const svc = getServiceRoleClient();
  const { data: draft, error } = await svc
    .from("social_post_drafts")
    .insert({
      company_id:        companyId,
      state:             "draft" as const,
      source_type:       source_type ?? "manual",
      content,
      link_url:          linkUrl,
      created_by:        gate.userId,
      updated_by:        gate.userId,
      media_urls:        [] as string[],
      target_profiles:   targetProfiles,
      platform_variants: {} as Record<string, unknown>,
    })
    .select("id, company_id, state, source_type, content, link_url, created_by, created_at, updated_at")
    .single();

  if (error) {
    logger.error("social.posts.create_v2.failed", {
      companyId,
      err: error.message,
      code: error.code,
    });
    return internalError(`Failed to create post: ${error.message}`);
  }

  return NextResponse.json(
    {
      ok: true,
      data: { post: draft },
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
