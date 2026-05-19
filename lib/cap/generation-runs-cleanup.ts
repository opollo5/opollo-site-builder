import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

const RETENTION_DAYS = 90;

export interface GenerationRunsCleanupResult {
  deletedRows: number;
  cutoff: string;
}

export async function runGenerationRunsCleanup(): Promise<GenerationRunsCleanupResult> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const svc = getServiceRoleClient();
  const { count, error } = await svc
    .from("cap_generation_runs")
    .delete({ count: "exact" })
    .lt("created_at", cutoff);

  if (error) {
    logger.error("cap.generation-runs-cleanup.failed", { error: error.message, cutoff });
    throw new Error(`Generation runs cleanup failed: ${error.message}`);
  }

  const deletedRows = count ?? 0;
  logger.info("cap.generation-runs-cleanup.complete", { deletedRows, cutoff });

  return { deletedRows, cutoff };
}
