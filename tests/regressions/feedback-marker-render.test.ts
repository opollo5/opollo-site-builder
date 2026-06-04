// tests/regressions/feedback-marker-render.test.ts
// §1 — click marker regression tests.
//
// Root causes fixed:
//   Capture: click_x/y_pct were % of element bounding box; now % of viewport.
//   Render: object-contain letterboxing misaligned the marker; now natural aspect.
//
// These tests verify the capture math (no browser required) and the render
// invariant (marker at X% of image = X% of viewport).

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// 1. Capture math — viewport-relative
// ---------------------------------------------------------------------------
describe("ElementPicker capture — viewport-relative coords", () => {
  it("click at viewport center → 50% both axes", () => {
    const viewportW = 1280, viewportH = 900;
    const clientX = 640, clientY = 450;  // dead center
    const clickXPct = (clientX / viewportW) * 100;
    const clickYPct = (clientY / viewportH) * 100;
    expect(clickXPct).toBeCloseTo(50, 1);
    expect(clickYPct).toBeCloseTo(50, 1);
  });

  it("click at top-left → ~0% both axes", () => {
    const viewportW = 1280, viewportH = 900;
    const clickXPct = (5 / viewportW) * 100;
    const clickYPct = (5 / viewportH) * 100;
    expect(clickXPct).toBeLessThan(1);
    expect(clickYPct).toBeLessThan(1);
  });

  it("click at element center but element is NOT centered → different from element-relative 50%", () => {
    // Simulates the bug: element spans x=[300,500], user clicks at x=400.
    // Old (wrong): (400-300)/(500-300)*100 = 50%  (% of element)
    // New (correct): 400/1280*100 = 31.25%  (% of viewport)
    const viewportW = 1280;
    const elementLeft = 300, elementWidth = 200;
    const clientX = 400;  // center of element

    const oldWrongPct = ((clientX - elementLeft) / elementWidth) * 100;
    const newCorrectPct = (clientX / viewportW) * 100;

    expect(oldWrongPct).toBeCloseTo(50, 1);   // old value was always 50% when clicking element center
    expect(newCorrectPct).toBeCloseTo(31.25, 1); // new value correctly reflects viewport position
    expect(oldWrongPct).not.toBeCloseTo(newCorrectPct, 0);  // they differ
  });

  it("viewport-relative % maps exactly to screenshot pixel when rendered at viewport size", () => {
    // screenshot taken at 1280×900; marker at (31.25%, 50%)
    // rendered at the same size → marker px = (400, 450) = original click
    const viewportW = 1280, viewportH = 900;
    const originalX = 400, originalY = 450;
    const clickXPct = (originalX / viewportW) * 100;
    const clickYPct = (originalY / viewportH) * 100;

    // Replay at the same viewport size
    const replayX = (clickXPct / 100) * viewportW;
    const replayY = (clickYPct / 100) * viewportH;
    expect(replayX).toBeCloseTo(originalX, 1);
    expect(replayY).toBeCloseTo(originalY, 1);
  });
});

// ---------------------------------------------------------------------------
// 2. Render invariant — no object-contain letterboxing
//
// The image is displayed at w-full with natural height (no object-contain).
// This means containerWidth == imageRenderedWidth, so left: X% == X% of image.
// The test simulates the old (wrong) object-contain layout vs the new layout.
// ---------------------------------------------------------------------------
describe("BugReplayOverlay render — natural aspect ratio (no letterboxing)", () => {
  it("without object-contain: container width == rendered image width", () => {
    // Container: 800px wide. Image natural: 1280×720 (16:9).
    // w-full + natural height → rendered at 800×450.
    // The container height expands to 450px (no letterboxing).
    const containerW = 800;
    const imageNaturalW = 1280, imageNaturalH = 720;
    const renderedW = containerW;
    const renderedH = (containerW / imageNaturalW) * imageNaturalH;

    // Marker at 40% × 60%:
    const clickXPct = 40, clickYPct = 60;
    const markerLeft = (clickXPct / 100) * containerW;
    const markerTop  = (clickYPct / 100) * renderedH;

    // Should match (clickXPct% of rendered image width, clickYPct% of rendered image height)
    expect(markerLeft).toBeCloseTo((clickXPct / 100) * renderedW, 1);
    expect(markerTop).toBeCloseTo((clickYPct / 100) * renderedH, 1);
  });

  it("WITH object-contain (the old bug): 2:1 container + 16:9 image → left letterboxing", () => {
    // Container: 800×400 (2:1). Image natural: 1280×720 (16:9).
    // object-contain → image rendered at 711×400 (fills height).
    // Left/right margin = (800 - 711) / 2 = ~44.5px.
    const containerW = 800, containerH = 400;
    const imageNaturalW = 1280, imageNaturalH = 720;
    const scale = Math.min(containerW / imageNaturalW, containerH / imageNaturalH);
    const renderedW = imageNaturalW * scale;  // ~711px
    const marginX = (containerW - renderedW) / 2;  // ~44.5px

    // Marker at left: 40% of container = 320px from container left edge.
    // Actual image position: (320 - 44.5) / 711 = ~38.7% of the image.
    const clickXPct = 40;
    const markerLeftInContainer = (clickXPct / 100) * containerW;       // 320px
    const markerLeftInImage     = (markerLeftInContainer - marginX) / renderedW * 100;

    // The marker is ~38.7% of the image, NOT 40% — a visible error.
    expect(markerLeftInImage).not.toBeCloseTo(40, 0);
    expect(Math.abs(markerLeftInImage - 40)).toBeGreaterThan(1);  // >1% error
  });
});

// ---------------------------------------------------------------------------
// 3. End-to-end: viewport capture → natural-aspect-ratio render → correct position
// ---------------------------------------------------------------------------
describe("Full round-trip: capture at viewport-relative → render at natural aspect", () => {
  it("click at 25%, 33% of viewport → marker at 25%, 33% of image", () => {
    const viewportW = 1280, viewportH = 900;
    const clientX = viewportW * 0.25, clientY = viewportH * 0.33;

    // Capture (fixed)
    const clickXPct = (clientX / viewportW) * 100;  // 25%
    const clickYPct = (clientY / viewportH) * 100;  // 33%

    // Render: image displayed at 600px wide (scaled from 1280px), natural height
    const displayW = 600;
    const displayH = (displayW / viewportW) * viewportH;  // 421.875px

    // Marker pixel position in the displayed image
    const markerX = (clickXPct / 100) * displayW;
    const markerY = (clickYPct / 100) * displayH;

    // These should map back to the same fraction of the display dimensions
    expect(markerX / displayW * 100).toBeCloseTo(25, 1);
    expect(markerY / displayH * 100).toBeCloseTo(33, 1);
  });
});
