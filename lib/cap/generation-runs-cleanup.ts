import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// Successful runs kept 1 year; error/failed runs kept 2 years for billing reconciliation
const SUCCESS_RETENTION_DAYS = 365;
const ERROR_RETENTION_DAYS = 730;

export interface GenerationRunsCleanupResult {
  deletedSuccessRows: number;
  deletedErrorRows: number;
  totalDeleted: number;
  successCutoff: string;
  errorCutoff: string;
}

export async function runGenerationRunsCleanup(): Promise<GenerationRunsCleanupResult> {
  const successCutoff = new Date(
    Date.now() - SUCCESS_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const errorCutoff = new Date(
    Date.now() - ERROR_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const svc = getServiceRoleClient();

  const { count: successCount, error: successError } = await svc
    .from("cap_generation_runs")
    .delete({ count: "exact" })
    .in("status", ["success"])
    .lt("created_at", successCutoff);

  if (successError) {
    logger.error("cap.generation-runs-cleanup.success-delete-failed", {
      error: successError.message,
      successCutoff,
    });
    throw new Error(`Generation runs cleanup (success) failed: ${successError.message}`);
  }

  const { count: errorCount, error: errorError } = await svc
    .from("cap_generation_runs")
    .delete({ count: "exact" })
    .in("status", ["error", "failed"])
    .lt("created_at", errorCutoff);

  if (errorError) {
    logger.error("cap.generation-runs-cleanup.error-delete-failed", {
      error: errorError.message,
      errorCutoff,
    });
    throw new Error(`Generation runs cleanup (error) failed: ${errorError.message}`);
  }

  const deletedSuccessRows = successCount ?? 0;
  const deletedErrorRows = errorCount ?? 0;
  const totalDeleted = deletedSuccessRows + deletedErrorRows;

  logger.info("cap.generation-runs-cleanup.complete", {
    deletedSuccessRows,
    deletedErrorRows,
    totalDeleted,
    successCutoff,
    errorCutoff,
  });

  return { deletedSuccessRows, deletedErrorRows, totalDeleted, successCutoff, errorCutoff };
}
