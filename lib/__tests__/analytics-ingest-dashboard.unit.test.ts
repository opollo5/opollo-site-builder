import { describe, expect, it, vi, beforeEach } from "vitest";

// LAYER 1 — Unit. Mocks Supabase at the service-role boundary.
//
// Tests the dashboard reducer over getProfileAnalyticsDashboard: tie-
// breaking on top-posts, period delta math, empty-state detection,
// platform ordering, and time-series day fill.

const profileSnapshotsCurrent: Array<Record<string, unknown>> = [];
const profileSnapshotsPrevious: Array<Record<string, unknown>> = [];
const postSnapshots: Array<Record<string, unknown>> = [];
const importsRows: Array<Record<string, unknown>> = [];
let postCountTotal = 0;

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from(table: string) {
      return {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          // Only the count-head probe uses the second arg.
          if (opts?.head) {
            return {
              eq() {
                return Promise.resolve({ count: postCountTotal });
              },
            };
          }
          const rows = pickRows(table);
          return chainQuery(rows);
        },
      };
    },
  }),
}));

function pickRows(table: string): Array<Record<string, unknown>> {
  if (table === "social_post_history_imports") return importsRows;
  if (table === "social_post_analytics_snapshots") return postSnapshots;
  // Two queries hit social_profile_analytics_snapshots — current + previous.
  // We return current here and the chained .lt branch swaps in previous.
  return profileSnapshotsCurrent;
}

