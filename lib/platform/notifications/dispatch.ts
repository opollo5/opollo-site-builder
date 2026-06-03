import "server-only";

import { sendEmail } from "@/lib/email/sendgrid";
import { renderBaseEmail, escapeHtml } from "@/lib/email/templates/base";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import {
  dedupeByEmail,
  resolveCompanyAdmins,
  resolveOpolloAdmins,
  resolveUserById,
} from "./recipients";
import {
  EVENT_CHANNELS,
  type DispatchPayload,
  type DispatchResult,
  type NotificationEvent,
  type ResolvedRecipient,
} from "./types";

// ---------------------------------------------------------------------------
// Single entry point for every platform-layer notification. Resolves
// recipients per event, fans out to the configured channels (email
// and/or in-app), and never throws — failures are logged and surfaced
// via the result envelope so the caller can decide whether to care.
//
// The bell-icon UI (lib/platform/notifications/queries.ts: list / unread
// count / mark read) lands when the in-app surface ships. Until then,
// in-app rows accumulate in platform_notifications and are visible via
// service-role queries.
//
// Inline rendering for V1: the templates/ subfolder pattern from the
// platform-customer-management skill is deferred — each event's
// subject/body is small and lives inline on dispatch. When templates
// proliferate (Phase 2 with CAP / analytics events), refactor into
// templates/<event>.ts.
// ---------------------------------------------------------------------------

export async function dispatch(
  payload: DispatchPayload,
): Promise<DispatchResult> {
  const result: DispatchResult = { inApp: 0, emails: 0, errors: [] };

  const channels = EVENT_CHANNELS[payload.event];
  const recipients = await resolveRecipients(payload);
  const deduped = dedupeByEmail(recipients);

  if (deduped.length === 0) {
    logger.info("notifications.dispatch.no_recipients", {
      event: payload.event,
      company_id: payload.companyId,
    });
    return result;
  }

  if (channels.includes("in_app")) {
    result.inApp = await writeInAppRows(payload, deduped, result);
  }
  if (channels.includes("email")) {
    result.emails = await sendEmails(payload, deduped, result);
  }

  return result;
}

async function resolveRecipients(
  payload: DispatchPayload,
): Promise<ResolvedRecipient[]> {
  switch (payload.event) {
    case "invitation_sent":
    case "invitation_reminder":
      // Invitee only — no userId yet (not a platform user until accept).
      return [
        { userId: null, email: payload.inviteeEmail, fullName: null },
      ];

    case "invitation_expired": {
      // Invitee + inviter (if the inviter is still around).
      const recipients: ResolvedRecipient[] = [
        { userId: null, email: payload.inviteeEmail, fullName: null },
      ];
      if (payload.inviterUserId) {
        const inviter = await resolveUserById(payload.inviterUserId);
        if (inviter) recipients.push(inviter);
      }
      return recipients;
    }

    case "invitation_accepted": {
      // Inviter + company admins. The new user themselves doesn't get a
      // notification — they're already on the page that just provisioned
      // them.
      const recipients: ResolvedRecipient[] = [];
      if (payload.inviterUserId) {
        const inviter = await resolveUserById(payload.inviterUserId);
        if (inviter) recipients.push(inviter);
      }
      const admins = await resolveCompanyAdmins(payload.companyId);
      return [...recipients, ...admins];
    }

    case "approval_requested":
      // Per the skill: "Company Approvers". For V1 we send to all admins
      // + approvers (both can approve). Editor and viewer are excluded.
      // Implementation: company members with role in (admin, approver).
      return resolveAdminsOrApprovers(payload.companyId);

    case "approval_decided":
    case "post_published":
    case "post_failed":
    case "changes_requested": {
      // Submitter + company admins.
      const submitter = await resolveUserById(payload.submitterUserId);
      const admins = await resolveCompanyAdmins(payload.companyId);
      return submitter ? [submitter, ...admins] : admins;
    }

    case "connection_lost": {
      // Opollo admins + company admins.
      const [opollo, admins] = await Promise.all([
        resolveOpolloAdmins(),
        resolveCompanyAdmins(payload.companyId),
      ]);
      return [...opollo, ...admins];
    }

    case "connection_restored":
      // Company admins only.
      return resolveCompanyAdmins(payload.companyId);

    case "image_generation_failed":
      // Platform admins of the company — same audience as connection_lost.
      return resolveCompanyAdmins(payload.companyId);

    case "proof_created":
    case "new_version_created": {
      // Submitter + company admins.
      const submitter = await resolveUserById(payload.submitterUserId);
      const admins = await resolveCompanyAdmins(payload.companyId);
      return submitter ? [submitter, ...admins] : admins;
    }

    case "proof_approved": {
      const submitter = await resolveUserById(payload.submitterUserId);
      const admins = await resolveCompanyAdmins(payload.companyId);
      return submitter ? [submitter, ...admins] : admins;
    }

    case "proof_revision_requested": {
      const submitter = await resolveUserById(payload.submitterUserId);
      const admins = await resolveCompanyAdmins(payload.companyId);
      return submitter ? [submitter, ...admins] : admins;
    }

    case "proof_step_advanced":
    case "proof_sent_back": {
      const submitter = await resolveUserById(payload.submitterUserId);
      const admins = await resolveCompanyAdmins(payload.companyId);
      return submitter ? [submitter, ...admins] : admins;
    }

    // Feedback events (§8 of feedback build spec)
    case "ticket_created": {
      // Notify all Opollo staff. Blocker severity has no additional
      // recipient widening here — all staff is already the full set.
      return resolveOpolloAdmins();
    }

    case "ticket_assigned": {
      const assignee = await resolveUserById(payload.assigneeUserId);
      return assignee ? [assignee] : [];
    }

    case "ticket_comment_added": {
      if (payload.isStaffAuthor) {
        // Staff replied → notify the reporter.
        const reporter = await resolveUserById(payload.reporterUserId);
        return reporter ? [reporter] : [];
      } else {
        // Reporter replied → notify the assignee (else Opollo staff).
        if (payload.assigneeUserId) {
          const assignee = await resolveUserById(payload.assigneeUserId);
          return assignee ? [assignee] : resolveOpolloAdmins();
        }
        return resolveOpolloAdmins();
      }
    }

    case "ticket_status_changed": {
      const reporter = await resolveUserById(payload.reporterUserId);
      return reporter ? [reporter] : [];
    }

    case "ticket_reopened_by_customer": {
      const recipients: ResolvedRecipient[] = [];
      if (payload.assigneeUserId) {
        const assignee = await resolveUserById(payload.assigneeUserId);
        if (assignee) recipients.push(assignee);
      }
      const staff = await resolveOpolloAdmins();
      return [...recipients, ...staff];
    }
  }
}

