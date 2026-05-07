import { describe, expect, it } from "vitest";

import { generateImageFilename } from "@/lib/utils/slugify";

describe("generateImageFilename", () => {
  it("uses the first 5 words from the post title", () => {
    expect(
      generateImageFilename(
        "AI in the wild — what MSPs need to know",
        "IMG_4567.jpg",
        0,
        "post_abc",
      ),
    ).toMatch(/^ai-in-the-wild-what-[a-f0-9]{4}\.jpg$/);
  });

  it("appends -2 / -3 suffix for subsequent images", () => {
    const second = generateImageFilename(
      "AI in the wild — what MSPs need to know",
      "IMG_4567.jpg",
      1,
      "post_abc",
    );
    expect(second).toMatch(/^ai-in-the-wild-what-2-[a-f0-9]{4}\.jpg$/);
  });

  it("preserves the original file extension", () => {
    expect(
      generateImageFilename("Hello world", "photo.PNG", 0, "post_x"),
    ).toMatch(/\.png$/);
  });

  it("falls back to .jpg when the original filename is missing or extensionless", () => {
    expect(generateImageFilename("Hi", "noext", 0, "p")).toMatch(/\.jpg$/);
    expect(generateImageFilename("Hi", null, 0, "p")).toMatch(/\.jpg$/);
    expect(generateImageFilename("Hi", undefined, 0, "p")).toMatch(/\.jpg$/);
  });

  it("is deterministic for the same (postId, imageIndex)", () => {
    const a = generateImageFilename("Same title", "x.jpg", 0, "post_xyz");
    const b = generateImageFilename("Same title", "x.jpg", 0, "post_xyz");
    expect(a).toBe(b);
  });

  it("differs between posts with the same title (collision-resistance)", () => {
    const a = generateImageFilename("Same title", "x.jpg", 0, "post_alpha");
    const b = generateImageFilename("Same title", "x.jpg", 0, "post_beta");
    expect(a).not.toBe(b);
  });

  it("differs between imageIndex 0 and 1 even for the same post", () => {
    const a = generateImageFilename("T", "x.jpg", 0, "post_z");
    const b = generateImageFilename("T", "x.jpg", 1, "post_z");
    expect(a).not.toBe(b);
  });

  it("strips non-ASCII / punctuation from the slug", () => {
    expect(
      generateImageFilename("Café — résumé", "x.jpg", 0, "post_q"),
    ).toMatch(/^[a-z0-9-]+\.jpg$/);
  });

  it("caps total length at 80 chars", () => {
    const longTitle = "supercalifragilisticexpialidocious " + "word ".repeat(20);
    const result = generateImageFilename(longTitle, "x.jpg", 0, "post_long");
    expect(result.length).toBeLessThanOrEqual(80);
  });

  it("falls back to 'image' for an empty title", () => {
    expect(generateImageFilename("", "x.jpg", 0, "post_e")).toMatch(/^image-[a-f0-9]{4}\.jpg$/);
  });

  it("works without a postId (falls back to slug-based hash)", () => {
    expect(
      generateImageFilename("Hello world", "x.jpg", 0),
    ).toMatch(/^hello-world-[a-f0-9]{4}\.jpg$/);
  });
});
