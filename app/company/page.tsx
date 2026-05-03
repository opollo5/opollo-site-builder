import Link from "next/link";
import { redirect } from "next/navigation";

import { SocialPostsDashboardCard } from "@/components/SocialPostsDashboardCard";
import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { getSocialPostsStats } from "@/lib/platform/social/posts";

// ---------------------------------------------------------------------------
// /company — customer landing dashboard (S1-11).
//
// Surfaces the social-posts quick-stats card + shortcuts to the rest
// of the customer surface. Same gating as the rest of /company:
//   1. No session → /login.
//   2. No company membership → "Not provisioned" envelope.
//
// Stats query is gated by canDo("view_calendar") — same threshold as
// the list page. Members of the company can see their own stats;
// Opollo staff see whichever company they're scoped to.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default async function CompanyLandingPage() {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/company")}`);
  }

  if (!session.company) {
    return (
      <main className="mx-auto max-w-3xl p-6 text-sm">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="font-medium">Account not provisioned to a company.</p>
          <p className="mt-1 text-muted-foreground">
            Your account isn&apos;t a member of any company on the
            platform yet. Ask an admin to invite you, or contact
            Opollo support.
          </p>
        </div>
      </main>
    );
  }

  const companyId = session.company.companyId;
  const canViewCalendar = await canDo(companyId, "view_calendar");

  // Without view_calendar permission we can't surface the stats; fall
  // back to a minimal landing with the management surfaces the user
  // does have access to. (Viewer is the lowest role and has
  // view_calendar, so this branch is purely defensive against future
  // role-table changes.)
  if (!canViewCalendar) {
    return <MinimalLanding role={session.company.role} />;
  }

  const statsResult = await getSocialPostsStats({ companyId });

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Here&apos;s where your social content sits today.
        </p>
      </header>

      {statsResult.ok ? (
        <SocialPostsDashboardCard stats={statsResult.data} />
      ) : (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          role="alert"
          data-testid="dashboard-stats-error"
        >
          Failed to load stats: {statsResult.error.message}
        </div>
      )}

      <nav
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        aria-label="Customer surfaces"
      >
        <Link
          href="/company/social/posts"
          className="block rounded-md border bg-card p-4 hover:border-primary/40"
          data-testid="dashboard-link-posts"
        >
          <div className="font-medium">Social posts</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Drafts, approvals, scheduling, audit trail.
          </div>
        </Link>
        <Link
          href="/company/social/calendar"
          className="block rounded-md border bg-card p-4 hover:border-primary/40"
          data-testid="dashboard-link-calendar"
        >
          <div className="font-medium">Calendar</div>
          <div className="mt-1 text-sm text-muted-foreground">
            30-day view of everything queued to publish.
          </div>
        </Link>
        <Link
          href="/company/social/connections"
          className="block rounded-md border bg-card p-4 hover:border-primary/40"
          data-testid="dashboard-link-connections"
        >
          <div className="font-medium">Connections</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Linked social accounts and platform status.
          </div>
        </Link>
        <Link
          href="/company/social/media"
          className="block rounded-md border bg-card p-4 hover:border-primary/40"
          data-testid="dashboard-link-media"
        >
          <div className="font-medium">Media library</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Images and videos attached to posts.
          </div>
        </Link>
        <Link
          href="/company/users"
          className="block rounded-md border bg-card p-4 hover:border-primary/40"
          data-testid="dashboard-link-users"
        >
          <div className="font-medium">Users</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Manage team members and pending invitations.
          </div>
        </Link>
      </nav>
    </main>
  );
}

function MinimalLanding({ role }: { role: string }) {
  return (
    <main className="mx-auto max-w-3xl p-6 text-sm">
      <h1 className="text-2xl font-semibold">Welcome back</h1>
      <p className="mt-2 text-muted-foreground">
        Your role ({role}) doesn&apos;t have access to the calendar.
        Ask an admin to elevate your permissions if you need to see
        post stats.
      </p>
      <nav className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link
          href="/company/users"
          className="block rounded-md border bg-card p-4 hover:border-primary/40"
        >
          <div className="font-medium">Users</div>
          <div className="mt-1 text-muted-foreground">
            See teammates and (if admin) manage invitations.
          </div>
        </Link>
      </nav>
    </main>
  );
}
