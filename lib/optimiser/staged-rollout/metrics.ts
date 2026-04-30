import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import type { RolloutMetrics } from "./evaluator";

// ---------------------------------------------------------------------------
// OPTIMISER PHASE 1.5 SLICE 16 — Metric fetcher for the rollout monitor.
//
// Reads GA4 rows from opt_metrics_daily for the rollout window (since
// started_at) and an equal-length pre-rollout baseline window. Sums
// the standard fields the GA4 sync writes:
//   - sessions
//   - conversions
//   - bounces (sessions * (1 - engagement_rate) where engagement_rate
//             is the GA4 default; falls back to 0 if missing).
//
// "errors_new" — 5xx on the new variant — comes from
// opt_metrics_daily rows with source='server_errors' written by the
// Vercel logs sync (Phase 1.5 slice D). When the Vercel feed isn't
// configured (env vars unset), no rows are written and errors_new
// stays at 0 for affected windows; the diagnostic surface flags the
// dormant feed so operators don't over-trust the error_rate threshold.
//
// Until the actual traffic-split mechanism (Ads URL swap or JS hash
// split) lands, "new" and "baseline" both read the same page-level
// metrics — the monitor is therefore detecting page-level regressions
// rather than variant-vs-baseline differences. Operators see this in
// regression_check_results and can override with a manual promote.
// ---------------------------------------------------------------------------

export interface MetricFetchInput {
  landing_page_id: string | null;
  rollout_started_at: string;
  /** Now. Caller-supplied so tests can pin the clock. */
  now: Date;
}

export async function fetchRolloutMetrics(
  input: MetricFetchInput,
): Promise<RolloutMetrics> {
  if (!input.landing_page_id) {
    return zeroMetrics();
  }

  const startedAt = new Date(input.rollout_started_at);
  const windowDays = Math.max(
    1,
    Math.ceil((input.now.getTime() - startedAt.getTime()) / (24 * 60 * 60 * 1000)),
  );
  const baselineEnd = new Date(startedAt);
  baselineEnd.setDate(baselineEnd.getDate() - 1);
  const baselineStart = new Date(baselineEnd);
  baselineStart.setDate(baselineStart.getDate() - windowDays);

  const supabase = getServiceRoleClient();
  const newRes = await supabase
    .from("opt_metrics_daily")
    .select("metric_date, metrics")
    .eq("landing_page_id", input.landing_page_id)
    .eq("source", "ga4")
    .eq("dimension_key", "")
    .gte("metric_date", startedAt.toISOString().slice(0, 10))
    .lte("metric_date", input.now.toISOString().slice(0, 10));
  const baselineRes = await supabase
    .from("opt_metrics_daily")
    .select("metric_date, metrics")
    .eq("landing_page_id", input.landing_page_id)
    .eq("source", "ga4")
    .eq("dimension_key", "")
    .gte("metric_date", baselineStart.toISOString().slice(0, 10))
    .lte("metric_date", baselineEnd.toISOString().slice(0, 10));
  const errorsRes = await supabase
    .from("opt_metrics_daily")
    .select("metric_date, metrics")
    .eq("landing_page_id", input.landing_page_id)
    .eq("source", "server_errors")
    .eq("dimension_key", "")
    .gte("metric_date", startedAt.toISOString().slice(0, 10))
    .lte("metric_date", input.now.toISOString().slice(0, 10));

  if (newRes.error) {
    logger.error("staged-rollout: metrics new window fetch failed", {
      err: newRes.error.message,
    });
  }
  if (baselineRes.error) {
    logger.error("staged-rollout: metrics baseline fetch failed", {
      err: baselineRes.error.message,
    });
  }
  if (errorsRes.error) {
    logger.error("staged-rollout: server_errors fetch failed", {
      err: errorsRes.error.message,
    });
  }

  const newAgg = aggregate(newRes.data ?? []);
  const baselineAgg = aggregate(baselineRes.data ?? []);
  const errorsAgg = aggregateErrors(errorsRes.data ?? []);

  return {
    sessions_new: newAgg.sessions,
    conversions_new: newAgg.conversions,
    bounces_new: newAgg.bounces,
    errors_new: errorsAgg.errors_5xx,
    sessions_baseline: baselineAgg.sessions,
    conversions_baseline: baselineAgg.conversions,
    bounces_baseline: baselineAgg.bounces,
  };
}

function aggregateErrors(
  rows: Array<{ metrics: unknown }>,
): { errors_5xx: number } {
  let errors = 0;
  for (const row of rows) {
    const m = (row.metrics ?? {}) as Record<string, unknown>;
    if (typeof m.errors_5xx === "number") errors += m.errors_5xx;
  }
  return { errors_5xx: errors };
}

interface MetricsAgg {
  sessions: number;
  conversions: number;
  bounces: number;
}

function aggregate(
  rows: Array<{ metrics: unknown }>,
): MetricsAgg {
  let sessions = 0;
  let conversions = 0;
  let bounces = 0;
  for (const row of rows) {
    const m = (row.metrics ?? {}) as Record<string, unknown>;
    const s = numeric(m.sessions);
    sessions += s;
    conversions += numeric(m.conversions ?? m.key_events);
    // Engagement-rate convention: GA4 returns engagement_rate as
    // sessions/total. Fallback to bounces field if explicitly stored.
    if (typeof m.bounces === "number") {
      bounces += numeric(m.bounces);
    } else if (typeof m.engagement_rate === "number") {
      bounces += s * (1 - numeric(m.engagement_rate));
    }
  }
  return {
    sessions,
    conversions,
    bounces: Math.round(bounces),
  };
}

function numeric(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function zeroMetrics(): RolloutMetrics {
  return {
    sessions_new: 0,
    conversions_new: 0,
    bounces_new: 0,
    errors_new: 0,
    sessions_baseline: 0,
    conversions_baseline: 0,
    bounces_baseline: 0,
  };
}
