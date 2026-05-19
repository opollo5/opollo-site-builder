import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { constantTimeEqual } from "@/lib/crypto-compare";
import { sideEffectsGuarded } from "@/lib/runtime-env";

export function authorisedCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return false;
  return constantTimeEqual(header.slice(7).trim(), secret);
}

export function unauthorisedResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code: "UNAUTHORIZED", message: "Invalid cron secret.", retryable: false }, timestamp: new Date().toISOString() },
    { status: 401 },
  );
}

/**
 * Returns a 200 skip response when the current environment has side-effects
 * guarded (staging without STAGING_SIDE_EFFECTS_ENABLED=1). Cron routes that
 * trigger external calls (AI generation, email sends, social publish) should
 * call this and return early if the result is non-null.
 *
 * Usage:
 *   const skip = guardedCronSkip("cap-monthly-generation");
 *   if (skip) return skip;
 */
export function guardedCronSkip(jobName: string): NextResponse | null {
  if (!sideEffectsGuarded()) return null;
  logger.info(`${jobName}.skipped_in_staging`, { reason: "STAGING_SIDE_EFFECTS_ENABLED not set" });
  return NextResponse.json(
    { ok: true, data: { status: "skipped", reason: "staging_side_effects_guarded" }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}

export async function updateHeartbeat(jobName: string, status: "ok" | "error", lastError?: unknown): Promise<void> {
  try {
    const svc = getServiceRoleClient();
    // Fetch current run_count then increment — cron_heartbeats has one row per job.
    const { data: current } = await svc
      .from("cron_heartbeats")
      .select("run_count")
      .eq("job_name", jobName)
      .maybeSingle();
    await svc
      .from("cron_heartbeats")
      .update({
        last_run_at: new Date().toISOString(),
        last_status: status,
        last_error: lastError ? { message: lastError instanceof Error ? lastError.message : String(lastError) } : null,
        run_count: ((current?.run_count as number | null) ?? 0) + 1,
      })
      .eq("job_name", jobName);
  } catch (err) {
    logger.warn("cron.heartbeat_update_failed", { jobName, err: err instanceof Error ? err.message : String(err) });
  }
}
