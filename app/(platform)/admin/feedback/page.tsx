import { redirect } from "next/navigation";
import Link from "next/link";

import { checkAdminAccess } from "@/lib/admin-gate";
import { isOpolloStaff } from "@/lib/platform/auth";
import { createRouteAuthClient } from "@/lib/auth";
import { listTickets } from "@/lib/feedback/tickets/queries";
import { resolveSignedUrl } from "@/lib/feedback/capture/screenshot";
import type { TicketPriority, TicketSeverity, TicketStatus } from "@/lib/feedback/types";

// ---------------------------------------------------------------------------
// Admin feedback board — /admin/feedback
// data-testid: admin-feedback-board
//
// §6 BUG fix: removed raw company_id (sentinel 00000000-…) from row subtitle.
// §6 POLISH: screenshot thumbnails, route path column.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const PRIORITY_ORDER: Record<TicketPriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const SEVERITY_COLOURS: Record<TicketSeverity, string> = {
  blocker: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  normal: "bg-gray-100 text-gray-600",
  low: "bg-gray-50 text-gray-400",
};

const STATUS_COLOURS: Record<TicketStatus, string> = {
  backlog: "bg-gray-100 text-gray-600",
  triaged: "bg-blue-100 text-blue-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  fixed: "bg-[--color-success-bg] text-[--color-success-fg]",
  verified: "bg-green-100 text-green-700",
  wont_fix: "bg-gray-100 text-gray-400",
  closed: "bg-gray-50 text-gray-400",
};

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

export default async function AdminFeedbackPage() {
  const access = await checkAdminAccess();
  if (access.kind === "redirect") redirect(access.to);

  const supabase = createRouteAuthClient();
  const isStaff = await isOpolloStaff(supabase);
  if (!isStaff) redirect("/admin");

  const tickets = await listTickets({});
  const sorted = [...tickets].sort(
    (a, b) =>
      (PRIORITY_ORDER[b.priority as TicketPriority] ?? 0) -
      (PRIORITY_ORDER[a.priority as TicketPriority] ?? 0),
  );

  // §6 — Resolve screenshot signed URLs for thumbnails (server-side, parallel).
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
          <p className="text-sm text-gray-500">{tickets.length} open tickets</p>
        </div>
      </div>

      {/* How fixes happen explainer */}
      <div className="mb-6 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500">
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

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-100 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-3 w-10" aria-label="Screenshot" />
              <th className="px-4 py-3">Title</th>
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
                  No open tickets — nice work.
                </td>
              </tr>
            )}
            {sorted.map((t, idx) => {
              const thumbUrl = screenshotUrls[idx];
              const { display: routeDisplay_, full: routeFull } = routeDisplay(t.route_pattern, t.page_url);
              return (
                <tr
                  key={t.id}
                  className="group cursor-pointer transition-colors hover:bg-gray-50"
                >
                  {/* §6 — thumbnail */}
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
                      {t.title}
                    </Link>
                    {/* §6 fix: show short id + date, NOT raw company_id UUID */}
                    <p className="text-xs text-gray-400">
                      #{t.id.slice(0, 8)} · {new Date(t.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                    </p>
                  </td>

                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_COLOURS[t.severity as TicketSeverity] ?? ""}`}
                    >
                      {t.severity}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                      {t.priority}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOURS[t.status as TicketStatus] ?? ""}`}
                    >
                      {t.status.replace(/_/g, " ")}
                    </span>
                  </td>

                  {/* §6 — show path only; title tooltip shows full URL */}
                  <td className="max-w-[180px] px-4 py-3">
                    <span
                      className="block truncate font-mono text-xs text-gray-500"
                      title={routeFull}
                    >
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
