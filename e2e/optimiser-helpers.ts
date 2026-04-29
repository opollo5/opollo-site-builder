import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Page, Route } from "@playwright/test";

// ---------------------------------------------------------------------------
// Optimiser-suite-specific E2E helpers. Mirrors the existing helpers.ts
// pattern (signInAsAdmin / auditA11y) — service-role Supabase access for
// fixture setup, network-layer mocks for external APIs, and tracked
// cleanup.
// ---------------------------------------------------------------------------

export function supabaseServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must be set for the optimiser E2E suite.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const TEST_CLIENT_PREFIX = "e2e-opt";

export type SeededOptClient = {
  id: string;
  client_slug: string;
  onboarded: boolean;
};

/**
 * Seed (or look up) an opt_clients row for the current test. `slug`
 * keeps fixtures isolated per spec; the global-teardown sweeps any
 * client whose slug starts with TEST_CLIENT_PREFIX.
 */
export async function seedOptClient(args: {
  slug: string;
  name?: string;
  onboarded?: boolean;
}): Promise<SeededOptClient> {
  const supabase = supabaseServiceClient();
  const fullSlug = `${TEST_CLIENT_PREFIX}-${args.slug}`;
  const { data: existing } = await supabase
    .from("opt_clients")
    .select("id, client_slug, onboarded_at")
    .eq("client_slug", fullSlug)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) {
    if (args.onboarded && !existing.onboarded_at) {
      await supabase
        .from("opt_clients")
        .update({ onboarded_at: new Date().toISOString() })
        .eq("id", existing.id as string);
    }
    return {
      id: existing.id as string,
      client_slug: existing.client_slug as string,
      onboarded: Boolean(args.onboarded || existing.onboarded_at),
    };
  }
  const { data: created, error } = await supabase
    .from("opt_clients")
    .insert({
      name: args.name ?? `E2E ${args.slug}`,
      client_slug: fullSlug,
      hosting_mode: "opollo_subdomain",
      llm_monthly_budget_usd: 50,
      onboarded_at: args.onboarded ? new Date().toISOString() : null,
    })
    .select("id, client_slug")
    .single();
  if (error || !created) {
    throw new Error(`seedOptClient: ${error?.message ?? "no row"}`);
  }
  return {
    id: created.id as string,
    client_slug: created.client_slug as string,
    onboarded: Boolean(args.onboarded),
  };
}

export async function seedLandingPage(args: {
  clientId: string;
  url: string;
  managed?: boolean;
  state?: "active" | "healthy" | "insufficient_data" | "read_only_external";
  alignmentScore?: number;
  spendUsdCents?: number;
  technicalAlerts?: string[];
}): Promise<{ id: string }> {
  const supabase = supabaseServiceClient();
  const { data, error } = await supabase
    .from("opt_landing_pages")
    .upsert(
      {
        client_id: args.clientId,
        url: args.url,
        managed: args.managed ?? true,
        management_mode: "read_only",
        state: args.state ?? "active",
        spend_30d_usd_cents: args.spendUsdCents ?? 0,
        active_technical_alerts: args.technicalAlerts ?? [],
        data_reliability:
          args.state === "insufficient_data" ? "red" : "green",
      },
      { onConflict: "client_id,url" },
    )
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedLandingPage: ${error?.message ?? "no row"}`);
  }
  return { id: data.id as string };
}

export async function seedAdGroupAndAd(args: {
  clientId: string;
  campaignName?: string;
  adGroupName?: string;
  finalUrl: string;
  headlines: string[];
  descriptions: string[];
}): Promise<{ adGroupId: string; campaignId: string; adId: string }> {
  const supabase = supabaseServiceClient();
  const { data: campaign, error: cErr } = await supabase
    .from("opt_campaigns")
    .upsert(
      {
        client_id: args.clientId,
        external_id: `e2e-cmp-${Date.now()}`,
        name: args.campaignName ?? "E2E Campaign",
        status: "enabled",
        channel_type: "SEARCH",
      },
      { onConflict: "client_id,external_id" },
    )
    .select("id")
    .single();
  if (cErr || !campaign) throw new Error(`seedAdGroup campaign: ${cErr?.message}`);
  const { data: adGroup, error: agErr } = await supabase
    .from("opt_ad_groups")
    .upsert(
      {
        client_id: args.clientId,
        campaign_id: campaign.id as string,
        external_id: `e2e-ag-${Date.now()}`,
        name: args.adGroupName ?? "E2E Ad Group",
        status: "enabled",
        raw: { top_search_terms: [{ term: "managed it support", impressions: 100 }] },
      },
      { onConflict: "client_id,external_id" },
    )
    .select("id")
    .single();
  if (agErr || !adGroup) throw new Error(`seedAdGroup ag: ${agErr?.message}`);
  const { data: ad, error: aErr } = await supabase
    .from("opt_ads")
    .upsert(
      {
        client_id: args.clientId,
        ad_group_id: adGroup.id as string,
        external_id: `e2e-ad-${Date.now()}`,
        ad_type: "responsive_search_ad",
        status: "enabled",
        headlines: args.headlines,
        descriptions: args.descriptions,
        final_url: args.finalUrl,
      },
      { onConflict: "ad_group_id,external_id" },
    )
    .select("id")
    .single();
  if (aErr || !ad) throw new Error(`seedAd: ${aErr?.message}`);
  return {
    adGroupId: adGroup.id as string,
    campaignId: campaign.id as string,
    adId: ad.id as string,
  };
}

export async function seedProposal(args: {
  clientId: string;
  landingPageId: string;
  adGroupId?: string;
  playbookId?: string;
  headline?: string;
  riskLevel?: "low" | "medium" | "high";
  status?: "pending" | "approved" | "applied" | "rejected" | "expired";
  expiresAt?: Date;
}): Promise<{ id: string }> {
  const supabase = supabaseServiceClient();
  const { data, error } = await supabase
    .from("opt_proposals")
    .insert({
      client_id: args.clientId,
      landing_page_id: args.landingPageId,
      ad_group_id: args.adGroupId ?? null,
      triggering_playbook_id: args.playbookId ?? "message_mismatch",
      category: "content_fix",
      status: args.status ?? "pending",
      headline: args.headline ?? "E2E Proposal",
      problem_summary: "Seeded by E2E spec.",
      risk_level: args.riskLevel ?? "medium",
      priority_score: 12.5,
      impact_score: 50,
      effort_bucket: 1,
      confidence_score: 0.5,
      confidence_sample: 0.6,
      confidence_freshness: 1.0,
      confidence_stability: 0.85,
      confidence_signal: 0.5,
      expected_impact_min_pp: 5,
      expected_impact_max_pp: 10,
      change_set: { fix_template: "Rewrite hero to match keyword + ad headline." },
      before_snapshot: { h1: "Generic IT Solutions", primary_cta: "Get a Quote" },
      after_snapshot: {},
      current_performance: {
        sessions: 600,
        conversion_rate: 0.012,
        bounce_rate: 0.72,
      },
      expires_at: (args.expiresAt ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedProposal: ${error?.message ?? "no row"}`);
  return { id: data.id as string };
}

