import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Aggregation helpers over opt_metrics_daily. Slice 4 page browser +
// Slice 5 alignment scoring + Slice 5 playbook evaluation all read
// per-page rollups via these.
//
// Phase 1 implementation: SUM/AVG over the time window in JS. Row
// counts are bounded (one row per page-day-source-dimension); a few
// hundred per managed page in the worst case. When this becomes hot,
// move into a pl/pgsql RPC.
// ---------------------------------------------------------------------------

export type PageMetricsRollup = {
  landing_page_id: string;
  window_days: number;
  sessions: number;
  conversions: number;
  conversion_rate: number;
  bounce_rate: number;
  avg_scroll_depth: number;
  avg_engagement_time_s: number;
  spend_usd_cents: number;
  clicks: number;
  /** Largest Contentful Paint, ms (most recent). */
  lcp_ms: number | null;
  mobile_speed_score: number | null;
  /** Per-device CR for the §9.6.3 mobile_only_failure detector. */
  mobile_cr_vs_desktop_ratio: number | null;
  /** TRUE if the latest day in the window is within freshness_window_days. */
  fresh: boolean;
  /** Days between today and the latest metric_date in the rollup. */
  freshness_age_days: number | null;
};

export type AggregationOptions = {
  /** Default 30 days. */
  window_days?: number;
};

export async function rollupForPage(
  landingPageId: string,
  opts: AggregationOptions = {},
): Promise<PageMetricsRollup> {
  const supabase = getServiceRoleClient();
  const window_days = opts.window_days ?? 30;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - window_days);
  const sinceIso = since.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("opt_metrics_daily")
    .select(
      "metric_date, source, dimension_key, dimension_value, metrics",
    )
    .eq("landing_page_id", landingPageId)
    .gte("metric_date", sinceIso);
  if (error) {
    throw new Error(`rollupForPage(${landingPageId}): ${error.message}`);
  }

  const rows = data ?? [];
  let sessions = 0;
  let conversions = 0;
  let bounceSum = 0;
  let bounceN = 0;
  let scrollSum = 0;
  let scrollN = 0;
  let engageSum = 0;
  let engageN = 0;
  let spendCents = 0;
  let clicks = 0;
  let lcp: number | null = null;
  let mobileSpeedScore: number | null = null;
  let latestDate: string | null = null;

  let mobileSessions = 0;
  let mobileConversions = 0;
  let desktopSessions = 0;
  let desktopConversions = 0;

  for (const r of rows) {
    const m = (r.metrics ?? {}) as Record<string, number | null>;
    if (!latestDate || (r.metric_date as string) > latestDate) {
      latestDate = r.metric_date as string;
    }
    if (r.source === "ga4") {
      if (r.dimension_key === "device") {
        if (r.dimension_value === "mobile") {
          mobileSessions += numericOrZero(m.sessions);
          mobileConversions += numericOrZero(m.conversions);
        } else if (r.dimension_value === "desktop") {
          desktopSessions += numericOrZero(m.sessions);
          desktopConversions += numericOrZero(m.conversions);
        }
      }
      sessions += numericOrZero(m.sessions);
      conversions += numericOrZero(m.conversions);
      if (m.bounce_rate != null) {
        bounceSum += m.bounce_rate;
        bounceN += 1;
      }
      if (m.avg_session_duration_s != null) {
        engageSum += m.avg_session_duration_s;
        engageN += 1;
      }
    } else if (r.source === "clarity") {
      if (m.scroll_depth != null) {
        scrollSum += m.scroll_depth;
        scrollN += 1;
      }
    } else if (r.source === "google_ads") {
      spendCents += numericOrZero(m.cost_usd_cents);
      clicks += numericOrZero(m.clicks);
    } else if (r.source === "pagespeed") {
      if (m.lcp_ms != null) lcp = m.lcp_ms;
      if (m.mobile_speed_score != null) mobileSpeedScore = m.mobile_speed_score;
    }
  }

  const conversion_rate =
    sessions > 0 ? conversions / sessions : 0;
  const bounce_rate = bounceN > 0 ? bounceSum / bounceN : 0;
  const avg_scroll_depth = scrollN > 0 ? scrollSum / scrollN : 0;
  const avg_engagement_time_s = engageN > 0 ? engageSum / engageN : 0;

  let mobile_cr_vs_desktop_ratio: number | null = null;
  if (mobileSessions >= 30 && desktopSessions >= 30) {
    const mobileCr = mobileSessions > 0 ? mobileConversions / mobileSessions : 0;
    const desktopCr = desktopSessions > 0 ? desktopConversions / desktopSessions : 0;
    if (desktopCr > 0) {
      mobile_cr_vs_desktop_ratio = mobileCr / desktopCr;
    }
  }

  let freshness_age_days: number | null = null;
  let fresh = false;
  if (latestDate) {
    const ageMs =
      Date.now() - Date.UTC(
        Number(latestDate.slice(0, 4)),
        Number(latestDate.slice(5, 7)) - 1,
        Number(latestDate.slice(8, 10)),
      );
    freshness_age_days = Math.max(0, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
    fresh = freshness_age_days <= 7;
  }

  return {
    landing_page_id: landingPageId,
    window_days,
    sessions,
    conversions,
    conversion_rate,
    bounce_rate,
    avg_scroll_depth,
    avg_engagement_time_s,
    spend_usd_cents: spendCents,
    clicks,
    lcp_ms: lcp,
    mobile_speed_score: mobileSpeedScore,
    mobile_cr_vs_desktop_ratio,
    fresh,
    freshness_age_days,
  };
}

function numericOrZero(v: number | null | undefined): number {
  return v == null || !Number.isFinite(v) ? 0 : v;
}
