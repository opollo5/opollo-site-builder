// Mirrors social_viewer_links table in migration 0070.

export type ViewerLink = {
  id: string;
  company_id: string;
  recipient_email: string | null;
  recipient_name: string | null;
  expires_at: string;
  revoked_at: string | null;
  last_viewed_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type CreateViewerLinkInput = {
  companyId: string;
  // Optional — when set, surfaces in the admin list as "shared with X".
  // The token is the auth, not the email; multiple recipients can use the
  // same link if it's forwarded.
  recipientEmail?: string | null;
  recipientName?: string | null;
  // Default 90 days; caller can override (e.g. shorter for sensitive
  // sharing, or longer for ongoing client visibility).
  expiresAt?: string;
  createdBy: string | null;
};

export type CreateViewerLinkResult = {
  link: ViewerLink;
  // Raw token returned ONCE for the link URL. NEVER stored; only the
  // SHA-256 hash lands in token_hash. Caller surfaces the URL to the
  // admin who shares it externally.
  rawToken: string;
};

export type ListViewerLinksInput = {
  companyId: string;
  // V1 default: only active (not revoked, not expired). Admin UI can
  // toggle this to see history.
  includeInactive?: boolean;
};
