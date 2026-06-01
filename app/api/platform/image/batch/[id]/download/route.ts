import { NextResponse, type NextRequest } from "next/server";
import { Zip, ZipPassThrough } from "fflate";

import { internalError, notFound, validateUuidParam, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/platform/image/batch/[id]/download?company_id=UUID
//
// Streams a ZIP of approved assets for a download-mode batch (D6, D7, E).
//
// For destination='download' batches: only jobs with image_selections.selected=true
// are included. For destination='publish' batches: all completed jobs (same
// as the original PR-1219 behaviour).
//
// Uses fflate ZipPassThrough (level=0, PNGs already compressed) + 10-concurrent
// Supabase Storage fetches. maxDuration=300.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const IMAGE_GEN_BUCKET = process.env.IMAGE_GENERATION_BUCKET ?? "generated-images";
const SIGNED_URL_TTL = 900;
const FETCH_CONCURRENCY = 10;
const HARD_CAP = 500;
const SOFT_WARNING = 100;
const IMAGE_FETCH_TIMEOUT_MS = 20_000;

interface JobRow {
  id: string;
  result_storage_path: string;
  parent_post_index: number | null;
  generation_params: Record<string, unknown> | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const idCheck = validateUuidParam(id, "id");
  if (!idCheck.ok) return idCheck.response;
  const batchId = idCheck.value;

  const companyId = new URL(req.url).searchParams.get("company_id");
  if (!companyId) return validationError("company_id query param is required.");

  const svc = getServiceRoleClient();

  // Auth + company-scope guard.
  const { data: batch, error: batchErr } = await svc
    .from("image_generation_batches")
    .select("id, company_id, state, total_jobs, destination")
    .eq("id", batchId)
    .single();

  if (batchErr || !batch) {
    if (batchErr?.code === "PGRST116") return notFound(`Batch ${batchId} not found.`);
    return internalError("Failed to fetch batch.");
  }

  if ((batch.company_id as string) !== companyId) return notFound(`Batch ${batchId} not found.`);

  const gate = await requireCanDoForApi(companyId, "create_post");
  if (gate.kind === "deny") return gate.response;

  const isDownloadMode = (batch.destination as string | null) === "download";

  // For download mode: only approved (selected=true) items.
  // For publish mode: all completed jobs (original behaviour).
  let jobs: JobRow[];

  if (isDownloadMode) {
    // JOIN image_generation_jobs → image_selections WHERE selected=true.
    const { data: selRows, error: selErr } = await svc
      .from("image_selections")
      .select("job_id")
      .eq("selected", true)
      .in(
        "job_id",
        // sub-select job IDs for this batch
        (await svc
          .from("image_generation_jobs")
          .select("id")
          .eq("batch_id", batchId)
          .eq("state", "completed")
          .not("result_storage_path", "is", null)
          .then(({ data }) => (data ?? []).map((j: { id: string }) => j.id))),
      );

    if (selErr) {
      logger.error("image.batch.download.sel_failed", { batchId, err: selErr.message });
      return internalError("Failed to fetch approved set.");
    }

    const approvedJobIds = new Set((selRows ?? []).map((r: { job_id: string }) => r.job_id));
    if (approvedJobIds.size === 0) {
      return NextResponse.json(
        { ok: false, error: { code: "NO_APPROVED_IMAGES", message: "No approved images in download set." } },
        { status: 422 },
      );
    }

    const { data: jobRows, error: jobErr } = await svc
      .from("image_generation_jobs")
      .select("id, result_storage_path, parent_post_index, generation_params")
      .eq("batch_id", batchId)
      .eq("state", "completed")
      .not("result_storage_path", "is", null)
      .in("id", [...approvedJobIds]);

    if (jobErr) return internalError("Failed to fetch jobs.");
    jobs = (jobRows ?? []) as JobRow[];
  } else {
    // Publish mode or no destination: all completed jobs (original behaviour).
    const { data: jobRows, error: jobErr } = await svc
      .from("image_generation_jobs")
      .select("id, result_storage_path, parent_post_index, generation_params")
      .eq("batch_id", batchId)
      .eq("state", "completed")
      .not("result_storage_path", "is", null)
      .order("parent_post_index", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true });

    if (jobErr) return internalError("Failed to fetch jobs.");
    jobs = (jobRows ?? []) as JobRow[];
  }

  if (jobs.length === 0) {
    return NextResponse.json(
      { ok: false, error: { code: "NO_COMPLETED_IMAGES", message: "No completed images to download." } },
      { status: 422 },
    );
  }

  if (jobs.length > HARD_CAP) {
    return NextResponse.json(
      { ok: false, error: { code: "BATCH_TOO_LARGE", message: `${jobs.length} images exceeds hard cap of ${HARD_CAP}.` } },
      { status: 413 },
    );
  }

  // Batch-sign storage paths.
  const paths = jobs.map((j) => j.result_storage_path);
  const { data: signed, error: signErr } = await svc.storage
    .from(IMAGE_GEN_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL);

  if (signErr || !signed) {
    logger.error("image.batch.download.sign_failed", { batchId, err: signErr?.message });
    return internalError("Failed to generate download URLs.");
  }

  const signedByPath = new Map<string, string>();
  for (const s of signed) {
    if (s.signedUrl && s.path) signedByPath.set(s.path, s.signedUrl);
  }

  // Stream ZIP.
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const skipped: Array<{ entryName: string; reason: string }> = [];

  void buildZip({ jobs, signedByPath, writer, skipped, batchId });

  const filename = `batch-${batchId.slice(0, 8)}.zip`;
  const headers = new Headers({
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  });
  if (jobs.length > SOFT_WARNING) {
    headers.set("X-Download-Warning", `large-batch: ${jobs.length} images`);
  }

  logger.info("image.batch.download.started", { batchId, companyId, count: jobs.length, isDownloadMode });
  return new NextResponse(readable, { headers });
}

