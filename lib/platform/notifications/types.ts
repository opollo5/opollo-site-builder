// Event types must match the platform_notification_type enum in
// migration 0070. Keep these aligned — adding a new event means
// extending both the enum (via a forward-only migration) and this
// type. Type system catches the gap at compile time via the Record<>
// shape in dispatch.ts.

export type NotificationEvent =
  | "invitation_sent"
  | "invitation_reminder"
  | "invitation_expired"
  | "invitation_accepted"
  | "approval_requested"
  | "approval_decided"
  | "connection_lost"
  | "connection_restored"
  | "post_published"
  | "post_failed"
  | "changes_requested"
  | "image_generation_failed"
  // B2 proof events
  | "proof_created"
  | "proof_approved"
  | "proof_revision_requested"
  | "new_version_created"
  // B3 step events
  | "proof_step_advanced"
  | "proof_sent_back"
  // Feedback module (migration 0179)
  | "ticket_created"
  | "ticket_assigned"
  | "ticket_comment_added"
  | "ticket_status_changed"
  | "ticket_reopened_by_customer";

export type NotificationChannel = "email" | "in_app";

// What each event needs from the caller. The dispatcher resolves
// recipients server-side from these IDs — callers don't need to know
// the role table.
export type DispatchPayload =
  | {
      event: "invitation_sent";
      companyId: string;
      inviteeEmail: string;
      inviterUserId: string | null;
      acceptUrl: string;
      expiresAt: string;
    }
  | {
      event: "invitation_reminder";
      companyId: string;
      inviteeEmail: string;
      acceptUrl: string;
      expiresAt: string;
    }
  | {
      event: "invitation_expired";
      companyId: string;
      inviteeEmail: string;
      inviterUserId: string | null;
    }
  | {
      event: "invitation_accepted";
      companyId: string;
      inviteeEmail: string;
      inviteeUserId: string;
      inviterUserId: string | null;
    }
  | {
      event: "approval_requested";
      companyId: string;
      postMasterId: string;
      submitterUserId: string;
    }
  | {
      event: "approval_decided";
      companyId: string;
      postMasterId: string;
      submitterUserId: string;
      decision: "approved" | "rejected" | "changes_requested";
      // Optional reviewer note; surfaced in the notification when decision is
      // 'changes_requested'. Omitted (or null) for approve/reject.
      comment?: string | null;
    }
  | {
      event: "connection_lost";
      companyId: string;
      platform: string;
      reason: string;
    }
  | {
      event: "connection_restored";
      companyId: string;
      platform: string;
    }
  | {
      event: "post_published";
      companyId: string;
      postMasterId: string;
      submitterUserId: string;
      platform: string;
      postUrl: string;
    }
  | {
      event: "post_failed";
      companyId: string;
      postMasterId: string;
      submitterUserId: string;
      platform: string;
      errorClass: string;
      errorMessage: string;
    }
  | {
      event: "changes_requested";
      companyId: string;
      postMasterId: string;
      submitterUserId: string;
      comment: string;
    }
  | {
      event: "image_generation_failed";
      companyId: string;
      styleId: string;
      compositionType: string;
      aspectRatio: string;
      attemptsCount: number;
    }
  // B2 proof events
  | {
      event: "proof_created";
      companyId: string;
      contentGroupId: string;
      submitterUserId: string;
      versionLabel: string;
    }
  | {
      event: "proof_approved";
      companyId: string;
      contentGroupId: string;
      submitterUserId: string;
    }
  | {
      event: "proof_revision_requested";
      companyId: string;
      contentGroupId: string;
      submitterUserId: string;
      comment?: string | null;
    }
  | {
      event: "new_version_created";
      companyId: string;
      contentGroupId: string;
      submitterUserId: string;
      versionLabel: string;
    }
  // B3 step events
  | {
      event: "proof_step_advanced";
      companyId: string;
      contentGroupId: string;
      submitterUserId: string;
      stepName: string;
    }
  | {
      event: "proof_sent_back";
      companyId: string;
      contentGroupId: string;
      submitterUserId: string;
      priorStepName: string;
      comment?: string | null;
    }
  // Feedback events (migration 0179)
  | {
      event: "ticket_created";
      companyId: string;
      ticketId: string;
      ticketTitle: string;
      severity: string;
      reporterUserId: string;
    }
  | {
      event: "ticket_assigned";
      companyId: string;
      ticketId: string;
      ticketTitle: string;
      assigneeUserId: string;
    }
  | {
      event: "ticket_comment_added";
      companyId: string;
      ticketId: string;
      ticketTitle: string;
      authorUserId: string;
      isStaffAuthor: boolean;
      assigneeUserId: string | null;
      reporterUserId: string;
    }
  | {
      event: "ticket_status_changed";
      companyId: string;
      ticketId: string;
      ticketTitle: string;
      fromStatus: string;
      toStatus: string;
      reporterUserId: string;
    }
  | {
      event: "ticket_reopened_by_customer";
      companyId: string;
      ticketId: string;
      ticketTitle: string;
      reporterUserId: string;
      assigneeUserId: string | null;
    };

// The set of channels each event fires on. Mirrors the trigger table in
// BUILD.md / platform-customer-management skill.
export const EVENT_CHANNELS: Record<NotificationEvent, readonly NotificationChannel[]> = {
  invitation_sent:       ["email"],
  invitation_reminder:   ["email"],
  invitation_expired:    ["email"],
  invitation_accepted:   ["email", "in_app"],
  approval_requested:    ["email", "in_app"],
  approval_decided:      ["email", "in_app"],
  connection_lost:       ["email", "in_app"],
  connection_restored:   ["in_app"],
  post_published:        ["in_app"],
  post_failed:              ["email", "in_app"],
  changes_requested:        ["email", "in_app"],
  image_generation_failed:  ["email"],
  proof_created:            ["in_app"],
  proof_approved:           ["email", "in_app"],
  proof_revision_requested: ["email", "in_app"],
  new_version_created:      ["email", "in_app"],
  proof_step_advanced:      ["email", "in_app"],
  proof_sent_back:          ["email", "in_app"],
  // Feedback events: blocker tickets are always immediate; others follow
  // the same in_app+email pattern but route through the cadence guard.
  ticket_created:               ["email", "in_app"],
  ticket_assigned:              ["in_app"],
  ticket_comment_added:         ["email", "in_app"],
  ticket_status_changed:        ["in_app"],
  ticket_reopened_by_customer:  ["email", "in_app"],
};

// Recipient kinds the dispatcher knows how to resolve. Each event maps
// to one or more of these in dispatch.ts.
export type RecipientKind =
  | "invitee_email"
  | "inviter"
  | "submitter"
  | "company_admins"
  | "opollo_admins"
  | "company_members";

export type ResolvedRecipient = {
  // For platform users: their auth.users.id. For external (invitee_email
  // before they accept): null.
  userId: string | null;
  email: string;
  // Best-effort display name; null when we don't know.
  fullName: string | null;
};

export type DispatchResult = {
  // How many in-app rows were inserted. 0 means the event has no
  // in_app channel OR no platform-user recipients.
  inApp: number;
  // How many emails were attempted (success + failure both count;
  // failures are logged inside dispatch).
  emails: number;
  // Failures captured for the caller to log if it cares; dispatch
  // itself does not throw.
  errors: Array<{ recipient: string; reason: string }>;
};
