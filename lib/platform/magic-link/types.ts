export type MagicLinkPurpose = "approval" | "login" | "reconnect";

export type MagicLink = {
  id: string;
  purpose: MagicLinkPurpose;
  token_hash: string;
  subject_type: string | null;
  subject_id: string | null;
  company_id: string | null;
  email: string | null;
  expires_at: string;
  consumed_at: string | null;
  session_expires_at: string | null;
  revoked_at: string | null;
  regenerated_from: string | null;
  created_at: string;
};

export type IssueInput = {
  purpose: MagicLinkPurpose;
  subjectType?: string;
  subjectId?: string;
  companyId?: string;
  email?: string;
  ttlMs?: number;
};

export type IssueResult = {
  rawToken: string;
  link: MagicLink;
};

export type ValidateResult =
  | { valid: true; link: MagicLink; sessionActive: boolean }
  | {
      valid: false;
      reason: "not_found" | "expired" | "revoked" | "session_expired";
    };

export type ConsumeResult =
  | { valid: true; link: MagicLink; isNewConsumption: boolean }
  | {
      valid: false;
      reason: "not_found" | "expired" | "revoked" | "session_expired";
    };

// Default link validity windows (ms from issuance to first-click deadline)
export const LINK_TTL_MS: Record<MagicLinkPurpose, number> = {
  approval: 24 * 60 * 60 * 1000,  // 24h — B0 §1: reviewer has 24h to click
  login: 15 * 60 * 1000,           // 15min — short-lived passwordless link
  reconnect: 24 * 60 * 60 * 1000, // 24h
};

// Session duration after first click (ms). Zero = no lingering session.
export const SESSION_TTL_MS: Record<MagicLinkPurpose, number> = {
  approval: 23 * 60 * 60 * 1000, // 23h — B0 §2: same-day session, ≤24h
  login: 0,                        // login creates a Supabase session, not a link session
  reconnect: 2 * 60 * 60 * 1000, // 2h
};
