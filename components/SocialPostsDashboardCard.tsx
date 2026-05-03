// ---------------------------------------------------------------------------
// S1-11 — quick-stats panel for /company. Server-component-friendly.
//
// Six tiles linking through to the filtered list. The "Approved this
// week" tile shares its filter with "Approved" but adds the emphasis;
// since the list view doesn't yet have a date filter, the link still
// goes to the approved tab.
// ---------------------------------------------------------------------------

import Link from "next/link";

import type { SocialPostsStats } from "@/lib/platform/social/posts";

type Props = {
  stats: SocialPostsStats;
};

type Tile = {
  label: string;
  value: number;
  href: string;
  emphasis?: "primary" | "amber" | "emerald" | "sky" | "rose";
  testId: string;
};

const EMPHASIS_BG: Record<NonNullable<Tile["emphasis"]>, string> = {
  primary: "bg-primary/10 text-primary",
  amber: "bg-amber-100 text-amber-900",
  emerald: "bg-emerald-100 text-emerald-900",
  sky: "bg-sky-100 text-sky-900",
  rose: "bg-rose-100 text-rose-900",
};

export function SocialPostsDashboardCard({ stats }: Props) {
  const tiles: Tile[] = [
    {
      label: "Drafts",
      value: stats.drafts,
      href: "/company/social/posts?state=draft",
      testId: "stats-drafts",
    },
    {
      label: "Awaiting approval",
      value: stats.awaitingApproval,
      href: "/company/social/posts?state=pending_client_approval",
      emphasis: "amber",
      testId: "stats-awaiting",
    },
    {
      label: "Approved",
      value: stats.approved,
      href: "/company/social/posts?state=approved",
      emphasis: "emerald",
      testId: "stats-approved",
    },
    {
      label: "Scheduled",
      value: stats.scheduled,
      href: "/company/social/posts?state=scheduled",
      emphasis: "sky",
      testId: "stats-scheduled",
    },
    {
      label: "Published",
      value: stats.published,
      href: "/company/social/posts?state=published",
      emphasis: "primary",
      testId: "stats-published",
    },
    {
      label: "Approved this week",
      value: stats.approvedThisWeek,
      href: "/company/social/posts?state=approved",
      emphasis: "emerald",
      testId: "stats-approved-this-week",
    },
    {
      label: "Changes requested",
      value: stats.changesRequested,
      href: "/company/social/posts?state=changes_requested",
      emphasis: "amber",
      testId: "stats-changes-requested",
    },
    {
      label: "Failed",
      value: stats.failed,
      href: "/company/social/posts?state=failed",
      emphasis: "rose",
      testId: "stats-failed",
    },
    {
      label: "Awaiting MSP release",
      value: stats.pendingMspRelease,
      href: "/company/social/posts?state=pending_msp_release",
      emphasis: "sky",
      testId: "stats-pending-msp-release",
    },
  ];

  return (
    <section
      className="rounded-lg border bg-card p-6"
      data-testid="social-posts-dashboard-card"
      aria-label="Social posts at a glance"
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Social posts at a glance</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Quick view of where your team&apos;s content sits in the
            approval pipeline.
          </p>
        </div>
        <Link
          href="/company/social/posts"
          className="text-sm text-primary hover:underline"
          data-testid="stats-view-all"
        >
          View all posts →
        </Link>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <li key={t.testId}>
            <Link
              href={t.href}
              className="block rounded-md border bg-background p-4 transition hover:border-primary/40 hover:bg-muted/40"
              data-testid={t.testId}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-muted-foreground">
                  {t.label}
                </span>
                {t.emphasis ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-sm font-medium ${EMPHASIS_BG[t.emphasis]}`}
                  >
                    {t.value === 1 ? "1 post" : `${t.value} posts`}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">
                {t.value}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
