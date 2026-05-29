import { describe, expect, test, vi, beforeEach } from "vitest";

// B4 — resolve-media unit tests.
//
// Verifies the priority order (asset-derived signed URLs first, legacy
// media_urls appended), dedupe behaviour, and graceful degradation when
// a single asset fails to sign.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const assetsTable: Array<{ id: string; storage_path: string }> = [];
let assetQueryError: { message: string } | null = null;
let signFailingPaths: Set<string> = new Set();

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            in(_field: string, ids: string[]) {
              if (assetQueryError) return Promise.resolve({ data: null, error: assetQueryError });
              return Promise.resolve({
                data: assetsTable.filter((a) => ids.includes(a.id)),
                error: null,
              });
            },
          };
        },
      };
    },
    storage: {
      from(_bucket: string) {
        return {
          async createSignedUrl(path: string, _ttl: number) {
            if (signFailingPaths.has(path)) {
              return { data: null, error: { message: "sign failed" } };
            }
            return { data: { signedUrl: `https://signed.example/${path}?sig=abc` }, error: null };
          },
        };
      },
    },
  }),
}));

import { resolveMediaForPublish } from "@/lib/social/publishing/resolve-media";

beforeEach(() => {
  assetsTable.length = 0;
  assetQueryError = null;
  signFailingPaths = new Set();
  vi.clearAllMocks();
});

describe("resolveMediaForPublish", () => {
  test("empty everything → empty array", async () => {
    const result = await resolveMediaForPublish({
      mediaAssetIds: null,
      legacyMediaUrls: null,
    });
    expect(result).toEqual([]);
  });

  test("only legacy media_urls → returned as-is (no asset query)", async () => {
    const result = await resolveMediaForPublish({
      mediaAssetIds: null,
      legacyMediaUrls: ["https://legacy.example/a.jpg", "https://legacy.example/b.jpg"],
    });
    expect(result).toEqual([
      "https://legacy.example/a.jpg",
      "https://legacy.example/b.jpg",
    ]);
  });

  test("only media_asset_ids → signed URLs returned, in asset-id order", async () => {
    assetsTable.push(
      { id: "asset-a", storage_path: "co/job1/a.jpg" },
      { id: "asset-b", storage_path: "co/job2/b.jpg" },
    );
    const result = await resolveMediaForPublish({
      mediaAssetIds: ["asset-a", "asset-b"],
      legacyMediaUrls: null,
    });
    expect(result).toEqual([
      "https://signed.example/co/job1/a.jpg?sig=abc",
      "https://signed.example/co/job2/b.jpg?sig=abc",
    ]);
  });

  test("both present → asset-derived first, legacy appended, dedupe applied", async () => {
    assetsTable.push({ id: "asset-a", storage_path: "co/job1/a.jpg" });
    const result = await resolveMediaForPublish({
      mediaAssetIds: ["asset-a"],
      legacyMediaUrls: [
        "https://signed.example/co/job1/a.jpg?sig=abc", // dup of signed
        "https://legacy.example/x.jpg",
      ],
    });
    expect(result).toEqual([
      "https://signed.example/co/job1/a.jpg?sig=abc",
      "https://legacy.example/x.jpg",
    ]);
  });

  test("one asset fails to sign → skipped, others kept; never throws", async () => {
    assetsTable.push(
      { id: "asset-good", storage_path: "co/good.jpg" },
      { id: "asset-bad", storage_path: "co/bad.jpg" },
    );
    signFailingPaths.add("co/bad.jpg");

    const result = await resolveMediaForPublish({
      mediaAssetIds: ["asset-good", "asset-bad"],
      legacyMediaUrls: ["https://legacy.example/z.jpg"],
    });

    expect(result).toEqual([
      "https://signed.example/co/good.jpg?sig=abc",
      "https://legacy.example/z.jpg",
    ]);
  });

  test("asset query fails → fall back gracefully (legacy still returned)", async () => {
    assetQueryError = { message: "connection refused" };
    const result = await resolveMediaForPublish({
      mediaAssetIds: ["asset-a"],
      legacyMediaUrls: ["https://legacy.example/x.jpg"],
    });
    expect(result).toEqual(["https://legacy.example/x.jpg"]);
  });

  test("asset id with no matching row → skipped with warn; never throws", async () => {
    assetsTable.push({ id: "asset-a", storage_path: "co/a.jpg" });
    const result = await resolveMediaForPublish({
      mediaAssetIds: ["asset-a", "asset-ghost"],
      legacyMediaUrls: null,
    });
    expect(result).toEqual(["https://signed.example/co/a.jpg?sig=abc"]);
  });

  test("empty arrays (not null) treated identically to null", async () => {
    const result = await resolveMediaForPublish({
      mediaAssetIds: [],
      legacyMediaUrls: [],
    });
    expect(result).toEqual([]);
  });

  test("falsy strings in legacy array are filtered out", async () => {
    const result = await resolveMediaForPublish({
      mediaAssetIds: null,
      legacyMediaUrls: ["valid.com", "", "another.com"],
    });
    expect(result).toEqual(["valid.com", "another.com"]);
  });
});
