import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMediaAsset,
  listMediaAssets,
} from "@/lib/platform/social/media";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// S1-23 — createMediaAsset + listMediaAssets against the live
// Supabase stack. fetch is mocked to avoid hitting the network for
// HEAD probes.
// ---------------------------------------------------------------------------

const COMPANY_A = "abcdef00-0000-0000-0000-aaaaaaaa2323";
const COMPANY_B = "abcdef00-0000-0000-0000-bbbbbbbb2323";

beforeEach(async () => {
  vi.restoreAllMocks();
  // Default: HEAD returns 404 so the lib falls through to defaults.
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 404 }),
  );

  const svc = getServiceRoleClient();
  for (const [id, slug] of [
    [COMPANY_A, "s1-23-a"],
    [COMPANY_B, "s1-23-b"],
  ] as const) {
    const r = await svc.from("platform_companies").insert({
      id,
      name: `S1-23 ${slug}`,
      slug,
      domain: `${slug}.test`,
      is_opollo_internal: false,
      timezone: "Australia/Melbourne",
      approval_default_rule: "any_one",
    });
    if (r.error) throw new Error(`seed company ${slug}: ${r.error.message}`);
  }
});

describe("createMediaAsset", () => {
  it("rejects http urls (https-only enforced)", async () => {
    const result = await createMediaAsset({
      companyId: COMPANY_A,
      sourceUrl: "http://insecure.test/a.jpg",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("creates an asset with operator-supplied mime + bytes when HEAD fails", async () => {
    const result = await createMediaAsset({
      companyId: COMPANY_A,
      sourceUrl: "https://cdn.test/a.jpg",
      mimeType: "image/jpeg",
      bytes: 12345,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.mime_type).toBe("image/jpeg");
    expect(result.data.bytes).toBe(12345);
    expect(result.data.source_url).toBe("https://cdn.test/a.jpg");
  });

  it("uses HEAD response for mime + bytes when probe succeeds", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: {
          "content-type": "image/png; charset=binary",
          "content-length": "98765",
        },
      }),
    );

    const result = await createMediaAsset({
      companyId: COMPANY_A,
      sourceUrl: "https://cdn.test/b.png",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.mime_type).toBe("image/png");
    expect(result.data.bytes).toBe(98765);
  });
});

describe("listMediaAssets", () => {
  it("returns assets newest first, scoped to company", async () => {
    await createMediaAsset({
      companyId: COMPANY_A,
      sourceUrl: "https://cdn.test/older.jpg",
      mimeType: "image/jpeg",
      bytes: 1,
    });
    await createMediaAsset({
      companyId: COMPANY_A,
      sourceUrl: "https://cdn.test/newer.jpg",
      mimeType: "image/jpeg",
      bytes: 2,
    });
    await createMediaAsset({
      companyId: COMPANY_B,
      sourceUrl: "https://cdn.test/other-co.jpg",
      mimeType: "image/jpeg",
      bytes: 3,
    });

    const result = await listMediaAssets({ companyId: COMPANY_A });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.assets.length).toBe(2);
    expect(result.data.assets[0]?.source_url).toBe("https://cdn.test/newer.jpg");
    expect(result.data.assets[1]?.source_url).toBe("https://cdn.test/older.jpg");
  });

  it("returns empty for a company with no assets", async () => {
    const result = await listMediaAssets({ companyId: COMPANY_B });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.assets).toEqual([]);
  });
});