// ─── ZIP builder ──────────────────────────────────────────────────────────────

async function buildZip({
  jobs,
  signedByPath,
  writer,
  skipped,
  batchId,
}: {
  jobs: JobRow[];
  signedByPath: Map<string, string>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  skipped: Array<{ entryName: string; reason: string }>;
  batchId: string;
}): Promise<void> {
  const chunkQueue: Uint8Array[] = [];
  let zipError: Error | null = null;

  const zip = new Zip((err, chunk, final) => {
    if (err) { zipError = err; return; }
    chunkQueue.push(chunk);
    if (final) void drain();
  });

  async function drain(): Promise<void> {
    while (chunkQueue.length > 0) {
      await writer.write(chunkQueue.shift()!);
    }
  }

  let inFlight = 0;
  const queue: Array<() => void> = [];

  function acquireSlot(): Promise<void> {
    if (inFlight < FETCH_CONCURRENCY) { inFlight++; return Promise.resolve(); }
    return new Promise((r) => queue.push(r));
  }

  function releaseSlot(): void {
    inFlight--;
    const next = queue.shift();
    if (next) { inFlight++; next(); }
  }

  try {
    await Promise.all(
      jobs.map(async (job) => {
        const entryName = buildEntryName(job);
        await acquireSlot();
        try {
          const signedUrl = signedByPath.get(job.result_storage_path);
          if (!signedUrl) { skipped.push({ entryName, reason: "no_signed_url" }); return; }

          let imgBuf: Buffer;
          try {
            const resp = await fetch(signedUrl, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
            if (!resp.ok) {
              skipped.push({ entryName, reason: `http_${resp.status}` });
              logger.warn("image.batch.download.fetch_failed", { batchId, jobId: job.id, status: resp.status });
              return;
            }
            imgBuf = Buffer.from(await resp.arrayBuffer());
          } catch (err) {
            skipped.push({ entryName, reason: err instanceof Error && err.name === "TimeoutError" ? "timeout" : "fetch_error" });
            logger.warn("image.batch.download.fetch_error", { batchId, jobId: job.id });
            return;
          }

          const entry = new ZipPassThrough(entryName);
          zip.add(entry);
          entry.push(imgBuf, true);
          await drain();
        } finally {
          releaseSlot();
        }
      }),
    );

    if (skipped.length > 0) {
      const lines = [`manifest.txt — skipped images in batch ${batchId}`, "", ...skipped.map((s) => `SKIPPED  ${s.entryName}  reason: ${s.reason}`), "", `Total skipped: ${skipped.length} / ${jobs.length}`];
      const manifestEntry = new ZipPassThrough("manifest.txt");
      zip.add(manifestEntry);
      manifestEntry.push(Buffer.from(lines.join("\n"), "utf-8"), true);
      await drain();
    }

    zip.end();
    if (zipError) throw zipError;
    await drain();
    logger.info("image.batch.download.complete", { batchId, total: jobs.length, skipped: skipped.length });
  } catch (err) {
    logger.error("image.batch.download.zip_error", { batchId, err: err instanceof Error ? err.message : String(err) });
    await writer.abort(err instanceof Error ? err : new Error(String(err)));
    return;
  }
  await writer.close();
}

function buildEntryName(job: JobRow): string {
  const row = job.parent_post_index !== null ? `row-${job.parent_post_index}` : "row-unknown";
  const params = job.generation_params;
  const variant = params && typeof params.variantKey === "string" ? params.variantKey : "base";
  return `${row}/${variant}-${job.id.slice(0, 8)}.png`;
}
