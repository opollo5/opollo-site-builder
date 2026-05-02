import type { CompanyRole } from "@/lib/platform/auth";

export type InvitationStatus =
  | "pending"
  | "accepted"
  | "expired"
  | "revoked";

export type SendInvitationInput = {
  companyId: string;
  email: string;
  role: CompanyRole;
  invitedBy: string | null;
  // Optional override for testability; defaults to 14 days per BUILD.md.
  expiresAt?: string;
};

export type Invitation = {
  id: string;
  company_id: string;
  email: string;
  role: CompanyRole;
  status: InvitationStatus;
  expires_at: string;
  invited_by: string | null;
  accepted_at: string | null;
  accepted_user_id: string | null;
  revoked_at: string | null;
  reminder_sent_at: string | null;
  expired_notified_at: string | null;
  created_at: string;
};

export type SendErrorCode =
  | "ACTIVE_MEMBERSHIP_EXISTS"
  | "PENDING_INVITE_EXISTS"
  | "VALIDATION_FAILED"
  | "INTERNAL_ERROR";

export type SendInvitationResult =
  | {
      ok: true;
      invitation: Invitation;
      // Raw token returned to the caller for the email body. NEVER stored;
      // only the SHA-256 hash lands in token_hash. Caller MUST send the
      // email immediately and discard the raw token from memory.
      rawToken: string;
    }
  | {
      ok: false;
      error: { code: SendErrorCode; message: string };
    };

export type RevokeErrorCode =
  | "NOT_FOUND"
  | "ALREADY_ACCEPTED"
  | "ALREADY_REVOKED"
  | "INTERNAL_ERROR";

export type RevokeInvitationResult =
  | { ok: true; invitation: Invitation }
  | { ok: false; error: { code: RevokeErrorCode; message: string } };

export type AcceptInvitationInput = {
  rawToken: string;
  email: string;
  password: string;
  fullName: string;
};

export type AcceptErrorCode =
  | "INVALID_TOKEN"
  | "EXPIRED"
  | "REVOKED"
  | "ALREADY_ACCEPTED"
  | "EMAIL_MISMATCH"
  | "AUTH_USER_EXISTS"
  | "VALIDATION_FAILED"
  | "INTERNAL_ERROR";

export type AcceptInvitationResult =
  | {
      ok: true;
      userId: string;
      companyId: string;
      role: CompanyRole;
    }
  | {
      ok: false;
      error: { code: AcceptErrorCode; message: string };
    };
