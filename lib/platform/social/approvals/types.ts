// Mirrors social_approval_rule + event_type enums in migration 0070.
export type ApprovalRule = "any_one" | "all_must";

export type ApprovalEventType =
  | "submitted"
  | "viewed"
  | "identity_bound"
  | "comment_added"
  | "approved"
  | "rejected"
  | "changes_requested"
  | "expired"
  | "revoked";

export type ApprovalRequest = {
  id: string;
  post_master_id: string;
  company_id: string;
  approval_rule: ApprovalRule;
  expires_at: string;
  revoked_at: string | null;
  final_approved_by_user_id: string | null;
  final_approved_by_email: string | null;
  final_approved_by_name: string | null;
  final_approved_at: string | null;
  final_rejected_at: string | null;
  created_at: string;
};

// Recipient view returned to the operator UI. token_hash and
// otp_code_hash are NEVER returned to the client — only stored
// server-side for verification. The raw token is returned ONCE on
// addRecipient() so the route can build the magic-link URL for the
// email body, then immediately discarded.
export type ApprovalRecipient = {
  id: string;
  approval_request_id: string;
  email: string;
  name: string | null;
  platform_user_id: string | null;
  requires_otp: boolean;
  // ISO timestamps
  revoked_at: string | null;
  created_at: string;
  // The OTP code is hashed; we only expose its expiry so the UI can
  // surface "OTP expired" without seeing the secret.
  otp_expires_at: string | null;
};

export type AddRecipientInput = {
  approvalRequestId: string;
  // Caller's company_id — used for scoping the parent request lookup
  // (defence-in-depth on top of RLS).
  companyId: string;
  email: string;
  name?: string | null;
  // If true, the magic-link viewer will challenge the recipient with
  // an OTP before showing the snapshot. V1 stores requires_otp but
  // the OTP issuance flow lands in the viewer slice.
  requiresOtp?: boolean;
};

export type AddRecipientResult = {
  recipient: ApprovalRecipient;
  // Raw token returned ONCE to the caller for the email body. Caller
  // MUST send the email immediately and discard the value from memory.
  rawToken: string;
};

export type ListRecipientsInput = {
  approvalRequestId: string;
  companyId: string;
};
