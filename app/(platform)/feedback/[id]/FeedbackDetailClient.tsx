"use client";

import { useCallback, useState } from "react";

import { BugReplayOverlay } from "@/components/feedback/BugReplayOverlay";
import { TicketThread } from "@/components/feedback/TicketThread";
import type {
  FeedbackTicket,
  FeedbackTicketComment,
  FeedbackTicketEvent,
  TicketStatus,
} from "@/lib/feedback/types";

// ---------------------------------------------------------------------------
// FeedbackDetailClient — interactive layer for the customer ticket detail page.
//
// data-testid: ticket-still-broken, ticket-event-timeline, ticket-thread,
//              ticket-reply (inside TicketThread), bug-replay-marker (inside BugReplayOverlay)
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<TicketStatus, string> = {
  backlog: "Backlog",
  triaged: "Triaged",
  in_progress: "In Progress",
  fixed: "Fixed",
  verified: "Verified",
  wont_fix: "Won't Fix",
  closed: "Closed",
};

function eventLabel(e: FeedbackTicketEvent): string {
  switch (e.event_type) {
    case "created": return "Reported";
    case "assigned": return "Assigned to support team";
    case "reassigned": return "Reassigned";
    case "status_changed": return `Status updated: ${e.from_value} → ${e.to_value}`;
    case "severity_changed": return `Severity updated: ${e.from_value} → ${e.to_value}`;
    case "priority_changed": return "Priority updated";
    case "reopened_by_customer": return "You reported this is still broken";
    case "verified": return "Marked as resolved by the team";
    case "closed": return "Ticket closed";
    default: return e.event_type;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

type Props = {
  ticket: FeedbackTicket;
  comments: FeedbackTicketComment[];
  events: FeedbackTicketEvent[];
  screenshotUrl: string | null;
};

export function FeedbackDetailClient({ ticket: initial, comments, events, screenshotUrl }: Props) {
  const [ticket, setTicket] = useState(initial);
  const [stillBrokenPending, setStillBrokenPending] = useState(false);
  const [stillBrokenError, setStillBrokenError] = useState<string | null>(null);

  const canReopen = ticket.status === "fixed" || ticket.status === "verified";

  const handleStillBroken = useCallback(async () => {
    setStillBrokenPending(true);
    setStillBrokenError(null);
    try {
      const resp = await fetch(`/api/feedback/tickets/${ticket.id}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: "This is still broken." }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setStillBrokenError(body?.error?.message ?? "Failed to reopen ticket.");
        return;
      }
      const { data } = await resp.json();
      setTicket(data.ticket);
    } finally {
      setStillBrokenPending(false);
    }
  }, [ticket.id]);

  return (
    <div className="mx-auto max-w-3xl p-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{ticket.title}</h1>
          <p className="mt-1 text-sm text-gray-400">
            Reported {formatDate(ticket.created_at)}
          </p>
        </div>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
          {STATUS_LABELS[ticket.status as TicketStatus] ?? ticket.status}
        </span>
      </div>

      <p className="mb-6 whitespace-pre-wrap text-sm text-gray-700">{ticket.description}</p>

      {/* Screenshot replay */}
      {screenshotUrl && (
        <div className="mb-6">
          <BugReplayOverlay
            screenshotUrl={screenshotUrl}
            clickXPct={ticket.click_x_pct}
            clickYPct={ticket.click_y_pct}
            cssSelector={ticket.css_selector}
            elementLabel={ticket.element_label}
          />
        </div>
      )}

      {/* Still broken — only for fixed/verified tickets */}
      {canReopen && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="mb-2 text-sm font-medium text-amber-800">
            This ticket is marked as fixed. Is it still broken for you?
          </p>
          <button
            data-testid="ticket-still-broken"
            onClick={handleStillBroken}
            disabled={stillBrokenPending}
            className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {stillBrokenPending ? "Sending…" : "Still broken"}
          </button>
          {stillBrokenError && (
            <p className="mt-2 text-xs text-red-600">{stillBrokenError}</p>
          )}
        </div>
      )}

      {/* Thread */}
      <div className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Messages</h2>
        <TicketThread ticketId={ticket.id} comments={comments} />
      </div>

      {/* Event timeline (read-only for customers) */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">History</h2>
        <ol data-testid="ticket-event-timeline" className="border-l-2 border-gray-200 pl-4">
          {events.map((e) => (
            <li key={e.id} className="mb-3 last:mb-0">
              <div className="text-xs font-medium text-gray-700">{eventLabel(e)}</div>
              <div className="text-[10px] text-gray-400">{formatDate(e.created_at)}</div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
