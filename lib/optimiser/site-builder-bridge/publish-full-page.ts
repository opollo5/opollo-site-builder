import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import {
  composeFullPage,
  type FullPageChrome,
  type TrackingConfig,
} from "@/lib/full-page-output";
import { extractFullPageChrome } from "@/lib/full-page-chrome-extractor";
import { writeStaticPage } from "@/lib/static-hosting";

// ---------------------------------------------------------------------------
// OPTIMISER PHASE 1.5 follow-up slice A — full_page publish bridge.
//
// Runs from approveBriefPage AFTER the page is marked approved. Reads
// brief_pages.output_mode; for output_mode='full_page' wraps the
// generated HTML in chrome + tracking pixels + (optional) A/B traffic-
// split snippet, writes the result via writeStaticPage. For
// output_mode='slice' (default) returns a no-op so the existing
// WordPress flow continues unchanged.
//
// Module boundary: this function is the optimiser's hook into the
// generation pipeline. It does NOT modify the runner directly; it
// runs as a bridge from approveBriefPage's terminal flow, mirroring
// the post-mode bridge already there.
//
// Write-safety contract:
//   - Idempotency: writeStaticPage rotates the previous version into
//     /history/ before overwriting; multiple bridge runs for the
//     same page produce timestamped history entries (no clobber).
//   - Dry-run fallback: writeStaticPage returns dry_run=true when
//     OPOLLO_HOSTING_HOST/USER/KEY is unset; we persist the would-be
//     write to opt_change_log.dry_run_payload so Phase 1.5 is testable
//     before hosting credentials land.
//   - Failure isolation: a publish failure does NOT roll back the
//     brief_pages approval — the operator sees the failure on the
//     change-log timeline and can retry with a manual-publish flow.
//   - Concurrency: serial per (landing_page, ordinal). The runner
//     advances through a brief one page at a time, so two brief_pages
//     can't be approved simultaneously for the same brief. Across
//     briefs the writeStaticPage history rotation absorbs collisions.
// ---------------------------------------------------------------------------

export type FullPagePublishResult =
  | {
      published: true;
      dry_run: false;
      path: string;
      archived_to: string | null;
    }
  | {
      published: true;
      dry_run: true;
      target_path: string;
      missing_env_vars: string[];
    }
  | {
      published: false;
      reason:
        | "not_full_page_mode"
        | "not_a_landing_page"
        | "no_proposal_link"
        | "client_lookup_failed"
        | "client_slice_mode"
        | "no_generated_html"
        | "chrome_unavailable"
        | "compose_failed"
        | "static_write_failed";
      message: string;
    };

