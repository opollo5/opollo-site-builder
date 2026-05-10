import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Breadcrumb buffer uses browser globals. Provide minimal stubs.
vi.stubGlobal("document", {
  createElement: vi.fn(),
});

import {
  __resetBufferForTests,
  clearBreadcrumbs,
  getBreadcrumbs,
  getRouteHistory,
  trackConsole,
  trackErrorToast,
  trackNetworkRequest,
  trackRoute,
} from "@/components/error-reporting/breadcrumb-buffer";

// ---------------------------------------------------------------------------
// Breadcrumb buffer — unit tests.
// ---------------------------------------------------------------------------

beforeEach(() => {
  __resetBufferForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("trackRoute", () => {
  it("records route changes", () => {
    trackRoute("/admin");         // from "" → "/admin" (recorded)
    trackRoute("/admin/sites");   // from "/admin" → "/admin/sites" (recorded)
    const history = getRouteHistory();
    expect(history).toHaveLength(2);
    // Last entry is the most recent change.
    expect(history[history.length - 1]).toMatchObject({ from: "/admin", to: "/admin/sites" });
  });

  it("ignores duplicate consecutive routes", () => {
    trackRoute("/admin");  // first call: records "" → "/admin"
    trackRoute("/admin");  // duplicate: no-op
    expect(getRouteHistory()).toHaveLength(1);
  });

  it("returns only last 10 route changes", () => {
    for (let i = 0; i < 15; i++) {
      trackRoute(`/page-${i}`);
    }
    expect(getRouteHistory()).toHaveLength(10);
    // Oldest kept is page-5, newest is page-14.
    expect(getRouteHistory()[0]!.to).toBe("/page-5");
  });
});

describe("ring buffer — eviction", () => {
  it("evicts oldest entries when max (200) is exceeded", () => {
    for (let i = 0; i < 205; i++) {
      trackNetworkRequest("GET", `/url-${i}`, 200, 10);
    }
    const crumbs = getBreadcrumbs();
    expect(crumbs.length).toBe(200);
  });

  it("preserves ordering — newest first", () => {
    trackNetworkRequest("GET", "/first", 200, 10);
    trackNetworkRequest("GET", "/second", 200, 10);
    const crumbs = getBreadcrumbs();
    expect((crumbs[0]!.data as Record<string, unknown>).url).toBe("/second");
    expect((crumbs[1]!.data as Record<string, unknown>).url).toBe("/first");
  });
});

describe("time window — 5-minute filter", () => {
  it("filters out entries older than 5 minutes", () => {
    trackNetworkRequest("GET", "/old", 200, 10);
    // Advance 6 minutes.
    vi.advanceTimersByTime(6 * 60 * 1000);
    trackNetworkRequest("GET", "/new", 200, 10);
    const crumbs = getBreadcrumbs();
    expect(crumbs).toHaveLength(1);
    expect((crumbs[0]!.data as Record<string, unknown>).url).toBe("/new");
  });
});

describe("clearBreadcrumbs", () => {
  it("clears all entries and route history on logout", () => {
    trackRoute("/admin");
    trackNetworkRequest("GET", "/api/test", 200, 10);
    clearBreadcrumbs();
    expect(getBreadcrumbs()).toHaveLength(0);
    expect(getRouteHistory()).toHaveLength(0);
  });
});

describe("trackConsole", () => {
  it("truncates messages to 500 chars", () => {
    const long = "x".repeat(600);
    trackConsole("console_error", long);
    const crumbs = getBreadcrumbs();
    expect((crumbs[0]!.data as Record<string, string>).message.length).toBe(500);
  });
});

describe("trackErrorToast", () => {
  it("records toast messages truncated to 200 chars", () => {
    const long = "y".repeat(300);
    trackErrorToast(long);
    const crumbs = getBreadcrumbs();
    expect(crumbs[0]!.type).toBe("error_toast");
    expect((crumbs[0]!.data as Record<string, string>).message.length).toBe(200);
  });
});
