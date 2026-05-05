import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { ANTHROPIC_MODEL_ALLOWLIST } from "@/lib/anthropic-pricing";
import { commitBrief } from "@/lib/briefs";
import {
  parseBodyWith,
  readJsonBody,
  respond,
  validateUuidParam,
} from "@/lib/http";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// M12-1 — POST /api/briefs/[brief_id]/commit.
// M12-2 — accepts optional brand_voice + design_direction in the body.
// M12-5 — accepts optional text_model + visual_model (allowlist-validated)
//         so the operator can pick per-brief tiers on the review surface.
//
// Body:
//   {
//     expected_version_lock: int,
//     page_hash: string,
//     brand_voice?: string | null,
//     design_direction?: string | null,
//     text_model?: string,        // must be in ANTHROPIC_MODEL_ALLOWLIST
//     visual_model?: string,      // must be in ANTHROPIC_MODEL_ALLOWLIST
//   }
//
// Freezes the brief's page list under optimistic-concurrency. Idempotent
// on (brief_id, page_hash): a replay with the same hash returns
// replay=true; a replay with a different hash → ALREADY_EXISTS.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 4 KB cap on brand_voice + design_direction prose. Descriptive fields;
// not documents. Anything longer is almost certainly an operator pasting
// the wrong thing into the wrong field.
const VOICE_DIRECTION_MAX_BYTES = 4096;

const ModelSchema = z
  .string()
  .refine(
    (v) => ANTHROPIC_MODEL_ALLOWLIST.includes(v),
    { message: "Unknown model id. Pick from the operator form's dropdown." },
  );

const CommitBodySchema = z.object({
  expected_version_lock: z.number().int().nonnegative(),
  page_hash: z.string().min(32).max(256),
  brand_voice: z
    .string()
    .max(VOICE_DIRECTION_MAX_BYTES)
    .nullable()
    .optional(),
  design_direction: z
    .string()
    .max(VOICE_DIRECTION_MAX_BYTES)
    .nullable()
    .optional(),
  text_model: ModelSchema.optional(),
  visual_model: ModelSchema.optional(),
});

export async function POST(
  req: Request,
  { params }: { params: { brief_id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const idCheck = validateUuidParam(params.brief_id, "brief_id");
  if (!idCheck.ok) return idCheck.response;

  const body = await readJsonBody(req);
  const parsed = parseBodyWith(CommitBodySchema, body);
  if (!parsed.ok) return parsed.response;

  const result = await commitBrief({
    briefId: idCheck.value,
    expectedVersionLock: parsed.data.expected_version_lock,
    pageHash: parsed.data.page_hash,
    committedBy: gate.user?.id ?? null,
    brandVoice: parsed.data.brand_voice,
    designDirection: parsed.data.design_direction,
    textModel: parsed.data.text_model,
    visualModel: parsed.data.visual_model,
  });

  if (!result.ok) {
    logger.warn("briefs.commit.failed", {
      brief_id: idCheck.value,
      code: result.error.code,
    });
    return respond(result);
  }

  // Bust the review page render so the post-commit read sees the frozen state.
  const svc = getServiceRoleClient();
  const lookup = await svc.from("briefs").select("site_id").eq("id", idCheck.value).maybeSingle();
  const siteId = (lookup.data?.site_id as string | undefined) ?? null;
  if (siteId) {
    revalidatePath(`/admin/sites/${siteId}/briefs/${idCheck.value}/review`);
    revalidatePath(`/admin/sites/${siteId}`);
  }

  // UAT (2026-05-03 round-3): commit→/run race elimination.
  //
  // The COMMIT writes via lib/briefs.commitBrief which uses pg.Client (a
  // direct connection). The /run server-render reads the brief via
  // PostgREST (a separate connection pool). Even though the COMMIT has
  // returned, PostgREST occasionally serves a stale read from a
  // connection that hasn't yet seen the write. Operators land on /run
  // and see "isn't committed yet" for several seconds.
  //
  // Fix: before this handler returns, re-read the brief via PostgREST
  // (the same path /run will use) until status='committed' is visible
  // OR a 5s ceiling expires. The retry adds latency to the commit POST
  // but eliminates the misleading "not committed yet" panel that follows.
  // Worth it — a 1s wait is invisible on a click; a "broken-looking
  // page" on the next nav is jarring.
  const visibilityCheckStartMs = Date.now();
  const VISIBILITY_TIMEOUT_MS = 5000;
  while (Date.now() - visibilityCheckStartMs < VISIBILITY_TIMEOUT_MS) {
    const peek = await svc
      .from("briefs")
      .select("status")
      .eq("id", idCheck.value)
      .maybeSingle();
    if (peek.data?.status === "committed") break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return respond(result);
}
