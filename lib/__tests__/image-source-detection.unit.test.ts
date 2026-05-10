import { describe, expect, it } from "vitest";

import { detectImageSource } from "@/lib/images/source-detection";

describe("detectImageSource", () => {
  it("detects istock-<id>.jpg as istock with numeric source_ref", () => {
    expect(detectImageSource("istock-1234567890.jpg")).toEqual({
      source: "istock",
      source_ref: "1234567890",
    });
  });

  it("detects istock_<id>.jpeg with underscore separator", () => {
    expect(detectImageSource("istock_9876543.jpeg")).toEqual({
      source: "istock",
      source_ref: "9876543",
    });
  });

  it("is case-insensitive (iStock-...)", () => {
    expect(detectImageSource("iStock-2216481617.png")).toEqual({
      source: "istock",
      source_ref: "2216481617",
    });
  });

  it("strips extension before matching", () => {
    expect(detectImageSource("istock-123456.webp")).toEqual({
      source: "istock",
      source_ref: "123456",
    });
  });

  it("returns upload for a generic photo filename", () => {
    expect(detectImageSource("hero-banner.jpg")).toEqual({
      source: "upload",
      source_ref: "hero-banner.jpg",
    });
  });

  it("returns upload when istock prefix has fewer than 6 digits", () => {
    expect(detectImageSource("istock-123.jpg")).toEqual({
      source: "upload",
      source_ref: "istock-123.jpg",
    });
  });

  it("returns upload when istock is not adjacent to digits", () => {
    expect(detectImageSource("istock-photo.jpg")).toEqual({
      source: "upload",
      source_ref: "istock-photo.jpg",
    });
  });

  it("preserves full filename as source_ref for upload rows", () => {
    const result = detectImageSource("portrait.png");
    expect(result.source_ref).toBe("portrait.png");
  });
});
