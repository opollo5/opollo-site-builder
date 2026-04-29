import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import type { OptHostingMode } from "./types";

// ---------------------------------------------------------------------------
// opt_clients DAO. Uses the service-role client because RLS on
// opt_clients allows authenticated admin/operator anyway, but we route
// every write through the service path so the touched-by audit field
// is always populated and the admin gate stays on the route layer.
// ---------------------------------------------------------------------------

export type OptClient = {
  id: string;
  name: string;
  primary_contact_email: string | null;
  cross_client_learning_consent: boolean;
  llm_monthly_budget_usd: number;
  hosting_mode: OptHostingMode;
  hosting_cname_host: string | null;
  client_slug: string;
  staged_rollout_config: Record<string, unknown>;
  confidence_overrides: Record<string, unknown>;
  data_threshold_overrides: Record<string, unknown>;
  onboarded_at: string | null;
  // v1.6 additions — composite-score weights + conversion-component
  // availability + causal-delta measurement window.
  score_weights: {
    alignment: number;
    behaviour: number;
    conversion: number;
    technical: number;
  };
  conversion_components_present: {
    cr: boolean;
    cpa: boolean;
    revenue: boolean;
  };
  causal_eval_window_days: number;
  version_lock: number;
  created_at: string;
  updated_at: string;
};

const CLIENT_COLUMNS =
  "id, name, primary_contact_email, cross_client_learning_consent, llm_monthly_budget_usd, hosting_mode, hosting_cname_host, client_slug, staged_rollout_config, confidence_overrides, data_threshold_overrides, onboarded_at, score_weights, conversion_components_present, causal_eval_window_days, version_lock, created_at, updated_at";

export async function listClients(): Promise<OptClient[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("opt_clients")
    .select(CLIENT_COLUMNS)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listClients: ${error.message}`);
  return (data ?? []) as OptClient[];
}

export async function getClient(id: string): Promise<OptClient | null> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("opt_clients")
    .select(CLIENT_COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getClient: ${error.message}`);
  return (data as OptClient | null) ?? null;
}

export type CreateClientInput = {
  name: string;
  primary_contact_email?: string;
  client_slug: string;
  hosting_mode?: OptHostingMode;
  hosting_cname_host?: string;
  llm_monthly_budget_usd?: number;
  cross_client_learning_consent?: boolean;
  created_by?: string | null;
};

export async function createClient(
  input: CreateClientInput,
): Promise<OptClient> {
  const supabase = getServiceRoleClient();
  const slug = input.client_slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) {
    throw new Error(
      "client_slug must be 2-41 chars: lowercase letters, digits, hyphens",
    );
  }
  const { data, error } = await supabase
    .from("opt_clients")
    .insert({
      name: input.name.trim(),
      primary_contact_email: input.primary_contact_email?.trim() || null,
      client_slug: slug,
      hosting_mode: input.hosting_mode ?? "opollo_subdomain",
      hosting_cname_host: input.hosting_cname_host?.trim() || null,
      llm_monthly_budget_usd: input.llm_monthly_budget_usd ?? 50,
      cross_client_learning_consent:
        input.cross_client_learning_consent ?? false,
      created_by: input.created_by ?? null,
      updated_by: input.created_by ?? null,
    })
    .select(CLIENT_COLUMNS)
    .single();
  if (error || !data) {
    throw new Error(`createClient: ${error?.message ?? "no data"}`);
  }
  return data as OptClient;
}

export type UpdateClientInput = Partial<{
  name: string;
  primary_contact_email: string | null;
  hosting_mode: OptHostingMode;
  hosting_cname_host: string | null;
  llm_monthly_budget_usd: number;
  cross_client_learning_consent: boolean;
  updated_by: string | null;
}>;

export async function updateClient(
  id: string,
  input: UpdateClientInput,
): Promise<OptClient> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("opt_clients")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select(CLIENT_COLUMNS)
    .single();
  if (error || !data) {
    throw new Error(`updateClient: ${error?.message ?? "no data"}`);
  }
  return data as OptClient;
}

export async function markOnboarded(
  id: string,
  userId: string | null,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase
    .from("opt_clients")
    .update({
      onboarded_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq("id", id)
    .is("onboarded_at", null);
  if (error) throw new Error(`markOnboarded: ${error.message}`);
}