async function resolveAdminsOrApprovers(
  companyId: string,
): Promise<ResolvedRecipient[]> {
  const svc = getServiceRoleClient();
  const memberships = await svc
    .from("platform_company_users")
    .select("user_id")
    .eq("company_id", companyId)
    .in("role", ["admin", "approver"]);
  if (memberships.error) {
    logger.error("notifications.dispatch.approvers_failed", {
      err: memberships.error.message,
    });
    return [];
  }
  const userIds = (memberships.data ?? []).map((m) => m.user_id as string);
  if (userIds.length === 0) return [];
  const users = await svc
    .from("platform_users")
    .select("id, email, full_name")
    .in("id", userIds);
  if (users.error) {
    logger.error("notifications.dispatch.approvers_users_failed", {
      err: users.error.message,
    });
    return [];
  }
  return (users.data ?? []).map((u) => ({
    userId: u.id as string,
    email: u.email as string,
    fullName: (u.full_name as string | null) ?? null,
  }));
}

async function writeInAppRows(
  payload: DispatchPayload,
  recipients: ResolvedRecipient[],
  result: DispatchResult,
): Promise<number> {
  const platformUsers = recipients.filter((r) => r.userId !== null);
  if (platformUsers.length === 0) return 0;

  const { title, body, actionUrl } = renderInApp(payload);
  const svc = getServiceRoleClient();
  const rows = platformUsers.map((r) => ({
    user_id: r.userId!,
    company_id: payload.companyId,
    type: payload.event,
    title,
    body,
    action_url: actionUrl,
  }));

  const insert = await svc
    .from("platform_notifications")
    .insert(rows)
    .select("id");

  if (insert.error) {
    logger.error("notifications.dispatch.in_app_insert_failed", {
      event: payload.event,
      company_id: payload.companyId,
      err: insert.error.message,
    });
    result.errors.push({
      recipient: "in_app",
      reason: insert.error.message,
    });
    return 0;
  }

  return insert.data?.length ?? 0;
}

