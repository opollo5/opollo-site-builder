import { describe, expect, it } from "vitest";

import {
  parseIstockIdFromFilename,
  readImageDimensions,
} from "@/lib/image-dimensions";

function buildPng(width: number, height: number): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdrLen = [0x00, 0x00, 0x00, 0x0d];
  const ihdrType = [0x49, 0x48, 0x44, 0x52];
  const w = [
    (width >>> 24) & 0xff,
    (width >>> 16) & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
  ];
  const h = [
    (height >>> 24) & 0xff,
    (height >>> 16) & 0xff,
    (height >>> 8) & 0xff,
    height & 0xff,
  ];
  return new Uint8Array([
    ...sig,
    ...ihdrLen,
    ...ihdrType,
    ...w,
    ...h,
    0x08,
    0x02,
    0x00,
    0x00,
    0x00,
  ]);
}

function buildJpegSof0(width: number, height: number): Uint8Array {
  const soi = [0xff, 0xd8];
  const app0 = [0xff, 0xe0, 0x00, 0x10];
  const jfifPad = new Array(14).fill(0);
  const sof0Marker = [0xff, 0xc0];
  const sof0Len = [0x00, 0x11];
  const precision = [0x08];
  const heightBytes = [(height >> 8) & 0xff, height & 0xff];
  const widthBytes = [(width >> 8) & 0xff, width & 0xff];
  const components = new Array(11).fill(0);
  return new Uint8Array([
    ...soi,
    ...app0,
    ...jfifPad,
    ...sof0Marker,
    ...sof0Len,
    ...precision,
    ...heightBytes,
    ...widthBytes,
    ...components,
  ]);
}

function buildGif(width: number, height: number): Uint8Array {
  const header = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
  const w = [width & 0xff, (width >> 8) & 0xff];
  const h = [height & 0xff, (height >> 8) & 0xff];
  return new Uint8Array([...header, ...w, ...h, 0x00, 0x00, 0x00]);
}

describe("readImageDimensions", () => {
  it("parses PNG width and height from IHDR", () => {
    expect(readImageDimensions(buildPng(640, 480))).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("parses JPEG width and height from SOF0", () => {
    expect(readImageDimensions(buildJpegSof0(800, 600))).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("parses GIF width and height from logical screen descriptor", () => {
    expect(readImageDimensions(buildGif(120, 90))).toEqual({
      width: 120,
      height: 90,
    });
  });

  it("returns null for an unrecognised header", () => {
    const garbage = new Uint8Array(64).fill(0x00);
    expect(readImageDimensions(garbage)).toBeNull();
  });

  it("returns null when the input is too short", () => {
    expect(readImageDimensions(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});

describe("parseIstockIdFromFilename", () => {
  it("extracts the numeric id from the canonical iStock filename", () => {
    expect(parseIstockIdFromFilename("iStock-2216481617.jpg")).toBe(
      "2216481617",
    );
  });

  it("matches the underscore variant case-insensitively", () => {
    expect(parseIstockIdFromFilename("istock_1234567890_v1.jpeg")).toBe(
      "1234567890",
    );
  });

  it("returns null when the filename has no iStock prefix", () => {
    expect(parseIstockIdFromFilename("hero-shot.jpg")).toBeNull();
  });

  it("returns null for a null filename", () => {
    expect(parseIstockIdFromFilename(null)).toBeNull();
  });
});
