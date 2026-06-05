import { redirect, notFound } from "next/navigation";

import { checkAdminAccess } from "@/lib/admin-gate";
import { isOpolloStaff } from "@/lib/platform/auth";
import { createRouteAuthClient } from "@/lib/auth";
import {
  getTicket,
  listComments,
  listEvents,
  listOpolloStaff,
  resolveActorNames,
  resolveCompanyNames,
} from "@/lib/feedback/tickets/queries";
import { resolveSignedUrl } from "@/lib/feedback/capture/screenshot";
import { BugReplayOverlay } from "@/components/feedback/BugReplayOverlay";
import { TicketThread } from "@/components/feedback/TicketThread";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { TicketTriagePanel } from "@/components/feedback/TicketTriagePanel";
import type {
  DebugSnapshot,
  FeedbackTicketEvent,
  TicketPriority,
  TicketStatus,
} from "@/lib/feedback/types";

// ---------------------------------------------------------------------------
// Admin ticket detail — /admin/feedback/[id]
//
// §6 BUG fix: removed raw company_id from subtitle (was showing sentinel UUID).
// §4: shows both "what happened" and "expected behavior" fields.
// §7: full triage panel (status/assignee/priority/delete).
// data-testid: bug-replay-marker, ticket-thread, ticket-reply, ticket-event-timeline
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function eventLabel(
  e: FeedbackTicketEvent,
  actorNames: Map<string, string>,
): string {
  const actor = e.actor_id
    ? (actorNames.get(e.actor_id) ?? "Opollo staff")
    : "system";

  switch (e.event_type) {
    case "created": return "Reported";
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
  fixed: "bg-[--color-success-bg] text-[--color-success-fg]",
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

  const [ticket, comments, events, staffList] = await Promise.all([
    getTicket(id),
    listComments(id),
    listEvents(id),
    listOpolloStaff(),
  ]);

  if (!ticket) notFound();

  const actorIds = events.map((e) => e.actor_id);
  const [actorNames, companyNamesMap] = await Promise.all([
    resolveActorNames(actorIds),
    resolveCompanyNames([ticket.company_id]),
  ]);
  const companyName = companyNamesMap.get(ticket.company_id) ?? null;

  const screenshotUrl = ticket.screenshot_path
    ? await resolveSignedUrl(ticket.screenshot_path)
    : null;

  return (
    <div className="mx-auto max-w-5xl p-6">
      {/* Breadcrumb */}
      <div className="mb-4">
        <Breadcrumbs
          crumbs={[
            { label: "Admin", href: "/admin" },
            { label: "Feedback", href: "/admin/feedback" },
            { label: ticket.ticket_number ? `#${ticket.ticket_number}` : `#${id.slice(0, 8)}` },
          ]}
        />
      </div>

      {/* Header — §6 fix: no raw company_id UUID in subtitle */}
      <div className="mb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {/* §3: primary identifier is the ticket number */}
            <h1 className="text-xl font-semibold text-gray-900">
              {ticket.ticket_number ? `#${ticket.ticket_number}` : `#${id.slice(0, 8)}`}
              {" "}
              <span className="font-normal text-gray-600">
                {ticket.description.split("\n")[0].slice(0, 80)}
              </span>
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              {companyName && (
                <span className="font-medium text-gray-700 mr-1">{companyName} ·</span>
              )}
              {formatDate(ticket.created_at)}
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

        {/* §4 — What happened */}
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-gray-500">What happened</p>
          <p className="whitespace-pre-wrap text-sm text-gray-700">{ticket.description}</p>
        </div>

        {/* §4 — Expected behavior */}
        {ticket.expected_behavior && (
          <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
            <p className="mb-1 text-xs font-medium text-gray-500">Expected</p>
            <p className="whitespace-pre-wrap text-sm text-gray-700">{ticket.expected_behavior}</p>
          </div>
        )}
      </div>

      {/* §7 — Full triage panel: status / priority / assignee / delete */}
      <div className="mb-6">
        <TicketTriagePanel
          ticketId={id}
          currentStatus={ticket.status as TicketStatus}
          currentAssigneeId={ticket.assignee_id}
          currentPriority={ticket.priority as TicketPriority}
          staffList={staffList}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: screenshot replay */}
        <div className="flex flex-col gap-4">
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

          {/* Debug snapshot panel */}
          {ticket.debug_snapshot && (
            <DebugSnapshotPanel snapshot={ticket.debug_snapshot as DebugSnapshot} />
          )}

          {/* Fix attempt panel */}
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
              <p className="text-xs italic text-gray-400">No fix attempt yet.</p>
            )}
          </div>
        </div>

        {/* Right: thread + event timeline */}
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Thread</h2>
            <TicketThread ticketId={id} comments={comments} />
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Event Timeline</h2>
            <ol data-testid="ticket-event-timeline" className="border-l-2 border-gray-200 pl-4">
              {events.map((e) => (
                <li key={e.id} className="mb-3 last:mb-0">
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

// ---------------------------------------------------------------------------
// DebugSnapshotPanel — collapsible panel shown on admin ticket detail.
// Renders the debug_snapshot JSONB column captured at submit time.
// ---------------------------------------------------------------------------

function DebugSnapshotPanel({ snapshot }: { snapshot: DebugSnapshot }) {
  const events = snapshot.apiEvents ?? [];
  return (
    <details className="rounded-lg border border-blue-100 bg-blue-50">
      <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-blue-700">
        Debug snapshot
      </summary>
      <div className="divide-y divide-blue-100 px-4 pb-3 text-xs text-gray-600">
        <div className="py-2 flex gap-2 flex-wrap">
          <span className="font-medium text-gray-700">Build:</span>
          <code className="font-mono">{snapshot.buildSha?.slice(0, 10) ?? "—"}</code>
          <span className="font-medium text-gray-700">Env:</span>
          <span>{snapshot.vercelEnv ?? "—"}</span>
          <span className="font-medium text-gray-700">Route:</span>
          <code className="font-mono">{snapshot.route}</code>
        </div>
        {snapshot.userEmail && (
          <div className="py-2">
            <span className="font-medium">User:</span> {snapshot.userEmail}
          </div>
        )}
        <div className="py-2">
          <span className="font-medium">Viewport:</span>{" "}
          {snapshot.viewport.w}×{snapshot.viewport.h} @{snapshot.viewport.dpr}x
        </div>
        {snapshot.userAgent && (
          <div className="py-2 break-all">
            <span className="font-medium">UA:</span> {snapshot.userAgent}
          </div>
        )}
        {events.length > 0 && (
          <div className="py-2">
            <p className="font-medium text-gray-700 mb-1">
              Recent API events ({events.length})
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full font-mono text-xs">
                <thead>
                  <tr className="text-gray-400">
                    <th className="pr-2 text-left font-normal">method</th>
                    <th className="pr-2 text-left font-normal">status</th>
                    <th className="pr-2 text-left font-normal">ms</th>
                    <th className="pr-2 text-left font-normal">path</th>
                  </tr>
                </thead>
                <tbody>
                  {events.slice(-20).map((e, i) => (
                    <tr
                      key={i}
                      className={
                        e.status === 0 || e.status >= 400
                          ? "text-red-600"
                          : "text-gray-700"
                      }
                    >
                      <td className="pr-2">{e.method}</td>
                      <td className="pr-2">{e.status || "err"}</td>
                      <td className="pr-2">{e.durationMs}</td>
                      <td className="break-all">{e.path}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
