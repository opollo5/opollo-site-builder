import { redirect, notFound } from "next/navigation";
import Link from "next/link";

import { checkAdminAccess } from "@/lib/admin-gate";
import { isOpolloStaff } from "@/lib/platform/auth";
import { createRouteAuthClient } from "@/lib/auth";
import {
  getTicket,
  listComments,
  listEvents,
  resolveActorNames,
} from "@/lib/feedback/tickets/queries";
import { resolveSignedUrl } from "@/lib/feedback/capture/screenshot";
import { BugReplayOverlay } from "@/components/feedback/BugReplayOverlay";
import { TicketThread } from "@/components/feedback/TicketThread";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { TicketTriageActions } from "@/components/feedback/TicketTriageActions";
import type {
  FeedbackTicketEvent,
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

function eventLabel(
  e: FeedbackTicketEvent,
  actorNames: Map<string, string>,
): string {
  // §2: resolve actor_id to a display name; fall back to "Opollo staff" for
  // null actor (automation/system events) or unknown ids.
  const actor = e.actor_id
    ? (actorNames.get(e.actor_id) ?? "Opollo staff")
    : "system";

  switch (e.event_type) {
    case "created": return `Reported`;
    case "assigned": return `Assigned by ${actor}`;
    case "reassigned": return `Reassigned by ${actor}`;
    case "status_changed": return `Status: ${e.from_value} → ${e.to_value} by ${actor}`;
    case "severity_changed": return `Severity: ${e.from_value} → ${e.to_value} by ${actor}`;
    case "priority_changed": return `Priority: ${e.from_value} → ${e.to_value} by ${actor}`;
    case "reopened_by_customer": return "Reopened by reporter (Still broken)";
    case "verified": return `Verified by ${actor}`;
    case "closed": return `Closed by ${actor}`;
    default: return e.event_type;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_COLOURS: Record<TicketStatus, string> = {
  backlog: "bg-gray-100 text-gray-600",
  triaged: "bg-blue-100 text-blue-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  fixed: "bg-emerald-100 text-emerald-700",
  verified: "bg-green-100 text-green-700",
  wont_fix: "bg-gray-100 text-gray-400",
  closed: "bg-gray-50 text-gray-400",
};

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

  // §2 — resolve all actor_ids in the event list to display names
  const actorIds = events.map((e) => e.actor_id);
  const actorNames = await resolveActorNames(actorIds);

  const screenshotUrl = ticket.screenshot_path
    ? await resolveSignedUrl(ticket.screenshot_path)
    : null;

  return (
    <div className="mx-auto max-w-5xl p-6">
      {/* §4 — Breadcrumb */}
      <div className="mb-4">
        <Breadcrumbs
          crumbs={[
            { label: "Admin", href: "/admin" },
            { label: "Feedback", href: "/admin/feedback" },
            { label: `#${id.slice(0, 8)}` },
          ]}
        />
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-gray-900">{ticket.title}</h1>
            <p className="mt-1 text-sm text-gray-500">
              #{id.slice(0, 8)} · {ticket.company_id} · {formatDate(ticket.created_at)}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOURS[ticket.status as TicketStatus] ?? ""}`}
            >
              {ticket.status.replace(/_/g, " ")}
            </span>
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
              {ticket.priority}
            </span>
          </div>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">{ticket.description}</p>
      </div>

      {/* §5 — Staff triage actions */}
      <TicketTriageActions
        ticketId={id}
        currentStatus={ticket.status as TicketStatus}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Left: screenshot replay */}
        <div className="flex flex-col gap-4">
          {/* §9 naming: "Bug Replay" → "Screenshot replay" */}
          <h2 className="text-sm font-semibold text-gray-700">Screenshot replay</h2>
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
                  <pre className="mt-1 overflow-x-auto rounded bg-gray-100 p-2 text-xs">
                    {JSON.stringify(ticket.console_errors, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </details>

          {/* §7 — Fix attempt panel */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h3 className="mb-2 text-xs font-semibold text-gray-700">Fix attempt</h3>
            {ticket.linked_pr_url || ticket.resolution_notes ? (
              <div className="flex flex-col gap-2 text-xs text-gray-600">
                {ticket.linked_pr_url && (
                  <div>
                    <span className="font-medium">PR: </span>
                    <a
                      href={ticket.linked_pr_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline break-all"
                    >
                      {ticket.linked_pr_url}
                    </a>
                  </div>
                )}
                {ticket.resolution_notes && (
                  <div>
                    <span className="font-medium">Notes: </span>
                    <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-gray-600">
                      {ticket.resolution_notes}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">No fix attempt yet.</p>
            )}
          </div>
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
                  {/* §2: shows resolved actor name, not actor_kind */}
                  <div className="text-xs font-medium text-gray-800">
                    {eventLabel(e, actorNames)}
                  </div>
                  <div className="text-xs text-gray-400">
                    {formatDate(e.created_at)}
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