// Minimal chainable query builder that returns either the data slice or
// the previous-period slice depending on whether `.lt` was called.
function chainQuery(rows: Array<Record<string, unknown>>) {
  let usePrevious = false;
  let result = rows;
  const builder: {
    eq: (...args: unknown[]) => typeof builder;
    gte: (...args: unknown[]) => typeof builder;
    lt: (...args: unknown[]) => typeof builder;
    order: (...args: unknown[]) => typeof builder;
    limit: (...args: unknown[]) => typeof builder;
    is: (...args: unknown[]) => typeof builder;
    not: (...args: unknown[]) => typeof builder;
    then: (
      resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => void,
    ) => void;
  } = {
    eq() {
      return builder;
    },
    gte() {
      return builder;
    },
    lt() {
      usePrevious = true;
      result = profileSnapshotsPrevious;
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    is() {
      return builder;
    },
    not() {
      return builder;
    },
    then(resolve) {
      const data = usePrevious ? result : rows;
      resolve({ data, error: null });
    },
  };
  return builder;
}

import { getProfileAnalyticsDashboard } from "@/lib/platform/social/analytics-ingest/dashboard";

const PROFILE_ID = "11111111-1111-1111-1111-111111111111";

function isoDay(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

beforeEach(() => {
  profileSnapshotsCurrent.length = 0;
  profileSnapshotsPrevious.length = 0;
  postSnapshots.length = 0;
  importsRows.length = 0;
  postCountTotal = 0;
});

describe("BSP analytics — dashboard reducer", () => {
  it("renders first-time empty state when no snapshots exist", async () => {
    const dash = await getProfileAnalyticsDashboard({
      profileId: PROFILE_ID,
      rangeDays: 30,
    });
    expect(dash.is_first_time).toBe(true);
    expect(dash.total_impressions_period).toBe(0);
    expect(dash.platforms).toEqual([]);
    expect(dash.top_posts).toEqual([]);
  });

  it("sums impressions across platforms and computes delta vs previous period", async () => {
    profileSnapshotsCurrent.push(
      {
        platform: "linkedin_company",
        bundle_social_account_id: "li-1",
        snapshot_date: isoDay(0),
        followers: 1000,
        post_count: 50,
        impressions: 500,
      },
      {
        platform: "facebook_page",
        bundle_social_account_id: "fb-1",
        snapshot_date: isoDay(0),
        followers: 2000,
        post_count: 100,
        impressions: 1500,
      },
    );
    profileSnapshotsPrevious.push(
      {
        platform: "linkedin_company",
        snapshot_date: isoDay(35),
        impressions: 400,
      },
      {
        platform: "facebook_page",
        snapshot_date: isoDay(35),
        impressions: 1000,
      },
    );
    postCountTotal = 0;
    const dash = await getProfileAnalyticsDashboard({
      profileId: PROFILE_ID,
      rangeDays: 30,
    });
    expect(dash.total_impressions_period).toBe(2000);
    expect(dash.total_impressions_previous_period).toBe(1400);
    expect(dash.total_impressions_delta_pct).toBeCloseTo(
      ((2000 - 1400) / 1400) * 100,
      2,
    );
  });

  it("orders platforms by current-period impressions DESC", async () => {
    profileSnapshotsCurrent.push(
      {
        platform: "linkedin_company",
        bundle_social_account_id: "li-1",
        snapshot_date: isoDay(0),
        followers: 100,
        impressions: 100,
      },
      {
        platform: "facebook_page",
        bundle_social_account_id: "fb-1",
        snapshot_date: isoDay(0),
        followers: 100,
        impressions: 999,
      },
      {
        platform: "gbp",
        bundle_social_account_id: "g-1",
        snapshot_date: isoDay(0),
        followers: 100,
        impressions: 200,
      },
    );
    const dash = await getProfileAnalyticsDashboard({
      profileId: PROFILE_ID,
      rangeDays: 30,
    });
    expect(dash.platforms.map((p) => p.platform)).toEqual([
      "facebook_page",
      "gbp",
      "linkedin_company",
    ]);
  });

  it("dedupes top posts by bundle_post_id keeping the most-recent snapshot", async () => {
    postSnapshots.push(
      {
        bundle_post_id: "post-A",
        platform: "linkedin_company",
        posted_at: isoDay(2),
        post_url: "https://linkedin.com/a",
        title: "A title",
        content: "A content here",
        media_urls: null,
        impressions: 1000,
        likes: 100,
        comments: 50,
        shares: 10,
        engagement_rate: 0.16,
        snapshot_date: isoDay(0), // latest
      },
      {
        bundle_post_id: "post-A",
        platform: "linkedin_company",
        posted_at: isoDay(2),
        post_url: "https://linkedin.com/a",
        title: "A title",
        content: "A content here",
        media_urls: null,
        impressions: 500,
        likes: 50,
        comments: 20,
        shares: 5,
        engagement_rate: 0.15,
        snapshot_date: isoDay(1), // older
      },
    );
    const dash = await getProfileAnalyticsDashboard({
      profileId: PROFILE_ID,
      rangeDays: 30,
    });
    expect(dash.top_posts).toHaveLength(1);
    expect(dash.top_posts[0].impressions).toBe(1000); // latest snapshot
  });

  it("tie-breaks top posts on impressions when engagement rate is equal", async () => {
    postSnapshots.push(
      {
        bundle_post_id: "post-A",
        platform: "linkedin_company",
        posted_at: isoDay(2),
        title: "A",
        content: "a",
        media_urls: null,
        impressions: 500,
        likes: 50,
        comments: 25,
        shares: 25,
        engagement_rate: 0.2,
        snapshot_date: isoDay(0),
      },
      {
        bundle_post_id: "post-B",
        platform: "linkedin_company",
        posted_at: isoDay(2),
        title: "B",
        content: "b",
        media_urls: null,
        impressions: 1000,
        likes: 100,
        comments: 50,
        shares: 50,
        engagement_rate: 0.2,
        snapshot_date: isoDay(0),
      },
    );
    const dash = await getProfileAnalyticsDashboard({
      profileId: PROFILE_ID,
      rangeDays: 30,
    });
    expect(dash.top_posts[0].bundle_post_id).toBe("post-B");
    expect(dash.top_posts[1].bundle_post_id).toBe("post-A");
  });

  it("fills every day of the range in the time series, zeros where no data", async () => {
    profileSnapshotsCurrent.push({
      platform: "linkedin_company",
      bundle_social_account_id: "li-1",
      snapshot_date: isoDay(5),
      followers: 100,
      impressions: 200,
    });
    const dash = await getProfileAnalyticsDashboard({
      profileId: PROFILE_ID,
      rangeDays: 7,
    });
    expect(dash.time_series).toHaveLength(7);
    // The day-5 entry has 200 impressions; others 0.
    const day5 = dash.time_series.find((p) => p.date === isoDay(5));
    expect(day5?.total).toBe(200);
    const zeros = dash.time_series.filter((p) => p.total === 0);
    expect(zeros.length).toBe(6);
  });

  it("returns only active imports (queued/running) in active_imports", async () => {
    importsRows.push(
      {
        id: "i-1",
        profile_id: PROFILE_ID,
        bundle_social_account_id: "x",
        platform: "linkedin_company",
        status: "queued",
        bundle_import_id: null,
        started_at: null,
        completed_at: null,
        posts_imported: 0,
        error_message: null,
        created_at: isoDay(0),
        updated_at: isoDay(0),
      },
      {
        id: "i-2",
        profile_id: PROFILE_ID,
        bundle_social_account_id: "y",
        platform: "linkedin_company",
        status: "succeeded",
        bundle_import_id: "imp-1",
        started_at: isoDay(1),
        completed_at: isoDay(0),
        posts_imported: 50,
        error_message: null,
        created_at: isoDay(2),
        updated_at: isoDay(0),
      },
    );
    const dash = await getProfileAnalyticsDashboard({
      profileId: PROFILE_ID,
      rangeDays: 7,
    });
    expect(dash.active_imports.map((i) => i.id)).toEqual(["i-1"]);
  });
});
