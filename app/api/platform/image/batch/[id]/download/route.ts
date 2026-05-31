import { NextResponse, type NextRequest } from "next/server";
import { Zip, ZipPassThrough } from "fflate";

import { internalError, notFound, validateUuidParam, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/platform/image/batch/[id]/download?company_id=UUID
//
// Stream a ZIP of all completed images in a batch.
//
// Auth: company_id query param → requireCanDoForApi("create_post").
//       Batch must belong to that company (company-scope guard).
//
// Pipeline:
//   1. Fetch batch + auth check
//   2. Fetch all completed jobs (result_storage_path not null)
//   3. Batch-sign storage paths
//   4. Stream ZIP: fetch images 10-at-a-time via semaphore, append each to
//      a fflate streaming Zip as it arrives, pipe bytes to the response
//      immediately (client download starts on the first chunk)
//   5. Append manifest.txt listing skipped images (fetch failures)
//
// Caps:
//   Hard cap: 500 completed images → 413
//   Soft cap: >100 images → X-Download-Warning header (in response)
//
// ZIP file layout:
//   row-{parentPostIndex}/{variantKey ?? "base"}-{jobId[0:8]}.png
//   manifest.txt   (present only when ≥1 image skipped)
//
// Stream semantics: fflate Zip emits chunks as each image is appended.
// ZipPassThrough is used (level=0) because PNGs are already compressed.
// Memory profile: 10 concurrent image buffers in flight, not the full set.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — same as QStash handler TTL

const IMAGE_GEN_BUCKET = process.env.IMAGE_GENERATION_BUCKET ?? "generated-images";
const SIGNED_URL_TTL = 900; // 15 min — enough for the download stream
const FETCH_CONCURRENCY = 10;
const HARD_CAP = 500;
const SOFT_WARNING_THRESHOLD = 100;
const IMAGE_FETCH_TIMEOUT_MS = 20_000;

interface CompletedJob {
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

  // company_id from query (required for auth scope)
  const companyId = new URL(req.url).searchParams.get("company_id");
  if (!companyId) return validationError("company_id query param is required.");

  const svc = getServiceRoleClient();

  // ─── 1. Fetch batch + company-scope check ────────────────────────────────
  const { data: batch, error: batchErr } = await svc
    .from("image_generation_batches")
    .select("id, company_id, state, total_jobs")
    .eq("id", batchId)
    .single();

  if (batchErr || !batch) {
    if (batchErr?.code === "PGRST116") return notFound(`Batch ${batchId} not found.`);
    logger.error("image.batch.download.fetch_failed", { batchId, error: batchErr?.message });
    return internalError("Failed to fetch batch.");
  }

  // Company-scope guard: batch must belong to the requesting company.
  if ((batch.company_id as string) !== companyId) {
    return notFound(`Batch ${batchId} not found.`);
  }

  const gate = await requireCanDoForApi(companyId, "create_post");
  if (gate.kind === "deny") return gate.response;

  // ─── 2. Fetch completed jobs ──────────────────────────────────────────────
  const { data: jobs, error: jobsErr } = await svc
    .from("image_generation_jobs")
    .select("id, result_storage_path, parent_post_index, generation_params")
    .eq("batch_id", batchId)
    .eq("state", "completed")
    .not("result_storage_path", "is", null)
    .order("parent_post_index", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });

  if (jobsErr) {
    logger.error("image.batch.download.jobs_failed", { batchId, error: jobsErr.message });
    return internalError("Failed to fetch batch jobs.");
  }

  const completedJobs = (jobs ?? []) as CompletedJob[];

  if (completedJobs.length === 0) {
    return NextResponse.json(
      { ok: false, error: { code: "NO_COMPLETED_IMAGES", message: "Batch has no completed images to download." } },
      { status: 422 },
    );
  }

  if (completedJobs.length > HARD_CAP) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BATCH_TOO_LARGE",
          message: `Batch has ${completedJobs.length} images; maximum download is ${HARD_CAP}. Filter by variant or split the batch.`,
        },
      },
      { status: 413 },
    );
  }

  // ─── 3. Batch-sign storage paths ─────────────────────────────────────────
  const paths = completedJobs.map((j) => j.result_storage_path);
  const { data: signed, error: signErr } = await svc.storage
    .from(IMAGE_GEN_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL);

  if (signErr || !signed) {
    logger.error("image.batch.download.sign_failed", { batchId, error: signErr?.message });
    return internalError("Failed to generate download URLs.");
  }

  // Build path → signedUrl map (Supabase returns them in the same order).
  const signedByPath = new Map<string, string>();
  for (const s of signed) {
    if (s.signedUrl && s.path) signedByPath.set(s.path, s.signedUrl);
  }

  // ─── 4. Stream ZIP via fflate ─────────────────────────────────────────────
  //
  // Strategy:
  //   - fflate Zip emits chunks via callback as each file is appended.
  //   - We pipe those chunks directly into a TransformStream writer.
  //   - The TransformStream.readable is the response body — client bytes
  //     start flowing after the first image is appended, not after all are done.
  //   - ZipPassThrough (level=0) is used because PNGs are already deflate-
  //     compressed; re-compressing wastes CPU for negligible size gain.
  //   - A semaphore limits concurrent Supabase Storage fetches to FETCH_CONCURRENCY.
  //   - Per-image failures: skip + record to manifest (Steven's ask).

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  const skipped: Array<{ entryName: string; reason: string }> = [];

  // Run the ZIP construction in the background — the async function resolves
  // after the last byte is written, but the readable is already being consumed.
  void buildZip({
    jobs: completedJobs,
    signedByPath,
    writer,
    skipped,
    batchId,
  });

  const filename = `batch-${batchId.slice(0, 8)}.zip`;
  const headers = new Headers({
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  });

  if (completedJobs.length > SOFT_WARNING_THRESHOLD) {
    headers.set(
      "X-Download-Warning",
      `large-batch: ${completedJobs.length} images; download may take 30-60s`,
    );
  }

  logger.info("image.batch.download.started", {
    batchId,
    companyId,
    imageCount: completedJobs.length,
  });

  return new NextResponse(readable, { headers });
}

