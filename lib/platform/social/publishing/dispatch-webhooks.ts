import "server-only";

import crypto from "crypto";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// Spec v1.0 §2.3 — outbound webhook dispatcher.
//
// Runs from /api/cron/dispatch-webhooks every minute (Vercel cron minimum;
// spec says 30 s but sub-minute cron is not available on Vercel).
//
// Claims up to 50 pending platform_event_deliveries, POSTs each to the
// subscriber's webhook_url, and updates delivery status accordingly.
//
// Backoff schedule (attempt_count → delay):
//   0 → 0 s (immediate first delivery, from the fan-out trigger)
//   1 → 30 s
//   2 → 5 min
//   3 → 30 min
//   4 → 2 h
//   5 → 12 h
//   6+ → dead_lettered (24 h is what would have been attempt 6)
//
// After 6 failed attempts the delivery is dead-lettered and
// subscription.consecutive_failures is incremented. After 10 consecutive
// failures the subscription is marked inactive and a subscription_disabled
// event is emitted.
// ---------------------------------------------------------------------------

const BATCH_SIZE = 50;
const CLAIM_TTL_SECONDS = 30;
const WEBHOOK_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 6;
const MAX_CONSECUTIVE_FAILURES = 10;

const BACKOFF_SECONDS = [0, 30, 300, 1800, 7200, 43200];

export type DispatchResult = {
  examined: number;
  delivered: number;
  retried: number;
  deadLettered: number;
  errors: number;
};

function nextAttemptAt(attemptCount: number): Date {
  const delay = BACKOFF_SECONDS[attemptCount] ?? BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1];
  return new Date(Date.now() + delay * 1000);
}

function signBody(body: string, secret: string): string {
  return (
    "sha256=" +
    crypto.createHmac("sha256", secret).update(body).digest("hex")
  );
}

