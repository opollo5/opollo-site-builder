"use client";

import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { H1, H3, Lead } from "@/components/ui/typography";
import type { SocialAnalytics } from "@/lib/platform/social/analytics";

// ---------------------------------------------------------------------------
// /company/social/analytics — client shell for charts + recent lists.
//
// All data is fetched server-side and passed as props. This component
// is "use client" only for recharts (needs DOM / window). No client-side
// data fetching here.
// ---------------------------------------------------------------------------

// Colors stay in hsl(var(...)) so they inherit the active CSS theme.
// The multi-series palette uses semantically distinct hues expressed
// as CSS hsl() strings (not hex) to satisfy the no-hardcoded-hex rule.
const PRIMARY = "hsl(var(--primary))";
const MUTED = "hsl(var(--muted-foreground))";

const PALETTE = [
  "hsl(211 100% 56%)",
  "hsl(152 73% 46%)",
  "hsl(43 96% 56%)",
  "hsl(262 80% 65%)",
  "hsl(17 100% 62%)",
];

function platformColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

// ---- Shared tooltip style ------------------------------------------------
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name?: string; fill?: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      {label && <p className="mb-1 font-medium text-foreground">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="text-muted-foreground">
          {p.name ? `${p.name}: ` : ""}{p.value}
        </p>
      ))}
    </div>
  );
}

// ---- KPI card ------------------------------------------------------------
function KpiCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: number | string;
  sublabel?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
      {sublabel && (
        <p className="mt-0.5 text-xs text-muted-foreground">{sublabel}</p>
      )}
    </div>
  );
}

// ---- Section wrapper -----------------------------------------------------
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`section-${title.replace(/\s+/g, "-").toLowerCase()}`}>
      <H3
        id={`section-${title.replace(/\s+/g, "-").toLowerCase()}`}
        className="mb-4 text-base font-semibold"
      >
        {title}
      </H3>
      {children}
    </section>
  );
}

// ---- Empty state ---------------------------------------------------------
function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-48 items-center justify-center rounded-lg border border-dashed bg-muted/30">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

