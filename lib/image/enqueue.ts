import "server-only";

import { getQstashClient } from "@/lib/qstash";
import { logger } from "@/lib/logger";
import type { GenerationParams } from "./types";

// ---------------------------------------------------------------------------
// Enqueue a single image generation job to the QStash handler.
// Called by B2's batch dispatch endpoint for each job in a batch.
//
// Idempotency: Upstash-Deduplication-Id is set to the jobId UUID so
// duplicate calls for the same job within QStash's dedup window (~24h)
// are absorbed by Upstash before they reach the handler.
// ---------------------------------------------------------------------------

const HANDLER_PATH = "/api/internal/image/qstash-handler";

export interface EnqueueImageJobInput {
  jobId: string;
  generationParams: GenerationParams;
  batchId?: string;
  /** Delay in seconds before QStash delivers. Used when re-enqueuing at concurrency cap. */
  delaySeconds?: number;
}

export type EnqueueResult = { ok: true } | { ok: false; error: string };

export async function enqueueImageJob(input: EnqueueImageJobInput): Promise<EnqueueResult> {
  const qstash = getQstashClient();
  if (!qstash) {
    logger.warn("image.enqueue.no_qstash", { jobId: input.jobId });
    return { ok: false, error: "QSTASH_TOKEN is not configured." };
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.VERCEL_URL;
  if (!origin) {
    return { ok: false, error: "NEXT_PUBLIC_SITE_URL is not set — cannot build callback URL." };
  }

  const url = `${origin}${HANDLER_PATH}`;

  try {
    await qstash.publishJSON({
      url,
      body: {
        jobId: input.jobId,
        generationParams: input.generationParams,
        ...(input.batchId && { batchId: input.batchId }),
      },
      deduplicationId: input.jobId,
      ...(input.delaySeconds && { delay: input.delaySeconds }),
    });

    logger.info("image.enqueue.ok", {
      jobId: input.jobId,
      batchId: input.batchId,
      delaySeconds: input.delaySeconds,
    });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error("image.enqueue.failed", { jobId: input.jobId, error });
    return { ok: false, error };
  }
}
