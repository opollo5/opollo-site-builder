import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import type { OptManagementMode, OptPageState } from "./types";

// ---------------------------------------------------------------------------
// opt_landing_pages helpers — listing, bulk-select per §7.4, and the
// page-import flow stub per §7.5.
// ---------------------------------------------------------------------------

export type LandingPage = {
  id: string;
  client_id: string;
  url: string;
  display_name: string | null;
  managed: boolean;
  management_mode: OptManagementMode;
  page_id: string | null;
  state: OptPageState;
  state_evaluated_at: string | null;
  state_reasons: unknown[];
  spend_30d_usd_cents: number;
  sessions_30d: number;
  core_offer: string | null;
  page_snapshot: Record<string, unknown>;
  active_technical_alerts: unknown[];
  data_reliability: "green" | "amber" | "red";
  data_reliability_checks: Record<string, unknown>;
  version_lock: number;
  created_at: string;
  updated_at: string;
};

const COLS =
  "id, client_id, url, display_name, managed, management_mode, page_id, state, state_evaluated_at, state_reasons, spend_30d_usd_cents, sessions_30d, core_offer, page_snapshot, active_technical_alerts, data_reliability, data_reliability_checks, version_lock, created_at, updated_at";

export async function listLandingPagesForClient(
  clientId: string,
): Promise<LandingPage[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("opt_landing_pages")
    .select(COLS)
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .order("spend_30d_usd_cents", { ascending: false });
  if (error) throw new Error(`listLandingPagesForClient: ${error.message}`);
  return (data ?? []) as LandingPage[];
}

export async function getLandingPage(id: string): Promise<LandingPage | null> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("opt_landing_pages")
    .select(COLS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getLandingPage: ${error.message}`);
  return (data as LandingPage | null) ?? null;
}

/**
 * Default-checked logic per §7.4.1: pages with > $100/month Ads spend
 * are pre-selected. Threshold in micros: 100 USD = 10_000 cents.
 */
export function defaultCheckedForBulk(page: LandingPage): boolean {
  return page.spend_30d_usd_cents > 100 * 100;
}

/** Set the managed flag for a list of pages. */
export async function setManagedFlag(
  clientId: string,
  pageIds: string[],
  managed: boolean,
  userId: string | null,
): Promise<{ updated: number }> {
  const supabase = getServiceRoleClient();
  if (pageIds.length === 0) return { updated: 0 };
  const { data, error } = await supabase
    .from("opt_landing_pages")
    .update({ managed, updated_by: userId })
    .eq("client_id", clientId)
    .in("id", pageIds)
    .is("deleted_at", null)
    .select("id");
  if (error) throw new Error(`setManagedFlag: ${error.message}`);
  return { updated: (data ?? []).length };
}

/** Add a single page manually (§7.4.1 'Add page manually'). */
export async function addPageManually(args: {
  clientId: string;
  url: string;
  displayName?: string;
  userId: string | null;
}): Promise<LandingPage> {
  const supabase = getServiceRoleClient();
  // Validate URL shape
  try {
    new URL(args.url);
  } catch {
    throw new Error(`addPageManually: invalid URL ${args.url}`);
  }
  const { data, error } = await supabase
    .from("opt_landing_pages")
    .upsert(
      {
        client_id: args.clientId,
        url: args.url,
        display_name: args.displayName ?? null,
        managed: true,
        management_mode: "read_only",
        state: "insufficient_data",
        created_by: args.userId,
        updated_by: args.userId,
      },
      { onConflict: "client_id,url" },
    )
    .select(COLS)
    .single();
  if (error || !data) {
    throw new Error(`addPageManually: ${error?.message ?? "no data"}`);
  }
  return data as LandingPage;
}
