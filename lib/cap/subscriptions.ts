import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export type CapTier = "starter" | "growth" | "agency";
export type CapStatus = "trial" | "active" | "paused" | "cancelled";

export interface CapSubscription {
  id: string;
  company_id: string;
  tier: CapTier;
  status: CapStatus;
  approval_required: boolean;
  monthly_cost_cap_usd: number;
  monthly_objective_template: string | null;
  trial_ends_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getCapSubscriptionByCompany(
  companyId: string,
): Promise<CapSubscription | null> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("cap_subscriptions")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    logger.warn("cap.subscriptions.get_failed", { companyId, error: error.message });
    return null;
  }
  return data as CapSubscription | null;
}

export interface CreateCapSubscriptionInput {
  companyId: string;
  tier: CapTier;
  status: CapStatus;
  approvalRequired?: boolean;
  monthlyCostCapUsd?: number;
  trialEndsAt?: string | null;
}

export async function createCapSubscription(
  input: CreateCapSubscriptionInput,
): Promise<CapSubscription> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("cap_subscriptions")
    .insert({
      company_id: input.companyId,
      tier: input.tier,
      status: input.status,
      approval_required: input.approvalRequired ?? false,
      monthly_cost_cap_usd: input.monthlyCostCapUsd ?? 200.0,
      trial_ends_at: input.trialEndsAt ?? null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create CAP subscription: ${error.message}`);
  }
  return data as CapSubscription;
}

export async function updateCapSubscriptionStatus(
  subscriptionId: string,
  status: CapStatus,
): Promise<void> {
  const svc = getServiceRoleClient();
  const { error } = await svc
    .from("cap_subscriptions")
    .update({ status })
    .eq("id", subscriptionId);

  if (error) {
    throw new Error(`Failed to update CAP subscription status: ${error.message}`);
  }
}

export async function updateCapSubscriptionObjectiveTemplate(
  subscriptionId: string,
  monthlyObjectiveTemplate: string | null,
): Promise<CapSubscription> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("cap_subscriptions")
    .update({ monthly_objective_template: monthlyObjectiveTemplate })
    .eq("id", subscriptionId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update CAP subscription objective template: ${error.message}`);
  }
  return data as CapSubscription;
}
