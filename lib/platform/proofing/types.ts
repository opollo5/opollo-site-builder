export type ProofState =
  | "draft"
  | "in_review"
  | "changes_requested"
  | "in_revision"
  | "approved"
  | "published"
  | "archived";

// Shape of snapshot_payload for a content_proof approval request.
// Immutable at request creation — reviewers always see content as it was
// when the proof was opened, not live edits.
export type ProofSnapshot = {
  content_group_id: string;
  draft_id: string;
  version_number: number;
  content: string | null;
  media_urls: string[] | null;
  platform_variants: Record<string, { content?: string; link?: string; cta?: string }> | null;
  submitted_at: string;
};

export type CreateProofInput = {
  draftId: string;
  companyId: string;
  submitterUserId: string;
  approvalRule: "any_one" | "all_must";
  recipients: Array<{
    email: string;
    name?: string | null;
    requiresOtp?: boolean;
  }>;
  expiryDays?: number;
  // Used to construct magic link URLs in day-0 invite emails.
  origin: string;
};

export type CreateProofResult = {
  approvalRequestId: string;
  recipientCount: number;
};

export type ReviseProofInput = {
  draftId: string;
  companyId: string;
  revisedByUserId: string;
};

export type ReviseProofResult = {
  newDraftId: string;
  contentGroupId: string;
  versionNumber: number;
};

export type OnProofPassInput = {
  approvalRequestId: string;
  contentGroupId: string;
  companyId: string;
  actorUserId?: string | null;
};

export type OnProofRejectInput = {
  approvalRequestId: string;
  contentGroupId: string;
  companyId: string;
  comment?: string | null;
};

export type ProofQueueItem = {
  approvalRequestId: string;
  recipientId: string;
  contentGroupId: string;
  snapshot: ProofSnapshot | null;
  companyName: string;
  expiresAt: string;
  versionLabel: string;
  // True when this is the item the current magic-link token directly maps to.
  isCurrentToken: boolean;
};
