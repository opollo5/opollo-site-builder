import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// ---------------------------------------------------------------------------
// S1-22 — resolveBundleUploadId against the live Supabase stack with
// a mocked bundle.social SDK.
//
// Covers:
//   - Cache hit: bundle_upload_id already populated → return immediately
//     without calling the SDK.
//   - First resolution: source_url present → uploadCreateFromUrl,
//     stores bundle_upload_id back.
//   - Asset under another company → NOT_FOUND.
//   - Asset with neither source_url nor bundle_upload_id → VALIDATION_FAILED.
//   - SDK throw → INTERNAL_ERROR; cache NOT populated.
//   - resolveBundleUploadIds: batch resolves and counts cached.
// ---------------------------------------------------------------------------

const mockClient = {
  upload: {
    uploadCreateFromUrl: vi.fn(),
  },
};

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => mockClient,
  getBundlesocialTeamId: () => "team-test-1",
}));

import {
  resolveBundleUploadId,
  resolveBundleUploadIds,
} from "@/lib/platform/social/media";
import { getServiceRoleClient } from "@/lib/supabase";

const COMPANY_A = "abcdef00-0000-0000-0000-aaaaaaaa2222";
const COMPANY_B = "abcdef00-0000-0000-0000-bbbbbbbb2222";

async function seedCompanies(): Promise<void> {
  const svc = getServiceRoleClient();
  for (const [id, slug] of [
    [COMPANY_A, "s1-22-a"],
    [COMPANY_B, "s1-22-b"],
  ] as const) {
    const r = await svc.from("platform_companies").insert({
      id,
      name: `S1-22 ${slug}`,
      slug,
      domain: `${slug}.test`,
      is_opollo_internal: false,
      timezone: "Australia/Melbourne",
      approval_default_rule: "any_one",
    });
    if (r.error) throw new Error(`seed company ${slug}: ${r.error.message}`);
  }
}

async function seedAsset(opts: {
  companyId: string;
  sourceUrl?: string | null;
  bundleUploadId?: string | null;
}): Promise<string> {
  const svc = getServiceRoleClient();
  const r = await svc
    .from("social_media_assets")
    .insert({
      company_id: opts.companyId,
      storage_path: `s1-22/${Math.random().toString(36).slice(2, 10)}.jpg`,
      mime_type: "image/jpeg",
      bytes: 1024,
      source_url: opts.sourceUrl ?? null,
      bundle_upload_id: opts.bundleUploadId ?? null,
    })
    .select("id")
    .single();
  if (r.error) throw new Error(`seed asset: ${r.error.message}`);
  return r.data.id as string;
}

beforeEach(async () => {
  mockClient.upload.uploadCreateFromUrl.mockReset();
  await seedCompanies();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveBundleUploadId", () => {
  it("returns cached bundle_upload_id without SDK call", async () => {
    const assetId = await seedAsset({
      companyId: COMPANY_A,
      sourceUrl: "https://cdn.test/a.jpg",
      bundleUploadId: "bup_cached_1",
    });
    const result = await resolveBundleUploadId({
      assetId,
      companyId: COMPANY_A,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.bundleUploadId).toBe("bup_cached_1");
    expect(result.data.cached).toBe(true);
    expect(mockClient.upload.uploadCreateFromUrl).not.toHaveBeenCalled();
  });

  it("uploads from source_url + caches the id", async () => {
    const assetId = await seedAsset({
      companyId: COMPANY_A,
      sourceUrl: "https://cdn.test/b.jpg",
    });
    mockClient.upload.uploadCreateFromUrl.mockResolvedValueOnce({
      id: "bup_fresh_1",
    });

    const result = await resolveBundleUploadId({
      assetId,
      companyId: COMPANY_A,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.bundleUploadId).toBe("bup_fresh_1");
    expect(result.data.cached).toBe(false);

    const callArg =
      mockClient.upload.uploadCreateFromUrl.mock.calls[0]?.[0];
    expect(callArg?.requestBody?.url).toBe("https://cdn.test/b.jpg");
    expect(callArg?.requestBody?.teamId).toBe("team-test-1");

    // Second call returns from cache, no SDK call.
    mockClient.upload.uploadCreateFromUrl.mockReset();
    const second = await resolveBundleUploadId({
      assetId,
      companyId: COMPANY_A,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.cached).toBe(true);
    expect(mockClient.upload.uploadCreateFromUrl).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for asset under another company", async () => {
    const assetId = await seedAsset({
      companyId: COMPANY_B,
      sourceUrl: "https://cdn.test/c.jpg",
    });
    const result = await resolveBundleUploadId({
      assetId,
      companyId: COMPANY_A,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
    expect(mockClient.upload.uploadCreateFromUrl).not.toHaveBeenCalled();
  });

  it("returns VALIDATION_FAILED when neither source_url nor cache present", async () => {
    const assetId = await seedAsset({ companyId: COMPANY_A });
    const result = await resolveBundleUploadId({
      assetId,
      companyId: COMPANY_A,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns INTERNAL_ERROR on SDK throw; cache NOT populated", async () => {
    const assetId = await seedAsset({
      companyId: COMPANY_A,
      sourceUrl: "https://cdn.test/d.jpg",
    });
    mockClient.upload.uploadCreateFromUrl.mockRejectedValueOnce(
      new Error("HTTP 500"),
    );

    const result = await resolveBundleUploadId({
      assetId,
      companyId: COMPANY_A,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INTERNAL_ERROR");

    const svc = getServiceRoleClient();
    const row = await svc
      .from("social_media_assets")
      .select("bundle_upload_id")
      .eq("id", assetId)
      .single();
    expect(row.data?.bundle_upload_id).toBeNull();
  });
});

describe("resolveBundleUploadIds (batch)", () => {
  it("resolves multiple assets and counts cached vs fresh", async () => {
    const cachedId = await seedAsset({
      companyId: COMPANY_A,
      sourceUrl: "https://cdn.test/cached.jpg",
      bundleUploadId: "bup_cached",
    });
    const freshId = await seedAsset({
      companyId: COMPANY_A,
      sourceUrl: "https://cdn.test/fresh.jpg",
    });
    mockClient.upload.uploadCreateFromUrl.mockResolvedValueOnce({
      id: "bup_fresh",
    });

    const result = await resolveBundleUploadIds(
      [cachedId, freshId],
      COMPANY_A,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.uploadIds).toEqual(["bup_cached", "bup_fresh"]);
    expect(result.data.cachedCount).toBe(1);
    expect(mockClient.upload.uploadCreateFromUrl).toHaveBeenCalledTimes(1);
  });

  it("aborts on first failure", async () => {
    const okId = await seedAsset({
      companyId: COMPANY_A,
      sourceUrl: "https://cdn.test/ok.jpg",
      bundleUploadId: "bup_ok",
    });
    const badId = await seedAsset({ companyId: COMPANY_A });

    const result = await resolveBundleUploadIds([okId, badId], COMPANY_A);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });
});
