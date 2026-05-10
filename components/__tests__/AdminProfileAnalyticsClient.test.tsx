import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminProfileAnalyticsClient } from "@/components/AdminProfileAnalyticsClient";
import type { AnalyticsDashboard } from "@/lib/platform/social/analytics-ingest";

// Mock sonner so toast calls don't error in jsdom.
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Recharts to a no-op component — its ResponsiveContainer breaks
// in jsdom because it depends on element measurements.
vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

function makeDashboard(
  overrides: Partial<AnalyticsDashboard> = {},
): AnalyticsDashboard {
  return {
    profile_id: "p-1",
    range_days: 30,
    total_impressions_period: 1500,
    total_impressions_previous_period: 1000,
    total_impressions_delta_pct: 50,
    platforms: [
      {
        platform: "linkedin_company",
        current: {
          followers: 500,
          post_count: 12,
          impressions_period: 1000,
          engagement_rate_period: null,
        },
        previous: { impressions_period: 800 },
        impressions_delta_pct: 25,
        has_data: true,
      },
      {
        platform: "facebook_page",
        current: {
          followers: 2000,
          post_count: 30,
          impressions_period: 500,
          engagement_rate_period: null,
        },
        previous: { impressions_period: 200 },
        impressions_delta_pct: 150,
        has_data: true,
      },
    ],
    time_series: [
      {
        date: "2026-05-01",
        by_platform: { linkedin_company: 100, facebook_page: 50 },
        total: 150,
      },
    ],
    top_posts: [
      {
        bundle_post_id: "post-1",
        platform: "linkedin_company",
        posted_at: "2026-05-01T12:00:00Z",
        post_url: "https://linkedin.com/post/1",
        title: "Best post ever",
        content_snippet: "snippet text",
        thumbnail_url: null,
        impressions: 1000,
        likes: 100,
        comments: 30,
        shares: 5,
        engagement_rate: 0.135,
      },
    ],
    active_imports: [],
    is_first_time: false,
    ...overrides,
  };
}

const COMMON_PROPS = {
  companyId: "c-1",
  profileId: "p-1",
  profileName: "Acme Brand",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AdminProfileAnalyticsClient", () => {
  it("renders hero, platform cards, time series, and top posts when data exists", () => {
    render(
      <AdminProfileAnalyticsClient
        {...COMMON_PROPS}
        initialDashboard={makeDashboard()}
      />,
    );
    expect(screen.getByTestId("analytics-dashboard")).toBeInTheDocument();
    expect(screen.getByText(/Total impressions/i)).toBeInTheDocument();
    expect(screen.getByTestId("platform-stat-card-linkedin_company")).toBeInTheDocument();
    expect(screen.getByTestId("platform-stat-card-facebook_page")).toBeInTheDocument();
    expect(screen.getByTestId("top-post-post-1")).toBeInTheDocument();
    expect(screen.getByText("Best post ever")).toBeInTheDocument();
  });

  it("renders the first-time empty state when is_first_time = true", () => {
    render(
      <AdminProfileAnalyticsClient
        {...COMMON_PROPS}
        initialDashboard={makeDashboard({
          is_first_time: true,
          total_impressions_period: 0,
          platforms: [],
          top_posts: [],
        })}
      />,
    );
    expect(screen.getByText(/Analytics are on the way/i)).toBeInTheDocument();
    expect(screen.queryByTestId("top-posts-list")).not.toBeInTheDocument();
  });

  it("shows in-progress imports in the empty state when present", () => {
    render(
      <AdminProfileAnalyticsClient
        {...COMMON_PROPS}
        initialDashboard={makeDashboard({
          is_first_time: true,
          total_impressions_period: 0,
          platforms: [],
          top_posts: [],
          active_imports: [
            {
              id: "imp-1",
              profile_id: "p-1",
              bundle_social_account_id: "acct-1",
              platform: "linkedin_company",
              status: "running",
              bundle_import_id: "b-1",
              started_at: "2026-05-10T11:00:00Z",
              completed_at: null,
              posts_imported: 0,
              error_message: null,
              created_at: "2026-05-10T10:55:00Z",
              updated_at: "2026-05-10T11:00:00Z",
            },
          ],
        })}
      />,
    );
    expect(screen.getByTestId("active-imports-list")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("date-range tabs trigger a fetch and update the dashboard", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          data: makeDashboard({ range_days: 7, total_impressions_period: 200 }),
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AdminProfileAnalyticsClient
        {...COMMON_PROPS}
        initialDashboard={makeDashboard()}
      />,
    );

    fireEvent.click(screen.getByTestId("range-tab-7"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const call = fetchMock.mock.calls[0][0] as string;
    expect(call).toContain("range=7");
  });

  it("the refresh button calls the force-refresh endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            data: {
              profile_id: "p-1",
              accounts_refreshed: 2,
              account_failures: 0,
              posts_refreshed: 30,
              post_failures: 0,
              errors: [],
            },
          }),
      })
      // Then the dashboard refetch after success:
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ ok: true, data: makeDashboard() }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AdminProfileAnalyticsClient
        {...COMMON_PROPS}
        initialDashboard={makeDashboard()}
      />,
    );

    fireEvent.click(screen.getByTestId("analytics-refresh-button"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/analytics/refresh"),
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("greys out platforms without analytics support (X)", () => {
    render(
      <AdminProfileAnalyticsClient
        {...COMMON_PROPS}
        initialDashboard={makeDashboard({
          platforms: [
            {
              platform: "x",
              current: {
                followers: null,
                post_count: null,
                impressions_period: 0,
                engagement_rate_period: null,
              },
              previous: { impressions_period: 0 },
              impressions_delta_pct: null,
              has_data: false,
            },
          ],
        })}
      />,
    );
    const card = screen.getByTestId("platform-stat-card-x");
    expect(card).toBeInTheDocument();
    // The card carries the opacity-60 class when analytics are unavailable.
    expect(card.className).toContain("opacity-60");
    expect(screen.getByText(/Not exposed/i)).toBeInTheDocument();
  });
});
