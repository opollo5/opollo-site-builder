import { describe, expect, it } from "vitest";

import { detectImageSource } from "@/lib/images/source-detection";

describe("detectImageSource", () => {
  it("detects istock-<id>.jpg as istock with numeric sourceRef", () => {
    expect(detectImageSource("istock-1234567890.jpg")).toEqual({
      source: "istock",
      sourceRef: "1234567890",
    });
  });

  it("detects istock_<id>.jpeg with underscore separator", () => {
    expect(detectImageSource("istock_9876543.jpeg")).toEqual({
      source: "istock",
      sourceRef: "9876543",
    });
  });

  it("is case-insensitive (iStock-...)", () => {
    expect(detectImageSource("iStock-2216481617.png")).toEqual({
      source: "istock",
      sourceRef: "2216481617",
    });
  });

  it("strips extension before matching", () => {
    expect(detectImageSource("istock-123456.webp")).toEqual({
      source: "istock",
      sourceRef: "123456",
    });
  });

  it("returns upload for a generic photo filename", () => {
    expect(detectImageSource("hero-banner.jpg")).toEqual({
      source: "upload",
      sourceRef: "hero-banner.jpg",
    });
  });

  it("returns upload when istock prefix has fewer than 6 digits", () => {
    // parseIstockIdFromFilename requires 6+ digit IDs
    expect(detectImageSource("istock-123.jpg")).toEqual({
      source: "upload",
      sourceRef: "istock-123.jpg",
    });
  });

  it("returns upload when istock is not adjacent to digits", () => {
    expect(detectImageSource("istock-photo.jpg")).toEqual({
      source: "upload",
      sourceRef: "istock-photo.jpg",
    });
  });

  it("preserves full filename as sourceRef for upload rows", () => {
    const result = detectImageSource("portrait.png");
    expect(result.sourceRef).toBe("portrait.png");
  });
});
