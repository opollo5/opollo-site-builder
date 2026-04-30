import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// OPTIMISER PHASE 1.5 follow-up slice A — publish-full-page bridge.
//
// These tests cover the bridge's pure no-op paths (fast paths that
// don't reach SFTP / homepage extraction). Full integration tests
// for SFTP write + chrome extraction live in the slice-14 unit tests
// (writeStaticPage, extractFullPageChrome) — this file just verifies
// the bridge dispatches correctly based on brief_pages.output_mode +
// briefs.content_type + opt_clients.hosting_mode.

const fromMock = vi.fn();
const supabaseMock = { from: fromMock };

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => supabaseMock,
}));

vi.mock("@/lib/static-hosting", () => ({
  writeStaticPage: vi.fn(),
}));

vi.mock("@/lib/full-page-chrome-extractor", () => ({
  extractFullPageChrome: vi.fn(),
}));

import { publishApprovedPageAsFullPage } from "@/lib/optimiser/site-builder-bridge/publish-full-page";

beforeEach(() => {
  fromMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

interface QueryStep {
  table: string;
  rows: unknown;
  error?: string | null;
}

function chainQuery(rows: unknown, error: string | null = null) {
  // Chainable supabase-js query builder mock — every modifier
  // returns `this`; terminal `.maybeSingle()` resolves.
  const chain: Record<string, unknown> = {};
  const terminal = Promise.resolve({
    data: rows,
    error: error ? { message: error } : null,
  });
  for (const m of [
    "select",
    "eq",
    "in",
    "is",
    "order",
    "limit",
    "update",
    "insert",
  ]) {
    (chain as Record<string, (...args: unknown[]) => unknown>)[m] = () => chain;
  }
  (chain as { maybeSingle: () => Promise<unknown> }).maybeSingle = () => terminal;
  (chain as { single: () => Promise<unknown> }).single = () => terminal;
  return chain;
}

function setupSequence(steps: QueryStep[]): void {
  fromMock.mockImplementation((table: string) => {
    const next = steps.shift();
    if (!next || next.table !== table) {
      return chainQuery(null, `unexpected query on ${table}`);
    }
    return chainQuery(next.rows, next.error ?? null);
  });
}

describe("publishApprovedPageAsFullPage", () => {
  it("returns no-op when brief_page output_mode is 'slice'", async () => {
    setupSequence([
      {
        table: "brief_pages",
        rows: {
          id: "p1",
          brief_id: "b1",
          ordinal: 0,
          title: "Page",
          slug_hint: null,
          output_mode: "slice",
          generated_html: "<section />",
        },
      },
    ]);
    const r = await publishApprovedPageAsFullPage("p1", "2026-05-01T00:00:00Z");
    expect(r.published).toBe(false);
    if (!r.published) expect(r.reason).toBe("not_full_page_mode");
  });

  it("returns no_generated_html when generated_html is empty", async () => {
    setupSequence([
      {
        table: "brief_pages",
        rows: {
          id: "p1",
          brief_id: "b1",
          ordinal: 0,
          title: "Page",
          slug_hint: null,
          output_mode: "full_page",
          generated_html: "",
        },
      },
    ]);
    const r = await publishApprovedPageAsFullPage("p1", "2026-05-01T00:00:00Z");
    expect(r.published).toBe(false);
    if (!r.published) expect(r.reason).toBe("no_generated_html");
  });

  it("returns not_a_landing_page when brief.content_type is 'post'", async () => {
    setupSequence([
      {
        table: "brief_pages",
        rows: {
          id: "p1",
          brief_id: "b1",
          ordinal: 0,
          title: "Page",
          slug_hint: null,
          output_mode: "full_page",
          generated_html: "<section />",
        },
      },
      {
        table: "briefs",
        rows: { id: "b1", site_id: "s1", content_type: "post" },
      },
    ]);
    const r = await publishApprovedPageAsFullPage("p1", "2026-05-01T00:00:00Z");
    expect(r.published).toBe(false);
    if (!r.published) expect(r.reason).toBe("not_a_landing_page");
  });

  it("returns no_proposal_link when brief_run has no triggered_by_proposal_id", async () => {
    setupSequence([
      {
        table: "brief_pages",
        rows: {
          id: "p1",
          brief_id: "b1",
          ordinal: 0,
          title: "Page",
          slug_hint: null,
          output_mode: "full_page",
          generated_html: "<section />",
        },
      },
      {
        table: "briefs",
        rows: { id: "b1", site_id: "s1", content_type: "page" },
      },
      {
        table: "brief_runs",
        rows: { id: "r1", triggered_by_proposal_id: null },
      },
    ]);
    const r = await publishApprovedPageAsFullPage("p1", "2026-05-01T00:00:00Z");
    expect(r.published).toBe(false);
    if (!r.published) expect(r.reason).toBe("no_proposal_link");
  });

  it("returns client_slice_mode when client.hosting_mode is 'client_slice'", async () => {
    setupSequence([
      {
        table: "brief_pages",
        rows: {
          id: "p1",
          brief_id: "b1",
          ordinal: 0,
          title: "Page",
          slug_hint: null,
          output_mode: "full_page",
          generated_html: "<section />",
        },
      },
      {
        table: "briefs",
        rows: { id: "b1", site_id: "s1", content_type: "page" },
      },
      {
        table: "brief_runs",
        rows: { id: "r1", triggered_by_proposal_id: "prop-1" },
      },
      {
        table: "opt_proposals",
        rows: { id: "prop-1", client_id: "c1", landing_page_id: "lp1" },
      },
      {
        table: "opt_clients",
        rows: {
          id: "c1",
          client_slug: "test",
          hosting_mode: "client_slice",
          tracking_config: {},
        },
      },
    ]);
    const r = await publishApprovedPageAsFullPage("p1", "2026-05-01T00:00:00Z");
    expect(r.published).toBe(false);
    if (!r.published) expect(r.reason).toBe("client_slice_mode");
  });
});
