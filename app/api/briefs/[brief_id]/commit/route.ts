import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
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
// M12-2 — accepts optional brand_voice + design_direction in the body;
//         those fields are persisted atomically with the committed
//         transition. Both are nullable strings capped at 4 KB. Omitted
//         fields preserve whatever value is currently on the row
//         (don't-touch semantics — see commitBrief input docs).
//
// Body:
//   {
//     expected_version_lock: int,
//     page_hash: string,
//     brand_voice?: string | null,
//     design_direction?: string | null,
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
});

export async function POST(
  req: Request,
  { params }: { params: { brief_id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
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

  return respond(result);
}
