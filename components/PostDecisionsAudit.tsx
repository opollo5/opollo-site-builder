// ---------------------------------------------------------------------------
// S1-8 — sender-side audit trail of decisions for a finalised post.
//
// Renders chronologically: who responded, what they decided, any
// comment, when. Server-component-friendly (no "use client") because
// the data is loaded once on the detail page.
// ---------------------------------------------------------------------------

import type {
  ApprovalEvent,
  ApprovalEventType,
} from "@/lib/platform/social/approvals";

type Props = {
  events: ApprovalEvent[];
};

const DECISION_LABEL: Partial<Record<ApprovalEventType, string>> = {
  approved: "Approved",
  rejected: "Rejected",
  changes_requested: "Requested changes",
  viewed: "Viewed",
  identity_bound: "Bound identity",
  comment_added: "Added a comment",
  submitted: "Submitted",
  expired: "Expired",
  revoked: "Revoked",
};

const DECISION_PILL: Partial<Record<ApprovalEventType, string>> = {
  approved: "bg-emerald-100 text-emerald-900",
  rejected: "bg-rose-100 text-rose-900",
  changes_requested: "bg-amber-100 text-amber-900",
  viewed: "bg-muted text-muted-foreground",
  identity_bound: "bg-muted text-muted-foreground",
  comment_added: "bg-muted text-muted-foreground",
  submitted: "bg-sky-100 text-sky-900",
  expired: "bg-muted text-muted-foreground",
  revoked: "bg-muted text-muted-foreground",
};

export function PostDecisionsAudit({ events }: Props) {
  // Decision events are the meaningful user-facing rows; viewed /
  // identity_bound are operational. V1 only inserts the decision
  // events, so this filter is currently a no-op for normal flows
  // but future-proofs the component for richer event types.
  const decisionEvents = events.filter((e) =>
    ["approved", "rejected", "changes_requested"].includes(e.event_type),
  );
  const otherEvents = events.filter(
    (e) => !["approved", "rejected", "changes_requested"].includes(e.event_type),
  );

  if (events.length === 0) return null;

  return (
    <section
      className="mt-8"
      data-testid="post-decisions-audit"
      aria-label="Reviewer responses"
    >
      <h2 className="text-lg font-semibold">Reviewer responses</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Decisions and comments from each reviewer, oldest first.
      </p>

      <ol className="mt-4 divide-y rounded-lg border bg-card">
        {decisionEvents.map((e) => (
          <li
            key={e.id}
            className="p-4"
            data-testid={`decision-event-${e.id}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span
                  className={`rounded-full px-2 py-0.5 text-sm font-medium ${
                    DECISION_PILL[e.event_type] ?? ""
                  }`}
                >
                  {DECISION_LABEL[e.event_type] ?? e.event_type}
                </span>
                <span className="ml-2 text-sm">
                  {e.bound_identity_name?.trim()
                    ? `${e.bound_identity_name} <${e.bound_identity_email ?? "?"}>`
                    : (e.bound_identity_email ?? "Unknown reviewer")}
                </span>
              </div>
              <time className="text-sm text-muted-foreground tabular-nums">
                {formatTime(e.occurred_at)}
              </time>
            </div>
            {e.comment_text ? (
              <p className="mt-3 whitespace-pre-wrap text-sm">
                {e.comment_text}
              </p>
            ) : null}
          </li>
        ))}
      </ol>

      {otherEvents.length > 0 ? (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            View {otherEvents.length} other event
            {otherEvents.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 space-y-1">
            {otherEvents.map((e) => (
              <li
                key={e.id}
                className="text-sm text-muted-foreground"
                data-testid={`audit-event-${e.id}`}
              >
                <time className="tabular-nums">{formatTime(e.occurred_at)}</time>
                {" — "}
                {DECISION_LABEL[e.event_type] ?? e.event_type}
                {e.bound_identity_email
                  ? ` by ${e.bound_identity_email}`
                  : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
