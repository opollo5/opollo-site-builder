/**
 * L6 Security — Pattern miner must not include non-consenting company data.
 *
 * Verifies that only companies with cross_client_learning_consent=TRUE
 * contribute feature rows. Non-consenting company posts must never appear.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const CONSENTING_COMPANY = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const NON_CONSENTING_COMPANY = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

afterEach(() => {
  vi.resetModules();
});

describe("SECURITY: pattern miner consent isolation", () => {
  it("only queries features for consenting companies — never leaks non-consenting IDs", async () => {
    const insertedRows: unknown[] = [];
    const featureQueryIds: string[] = [];

    vi.doMock("@/lib/supabase", () => ({
      getServiceRoleClient: () => ({
        from: (table: string) => {
          if (table === "ins_consent") {
            return {
              select: () => ({
                eq: () =>
                  Promise.resolve({
                    // 5 consenting companies — meets the MIN_COMPANIES floor
                    data: [
                      { company_id: CONSENTING_COMPANY },
                      { company_id: "c2000000-0000-0000-0000-000000000002" },
                      { company_id: "c3000000-0000-0000-0000-000000000003" },
                      { company_id: "c4000000-0000-0000-0000-000000000004" },
                      { company_id: "c5000000-0000-0000-0000-000000000005" },
                    ],
                    error: null,
                  }),
              }),
            };
          }
          if (table === "ins_post_features") {
            return {
              select: () => ({
                in: (_col: string, ids: string[]) => {
                  featureQueryIds.push(...ids);
                  return {
                    not: () => ({
                      is: () =>
                        Promise.resolve({
                          data: Array.from({ length: 150 }, (_, i) => ({
                            engagement_rate: 0.05 + i * 0.001,
                            has_question: i % 2 === 0,
                            word_count: 50 + i,
                            topic_tags: ["ransomware"],
                          })),
                          error: null,
                        }),
                    }),
                  };
                },
              }),
            };
          }
          if (table === "ins_pattern_library") {
            return {
              insert: (row: unknown) => {
                insertedRows.push(row);
                return Promise.resolve({ error: null });
              },
            };
          }
          return {};
        },
      }),
    }));

    const { minePatterns } = await import("@/lib/insights/pattern-miner");
    await minePatterns();

    // Non-consenting company ID must never reach the feature query
    expect(featureQueryIds).not.toContain(NON_CONSENTING_COMPANY);
    expect(featureQueryIds).toContain(CONSENTING_COMPANY);

    // No inserted pattern row may contain raw post content
    for (const row of insertedRows) {
      const patternData = (row as { pattern_data: Record<string, unknown> }).pattern_data;
      expect(patternData).not.toHaveProperty("content");
      expect(patternData).not.toHaveProperty("post_text");
      expect(patternData).not.toHaveProperty("raw_text");
    }
  });

  it("aborts early when fewer than 5 companies consent — writes no patterns", async () => {
    vi.doMock("@/lib/supabase", () => ({
      getServiceRoleClient: () => ({
        from: (table: string) => {
          if (table === "ins_consent") {
            return {
              select: () => ({
                eq: () =>
                  Promise.resolve({
                    data: [
                      { company_id: "c1" },
                      { company_id: "c2" },
                      { company_id: "c3" },
                    ],
                    error: null,
                  }),
              }),
            };
          }
          return {};
        },
      }),
    }));

    const { minePatterns } = await import("@/lib/insights/pattern-miner");
    const result = await minePatterns();

    expect(result.patternsWritten).toBe(0);
    expect(result.companiesContributing).toBe(3);
  });
});
