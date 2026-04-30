import "server-only";

import { logger } from "@/lib/logger";
import { sendEmail, escapeHtml } from "@/lib/optimiser/email/send";
import { approveProposal } from "@/lib/optimiser/proposals";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Assisted approval (Phase 2 Slice 21).
//
// Spec §6 feature 12 + §12.3:
//   - Per-client opt-in via opt_clients.assisted_approval_enabled
//   - Low-risk proposals (risk_level='low' AND effort_bucket=1)
//     auto-approve after 48 hours of being pending and unreviewed
//   - High-risk proposals ALWAYS require manual approval regardless
//     (enforced via the eligibility filter — high-risk never matches)
//   - Staff get a notification email when auto-approval fires (uses
//     the existing §9.11 email infrastructure)
//
// Cron-driven sweep that hits every opt_clients row with the flag on
// and finds eligible pending proposals older than the threshold.
// ---------------------------------------------------------------------------

const AUTO_APPROVE_AFTER_HOURS = 48;

export interface AssistedApprovalOutcome {
  client_id: string;
  client_name: string;
  proposals_auto_approved: number;
  proposals_skipped_high_risk: number;
  errors: number;
}

export async function runAssistedApprovalSweep(): Promise<{
  outcomes: AssistedApprovalOutcome[];
  total_auto_approved: number;
}> {
  const supabase = getServiceRoleClient();
  const { data: clients, error } = await supabase
    .from("opt_clients")
    .select("id, name, primary_contact_email, assisted_approval_enabled")
    .eq("assisted_approval_enabled", true)
    .is("deleted_at", null);
  if (error) {
    throw new Error(`runAssistedApprovalSweep: ${error.message}`);
  }
  const outcomes: AssistedApprovalOutcome[] = [];
  let total = 0;
  for (const client of clients ?? []) {
    const o = await sweepClient({
      clientId: client.id as string,
      clientName: client.name as string,
      recipient: (client.primary_contact_email as string | null) ?? null,
    });
    total += o.proposals_auto_approved;
    outcomes.push(o);
  }
  return { outcomes, total_auto_approved: total };
}

async function sweepClient(args: {
  clientId: string;
  clientName: string;
  recipient: string | null;
}): Promise<AssistedApprovalOutcome> {
  const supabase = getServiceRoleClient();
  const cutoff = new Date(
    Date.now() - AUTO_APPROVE_AFTER_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const { data: candidates, error } = await supabase
    .from("opt_proposals")
    .select(
      "id, headline, risk_level, effort_bucket, expected_impact_min_pp, expected_impact_max_pp, created_at",
    )
    .eq("client_id", args.clientId)
    .eq("status", "pending")
    .eq("category", "content_fix")
    .lte("created_at", cutoff)
    .is("deleted_at", null);
  if (error) {
    logger.error("optimiser.assisted_approval.list_failed", {
      client_id: args.clientId,
      error: error.message,
    });
    return {
      client_id: args.clientId,
      client_name: args.clientName,
      proposals_auto_approved: 0,
      proposals_skipped_high_risk: 0,
      errors: 1,
    };
  }

  let approved = 0;
  let skippedHighRisk = 0;
  let errs = 0;
  const approvedRows: Array<{ id: string; headline: string }> = [];

  for (const proposal of candidates ?? []) {
    // Defence-in-depth: high-risk proposals must NEVER auto-approve.
    if (proposal.risk_level !== "low" || proposal.effort_bucket !== 1) {
      skippedHighRisk += 1;
      continue;
    }
    try {
      const result = await approveProposal({
        proposalId: proposal.id as string,
        // null approverUserId — system-driven, not a real user.
        approverUserId: null,
      });
      if (!result.ok) {
        // Expired / guardrail / status conflict — log and skip; the
        // expiry sweep cleans these up separately.
        logger.info("optimiser.assisted_approval.skipped", {
          proposal_id: proposal.id,
          code: result.code,
          message: result.message,
        });
        continue;
      }
      approved += 1;
      approvedRows.push({
        id: proposal.id as string,
        headline: proposal.headline as string,
      });
    } catch (err) {
      errs += 1;
      logger.error("optimiser.assisted_approval.failed", {
        proposal_id: proposal.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Notification email — staff get a "these proposals just auto-
  // approved" digest if any fired this tick.
  if (approvedRows.length > 0 && args.recipient) {
    await sendNotificationEmail({
      recipient: args.recipient,
      clientName: args.clientName,
      approved: approvedRows,
    });
  }

  return {
    client_id: args.clientId,
    client_name: args.clientName,
    proposals_auto_approved: approved,
    proposals_skipped_high_risk: skippedHighRisk,
    errors: errs,
  };
}

async function sendNotificationEmail(args: {
  recipient: string;
  clientName: string;
  approved: Array<{ id: string; headline: string }>;
}): Promise<void> {
  const subject = `[Optimiser] ${args.clientName} — ${args.approved.length} proposal${args.approved.length === 1 ? "" : "s"} auto-approved`;
  const text = [
    `Optimiser assisted-approval — ${args.clientName}`,
    "",
    `${args.approved.length} low-risk proposal${args.approved.length === 1 ? "" : "s"} auto-approved after the 48-hour review window.`,
    "",
    ...args.approved.map((p) => `- ${p.headline} (${p.id.slice(0, 8)}…)`),
    "",
    "Each was risk_level=low, effort_bucket=1. High-risk proposals always require manual approval.",
    "Disable assisted approval at /optimiser/clients/<id>/settings.",
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family: -apple-system,Segoe UI,Roboto,sans-serif">
<h1>Optimiser assisted-approval — ${escapeHtml(args.clientName)}</h1>
<p>${args.approved.length} low-risk proposal${args.approved.length === 1 ? "" : "s"} auto-approved after the 48-hour review window.</p>
<ul>
${args.approved.map((p) => `<li>${escapeHtml(p.headline)} <span style="color:#666">(${escapeHtml(p.id.slice(0, 8))}…)</span></li>`).join("\n")}
</ul>
<p style="color:#666">Each was risk_level=low, effort_bucket=1. High-risk proposals always require manual approval. Disable assisted approval at /optimiser/clients/&lt;id&gt;/settings.</p>
</body></html>`;
  await sendEmail({
    to: args.recipient,
    subject,
    text,
    html,
    category: "optimiser.assisted_approval",
  });
}
