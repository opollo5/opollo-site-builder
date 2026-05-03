// Mirrors social_post_state / social_post_source enums in migration 0070.
// Keep aligned: extending the enum requires a forward-only migration AND
// extending these literal unions; TypeScript catches the gap at compile
// time via exhaustive switches over the type.
export type SocialPostState =
  | "draft"
  | "pending_client_approval"
  | "approved"
  | "rejected"
  | "changes_requested"
  | "pending_msp_release"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed";

export type SocialPostSource = "manual" | "csv" | "cap" | "api";

export type PostMaster = {
  id: string;
  company_id: string;
  state: SocialPostState;
  source_type: SocialPostSource;
  master_text: string | null;
  link_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  state_changed_at: string;
};

export type PostMasterListItem = {
  id: string;
  state: SocialPostState;
  source_type: SocialPostSource;
  master_text: string | null;
  link_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  state_changed_at: string;
};

export type CreatePostMasterInput = {
  companyId: string;
  // V1 keeps the master copy as plain text (no rich text, no per-platform
  // variants yet). Variants get added in a later slice; this slice ships
  // the editorial L1 foundation.
  masterText?: string | null;
  linkUrl?: string | null;
  sourceType?: SocialPostSource;
  createdBy: string | null;
};

export type ListPostMastersInput = {
  companyId: string;
  // Optional state filter — useful for the "drafts" / "scheduled" /
  // "published" tabs the calendar UI will need.
  states?: SocialPostState[];
  // Soft pagination knobs for V1; fancier cursor pagination lands when
  // any single tab gets >200 rows in practice.
  limit?: number;
  offset?: number;
  // Free-text search against master_text (ILIKE). Blank / undefined = no filter.
  q?: string;
  // When true, runs count: "exact" alongside the data query so the caller
  // can render "X–Y of N" pagination. Opt-in so callers that don't need it
  // don't pay for the count round-trip.
  withCount?: boolean;
};
