import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// PageSpeed Insights sync (spec §4.4).
//
// Endpoint: GET https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed
// Auth: API key via &key=... — one key for all clients (PSI is free).
// PSI quota: 25,000 queries/day on the free tier; we run weekly per
// landing page.
//
// Phase 1 stores LCP, INP, CLS, performance_score, mobile_score in
// opt_metrics_daily with source = 'pagespeed' and one row per
// (landing_page, run date, dimension=strategy=mobile|desktop).
// ---------------------------------------------------------------------------

const PSI_API = "https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed";

const MIN_SYNC_INTERVAL_MS = 6 * 24 * 60 * 60 * 1000; // weekly

type PsiResult = {
  lighthouseResult?: {
    categories?: { performance?: { score?: number } };
    audits?: {
      "largest-contentful-paint"?: { numericValue?: number };
      "interaction-to-next-paint"?: { numericValue?: number };
      "cumulative-layout-shift"?: { numericValue?: number };
    };
  };
};

export async function syncPagespeedForClient(
  clientId: string,
): Promise<{ rows_written: number; skipped?: boolean }> {
  const apiKey = process.env.PSI_API_KEY;
  if (!apiKey) {
    return { rows_written: 0, skipped: true };
  }

  const supabase = getServiceRoleClient();

  // Pages to probe: every managed landing page that hasn't been
  // synced from PSI in the last 6 days.
  const cutoff = new Date(Date.now() - MIN_SYNC_INTERVAL_MS).toISOString();

  const { data: pages } = await supabase
    .from("opt_landing_pages")
    .select("id, url")
    .eq("client_id", clientId)
    .eq("managed", true)
    .is("deleted_at", null);

  if (!pages || pages.length === 0) return { rows_written: 0 };

  let rowsWritten = 0;
  for (const page of pages) {
    // Skip if a recent (mobile + desktop) PSI row exists for this page.
    const { data: recent } = await supabase
      .from("opt_metrics_daily")
      .select("id")
      .eq("landing_page_id", page.id)
      .eq("source", "pagespeed")
      .gte("ingested_at", cutoff)
      .limit(1);
    if (recent && recent.length > 0) continue;

    for (const strategy of ["mobile", "desktop"] as const) {
      try {
        const url = `${PSI_API}?url=${encodeURIComponent(page.url as string)}&strategy=${strategy}&category=performance&key=${apiKey}`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const json = (await res.json()) as PsiResult;
        const lighthouse = json.lighthouseResult;
        const lcp =
          lighthouse?.audits?.["largest-contentful-paint"]?.numericValue ?? null;
        const inp =
          lighthouse?.audits?.["interaction-to-next-paint"]?.numericValue ?? null;
        const cls =
          lighthouse?.audits?.["cumulative-layout-shift"]?.numericValue ?? null;
        const perfScore =
          (lighthouse?.categories?.performance?.score ?? 0) * 100;

        const today = new Date().toISOString().slice(0, 10);
        const { error } = await supabase
          .from("opt_metrics_daily")
          .upsert(
            {
              client_id: clientId,
              landing_page_id: page.id,
              metric_date: today,
              source: "pagespeed",
              dimension_key: "strategy",
              dimension_value: strategy,
              metrics: {
                lcp_ms: lcp,
                inp_ms: inp,
                cls,
                performance_score: perfScore,
                mobile_speed_score:
                  strategy === "mobile" ? perfScore : null,
              },
              ingested_at: new Date().toISOString(),
            },
            {
              onConflict:
                "landing_page_id,metric_date,source,dimension_key,dimension_value",
            },
          )
          .select("id");
        if (!error) rowsWritten += 1;
      } catch {
        // PSI is best-effort weekly — single page failure doesn't fail
        // the sync.
      }
    }
  }
  return { rows_written: rowsWritten };
}