/**
 * Sweep optimiser fixtures created by E2E specs. Called from
 * global-teardown alongside the existing site cleanup.
 */
export async function cleanupOptimiserFixtures(): Promise<void> {
  const supabase = supabaseServiceClient();
  const { data } = await supabase
    .from("opt_clients")
    .select("id, client_slug")
    .like("client_slug", `${TEST_CLIENT_PREFIX}-%`);
  for (const row of data ?? []) {
    // ON DELETE CASCADE from opt_clients sweeps everything downstream
    // (campaigns, ad_groups, keywords, ads, landing_pages, metrics_daily,
    // alignment_scores, proposals, evidence, memory). opt_change_log uses
    // ON DELETE RESTRICT so we have to wipe it first.
    await supabase
      .from("opt_change_log")
      .delete()
      .eq("client_id", row.id as string);
    await supabase
      .from("opt_clients")
      .delete()
      .eq("id", row.id as string);
  }
}

/**
 * Mock all external APIs the optimiser touches: Google Ads, GA4,
 * Microsoft Clarity, PageSpeed Insights, Anthropic. Specs that exercise
 * sync paths or LLM-driven scoring install this once in beforeEach.
 *
 * Routes are abort-safe — a real prod hit would fail loudly so a
 * leaked-credential bug surfaces in CI.
 */
export async function installExternalApiMocks(page: Page): Promise<void> {
  // Google Ads searchStream — return empty results so sync runs no-op-ish.
  await page.route(/googleads\.googleapis\.com/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ results: [] }]),
    }),
  );
  // OAuth token exchange (Ads + GA4 share oauth2.googleapis.com).
  await page.route(/oauth2\.googleapis\.com/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "e2e-access-token",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    }),
  );
  // GA4 runReport.
  await page.route(/analyticsdata\.googleapis\.com/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rows: [] }),
    }),
  );
  // Clarity — return empty insights.
  await page.route(/www\.clarity\.ms/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    }),
  );
  // PageSpeed Insights.
  await page.route(/pagespeedonline\.googleapis\.com/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        lighthouseResult: {
          categories: { performance: { score: 0.85 } },
          audits: {
            "largest-contentful-paint": { numericValue: 1800 },
            "interaction-to-next-paint": { numericValue: 120 },
            "cumulative-layout-shift": { numericValue: 0.05 },
          },
        },
      }),
    }),
  );
  // Anthropic — JSON-shaped scoring response.
  await page.route(/api\.anthropic\.com/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "msg_e2e",
        model: "claude-sonnet-4-6",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              score: 72,
              rationale: "E2E mock: page broadly aligned with ad message.",
              intent: "transactional",
            }),
          },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 200, output_tokens: 60 },
      }),
    }),
  );
}
