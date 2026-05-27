import { describe, expect, it, vi, beforeEach, type MockedFunction } from "vitest";

import type { GeneratedImage } from "@/lib/image/types";

// ---------------------------------------------------------------------------
// S-5 — unit tests for triggerCAPImageGen.
//
// Verifies that the `bytes` column in the social_media_assets insert reflects
// the actual image buffer length, not the hard-coded 0 that was there before.
//
// All Supabase + image-gen calls are mocked — no real credentials needed.
// ---------------------------------------------------------------------------

vi.mock("@/lib/image", () => ({
  generateWithFallback: vi.fn(),
  getAllowedStyles: vi.fn().mockReturnValue(["clean_corporate"]),
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

import { generateWithFallback } from "@/lib/image";
import { getServiceRoleClient } from "@/lib/supabase";
import { triggerCAPImageGen } from "@/lib/platform/social/cap/image-trigger";

const mockGenerate = generateWithFallback as MockedFunction<typeof generateWithFallback>;
const mockGetSvc = getServiceRoleClient as MockedFunction<typeof getServiceRoleClient>;

function makeMockSvc(overrides?: {
  signedUrlError?: boolean;
  assetInsertError?: boolean;
  draftUpdateError?: boolean;
}) {
  const mockSingle = vi.fn().mockResolvedValue(
    overrides?.assetInsertError
      ? { data: null, error: { message: "insert failed" } }
      : { data: { id: "asset-uuid-1" }, error: null },
  );
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });

  const mockEq = vi.fn().mockResolvedValue(
    overrides?.draftUpdateError
      ? { error: { message: "update failed" } }
      : { error: null },
  );
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });

  const mockCreateSignedUrl = vi.fn().mockResolvedValue(
    overrides?.signedUrlError
      ? { data: null, error: { message: "signed url error" } }
      : { data: { signedUrl: "https://storage.example.com/img.jpeg" }, error: null },
  );
  const mockStorageFrom = vi.fn().mockReturnValue({ createSignedUrl: mockCreateSignedUrl });

  const svc = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "social_media_assets") return { insert: mockInsert };
      if (table === "social_post_drafts") return { update: mockUpdate };
      return {};
    }),
    storage: { from: mockStorageFrom },
  };

  return { svc, mockInsert, mockSelect, mockSingle, mockUpdate, mockEq, mockCreateSignedUrl };
}

const FAKE_BUFFER = Buffer.from("fake-image-bytes-1234");

function makeFakeImage(bufferOverride?: Buffer): GeneratedImage {
  return {
    storagePath: "company-id/generated/test-img.jpeg",
    width: 1024,
    height: 1024,
    format: "jpeg",
    buffer: bufferOverride ?? FAKE_BUFFER,
  };
}

beforeEach(() => {
  process.env.IDEOGRAM_API_KEY = "test-key-not-real";
  vi.clearAllMocks();
});

describe("triggerCAPImageGen", () => {
  it("inserts social_media_assets with bytes = buffer.length (S-5 fix)", async () => {
    const { svc, mockInsert } = makeMockSvc();
    mockGetSvc.mockReturnValue(svc as never);
    mockGenerate.mockResolvedValue([makeFakeImage()]);

    await triggerCAPImageGen({
      companyId: "company-id",
      draftId: "draft-id-1",
      brand: null,
    });

    expect(mockInsert).toHaveBeenCalledOnce();
    const insertArg = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.bytes).toBe(FAKE_BUFFER.length);
    expect(insertArg.bytes).toBeGreaterThan(0);
  });

  it("skips silently when IDEOGRAM_API_KEY is unset", async () => {
    delete process.env.IDEOGRAM_API_KEY;
    const { svc, mockInsert } = makeMockSvc();
    mockGetSvc.mockReturnValue(svc as never);

    await expect(
      triggerCAPImageGen({ companyId: "c", draftId: "d", brand: null }),
    ).resolves.toBeUndefined();

    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("returns without throwing when generateWithFallback throws", async () => {
    const { svc, mockInsert } = makeMockSvc();
    mockGetSvc.mockReturnValue(svc as never);
    mockGenerate.mockRejectedValue(new Error("Ideogram unreachable"));

    await expect(
      triggerCAPImageGen({ companyId: "c", draftId: "d", brand: null }),
    ).resolves.toBeUndefined();

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("returns without throwing when generateWithFallback returns empty array", async () => {
    const { svc, mockInsert } = makeMockSvc();
    mockGetSvc.mockReturnValue(svc as never);
    mockGenerate.mockResolvedValue([]);

    await expect(
      triggerCAPImageGen({ companyId: "c", draftId: "d", brand: null }),
    ).resolves.toBeUndefined();

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("returns without throwing when signed URL creation fails", async () => {
    const { svc, mockInsert } = makeMockSvc({ signedUrlError: true });
    mockGetSvc.mockReturnValue(svc as never);
    mockGenerate.mockResolvedValue([makeFakeImage()]);

    await expect(
      triggerCAPImageGen({ companyId: "c", draftId: "d", brand: null }),
    ).resolves.toBeUndefined();

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("falls back to bytes=0 when buffer is absent from GeneratedImage", async () => {
    const { svc, mockInsert } = makeMockSvc();
    mockGetSvc.mockReturnValue(svc as never);
    const imageWithoutBuffer: GeneratedImage = {
      storagePath: "company-id/generated/stock.jpeg",
      width: 800,
      height: 800,
      format: "jpeg",
    };
    mockGenerate.mockResolvedValue([imageWithoutBuffer]);

    await triggerCAPImageGen({ companyId: "c", draftId: "d", brand: null });

    const insertArg = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.bytes).toBe(0);
  });

  it("links the new asset to all post variants", async () => {
    const { svc, mockEq } = makeMockSvc();
    mockGetSvc.mockReturnValue(svc as never);
    mockGenerate.mockResolvedValue([makeFakeImage()]);

    await triggerCAPImageGen({
      companyId: "company-id",
      draftId: "draft-id-1",
      brand: null,
    });

    expect(mockEq).toHaveBeenCalledWith("id", "draft-id-1");
  });
});
