import "server-only";

import { logger } from "@/lib/logger";
import { hashToken } from "@/lib/platform/invitations";
import { getServiceRoleClient } from "@/lib/supabase";

import { issue, regenerate } from "./service";
import type { IssueResult } from "./types";

// ---------------------------------------------------------------------------
// regenerateApprovalLink — the resend primitive that was missing.
//
// Recon finding 5: raw tokens are discarded after creation, so Phase-2
// external-approver reminders (approval-callbacks.ts) could not send a
// fresh working link. After B1 this is the fix: call this to get a fresh
// raw token for reminder emails.
//
// Flow:
//   1. If the recipient has a magic_link_id → regenerate from that link
//      (revokes old, issues new with regenerated_from chain).
//   2. If the recipient has no magic_link_id (legacy row) → issue a brand-
//      new link and back-fill both token_hash and magic_link_id.
// ---------------------------------------------------------------------------
export async function regenerateApprovalLink(
  recipientId: string,
): Promise<IssueResult & { email: string }> {
  const svc = getServiceRoleClient();

  const { data: recipient, error: recipientErr } = await svc
    .from("social_approval_recipients")
    .select("id, approval_request_id, email, magic_link_id")
    .eq("id", recipientId)
    .maybeSingle();

  if (recipientErr || !recipient) {
    throw new Error(`Recipient not found: ${recipientId}`);
  }

  const rec = recipient as {
    id: string;
    approval_request_id: string;
    email: string;
    magic_link_id: string | null;
  };

  let result: IssueResult;

  if (rec.magic_link_id) {
    result = await regenerate(rec.magic_link_id);
  } else {
    // Legacy recipient without a magic_links row — issue fresh and back-fill
    const { data: req } = await svc
      .from("social_approval_requests")
      .select("company_id")
      .eq("id", rec.approval_request_id)
      .maybeSingle();

    result = await issue({
      purpose: "approval",
      subjectType: "approval_recipient",
      subjectId: rec.id,
      companyId: req?.company_id ?? undefined,
      email: rec.email,
    });
  }

  // Back-fill: keep social_approval_recipients.token_hash in sync (dual write)
  // and update the FK to the new link.
  const { error: updateErr } = await svc
    .from("social_approval_recipients")
    .update({
      token_hash: result.link.token_hash,
      magic_link_id: result.link.id,
    })
    .eq("id", rec.id);

  if (updateErr) {
    logger.error("magic_link.approval.regenerate.update_failed", {
      err: updateErr.message,
      recipient_id: rec.id,
    });
    throw new Error(
      `Failed to update recipient after regenerate: ${updateErr.message}`,
    );
  }

  return { ...result, email: rec.email };
}
