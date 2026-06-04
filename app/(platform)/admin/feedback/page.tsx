import { redirect } from "next/navigation";
import Link from "next/link";

import { checkAdminAccess } from "@/lib/admin-gate";
import { isOpolloStaff } from "@/lib/platform/auth";
import { createRouteAuthClient } from "@/lib/auth";
import { listTickets, type TicketFilterGroup } from "@/lib/feedback/tickets/queries";
import { resolveSignedUrl } from "@/lib/feedback/capture/screenshot";
import type { TicketPriority, TicketSeverity, TicketStatus } from "@/lib/feedback/types";

// ---------------------------------------------------------------------------
// Admin feedback board — /admin/feedback
// data-testid: admin-feedback-board
//
// Backlog item 1: status filter via ?filter= search param.
//   All / Open (default) / Closed / Won't-fix / Deleted
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const PRIORITY_ORDER: Record<TicketPriority, number> = {
  urgent: 4, high: 3, medium: 2, low: 1,
};

const SEVERITY_COLOURS: Record<TicketSeverity, string> = {
  blocker: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  normal: "bg-gray-100 text-gray-600",
  low: "bg-gray-50 text-gray-400",
};

const STATUS_COLOURS: Record<TicketStatus | "deleted", string> = {
  backlog: "bg-gray-100 text-gray-600",
  triaged: "bg-blue-100 text-blue-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  fixed: "bg-[--color-success-bg] text-[--color-success-fg]",
  verified: "bg-green-100 text-green-700",
  wont_fix: "bg-gray-100 text-gray-400",
  closed: "bg-gray-50 text-gray-400",
  deleted: "bg-red-50 text-red-400",
};

const FILTER_TABS: Array<{ key: TicketFilterGroup; label: string }> = [
  { key: "open",     label: "Open" },
  { key: "all",      label: "All" },
  { key: "closed",   label: "Closed" },
  { key: "wont_fix", label: "Won't fix" },
  { key: "deleted",  label: "Deleted" },
];

function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = ms / 3600000;
  if (h < 24) return `${Math.floor(h)}h`;
  return `${Math.floor(h / 24)}d`;
}

function routeDisplay(routePattern: string | null, pageUrl: string): { display: string; full: string } {
  const full = routePattern ?? pageUrl;
  try {
    const u = new URL(pageUrl);
    return { display: u.pathname || full, full };
  } catch {
    return { display: full, full };
  }
}

function isValidFilterGroup(v: string | undefined): v is TicketFilterGroup {
  return ["open", "all", "closed", "wont_fix", "deleted"].includes(v ?? "");
}

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await checkAdminAccess();
  if (access.kind === "redirect") redirect(access.to);

  const supabase = createRouteAuthClient();
  const isStaff = await isOpolloStaff(supabase);
  if (!isStaff) redirect("/admin");

  const params = await searchParams;
  const rawFilter = params.filter;
  const filterGroup: TicketFilterGroup = isValidFilterGroup(rawFilter) ? rawFilter : "open";

  const tickets = await listTickets({ filterGroup });
  const sorted = [...tickets].sort(
    (a, b) =>
      (PRIORITY_ORDER[b.priority as TicketPriority] ?? 0) -
      (PRIORITY_ORDER[a.priority as TicketPriority] ?? 0),
  );

  const screenshotUrls = await Promise.all(
    sorted.map((t) =>
      t.screenshot_path
        ? resolveSignedUrl(t.screenshot_path).catch(() => null)
        : Promise.resolve(null),
    ),
  );

  return (
    <div data-testid="admin-feedback-board" className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Feedback</h1>
          <p className="text-sm text-gray-500">{tickets.length} ticket{tickets.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {/* How fixes happen explainer */}
      <div className="mb-4 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500">
        <p className="font-medium text-gray-600">How fixes happen</p>
        <p className="mt-1 leading-relaxed">
          Open tickets are pulled into the repo with{" "}
          <code className="rounded bg-gray-200 px-1">npm run bugs:pull</code>, which writes
          each to <code className="rounded bg-gray-200 px-1">docs/bugs/</code>. In a Claude
          Code session, point it at that folder and ask it to work the queue — it investigates,
          prepares a fix, opens a pull request, and marks the ticket &ldquo;fixed.&rdquo;{" "}
          A human reviews and merges the PR; verifying and closing the ticket stay with you.
        </p>
      </div>

      {/* Filter strip */}
      <div
        data-testid="feedback-filter-strip"
        className="mb-4 flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1"
        role="tablist"
        aria-label="Ticket filter"
      >
        {FILTER_TABS.map(({ key, label }) => {
          const active = filterGroup === key;
          return (
            <Link
              key={key}
              href={`/admin/feedback?filter=${key}`}
              role="tab"
              aria-selected={active}
              data-testid={`filter-tab-${key}`}
              className={`flex-1 rounded-md px-3 py-1.5 text-center text-xs font-medium transition-colors ${
                active
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-100 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-3 w-10" aria-label="Screenshot" />
              <th className="px-4 py-3">Ticket</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Route</th>
              <th className="px-4 py-3">Age</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  No tickets in this view.
                </td>
              </tr>
            )}
            {sorted.map((t, idx) => {
              const thumbUrl = screenshotUrls[idx];
              const isDeleted = !!(t as Record<string, unknown>).deleted_at;
              const effectiveStatus = isDeleted ? "deleted" : t.status;
              const { display: routeDisplay_, full: routeFull } = routeDisplay(t.route_pattern, t.page_url);
              return (
                <tr
                  key={t.id}
                  className={`group cursor-pointer transition-colors hover:bg-gray-50 ${isDeleted ? "opacity-60" : ""}`}
                >
                  <td className="px-3 py-2">
                    {thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbUrl}
                        alt=""
                        loading="lazy"
                        className="h-8 w-12 rounded object-cover object-top opacity-90"
                      />
                    ) : (
                      <div className="h-8 w-12 rounded bg-gray-100" />
                    )}
                  </td>

                  <td className="max-w-xs px-4 py-3">
                    <Link
                      href={`/admin/feedback/${t.id}`}
                      className="block font-medium text-gray-900 group-hover:text-emerald-700"
                    >
                      {(t as Record<string, unknown>).ticket_number
                        ? `#${(t as Record<string, unknown>).ticket_number}`
                        : `#${t.id.slice(0, 8)}`}
                      {" "}
                      <span className="font-normal text-gray-600">
                        {t.description.split("\n")[0].slice(0, 60)}
                      </span>
                    </Link>
                    <p className="text-xs text-gray-400">
                      {new Date(t.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                    </p>
                  </td>

                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_COLOURS[t.severity as TicketSeverity] ?? ""}`}>
                      {t.severity}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                      {t.priority}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOURS[effectiveStatus as keyof typeof STATUS_COLOURS] ?? ""}`}>
                      {isDeleted ? "deleted" : t.status.replace(/_/g, " ")}
                    </span>
                  </td>

                  <td className="max-w-[180px] px-4 py-3">
                    <span className="block truncate font-mono text-xs text-gray-500" title={routeFull}>
                      {routeDisplay_}
                    </span>
                  </td>

                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">
                    {age(t.created_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