// ---- Main component ------------------------------------------------------
export function SocialAnalyticsClient({
  data,
}: {
  data: SocialAnalytics;
}) {
  const hasAnyPosts = data.totalPublished > 0 || data.postsBySource.reduce((s, x) => s + x.count, 0) > 0;
  const hasPlatformData = data.postsByPlatform.length > 0;
  const hasSourceData = data.postsBySource.length > 0;
  const hasTrend = data.publishedByDay.some((d) => d.count > 0);
  const hasStateData = data.postsByState.length > 0;

  return (
    <main className="mx-auto max-w-6xl space-y-10 p-6">
      <header>
        <H1>Analytics</H1>
        <Lead className="mt-0.5">
          Your social media performance at a glance.
        </Lead>
      </header>

      {!hasAnyPosts && (
        <div
          className="rounded-lg border border-dashed p-8 text-center"
          data-testid="analytics-empty"
        >
          <p className="font-medium">No posts published yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first post to see analytics here.
          </p>
          <Button asChild className="mt-4">
            <Link href="/company/social/posts">Go to Posts</Link>
          </Button>
        </div>
      )}

      {/* KPI cards */}
      <Section title="Summary">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Total published"
            value={data.totalPublished}
            sublabel="All time"
          />
          <KpiCard
            label="Published this month"
            value={data.publishedThisMonth}
            sublabel="Calendar month"
          />
          <KpiCard
            label="Scheduled"
            value={data.scheduledUpcoming}
            sublabel="Awaiting publish"
          />
          <KpiCard
            label="Connected platforms"
            value={data.activeConnectionsCount}
            sublabel="Healthy connections"
          />
        </div>
      </Section>

      {/* 30-day published trend */}
      <Section title="Published posts — last 30 days">
        {!hasTrend ? (
          <ChartEmpty message="No posts published in the last 30 days." />
        ) : (
          <div className="rounded-lg border bg-card p-4">
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart
                data={data.publishedByDay}
                margin={{ top: 4, right: 8, bottom: 0, left: -20 }}
              >
                <defs>
                  <linearGradient id="publishedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={PRIMARY} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={PRIMARY} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: MUTED }}
                  tickFormatter={(d: string) =>
                    new Date(d + "T00:00:00Z").toLocaleDateString("en-AU", {
                      day: "numeric",
                      month: "short",
                      timeZone: "UTC",
                    })
                  }
                  interval={6}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: MUTED }}
                  allowDecimals={false}
                />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="count"
                  name="Published"
                  stroke={PRIMARY}
                  strokeWidth={2}
                  fill="url(#publishedGrad)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      {/* Posts by platform */}
      <Section title="Posts by platform">
        {!hasPlatformData ? (
          <ChartEmpty message="No platform variants found. Add platforms to your posts to see this chart." />
        ) : (
          <div className="rounded-lg border bg-card p-4">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={data.postsByPlatform}
                margin={{ top: 4, right: 8, bottom: 40, left: -20 }}
                barCategoryGap="35%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="platform"
                  tick={{ fontSize: 11, fill: MUTED }}
                  angle={-30}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: MUTED }}
                  allowDecimals={false}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Posts" radius={[3, 3, 0, 0]}>
                  {data.postsByPlatform.map((_, i) => (
                    <Cell key={i} fill={platformColor(i)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      {/* Post state distribution + Source breakdown side by side */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Posts by status">
          {!hasStateData ? (
            <ChartEmpty message="No post data yet." />
          ) : (
            <div className="rounded-lg border bg-card p-4">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={data.postsByState}
                  layout="vertical"
                  margin={{ top: 4, right: 16, bottom: 4, left: 120 }}
                  barCategoryGap="30%"
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: MUTED }}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="state"
                    tick={{ fontSize: 11, fill: MUTED }}
                    width={115}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="count" name="Posts" fill={PRIMARY} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Section>

        <Section title="AI vs manual">
          {!hasSourceData ? (
            <ChartEmpty message="No post data yet." />
          ) : (
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-6">
                <ResponsiveContainer width="60%" height={180}>
                  <PieChart>
                    <Pie
                      data={data.postsBySource}
                      dataKey="count"
                      nameKey="source"
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {data.postsBySource.map((_, i) => (
                        <Cell key={i} fill={platformColor(i)} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <ul className="flex-1 space-y-2 text-sm" aria-label="Source breakdown">
                  {data.postsBySource.map((s, i) => (
                    <li key={s.source} className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: platformColor(i) }}
                        aria-hidden
                      />
                      <span className="truncate text-muted-foreground">{s.source}</span>
                      <span className="ml-auto font-medium tabular-nums">{s.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </Section>
      </div>

      {/* Recent published posts */}
      <Section title="Recently published">
        {data.recentPublished.length === 0 ? (
          <ChartEmpty message="No published posts yet." />
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Content
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Platforms
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                    Published
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.recentPublished.map((post) => (
                  <tr key={post.id} className="hover:bg-muted/20">
                    <td className="max-w-xs px-4 py-3">
                      <Link
                        href={`/company/social/posts/${post.id}`}
                        className="line-clamp-2 text-foreground hover:text-primary hover:underline"
                      >
                        {post.master_text
                          ? post.master_text.slice(0, 120) +
                            (post.master_text.length > 120 ? "…" : "")
                          : <span className="text-muted-foreground">— no copy —</span>}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {post.platforms.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {post.platforms.map((p) => (
                            <span
                              key={p}
                              className="inline-block rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-muted-foreground">
                      {new Date(post.state_changed_at).toLocaleDateString("en-AU", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Pending approval */}
      {data.pendingApproval.length > 0 && (
        <Section title="Pending approval">
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Content
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                    Submitted
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.pendingApproval.map((post) => (
                  <tr key={post.id} className="hover:bg-muted/20">
                    <td className="max-w-xs px-4 py-3">
                      <span className="line-clamp-2 text-foreground">
                        {post.master_text
                          ? post.master_text.slice(0, 120) +
                            (post.master_text.length > 120 ? "…" : "")
                          : <span className="text-muted-foreground">— no copy —</span>}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-muted-foreground">
                      {new Date(post.created_at).toLocaleDateString("en-AU", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/company/social/posts/${post.id}`}
                        className="text-primary hover:underline"
                      >
                        Review →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </main>
  );
}
