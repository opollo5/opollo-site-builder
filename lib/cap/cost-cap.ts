import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { recordHealthEvent } from "@/lib/platform/service-health/record";

export class CostCapExceededError extends Error {
  constructor(
    public readonly subscriptionId: string,
    public readonly spentUsd: number,
    public readonly capUsd: number,
  ) {
    super(`Cost cap exceeded for subscription ${subscriptionId}: $${spentUsd.toFixed(4)} of $${capUsd.toFixed(2)}`);
    this.name = "CostCapExceededError";
  }
}

/**
 * Throws CostCapExceededError if this subscription has exceeded its monthly
 * cost cap. Looks at cap_generation_runs over the past 30 days.
 *
 * Call BEFORE any generation attempt. When thrown, caller records a
 * service_health_event with type='cost_cap_exceeded', severity='warning'.
 */
export async function assertCostCapNotExceeded(subscriptionId: string): Promise<void> {
  const svc = getServiceRoleClient();

  const { data: sub } = await svc
    .from("cap_subscriptions")
    .select("monthly_cost_cap_usd")
    .eq("id", subscriptionId)
    .maybeSingle();

  if (!sub) return; // subscription not found — let caller fail on its own terms

  const capUsd = Number(sub.monthly_cost_cap_usd);

  // Sum generation runs in the past 30 days for all campaigns owned by this subscription
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: runs } = await svc
    .from("cap_generation_runs")
    .select("estimated_cost_usd, cap_campaign_id")
    .gte("created_at", since)
    .in(
      "cap_campaign_id",
      (
        await svc
          .from("cap_campaigns")
          .select("id")
          .eq("cap_subscription_id", subscriptionId)
      ).data?.map((c: { id: string }) => c.id) ?? [],
    );

  const spentUsd = (runs ?? []).reduce(
    (sum: number, r: { estimated_cost_usd: string | number }) => sum + Number(r.estimated_cost_usd),
    0,
  );

  logger.info("cap.cost-cap.check", { subscriptionId, spentUsd, capUsd });

  if (spentUsd >= capUsd) {
    void recordHealthEvent({
      serviceName: "cap",
      operation: "cost_cap_check",
      eventType: "cost_cap_exceeded",
      severity: "warning",
      details: { subscriptionId, spentUsd, capUsd },
    });
    throw new CostCapExceededError(subscriptionId, spentUsd, capUsd);
  }
}
