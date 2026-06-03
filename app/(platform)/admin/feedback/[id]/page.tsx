import { redirect, notFound } from "next/navigation";

import { checkAdminAccess } from "@/lib/admin-gate";
import { isOpolloStaff } from "@/lib/platform/auth";
import { createRouteAuthClient } from "@/lib/auth";
import { getTicket, listComments, listEvents } from "@/lib/feedback/tickets/queries";
import { resolveSignedUrl } from "@/lib/feedback/capture/screenshot";
import { BugReplayOverlay } from "@/components/feedback/BugReplayOverlay";
import { TicketThread } from "@/components/feedback/TicketThread";
import type {
  FeedbackTicketEvent,
  TicketPriority,
  TicketSeverity,
  TicketStatus,
} from "@/lib/feedback/types";

// ---------------------------------------------------------------------------
// Admin ticket detail — /admin/feedback/[id]
//
// data-testid: bug-replay-marker (on BugReplayOverlay), ticket-thread,
//              ticket-reply, ticket-event-timeline
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function eventLabel(e: FeedbackTicketEvent): string {
  switch (e.event_type) {
    case "created": return `Reported (${e.to_value ?? "backlog"})`;
    case "assigned": return `Assigned to ${e.to_value ?? "unknown"}`;
    case "reassigned": return `Reassigned from ${e.from_value ?? "?"} → ${e.to_value ?? "?"}`;
    case "status_changed": return `Status: ${e.from_value} → ${e.to_value}`;
    case "severity_changed": return `Severity: ${e.from_value} → ${e.to_value}`;
    case "priority_changed": return `Priority: ${e.from_value} → ${e.to_value}`;
    case "reopened_by_customer": return "Reopened by customer (Still broken)";
    case "verified": return "Verified";
    case "closed": return "Closed";
    default: return e.event_type;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default async function AdminTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const access = await checkAdminAccess();
  if (access.kind === "redirect") redirect(access.to);

  const supabase = createRouteAuthClient();
  const isStaff = await isOpolloStaff(supabase);
  if (!isStaff) redirect("/admin");

  const [ticket, comments, events] = await Promise.all([
    getTicket(id),
    listComments(id),
    listEvents(id),
  ]);

  if (!ticket) notFound();

  const screenshotUrl = ticket.screenshot_path
    ? await resolveSignedUrl(ticket.screenshot_path)
    : null;

  return (
    <div className="mx-auto max-w-5xl p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{ticket.title}</h1>
            <p className="mt-1 text-sm text-gray-500">
              #{id.slice(0, 8)} · {ticket.company_id} · {formatDate(ticket.created_at)}
            </p>
          </div>
          <span className="rounded-full bg-purple-100 px-3 py-1 text-sm font-medium text-purple-700">
            {ticket.priority}
          </span>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">{ticket.description}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: screenshot replay */}
        <div className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-gray-700">Bug Replay</h2>
          <BugReplayOverlay
            screenshotUrl={screenshotUrl}
            clickXPct={ticket.click_x_pct}
            clickYPct={ticket.click_y_pct}
            cssSelector={ticket.css_selector}
            elementLabel={ticket.element_label}
          />

          {/* Forensic panel */}
          <details className="rounded-lg border border-gray-200 bg-gray-50">
            <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-gray-600">
              Forensics
            </summary>
            <div className="divide-y divide-gray-100 px-4 pb-3 text-xs text-gray-600">
              <div className="py-2"><span className="font-medium">Route:</span> {ticket.route_pattern ?? ticket.page_url}</div>
              <div className="py-2"><span className="font-medium">Selector:</span> <code className="font-mono">{ticket.css_selector}</code></div>
              <div className="py-2"><span className="font-medium">Viewport:</span> {ticket.viewport_w}×{ticket.viewport_h} @{ticket.device_pixel_ratio ?? 1}x</div>
              {ticket.user_agent && (
                <div className="py-2 break-all"><span className="font-medium">UA:</span> {ticket.user_agent}</div>
              )}
              {ticket.console_errors != null && (
                <div className="py-2">
                  <span className="font-medium">Console errors:</span>
                  <pre className="mt-1 overflow-x-auto rounded bg-gray-100 p-2 text-[10px]">
                    {JSON.stringify(ticket.console_errors, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </details>
        </div>

        {/* Right: thread + event timeline */}
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Thread</h2>
            <TicketThread ticketId={id} comments={comments} />
          </div>

          {/* Event timeline */}
          <div>
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Event Timeline</h2>
            <ol data-testid="ticket-event-timeline" className="border-l-2 border-gray-200 pl-4">
              {events.map((e) => (
                <li key={e.id} className="mb-3 last:mb-0">
                  <div className="text-xs font-medium text-gray-800">{eventLabel(e)}</div>
                  <div className="text-[10px] text-gray-400">
                    {e.actor_kind} · {formatDate(e.created_at)}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