// ─── ZIP builder (runs in background, writes to stream writer) ───────────────

async function buildZip({
  jobs,
  signedByPath,
  writer,
  skipped,
  batchId,
}: {
  jobs: CompletedJob[];
  signedByPath: Map<string, string>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  skipped: Array<{ entryName: string; reason: string }>;
  batchId: string;
}): Promise<void> {
  // fflate Zip emits chunks synchronously as each file is pushed.
  // We collect them into a micro-queue and drain asynchronously to avoid
  // blocking the event loop on large images.
  const chunkQueue: Uint8Array[] = [];
  let zipFinalized = false;
  let zipError: Error | null = null;

  const zip = new Zip((err, chunk, final) => {
    if (err) { zipError = err; return; }
    chunkQueue.push(chunk);
    if (final) zipFinalized = true;
  });

  // Drain the chunk queue to the writer.
  async function drain(): Promise<void> {
    while (chunkQueue.length > 0) {
      const chunk = chunkQueue.shift()!;
      await writer.write(chunk);
    }
  }

  // Semaphore: at most FETCH_CONCURRENCY images in-flight at once.
  let inFlight = 0;
  const queue: Array<() => void> = [];

  function acquireSlot(): Promise<void> {
    if (inFlight < FETCH_CONCURRENCY) {
      inFlight++;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve));
  }

  function releaseSlot(): void {
    inFlight--;
    const next = queue.shift();
    if (next) { inFlight++; next(); }
  }

  try {
    // Fan out image fetches, respecting the semaphore.
    await Promise.all(
      jobs.map(async (job) => {
        const entryName = buildEntryName(job);

        await acquireSlot();
        try {
          const signedUrl = signedByPath.get(job.result_storage_path);
          if (!signedUrl) {
            skipped.push({ entryName, reason: "no_signed_url" });
            return;
          }

          let imgBuf: Buffer;
          try {
            const resp = await fetch(signedUrl, {
              signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
            });
            if (!resp.ok) {
              skipped.push({ entryName, reason: `http_${resp.status}` });
              logger.warn("image.batch.download.fetch_failed", {
                batchId, jobId: job.id, status: resp.status,
              });
              return;
            }
            imgBuf = Buffer.from(await resp.arrayBuffer());
          } catch (err) {
            skipped.push({
              entryName,
              reason: err instanceof Error && err.name === "TimeoutError"
                ? "timeout"
                : "fetch_error",
            });
            logger.warn("image.batch.download.fetch_error", {
              batchId, jobId: job.id,
              err: err instanceof Error ? err.message : String(err),
            });
            return;
          }

          // Append image to ZIP. ZipPassThrough = store (no re-compression).
          const entry = new ZipPassThrough(entryName);
          zip.add(entry);
          entry.push(imgBuf, true);

          // Drain accumulated chunks to the writer after each image.
          await drain();
        } finally {
          releaseSlot();
        }
      }),
    );

    // Append manifest.txt if any images were skipped.
    if (skipped.length > 0) {
      const lines = [
        `manifest.txt — skipped images in batch ${batchId}`,
        `Generated: ${new Date().toISOString()}`,
        "",
        ...skipped.map((s) => `SKIPPED  ${s.entryName}  reason: ${s.reason}`),
        "",
        `Total skipped: ${skipped.length} / ${jobs.length}`,
      ];
      const manifestBuf = Buffer.from(lines.join("\n"), "utf-8");
      const manifestEntry = new ZipPassThrough("manifest.txt");
      zip.add(manifestEntry);
      manifestEntry.push(manifestBuf, true);
      await drain();
    }

    // Finalise ZIP — emits central directory + end-of-central-directory record.
    zip.end();
    if (zipError) throw zipError;
    await drain(); // flush final record chunks

    logger.info("image.batch.download.complete", {
      batchId,
      total: jobs.length,
      skipped: skipped.length,
    });
  } catch (err) {
    logger.error("image.batch.download.zip_error", {
      batchId,
      err: err instanceof Error ? err.message : String(err),
    });
    await writer.abort(err instanceof Error ? err : new Error(String(err)));
    return;
  }

  await writer.close();
}

// ─── ZIP entry name ───────────────────────────────────────────────────────────

function buildEntryName(job: CompletedJob): string {
  const rowPart = job.parent_post_index !== null ? `row-${job.parent_post_index}` : "row-unknown";

  // variantKey is stored in generation_params.variantKey for template jobs.
  const params = job.generation_params;
  const variantKey =
    params && typeof params.variantKey === "string" ? params.variantKey : null;
  const variantPart = variantKey ?? "base";

  const shortId = job.id.slice(0, 8);
  return `${rowPart}/${variantPart}-${shortId}.png`;
}
