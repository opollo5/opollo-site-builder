import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("echarts-for-react", () => ({
  default: ({ style }: { style?: React.CSSProperties }) => (
    <div data-testid="echart" style={style} />
  ),
}));

import { InsightsDashboardClient } from "@/components/insights/InsightsDashboardClient";
import type { InsightsDashboardData } from "@/lib/insights/dashboard";

function makeData(overrides: Partial<InsightsDashboardData> = {}): InsightsDashboardData {
  return {
    companyId: "c-1",
    dataFreshness: { lastIngestIso: "2026-05-22T04:00:00Z", isStale: false },
    kpis: {
      reach30d: 24381,
      avgEngagementRate30d: 0.042,
      followerGrowth30d: null,
      bestPost: { id: "snap-1", engagementRate: 0.124, url: null },
    },
    availableMetrics: {
      likes: true,
      comments: true,
      shares: true,
      impressions: true,
      reach: true,
    },
    activePlatform: "linkedin_company",
    platforms: [
      {
        platform: "linkedin_company",
        postCount30d: 12,
        connected: true,
        lastIngestRelative: "2h ago",
        healthStatus: "green",
      },
    ],
    trendByPlatform: {
      linkedin_company: [
        { date: "2026-04-23", engagementRate: 0.03 },
        { date: "2026-04-24", engagementRate: 0.05 },
      ],
    },
    bestPosts: [
      {
        id: "post-1",
        bundlePostId: "bp-1",
        platform: "linkedin_company",
        source: "cap",
        content: "When ransomware hits an MSP client, the clock starts...",
        postedAt: "2026-05-01T10:14:00Z",
        engagementRate: 0.124,
        impressions: 1840,
        likes: 47,
        comments: 12,
        shares: 8,
      },
    ],
    underperformingPosts: [
      {
        id: "post-2",
        bundlePostId: "bp-2",
        platform: "facebook_page",
        source: "composer",
        content: "Underperforming post content here.",
        postedAt: "2026-04-20T08:00:00Z",
        engagementRate: 0.005,
        impressions: 200,
        likes: 1,
        comments: 0,
        shares: 0,
      },
    ],
    heatmapData: [{ dayOfWeek: 2, hour: 10, engagementRate: 0.08, postCount: 5 }],
    sourceComparison: {
      cap: { count: 28, avgEngagementRate: 0.052 },
      composer: { count: 14, avgEngagementRate: 0.036 },
    },
    xConnected: false,
    xMetrics: null,
    postCount: 47,
    period: "30d" as const,
    ...overrides,
  };
}

describe("InsightsDashboardClient", () => {
  it("renders all 5 sections with fixture data", () => {
    render(<InsightsDashboardClient data={makeData()} companyId="c-1" />);
    expect(screen.getByTestId("insights-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("kpi-row")).toBeInTheDocument();
    expect(screen.getByTestId("recommendations-panel")).toBeInTheDocument();
    expect(screen.getByTestId("best-content-section")).toBeInTheDocument();
    expect(screen.getByTestId("trend-chart-section")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-footer-tabs")).toBeInTheDocument();
  });

  it("renders empty state when no posts", () => {
    render(
      <InsightsDashboardClient
        data={makeData({ postCount: 0 })}
        companyId="c-1"
      />,
    );
    expect(screen.getByTestId("empty-no-posts")).toBeInTheDocument();
    expect(
      screen.getByText(/Insights starts learning after your first published post/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("insights-dashboard")).not.toBeInTheDocument();
  });

  it("shows 'need more posts' empty state in recommendations when < 20 posts", () => {
    render(
      <InsightsDashboardClient
        data={makeData({ postCount: 12 })}
        companyId="c-1"
      />,
    );
    expect(screen.getByTestId("recs-empty-need-more")).toBeInTheDocument();
    expect(screen.getByText(/Need 8 more posts/i)).toBeInTheDocument();
  });

  it("KPI cards render conditionally based on availableMetrics", () => {
    render(
      <InsightsDashboardClient
        data={makeData({
          availableMetrics: {
            likes: false,
            comments: false,
            shares: false,
            impressions: false,
            reach: false,
          },
          kpis: {
            reach30d: null,
            avgEngagementRate30d: 0.04,
            followerGrowth30d: null,
            bestPost: null,
          },
        })}
        companyId="c-1"
      />,
    );
    expect(screen.queryByTestId("kpi-reach")).not.toBeInTheDocument();
    expect(screen.getByTestId("kpi-engagement")).toBeInTheDocument();
  });

  it("heatmap is not shown by default (requires time_of_day sort)", () => {
    render(<InsightsDashboardClient data={makeData()} companyId="c-1" />);
    expect(screen.queryByTestId("posting-heatmap")).not.toBeInTheDocument();
  });

  it("X tab only renders when xConnected = true", () => {
    const { rerender } = render(
      <InsightsDashboardClient data={makeData({ xConnected: false })} companyId="c-1" />,
    );
    expect(screen.queryByTestId("x-tab")).not.toBeInTheDocument();

    rerender(
      <InsightsDashboardClient
        data={makeData({
          xConnected: true,
          xMetrics: { published30d: 5, scheduled: 2 },
        })}
        companyId="c-1"
      />,
    );
    expect(screen.getByTestId("x-tab")).toBeInTheDocument();
  });

  it("integration health shows platforms list", () => {
    render(<InsightsDashboardClient data={makeData()} companyId="c-1" />);
    // Click health tab
    fireEvent.click(screen.getByText("Integration health"));
    expect(screen.getByTestId("integration-health-list")).toBeInTheDocument();
    expect(screen.getByTestId("health-row-linkedin_company")).toBeInTheDocument();
  });

  it("renders stale data pill when isStale = true (data wired through page; stale pill is in page not client)", () => {
    // The stale pill is in the server page's PageHeader.Meta.
    // This test verifies the client renders fine when passed stale data.
    render(
      <InsightsDashboardClient
        data={makeData({ dataFreshness: { lastIngestIso: null, isStale: true } })}
        companyId="c-1"
      />,
    );
    expect(screen.getByTestId("insights-dashboard")).toBeInTheDocument();
  });
});
