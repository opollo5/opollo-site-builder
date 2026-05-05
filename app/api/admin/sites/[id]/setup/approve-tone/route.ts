import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { readJsonBody } from "@/lib/http";
import { getServiceRoleClient } from "@/lib/supabase";

// POST /api/admin/sites/[id]/setup/approve-tone — admin-gated.
//   Body: { tone_of_voice, approved_samples }
//   Persists tone_of_voice JSON (with approved_samples folded in) and
//   flips status to 'approved'.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ToneSchema = z.object({
  formality_level: z.number().min(1).max(5),
  sentence_length: z.union([
    z.literal("short"),
    z.literal("medium"),
    z.literal("long"),
  ]),
  jargon_usage: z.union([
    z.literal("embraced"),
    z.literal("neutral"),
    z.literal("avoided"),
  ]),
  personality_markers: z.array(z.string()),
  avoid_markers: z.array(z.string()),
  target_audience: z.string(),
  style_guide: z.string().min(1),
});

const SampleSchema = z.object({
  kind: z.union([
    z.literal("hero"),
    z.literal("service"),
    z.literal("blog"),
  ]),
  text: z.string().min(1).max(800),
});

const BodySchema = z.object({
  tone_of_voice: ToneSchema,
  approved_samples: z.array(SampleSchema).max(5),
});

function errorJson(code: string, message: string, status: number): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return errorJson("VALIDATION_FAILED", "Site id must be a UUID.", 400);
  }

  const body = await readJsonBody(req);
  if (body === undefined) return errorJson("VALIDATION_FAILED", "Request body must be valid JSON.", 400);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Body failed validation.",
          details: { issues: parsed.error.issues },
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("sites")
    .update({
      tone_of_voice: {
        ...parsed.data.tone_of_voice,
        approved_samples: parsed.data.approved_samples,
      },
      tone_of_voice_status: "approved",
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .neq("status", "removed")
    .select("id")
    .maybeSingle();
  if (error) {
    return errorJson("INTERNAL_ERROR", error.message, 500);
  }
  if (!data) {
    return errorJson("NOT_FOUND", `No active site found with id ${params.id}.`, 404);
  }

  revalidatePath(`/admin/sites/${params.id}/setup`);
  revalidatePath(`/admin/sites/${params.id}`);
  return NextResponse.json(
    { ok: true, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
