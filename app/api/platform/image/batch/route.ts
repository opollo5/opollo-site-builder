import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { dbUuid, internalError, readJsonBody, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { dispatchImageBatch } from "@/lib/image/dispatch";

// ---------------------------------------------------------------------------
// POST /api/platform/image/batch
//
// Creates a batch + N image_generation_jobs, enqueues one QStash message per
// job, returns the batchId for the operator to poll.
//
// Budget pre-flight, batch+job creation, QStash enqueue, and batch-state
// advancement all live in lib/image/dispatch.ts so the C4 ingest route can
// reuse the same surface without re-authing or duplicating side-effects.
//
// §1.2: route under /api/platform/image/*, not /social/
// §1.7: one job per distinct aspect ratio derived from target_platforms.
// §1.6: no signed URLs stored; result_storage_path set by the handler.
//
// Auth: canDo("create_post") — editor+.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JobSpecSchema = z.object({
  styleId: z.enum(["clean_corporate", "bold_promo", "minimal_modern", "editorial", "product_focus"]),
  primaryColour: z.string(),
  compositionType: z.enum(["split_layout", "gradient_fade", "full_background", "geometric", "texture"]),
  aspectRatio: z.enum(["1x1", "4x5", "9x16", "16x9", "4x3"]),
  industry: z.string().optional(),
  targetPlatforms: z.array(z.string()).optional(),
  targetPublishDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  parentPostIndex: z.number().int().min(0).optional(),
});

const BatchSchema = z.object({
  company_id: dbUuid(),
  jobs: z.array(JobSpecSchema).min(1).max(100),
  source_filename: z.string().optional(),
  source_row_count: z.number().int().min(1).optional(),
  mode: z.enum(["generate", "preview"]).default("generate"),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");

  const parsed = BatchSchema.safeParse(body);
  if (!parsed.success) {
    return validationError("Invalid batch spec.", { issues: parsed.error.issues });
  }

  const { company_id, jobs, source_filename, source_row_count, mode } = parsed.data;

  const gate = await requireCanDoForApi(company_id, "create_post");
  if (gate.kind === "deny") return gate.response;

  const result = await dispatchImageBatch({
    companyId: company_id,
    triggeredBy: gate.userId,
    jobs,
    mode,
    sourceFilename: source_filename,
    sourceRowCount: source_row_count,
  });

  if (!result.ok) {
    if (result.code === "BUDGET_EXCEEDED") {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: result.code,
            message: result.message,
            ...result.details,
          },
          timestamp: new Date().toISOString(),
        },
        { status: 402 },
      );
    }
    return internalError(result.message);
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        batchId: result.batchId,
        totalJobs: result.totalJobs,
        mode: result.mode,
        ...(result.enqueueErrors && { enqueueErrors: result.enqueueErrors }),
      },
      timestamp: new Date().toISOString(),
    },
    { status: 201 },
  );
}
