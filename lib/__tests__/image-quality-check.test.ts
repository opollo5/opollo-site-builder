import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  qualityCheck,
  selectOverlayColour,
} from "@/lib/image/failure/quality-check";

// Create a synthetic JPEG with a uniform greyscale fill.
// luminance = 0–255; size is 200×200px so it exceeds the 50 KB floor only
// if we use a large enough image. We use 400×400 + high quality to be safe.
async function syntheticImage(
  luminance: number,
  width = 400,
  height = 400,
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: luminance, g: luminance, b: luminance },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

// Create a noisy image (random pixel values) to trigger high Laplacian variance.
async function noisyImage(width = 400, height = 400): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = Math.floor(Math.random() * 256);
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe("selectOverlayColour", () => {
  it("returns white for dark zones (luminance < 160)", () => {
    expect(selectOverlayColour(50)).toBe("white");
    expect(selectOverlayColour(159)).toBe("white");
  });

  it("returns dark for light zones (luminance > 180)", () => {
    expect(selectOverlayColour(181)).toBe("dark");
    expect(selectOverlayColour(255)).toBe("dark");
  });

  it("returns overlay for mid-grey zones (160–180)", () => {
    expect(selectOverlayColour(160)).toBe("overlay");
    expect(selectOverlayColour(170)).toBe("overlay");
    expect(selectOverlayColour(180)).toBe("overlay");
  });
});

describe("qualityCheck", () => {
  it("fails tiny buffers (< 50 KB)", async () => {
    const tiny = Buffer.alloc(1000, 0);
    const result = await qualityCheck(tiny, "split_layout");
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/too small/i);
  });

  it("passes for a dark uniform image (luminance 80)", async () => {
    const buf = await syntheticImage(80);
    // Dark image → luminance < 160 → luminanceOk. Uniform → low Laplacian → safeZoneOk.
    const result = await qualityCheck(buf, "split_layout");
    expect(result.passed).toBe(true);
    // Luminance score should be near 80
    expect(result.luminanceScore).toBeGreaterThan(50);
    expect(result.luminanceScore).toBeLessThan(120);
  });

  it("passes for a light uniform image (luminance 220)", async () => {
    const buf = await syntheticImage(220);
    const result = await qualityCheck(buf, "gradient_fade");
    expect(result.passed).toBe(true);
    expect(result.luminanceScore).toBeGreaterThan(180);
  });

  it("fails for a mid-grey uniform image with no safe zone (luminance 170)", async () => {
    const buf = await syntheticImage(170);
    // Luminance in 160–180 range → luminanceOk=false → fails
    const result = await qualityCheck(buf, "full_background");
    expect(result.passed).toBe(false);
  });

  it("returns a reason string on failure", async () => {
    const buf = await syntheticImage(170);
    const result = await qualityCheck(buf, "full_background");
    expect(result.reason).toBeDefined();
    expect(result.reason).toMatch(/luminance/i);
  });

  it("all composition types are handled without throwing", async () => {
    const buf = await syntheticImage(80);
    const types = [
      "split_layout",
      "gradient_fade",
      "full_background",
      "geometric",
      "texture",
    ] as const;
    for (const t of types) {
      await expect(qualityCheck(buf, t)).resolves.toBeDefined();
    }
  });
});