async function sendEmails(
  payload: DispatchPayload,
  recipients: ResolvedRecipient[],
  result: DispatchResult,
): Promise<number> {
  const { subject, html, text } = renderEmail(payload);
  let count = 0;
  for (const r of recipients) {
    const send = await sendEmail({ to: r.email, subject, html, text });
    if (!send.ok) {
      logger.warn("notifications.dispatch.email_failed", {
        event: payload.event,
        company_id: payload.companyId,
        recipient: r.email,
        err: send.error.message,
      });
      result.errors.push({ recipient: r.email, reason: send.error.message });
      continue;
    }
    count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Inline renderers. Each event has a small subject/body — no per-event
// template files needed for V1.
// ---------------------------------------------------------------------------

function renderInApp(
  payload: DispatchPayload,
): { title: string; body: string; actionUrl: string | null } {
  switch (payload.event) {
    case "invitation_accepted":
      return {
        title: `${payload.inviteeEmail} accepted their invitation`,
        body: "They're now a member of your company on Opollo.",
        actionUrl: null,
      };
    case "approval_requested":
      return {
        title: "A post needs your approval",
        body: "Open the calendar to review.",
        actionUrl: `/company/social/posts/${payload.postMasterId}`,
      };
    case "approval_decided":
      return {
        title: `Your post was ${payload.decision}`,
        body: payload.decision === "approved"
          ? "Schedule it from the calendar when you're ready."
          : payload.comment
            ? payload.comment
            : payload.decision === "rejected"
              ? "Open the post to see the feedback."
              : "Changes requested — review the post and resubmit.",
        actionUrl: `/company/social/posts/${payload.postMasterId}`,
      };
    case "connection_lost":
      return {
        title: `${payload.platform} connection needs attention`,
        body: payload.reason,
        actionUrl: "/company/social/connections",
      };
    case "connection_restored":
      return {
        title: `${payload.platform} connection is healthy again`,
        body: "Failed posts can be retried from the failures queue.",
        actionUrl: "/company/social/connections",
      };
    case "post_published":
      return {
        title: `Published to ${payload.platform}`,
        body: payload.postUrl,
        actionUrl: payload.postUrl,
      };
    case "post_failed":
      return {
        title: `Publish to ${payload.platform} failed`,
        body: `${payload.errorClass}: ${payload.errorMessage}`,
        actionUrl: `/company/social/posts/${payload.postMasterId}`,
      };
    case "changes_requested":
      return {
        title: "Changes requested on your post",
        body: payload.comment,
        actionUrl: `/company/social/posts/${payload.postMasterId}`,
      };
    // Email-only events still get an inline renderer to keep the
    // exhaustive-switch contract; they just won't be invoked.
    case "invitation_sent":
    case "invitation_reminder":
    case "invitation_expired":
    case "image_generation_failed":
      return {
        title: "Image generation failed",
        body: "",
        actionUrl: null,
      };

    case "proof_created":
      return {
        title: `Proof ${payload.versionLabel} created`,
        body: "A new content proof has been opened for review.",
        actionUrl: null,
      };
    case "proof_approved":
      return {
        title: "Proof approved",
        body: "All required reviewers have approved. The content will be scheduled for publishing.",
        actionUrl: null,
      };
    case "proof_revision_requested":
      return {
        title: "Changes requested on proof",
        body: payload.comment ?? "A reviewer has requested changes. Create a new version to resubmit.",
        actionUrl: null,
      };
    case "new_version_created":
      return {
        title: `New version ${payload.versionLabel} created`,
        body: "A revised version has been submitted for re-review.",
        actionUrl: null,
      };
    // B3 step events
    case "proof_step_advanced":
      return {
        title: `Proof moved to: ${payload.stepName}`,
        body: "The previous step passed. The next step is now open for review.",
        actionUrl: null,
      };
    case "proof_sent_back":
      return {
        title: `Proof sent back to: ${payload.priorStepName}`,
        body: payload.comment ?? "A gatekeeper has requested re-review of a prior step.",
        actionUrl: null,
      };

    // Feedback events
    case "ticket_created":
      return {
        title: `New bug report: ${payload.ticketTitle}`,
        body: `Severity: ${payload.severity}. Review it in the admin feedback board.`,
        actionUrl: `/admin/feedback/${payload.ticketId}`,
      };
    case "ticket_assigned":
      return {
        title: `Bug assigned to you: ${payload.ticketTitle}`,
        body: "A bug report has been assigned to you for investigation.",
        actionUrl: `/admin/feedback/${payload.ticketId}`,
      };
    case "ticket_comment_added":
      return {
        title: payload.isStaffAuthor
          ? `Opollo replied on: ${payload.ticketTitle}`
          : `Reply on: ${payload.ticketTitle}`,
        body: payload.isStaffAuthor
          ? "The Opollo team replied to your bug report."
          : "A user replied to a bug report.",
        actionUrl: payload.isStaffAuthor
          ? `/feedback/${payload.ticketId}`
          : `/admin/feedback/${payload.ticketId}`,
      };
    case "ticket_status_changed":
      return {
        title: `Bug status updated: ${payload.ticketTitle}`,
        body: `Status changed from ${payload.fromStatus} to ${payload.toStatus}.`,
        actionUrl: `/feedback/${payload.ticketId}`,
      };
    case "ticket_reopened_by_customer":
      return {
        title: `Bug reopened: ${payload.ticketTitle}`,
        body: "A customer reported this bug is still occurring.",
        actionUrl: `/admin/feedback/${payload.ticketId}`,
      };
  }
}

function renderEmail(
  payload: DispatchPayload,
): { subject: string; html: string; text: string } {
  // Each email follows the same brand shell (renderBaseEmail) so V1
  // doesn't need bespoke designs per event. The subject + body lines
  // capture what the recipient needs to know.
  const { subject, lead, action } = renderEmailContent(payload);

  const htmlBody = `
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#0f172a;">
      ${escapeHtml(lead)}
    </p>
  `;

  const textBody = lead;

  const { html, text } = renderBaseEmail({
    heading: subject,
    bodyHtml: htmlBody,
    bodyText: textBody,
    cta: action ?? undefined,
    footerNote: "Sent automatically by Opollo.",
  });

  return { subject, html, text };
}

function renderEmailContent(
  payload: DispatchPayload,
): {
  subject: string;
  lead: string;
  action: { label: string; url: string } | null;
} {
  switch (payload.event) {
    case "invitation_sent":
      return {
        subject: "You've been invited to Opollo",
        lead: "You've been invited to join a company on Opollo. The button below sets your password and creates your account.",
        action: { label: "Accept invitation", url: payload.acceptUrl },
      };
    case "invitation_reminder":
      return {
        subject: "Reminder: your Opollo invitation",
        lead: `Your invitation expires on ${formatDate(payload.expiresAt)}. Accept it before then or ask for a new one.`,
        action: { label: "Accept invitation", url: payload.acceptUrl },
      };
    case "invitation_expired":
      return {
        subject: "Your Opollo invitation expired",
        lead: "Your invitation to join Opollo expired without being accepted. Ask the inviter for a fresh one if you still need access.",
        action: null,
      };
    case "invitation_accepted":
      return {
        subject: "An invitation was accepted",
        lead: `${payload.inviteeEmail} accepted their invitation and is now a member of your company on Opollo.`,
        action: null,
      };
    case "approval_requested":
      return {
        subject: "A post needs your approval",
        lead: "A new post is waiting for your review on Opollo.",
        action: {
          label: "Review post",
          url: `${siteUrl()}/company/social/posts/${payload.postMasterId}`,
        },
      };
    case "approval_decided":
      return {
        subject: `Your post was ${payload.decision}`,
        lead:
          payload.decision === "approved"
            ? "Your post was approved and is ready to schedule."
            : payload.comment
              ? payload.comment
              : payload.decision === "rejected"
                ? "Your post was rejected. Open it on Opollo to see the feedback."
                : "Changes were requested on your post. Open it on Opollo to review.",
        action: {
          label: "Open post",
          url: `${siteUrl()}/company/social/posts/${payload.postMasterId}`,
        },
      };
    case "connection_lost":
      return {
        subject: `${payload.platform} connection lost`,
        lead: `Your ${payload.platform} connection on Opollo needs attention. Reason: ${payload.reason}.`,
        action: {
          label: "View connections",
          url: `${siteUrl()}/company/social/connections`,
        },
      };
    case "connection_restored":
      // Email-only event isn't on the channel list for connection_restored;
      // this branch is exhaustiveness defence. Still produces sane output
      // if a future change flips it on.
      return {
        subject: `${payload.platform} connection restored`,
        lead: `Your ${payload.platform} connection is healthy again.`,
        action: {
          label: "View connections",
          url: `${siteUrl()}/company/social/connections`,
        },
      };
    case "post_published":
      return {
        subject: `Published to ${payload.platform}`,
        lead: `Your post went live on ${payload.platform}: ${payload.postUrl}`,
        action: { label: "View post", url: payload.postUrl },
      };
    case "post_failed":
      return {
        subject: `Publish to ${payload.platform} failed`,
        lead: `Publishing to ${payload.platform} failed (${payload.errorClass}). Open Opollo to investigate.`,
        action: {
          label: "View post",
          url: `${siteUrl()}/company/social/posts/${payload.postMasterId}`,
        },
      };
    case "changes_requested":
      return {
        subject: "Changes requested on your post",
        lead: payload.comment,
        action: {
          label: "Open post",
          url: `${siteUrl()}/company/social/posts/${payload.postMasterId}`,
        },
      };
    case "image_generation_failed":
      return {
        subject: "Image generation failed — action may be required",
        lead: `All ${payload.attemptsCount} generation attempts for a ${payload.aspectRatio} image failed (style: ${payload.styleId}, composition: ${payload.compositionType}). The image was not produced. Check Ideogram API status or review the image_generation_log for details.`,
        action: null,
      };
    // B2 proof events
    case "proof_created":
      return {
        subject: `Proof ${payload.versionLabel} opened for review`,
        lead: "A new content proof has been opened. Reviewers have been notified.",
        action: null,
      };
    case "proof_approved":
      return {
        subject: "Proof approved — content will be published",
        lead: "All required reviewers approved the proof. The content has been queued for publishing.",
        action: null,
      };
    case "proof_revision_requested":
      return {
        subject: "Changes requested on proof",
        lead: payload.comment
          ? payload.comment
          : "A reviewer has requested changes. Create a new version to resubmit for review.",
        action: null,
      };
    case "new_version_created":
      return {
        subject: `New proof version ${payload.versionLabel} submitted for review`,
        lead: "A revised version has been submitted. Reviewers have been notified.",
        action: null,
      };
    // B3 step events
    case "proof_step_advanced":
      return {
        subject: `Proof advanced to: ${payload.stepName}`,
        lead: `The previous step passed. The proof has moved to the next step: ${payload.stepName}. Reviewers for this step have been notified.`,
        action: null,
      };
    case "proof_sent_back":
      return {
        subject: `Proof sent back to: ${payload.priorStepName}`,
        lead: payload.comment
          ? payload.comment
          : `A gatekeeper has sent the proof back to ${payload.priorStepName} for re-review.`,
        action: null,
      };

    // Feedback events
    case "ticket_created": {
      const isBlocker = payload.severity === "blocker";
      return {
        subject: isBlocker
          ? `🚨 BLOCKER bug reported: ${payload.ticketTitle}`
          : `New bug report: ${payload.ticketTitle}`,
        lead: isBlocker
          ? `A BLOCKER severity bug was just reported. Immediate attention required.`
          : `A new bug report has been submitted. Review it in the admin feedback board.`,
        action: {
          label: "Review bug report",
          url: `${siteUrl()}/admin/feedback/${payload.ticketId}`,
        },
      };
    }
    case "ticket_assigned":
      return {
        subject: `Bug assigned to you: ${payload.ticketTitle}`,
        lead: "A bug report has been assigned to you for investigation.",
        action: {
          label: "View bug report",
          url: `${siteUrl()}/admin/feedback/${payload.ticketId}`,
        },
      };
    case "ticket_comment_added":
      return {
        subject: payload.isStaffAuthor
          ? `Update on your bug report: ${payload.ticketTitle}`
          : `New reply on bug: ${payload.ticketTitle}`,
        lead: payload.isStaffAuthor
          ? "The Opollo team has replied to your bug report."
          : "A user has replied to a bug report you are following.",
        action: {
          label: "View conversation",
          url: payload.isStaffAuthor
            ? `${siteUrl()}/feedback/${payload.ticketId}`
            : `${siteUrl()}/admin/feedback/${payload.ticketId}`,
        },
      };
    case "ticket_status_changed":
      return {
        subject: `Bug update: ${payload.ticketTitle}`,
        lead: `Your bug report status changed from "${payload.fromStatus}" to "${payload.toStatus}".`,
        action: {
          label: "View bug report",
          url: `${siteUrl()}/feedback/${payload.ticketId}`,
        },
      };
    case "ticket_reopened_by_customer":
      return {
        subject: `Bug reopened: ${payload.ticketTitle}`,
        lead: "A customer has reported that this bug is still occurring after the fix.",
        action: {
          label: "Review bug report",
          url: `${siteUrl()}/admin/feedback/${payload.ticketId}`,
        },
      };
  }
}

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