export async function publishApprovedPageAsFullPage(
  briefPageId: string,
  nowIso: string,
): Promise<FullPagePublishResult> {
  const supabase = getServiceRoleClient();

  const pageRes = await supabase
    .from("brief_pages")
    .select(
      "id, brief_id, ordinal, title, slug_hint, output_mode, generated_html",
    )
    .eq("id", briefPageId)
    .is("deleted_at", null)
    .maybeSingle();
  if (pageRes.error || !pageRes.data) {
    return {
      published: false,
      reason: "no_generated_html",
      message: pageRes.error?.message ?? "brief_page not found",
    };
  }
  const page = pageRes.data as {
    id: string;
    brief_id: string;
    ordinal: number;
    title: string;
    slug_hint: string | null;
    output_mode: "slice" | "full_page";
    generated_html: string | null;
  };
  if (page.output_mode !== "full_page") {
    return {
      published: false,
      reason: "not_full_page_mode",
      message: "Page output_mode is 'slice' — bridge is a no-op.",
    };
  }
  if (!page.generated_html || page.generated_html.trim().length === 0) {
    return {
      published: false,
      reason: "no_generated_html",
      message: "Page has no generated_html to publish.",
    };
  }

  const briefRes = await supabase
    .from("briefs")
    .select("id, site_id, content_type")
    .eq("id", page.brief_id)
    .maybeSingle();
  if (briefRes.error || !briefRes.data) {
    return {
      published: false,
      reason: "client_lookup_failed",
      message: briefRes.error?.message ?? "brief lookup failed",
    };
  }
  const brief = briefRes.data as {
    id: string;
    site_id: string;
    content_type: "page" | "post";
  };
  if (brief.content_type !== "page") {
    return {
      published: false,
      reason: "not_a_landing_page",
      message: "Bridge is for content_type='page' (landing pages) only.",
    };
  }

  // Resolve the optimiser context: brief_run.triggered_by_proposal_id
  // → opt_proposals.client_id + landing_page_id → opt_clients +
  // opt_landing_pages.
  const runRes = await supabase
    .from("brief_runs")
    .select("id, triggered_by_proposal_id")
    .eq("brief_id", brief.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const proposalId =
    (runRes.data?.triggered_by_proposal_id as string | null) ?? null;
  if (!proposalId) {
    return {
      published: false,
      reason: "no_proposal_link",
      message:
        "brief_run has no triggered_by_proposal_id; can't resolve opt_client. " +
        "full_page publish is currently optimiser-driven only.",
    };
  }

  const proposalRes = await supabase
    .from("opt_proposals")
    .select("id, client_id, landing_page_id")
    .eq("id", proposalId)
    .is("deleted_at", null)
    .maybeSingle();
  if (proposalRes.error || !proposalRes.data) {
    return {
      published: false,
      reason: "client_lookup_failed",
      message: proposalRes.error?.message ?? "proposal not found",
    };
  }
  const proposal = proposalRes.data as {
    id: string;
    client_id: string;
    landing_page_id: string;
  };

  const clientRes = await supabase
    .from("opt_clients")
    .select("id, client_slug, hosting_mode, tracking_config")
    .eq("id", proposal.client_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (clientRes.error || !clientRes.data) {
    return {
      published: false,
      reason: "client_lookup_failed",
      message: clientRes.error?.message ?? "client not found",
    };
  }
  const client = clientRes.data as {
    id: string;
    client_slug: string;
    hosting_mode: "opollo_subdomain" | "opollo_cname" | "client_slice";
    tracking_config: TrackingConfig | null;
  };
  if (client.hosting_mode === "client_slice") {
    return {
      published: false,
      reason: "client_slice_mode",
      message:
        "client_slice mode publishes via WordPress, not static hosting.",
    };
  }

  const landingRes = await supabase
    .from("opt_landing_pages")
    .select("id, url")
    .eq("id", proposal.landing_page_id)
    .maybeSingle();
  const landingUrl =
    (landingRes.data?.url as string | undefined) ?? null;

  // Chrome: read from site_conventions.full_page_chrome; fall back to
  // homepage extraction when null. UPSERT the result so subsequent
  // runs reuse the cache.
  const chrome = await resolveChrome(brief.site_id, landingUrl);
  if (!chrome) {
    return {
      published: false,
      reason: "chrome_unavailable",
      message:
        "site_conventions.full_page_chrome is empty and homepage extraction failed.",
    };
  }

  // Active A/B test → traffic-split config. When this brief is the
  // result of a variant generation (slice 18), opt_variants.brief_id
  // points to it. The opt_tests row has both variant ids; we derive
  // the URL convention {page-slug}.html for A and {page-slug}-b.html
  // for B (the slice-19 variant generator publishes at sibling paths).
  const pageSlug = derivePageSlug(landingUrl, page.slug_hint, page.title);
  const abSplit = await resolveAbSplitConfig({
    briefId: brief.id,
    landingPageId: proposal.landing_page_id,
    clientSlug: client.client_slug,
    pageSlug,
    hostingMode: client.hosting_mode,
  });

  let html: string;
  try {
    html = composeFullPage({
      fragmentHtml: page.generated_html,
      cssBundle: "",
      chrome,
      tracking: client.tracking_config ?? {},
      meta: {
        title: page.title,
        canonical_url: landingUrl ?? undefined,
      },
      abSplit: abSplit ?? undefined,
    });
  } catch (err) {
    logger.error("optimiser.publish_full_page.compose_failed", {
      brief_page_id: page.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      published: false,
      reason: "compose_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // Variant suffix: when this brief belongs to a variant labelled B,
  // publish at {page-slug}-b.html so the traffic-split snippet's URL
  // convention matches.
  const variantSlugSuffix = await resolveVariantSlugSuffix(brief.id);
  const finalPageSlug = `${pageSlug}${variantSlugSuffix}`;

  const writeRes = await writeStaticPage({
    client_slug: client.client_slug,
    page_slug: finalPageSlug,
    html,
  });
  if (!writeRes.ok) {
    logger.error("optimiser.publish_full_page.write_failed", {
      brief_page_id: page.id,
      err: writeRes.error.message,
    });
    return {
      published: false,
      reason: "static_write_failed",
      message: writeRes.error.message,
    };
  }

  if (writeRes.dry_run) {
    await supabase.from("opt_change_log").insert({
      client_id: client.id,
      proposal_id: proposal.id,
      landing_page_id: proposal.landing_page_id,
      event: "page_regenerated",
      details: {
        bridge: "full_page",
        dry_run: true,
        target_path: writeRes.payload.target_path,
        body_size: writeRes.payload.body_size,
        ab_test: abSplit ? { test_id: abSplit.test_id, this_variant: abSplit.this_variant } : null,
      },
      dry_run_payload: writeRes.payload,
      actor_user_id: null,
      created_at: nowIso,
    });
    return {
      published: true,
      dry_run: true,
      target_path: writeRes.payload.target_path,
      missing_env_vars: writeRes.payload.missing_env_vars,
    };
  }

  await supabase.from("opt_change_log").insert({
    client_id: client.id,
    proposal_id: proposal.id,
    landing_page_id: proposal.landing_page_id,
    event: "page_regenerated",
    details: {
      bridge: "full_page",
      dry_run: false,
      path: writeRes.path,
      archived_to: writeRes.archived_to,
      ab_test: abSplit ? { test_id: abSplit.test_id, this_variant: abSplit.this_variant } : null,
    },
    actor_user_id: null,
    created_at: nowIso,
  });

  return {
    published: true,
    dry_run: false,
    path: writeRes.path,
    archived_to: writeRes.archived_to,
  };
}

async function resolveChrome(
  siteId: string,
  landingUrl: string | null,
): Promise<FullPageChrome | null> {
  const supabase = getServiceRoleClient();
  const conv = await supabase
    .from("site_conventions")
    .select("id, full_page_chrome")
    .eq("site_id", siteId)
    .maybeSingle();
  const cached =
    (conv.data?.full_page_chrome as FullPageChrome | null) ?? null;
  if (cached && (cached.header_html || cached.nav_html || cached.footer_html)) {
    return cached;
  }
  // Lazy extract from the landing page's origin homepage. We don't
  // have a separate "homepage" pointer in opt_clients, so derive
  // from the landing URL's origin.
  if (!landingUrl) return null;
  let origin: string;
  try {
    origin = new URL(landingUrl).origin + "/";
  } catch {
    return null;
  }
  const ext = await extractFullPageChrome(origin);
  if (!ext.ok) {
    logger.warn("optimiser.publish_full_page.chrome_extract_failed", {
      origin,
      err: ext.error.message,
    });
    return null;
  }
  // UPSERT the cached extraction so future runs skip the fetch.
  if (conv.data?.id) {
    await supabase
      .from("site_conventions")
      .update({ full_page_chrome: ext.chrome })
      .eq("id", conv.data.id as string);
  }
  return ext.chrome;
}

interface AbSplitConfig {
  test_id: string;
  traffic_split_percent: number;
  variant_a_url: string;
  variant_b_url: string;
  this_variant: "A" | "B";
}

async function resolveAbSplitConfig(args: {
  briefId: string;
  landingPageId: string;
  clientSlug: string;
  pageSlug: string;
  hostingMode: "opollo_subdomain" | "opollo_cname" | "client_slice";
}): Promise<AbSplitConfig | null> {
  const supabase = getServiceRoleClient();
  // Is this brief tied to a variant?
  const variantRes = await supabase
    .from("opt_variants")
    .select("id, variant_label")
    .eq("brief_id", args.briefId)
    .maybeSingle();
  if (!variantRes.data) return null;
  const thisLabel = variantRes.data.variant_label as "A" | "B";
  if (thisLabel !== "A" && thisLabel !== "B") return null;

  const testRes = await supabase
    .from("opt_tests")
    .select("id, status, traffic_split_percent")
    .eq("landing_page_id", args.landingPageId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!testRes.data) return null;
  const test = testRes.data as {
    id: string;
    status: string;
    traffic_split_percent: number;
  };

  // URL convention — variant A at /{client}/{page}.html, variant B at
  // /{client}/{page}-b.html. Origin is derived from hosting_mode (the
  // operator's hosting_cname_host overrides for cname mode); for
  // opollo_subdomain we rely on the static_hosting public-URL config,
  // which the static writer doesn't itself expose. We use root-
  // relative URLs so the snippet's `new URL(target, location.origin)`
  // resolves correctly regardless of which subdomain the page was
  // served from.
  const aUrl = `/${args.pageSlug}.html`;
  const bUrl = `/${args.pageSlug}-b.html`;

  // Test id must be safe-id chars (the snippet's compile-time
  // validator enforces this); UUIDs are fine but include hyphens
  // which the snippet validator allows.
  return {
    test_id: test.id,
    traffic_split_percent: test.traffic_split_percent,
    variant_a_url: aUrl,
    variant_b_url: bUrl,
    this_variant: thisLabel,
  };
}

async function resolveVariantSlugSuffix(briefId: string): Promise<string> {
  const supabase = getServiceRoleClient();
  const variantRes = await supabase
    .from("opt_variants")
    .select("variant_label")
    .eq("brief_id", briefId)
    .maybeSingle();
  if (!variantRes.data) return "";
  const label = variantRes.data.variant_label as string;
  if (label === "B") return "-b";
  if (label === "C") return "-c";
  if (label === "D") return "-d";
  return "";
}

function derivePageSlug(
  url: string | null,
  slugHint: string | null,
  title: string,
): string {
  if (slugHint && slugHint.trim().length > 0) {
    return slugify(slugHint);
  }
  if (url) {
    try {
      const u = new URL(url);
      const last = u.pathname.split("/").filter(Boolean).pop();
      if (last) return slugify(last.replace(/\.html?$/i, ""));
    } catch {
      // fall through
    }
  }
  return slugify(title) || `page-${Date.now().toString(36)}`;
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}
