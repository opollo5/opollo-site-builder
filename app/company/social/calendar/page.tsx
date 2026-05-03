import { redirect } from "next/navigation";

import { SocialCalendarClient } from "@/components/SocialCalendarClient";
import { H1, Lead } from "@/components/ui/typography";
import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { listCompanyScheduleEntries } from "@/lib/platform/social/scheduling";

// ---------------------------------------------------------------------------
// S1-25/S1-32 — customer calendar view at /company/social/calendar.
//
// Server-rendered. Accepts ?from=YYYY-MM-DD to set the window start
// (defaults to today). Always shows a 30-day forward window.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

type Props = {
  searchParams: Promise<{ from?: string }>;
};

function parseFromParam(raw: string | undefined): Date {
  if (!raw) return new Date();
  const d = new Date(raw);
  return isNaN(d.getTime()) ? new Date() : d;
}

export default async function CompanySocialCalendarPage({ searchParams }: Props) {
  const { from: fromParam } = await searchParams;

  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/company/social/calendar")}`);
  }
  if (!session.company) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
        <p className="font-medium">Account not provisioned to a company.</p>
        <p className="mt-1 text-muted-foreground">
          Your account isn&apos;t a member of any company on the platform
          yet. Ask an admin to invite you, or contact Opollo support.
        </p>
      </div>
    );
  }

  const windowStart = parseFromParam(fromParam);
  const windowEnd = new Date(windowStart.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const result = await listCompanyScheduleEntries({
    companyId: session.company.companyId,
    fromIso: windowStart.toISOString(),
    toIso: windowEnd.toISOString(),
  });

  return (
    <main className="mx-auto max-w-4xl p-6">
      <header>
        <H1>Calendar</H1>
        <Lead className="mt-0.5">
          {WINDOW_DAYS}-day window. Use Prev / Next to navigate.
        </Lead>
      </header>
      <div className="mt-6">
        {result.ok ? (
          <SocialCalendarClient
            entries={result.data.entries.map((e) => ({
              id: e.id,
              post_master_id: e.post_master_id,
              platform: e.platform,
              scheduled_at: e.scheduled_at,
              preview: e.preview,
            }))}
            fromIso={windowStart.toISOString()}
            toIso={windowEnd.toISOString()}
          />
        ) : (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
            role="alert"
          >
            Failed to load calendar: {result.error.message}
          </div>
        )}
      </div>
    </main>
  );
}