export async function dispatchWebhooks(): Promise<ApiResponse<DispatchResult>> {
  const svc = getServiceRoleClient();
  const now = new Date().toISOString();

  // Fetch up to BATCH_SIZE pending deliveries.
  const { data: pending, error: fetchErr } = await svc
    .from("platform_event_deliveries")
    .select(
      "id, subscription_id, event_id, attempt_count",
    )
    .eq("status", "pending")
    .lte("next_attempt_at", now)
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) {
    logger.error("dispatch_webhooks.fetch_failed", { err: fetchErr.message });
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: fetchErr.message, retryable: true, suggested_action: "Retry." },
      timestamp: new Date().toISOString(),
    };
  }

  const rows = pending ?? [];
  let delivered = 0;
  let retried = 0;
  let deadLettered = 0;
  let errors = 0;

  for (const row of rows) {
    const deliveryId = row.id as string;
    const subscriptionId = row.subscription_id as string;
    const eventId = row.event_id as string;
    const attemptCount = (row.attempt_count as number) ?? 0;

    // Claim the delivery atomically.
    const claimedUntil = new Date(Date.now() + CLAIM_TTL_SECONDS * 1000).toISOString();
    const { error: claimErr } = await svc
      .from("platform_event_deliveries")
      .update({ status: "in_flight", claimed_until: claimedUntil })
      .eq("id", deliveryId)
      .eq("status", "pending");

    if (claimErr) {
      // Another worker claimed this delivery; skip.
      continue;
    }

    // Look up subscription and event in parallel.
    const [subRes, evtRes] = await Promise.all([
      svc
        .from("platform_event_subscriptions")
        .select("webhook_url, signing_secret, consecutive_failures, active")
        .eq("id", subscriptionId)
        .maybeSingle(),
      svc
        .from("platform_events")
        .select("event_type, company_id, payload, created_at")
        .eq("id", eventId)
        .maybeSingle(),
    ]);

    if (subRes.error || !subRes.data || !subRes.data.active) {
      // Subscription gone or inactive — dead-letter silently.
      await svc
        .from("platform_event_deliveries")
        .update({ status: "dead_lettered", dead_lettered_at: new Date().toISOString() })
        .eq("id", deliveryId);
      deadLettered++;
      continue;
    }

    if (evtRes.error || !evtRes.data) {
      // Event gone — dead-letter.
      await svc
        .from("platform_event_deliveries")
        .update({ status: "dead_lettered", dead_lettered_at: new Date().toISOString() })
        .eq("id", deliveryId);
      deadLettered++;
      continue;
    }

    const sub = subRes.data;
    const evt = evtRes.data;

    // Build webhook payload.
    const webhookBody = JSON.stringify({
      event_id: eventId,
      event_type: evt.event_type,
      company_id: evt.company_id,
      payload: evt.payload,
      created_at: evt.created_at,
    });
    const signature = signBody(webhookBody, sub.signing_secret as string);

    // Attempt delivery.
    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    let success = false;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
      try {
        const res = await fetch(sub.webhook_url as string, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Opollo-Signature": signature,
            "X-Opollo-Event-Id": eventId,
          },
          body: webhookBody,
          signal: controller.signal,
        });
        responseStatus = res.status;
        responseBody = await res.text().catch(() => null);
        success = res.status >= 200 && res.status < 300;
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      responseBody = err instanceof Error ? err.message : "fetch error";
    }

    const nowTs = new Date().toISOString();

    if (success) {
      await svc
        .from("platform_event_deliveries")
        .update({
          status: "delivered",
          delivered_at: nowTs,
          attempt_count: attemptCount + 1,
          last_response_status: responseStatus,
          last_response_body: responseBody,
          claimed_until: null,
        })
        .eq("id", deliveryId);

      // Reset consecutive failure counter.
      await svc
        .from("platform_event_subscriptions")
        .update({ consecutive_failures: 0, last_delivery_at: nowTs })
        .eq("id", subscriptionId);

      delivered++;
    } else {
      const newAttemptCount = attemptCount + 1;

      if (newAttemptCount >= MAX_ATTEMPTS) {
        // Dead-letter.
        await svc
          .from("platform_event_deliveries")
          .update({
            status: "dead_lettered",
            dead_lettered_at: nowTs,
            attempt_count: newAttemptCount,
            last_response_status: responseStatus,
            last_response_body: responseBody,
            claimed_until: null,
          })
          .eq("id", deliveryId);

        // Increment consecutive_failures on subscription.
        const newConsecutive = ((sub.consecutive_failures as number) ?? 0) + 1;
        const subUpdate: Record<string, unknown> = { consecutive_failures: newConsecutive };

        if (newConsecutive >= MAX_CONSECUTIVE_FAILURES) {
          subUpdate.active = false;
          // Emit subscription_disabled event.
          void svc.from("platform_events").insert({
            event_type: "subscription_disabled",
            entity_type: "platform_event_subscription",
            entity_id: subscriptionId,
            payload: { consecutive_failures: newConsecutive, last_response_status: responseStatus },
          });
          logger.warn("dispatch_webhooks.subscription_disabled", {
            subscription_id: subscriptionId,
            consecutive_failures: newConsecutive,
          });
        }

        await svc
          .from("platform_event_subscriptions")
          .update(subUpdate)
          .eq("id", subscriptionId);

        deadLettered++;
      } else {
        // Schedule retry.
        await svc
          .from("platform_event_deliveries")
          .update({
            status: "pending",
            attempt_count: newAttemptCount,
            next_attempt_at: nextAttemptAt(newAttemptCount).toISOString(),
            last_response_status: responseStatus,
            last_response_body: responseBody,
            claimed_until: null,
          })
          .eq("id", deliveryId);

        retried++;
      }

      logger.warn("dispatch_webhooks.delivery_failed", {
        delivery_id: deliveryId,
        subscription_id: subscriptionId,
        attempt_count: newAttemptCount,
        response_status: responseStatus,
      });
      errors++;
    }
  }

  return {
    ok: true,
    data: { examined: rows.length, delivered, retried, deadLettered, errors },
    timestamp: new Date().toISOString(),
  };
}
