import { redirect } from "next/navigation";

import { SocialCalendarClient } from "@/components/SocialCalendarClient";
import { H1 } from "@/components/ui/typography";
import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { listCompanyScheduleEntries } from "@/lib/platform/social/scheduling";

// ---------------------------------------------------------------------------
// /company/social/calendar — monthly grid view.
//
// Accepts ?month=YYYY-MM (defaults to current month). Fetches schedule
// entries for the full 6-row grid (Mon before the 1st through Sun after
// the last day) so the client can render a standard month grid without
// a second request. The client component handles month navigation and
// platform filtering.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ month?: string }>;
};

function parseMonthParam(raw: string | undefined): { year: number; month: number } {
  const today = new Date();
  if (!raw) return { year: today.getFullYear(), month: today.getMonth() + 1 };
  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  if (!match) return { year: today.getFullYear(), month: today.getMonth() + 1 };
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  if (month < 1 || month > 12) return { year: today.getFullYear(), month: today.getMonth() + 1 };
  return { year, month };
}

export default async function CompanySocialCalendarPage({ searchParams }: Props) {
  const { month: monthParam } = await searchParams;

  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/company/social/calendar")}`);
  }
  if (!session.company) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        <p className="font-medium">No company context.</p>
      </div>
    );
  }

  const { year, month } = parseMonthParam(monthParam);
  const monthIso = `${year}-${String(month).padStart(2, "0")}`;

  // Grid bounds: Monday on/before the 1st → 42 days later (6 rows × 7 cols).
  const firstOfMonth = new Date(year, month - 1, 1);
  const startDow = (firstOfMonth.getDay() + 6) % 7; // Mon=0 … Sun=6
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - startDow);
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridStart.getDate() + 42);

  const result = await listCompanyScheduleEntries({
    companyId: session.company.companyId,
    fromIso: gridStart.toISOString(),
    toIso: gridEnd.toISOString(),
  });

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <H1>Calendar</H1>
      </header>
      {result.ok ? (
        <SocialCalendarClient
          entries={result.data.entries.map((e) => ({
            id: e.id,
            post_master_id: e.post_master_id,
            platform: e.platform,
            scheduled_at: e.scheduled_at,
            preview: e.preview,
          }))}
          monthIso={monthIso}
        />
      ) : (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          role="alert"
        >
          Failed to load calendar: {result.error.message}
        </div>
      )}
    </main>
  );
}
