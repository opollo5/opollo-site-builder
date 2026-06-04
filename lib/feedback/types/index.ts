// lib/feedback/types/index.ts — shared types for the feedback module.
// These mirror the feedback_tickets / feedback_ticket_comments /
// feedback_ticket_events DB schema. Keep aligned with the migration.

export type TicketStatus =
  | "backlog"
  | "triaged"
  | "in_progress"
  | "fixed"
  | "verified"
  | "wont_fix"
  | "closed";

export type TicketSeverity = "low" | "normal" | "high" | "blocker";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type EventActorKind = "human-staff" | "automation" | "customer-reporter" | "system";
export type EventType =
  | "created"
  | "assigned"
  | "reassigned"
  | "status_changed"
  | "severity_changed"
  | "priority_changed"
  | "reopened_by_customer"
  | "verified"
  | "closed";

// ---------------------------------------------------------------------------
// CallerContext — the three contexts that may drive status transitions.
// Enforced in update-status.ts; must be set at the call site, never inferred.
// ---------------------------------------------------------------------------
export type CallerContext =
  | { kind: "human-staff"; userId: string }
  | { kind: "automation" }
  | { kind: "customer-reporter"; userId: string };

// ---------------------------------------------------------------------------
// DB row shapes (snake_case matching DB columns).
// ---------------------------------------------------------------------------
export type FeedbackTicket = {
  id: string;
  company_id: string;
  title: string;
  description: string;
  severity: TicketSeverity;
  priority: TicketPriority;
  status: TicketStatus;
  assignee_id: string | null;
  triaged_by: string | null;
  triaged_at: string | null;
  verified_by: string | null;
  verified_at: string | null;
  tags: string[];
  page_url: string;
  route_pattern: string | null;
  css_selector: string;
  element_label: string | null;
  click_x_pct: number;
  click_y_pct: number;
  viewport_w: number;
  viewport_h: number;
  device_pixel_ratio: number | null;
  user_agent: string | null;
  console_errors: unknown | null;
  screenshot_path: string | null;
  annotation: unknown | null;
  repo_ref: string | null;
  linked_pr_url: string | null;
  resolution_notes: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type FeedbackTicketComment = {
  id: string;
  ticket_id: string;
  body: string;
  author_id: string;
  is_staff: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type FeedbackTicketEvent = {
  id: string;
  ticket_id: string;
  event_type: EventType;
  from_value: string | null;
  to_value: string | null;
  actor_id: string | null;
  actor_kind: EventActorKind;
  created_at: string;
};

// ---------------------------------------------------------------------------
// API-layer shapes (camelCase for the wire format)
// ---------------------------------------------------------------------------
export type CreateTicketInput = {
  companyId: string;
  title: string;
  description: string;
  severity: TicketSeverity;
  tags: string[];
  assigneeId?: string | null;
  pageUrl: string;
  routePattern?: string | null;
  cssSelector: string;
  elementLabel?: string | null;
  clickXPct: number;
  clickYPct: number;
  viewportW: number;
  viewportH: number;
  devicePixelRatio?: number | null;
  userAgent?: string | null;
  consoleErrors?: unknown[] | null;
  screenshotObjectPath?: string | null;
};

export type UpdateTicketInput = {
  ticketId: string;
  status?: TicketStatus;
  assigneeId?: string | null;
  severity?: TicketSeverity;
  priority?: TicketPriority;
  tags?: string[];
};
