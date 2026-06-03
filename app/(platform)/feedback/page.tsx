import { redirect } from "next/navigation";
import Link from "next/link";

import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { listTickets } from "@/lib/feedback/tickets/queries";
import type { TicketSeverity, TicketStatus } from "@/lib/feedback/types";

// ---------------------------------------------------------------------------
// Customer feedback list — /feedback
//
// Company-scoped: members see ONLY their own company's tickets (RLS enforced
// at the DB level + explicit companyId filter here).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const STATUS_LABELS: Record<TicketStatus, string> = {
  backlog: "Backlog",
  triaged: "Triaged",
  in_progress: "In Progress",
  fixed: "Fixed",
  verified: "Verified",
  wont_fix: "Won't Fix",
  closed: "Closed",
};

const STATUS_COLOURS: Record<TicketStatus, string> = {
  backlog: "bg-gray-100 text-gray-600",
  triaged: "bg-blue-100 text-blue-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  fixed: "bg-emerald-100 text-emerald-700",
  verified: "bg-green-100 text-green-700",
  wont_fix: "bg-gray-100 text-gray-400",
  closed: "bg-gray-50 text-gray-400",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export default async function FeedbackPage() {
  const session = await getCurrentPlatformSession();
  if (!session) redirect("/login?next=/feedback");
  if (!session.company) redirect("/");

  const companyId = session.company.companyId;
  const tickets = await listTickets({ companyId });

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Bug Reports</h1>
        <p className="text-sm text-gray-500">
          {tickets.length} ticket{tickets.length !== 1 ? "s" : ""} from your company
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {tickets.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">
            No bug reports yet. Use the bug reporter tab to report an issue.
          </div>
        )}
        {tickets.map((t) => (
          <Link
            key={t.id}
            href={`/feedback/${t.id}`}
            className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 transition-colors hover:bg-emerald-50/30"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-gray-900">{t.title}</p>
              <p className="text-xs text-gray-400">
                {formatDate(t.created_at)} · {t.route_pattern ?? t.page_url}
              </p>
            </div>
            <div className="ml-4 flex flex-shrink-0 items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOURS[t.status as TicketStatus] ?? ""}`}>
                {STATUS_LABELS[t.status as TicketStatus] ?? t.status}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
