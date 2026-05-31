/**
 * Golden-image test fixture templates (E7).
 *
 * These are small synthetic templates covering all V1 layer types and
 * key rendering features. They are designed to be fast to render
 * (small canvas, no external image fetches) and visually distinctive.
 *
 * Render characteristics:
 *  - fixture-text-basic: text-fit, alignment, background_color
 *  - fixture-text-secondary: *asterisks* secondary style parsing
 *  - fixture-text-glyph-bg: glyph-hugging per-line background (the "pink pill")
 *  - fixture-rectangle-solid: solid fill + border_radius + border
 *  - fixture-rectangle-gradient: linear gradient fill
 *  - fixture-composite: multi-layer (rect bg + text + rect overlay)
 */

import type { Template, ShapeLayer } from "@/lib/image/template-model";
import { TEMPLATE_SCHEMA_VERSION } from "@/lib/image/template-model";

const BASE: Pick<Template, "version" | "orientation" | "groups" | "fonts" | "variants" | "render_settings" | "settings"> = {
  version: TEMPLATE_SCHEMA_VERSION,
  orientation: "landscape",
  groups: [],
  fonts: [],
  variants: [],
  render_settings: { format: "png", quality: 100, scale: 1, dpi: 72 },
  settings: { guides: false },
};

const CONSTRAINTS_FIXED = { horizontal: "left" as const, vertical: "top" as const };
const LAYER_BASE = {
  rotation: 0, rotate_x: 0, rotate_y: 0, rotate_z: 0,
  skew_x: 0, skew_y: 0, opacity: 1,
  locked: false, hide: false, hide_when_empty: false,
  lock_aspect_ratio: false, description: "", group: null,
  constraints: CONSTRAINTS_FIXED,
};

// ─── fixture-text-basic ───────────────────────────────────────────────────────

export const FIXTURE_TEXT_BASIC: Template = {
  ...BASE,
  id: "fixture-text-basic",
  name: "Text Basic",
  width: 400, height: 200,
  background_color: "#1E3A5F",
  layers: [
    {
      ...LAYER_BASE,
      id: "l_title", name: "title", type: "text",
      x: 20, y: 20, width: 360, height: 160,
      text: "Hello World",
      font_family: "Inter", font_size: 48, font_weight: 700,
      color: "#FFFFFF",
      text_align_h: "center", text_align_v: "center",
      letter_spacing: 0, line_height: 1.2,
      text_transform: "none", text_decoration: "none",
      word_break: "normal", style: "", direction: "ltr",
      text_fit: { enabled: true, min_size: 16, max_size: 64, max_lines: 3 },
      truncate: false,
      text_box: { padding: null, border: null },
      background: { color: null, border: null, border_width: null, padding_h: 0, padding_v: 0, shadow: null, radius: null, shift: null },
      secondary: { font_family: null, color: null },
    },
  ],
};

// ─── fixture-text-secondary ───────────────────────────────────────────────────

export const FIXTURE_TEXT_SECONDARY: Template = {
  ...BASE,
  id: "fixture-text-secondary",
  name: "Text Secondary Styles",
  width: 640, height: 160,
  background_color: "#2B0B5E",
  layers: [
    {
      ...LAYER_BASE,
      id: "l_headline", name: "headline", type: "text",
      x: 20, y: 20, width: 600, height: 120,
      text: "Mindset Shifts That *Matter*",
      font_family: "Inter", font_size: 48, font_weight: 900,
      color: "#FFFFFF",
      text_align_h: "center", text_align_v: "center",
      letter_spacing: -2, line_height: 1.1,
      text_transform: "uppercase", text_decoration: "none",
      word_break: "normal", style: "", direction: "ltr",
      text_fit: { enabled: true, min_size: 24, max_size: 60, max_lines: 2 },
      truncate: false,
      text_box: { padding: null, border: null },
      background: { color: null, border: null, border_width: null, padding_h: 0, padding_v: 0, shadow: null, radius: null, shift: null },
      secondary: { font_family: null, color: "#FF89FF" },
    },
  ],
};

// ─── fixture-text-glyph-bg ────────────────────────────────────────────────────

export const FIXTURE_TEXT_GLYPH_BG: Template = {
  ...BASE,
  id: "fixture-text-glyph-bg",
  name: "Text Glyph-Hugging Background",
  width: 500, height: 200,
  background_color: "#0F172A",
  layers: [
    {
      ...LAYER_BASE,
      id: "l_pill", name: "episode_label", type: "text",
      x: 20, y: 60, width: 460, height: 80,
      text: "EPISODE 42",
      font_family: "Inter", font_size: 28, font_weight: 700,
      color: "#FFFFFF",
      text_align_h: "center", text_align_v: "center",
      letter_spacing: 2, line_height: 1.2,
      text_transform: "uppercase", text_decoration: "none",
      word_break: "normal", style: "", direction: "ltr",
      text_fit: { enabled: false, min_size: 16, max_size: 40, max_lines: 1 },
      truncate: false,
      text_box: { padding: null, border: null },
      background: {
        color: "#7C3AED",
        border: null, border_width: null,
        padding_h: 16, padding_v: 6,
        shadow: null, radius: 20, shift: null,
      },
      secondary: { font_family: null, color: null },
    },
  ],
};

// ─── fixture-rectangle-solid ──────────────────────────────────────────────────

export const FIXTURE_RECTANGLE_SOLID: Template = {
  ...BASE,
  id: "fixture-rectangle-solid",
  name: "Rectangle Solid Fill",
  width: 300, height: 300,
  background_color: "#F8FAFC",
  layers: [
    {
      ...LAYER_BASE,
      id: "l_card", name: "card", type: "rectangle",
      x: 30, y: 30, width: 240, height: 240,
      color: "#7C3AED",
      gradient: null,
      border_radius: 24,
      border: { color: "#5B21B6", width: 3, style: "solid" as const },
    },
  ],
};

// ─── fixture-rectangle-gradient ───────────────────────────────────────────────

export const FIXTURE_RECTANGLE_GRADIENT: Template = {
  ...BASE,
  id: "fixture-rectangle-gradient",
  name: "Rectangle Linear Gradient",
  width: 400, height: 200,
  background_color: "#FFFFFF",
  layers: [
    {
      ...LAYER_BASE,
      id: "l_grad", name: "gradient_band", type: "rectangle",
      x: 0, y: 0, width: 400, height: 200,
      color: null,
      gradient: {
        type: "linear" as const,
        angle: 135,
        stops: [
          { color: "#7C3AED", position: 0 },
          { color: "#DB2777", position: 1 },
        ],
      },
      border_radius: 0,
      border: null,
    },
  ],
};

// ─── fixture-composite ────────────────────────────────────────────────────────

export const FIXTURE_COMPOSITE: Template = {
  ...BASE,
  id: "fixture-composite",
  name: "Multi-Layer Composite",
  width: 500, height: 280,
  background_color: "#111827",
  layers: [
    // Top layer (rendered on top): text
    {
      ...LAYER_BASE,
      id: "l_title", name: "title", type: "text",
      x: 20, y: 180, width: 460, height: 80,
      text: "Social Media *Post*",
      font_family: "Inter", font_size: 32, font_weight: 700,
      color: "#FFFFFF",
      text_align_h: "left", text_align_v: "center",
      letter_spacing: 0, line_height: 1.2,
      text_transform: "none", text_decoration: "none",
      word_break: "normal", style: "", direction: "ltr",
      text_fit: { enabled: true, min_size: 18, max_size: 40, max_lines: 2 },
      truncate: false,
      text_box: { padding: null, border: null },
      background: { color: null, border: null, border_width: null, padding_h: 0, padding_v: 0, shadow: null, radius: null, shift: null },
      secondary: { font_family: null, color: "#F59E0B" },
    },
    // Middle layer: semi-transparent overlay band
    {
      ...LAYER_BASE,
      id: "l_overlay", name: "overlay_band", type: "rectangle",
      x: 0, y: 160, width: 500, height: 120,
      opacity: 0.85,
      color: "#1F2937",
      gradient: null, border_radius: 0, border: null,
    },
    // Bottom layer: gradient background
    {
      ...LAYER_BASE,
      id: "l_bg", name: "background", type: "rectangle",
      x: 0, y: 0, width: 500, height: 280,
      color: null,
      gradient: {
        type: "linear" as const,
        angle: 45,
        stops: [
          { color: "#7C3AED", position: 0 },
          { color: "#2563EB", position: 1 },
        ],
      },
      border_radius: 0, border: null,
    },
  ],
};

// ─── Shape layer fixtures (S-renderer) ───────────────────────────────────────

const SHAPE_BASE: Omit<ShapeLayer, "id" | "name" | "shapeKind" | "color" | "gradient" | "border"> = {
  type: "shape",
  x: 50, y: 50, width: 300, height: 200,
  rotation: 0, rotate_x: 0, rotate_y: 0, rotate_z: 0,
  skew_x: 0, skew_y: 0, opacity: 1,
  locked: false, hide: false, hide_when_empty: false,
  lock_aspect_ratio: false, description: "", group: null,
  constraints: CONSTRAINTS_FIXED,
};

export const FIXTURE_SHAPE_ELLIPSE: Template = {
  ...BASE,
  id: "fixture-shape-ellipse",
  name: "Shape Ellipse",
  width: 400, height: 300,
  orientation: "landscape",
  background_color: "#1e1b4b",
  layers: [{
    ...SHAPE_BASE,
    id: "s_ellipse", name: "ellipse", shapeKind: "ellipse",
    color: "#818cf8",
    gradient: null,
    border: { color: "#ffffff", width: 3, style: "solid" },
  }],
};

export const FIXTURE_SHAPE_TRIANGLE: Template = {
  ...BASE,
  id: "fixture-shape-triangle",
  name: "Shape Triangle",
  width: 400, height: 300,
  orientation: "landscape",
  background_color: "#064e3b",
  layers: [{
    ...SHAPE_BASE,
    id: "s_tri", name: "triangle", shapeKind: "triangle",
    color: "#34d399",
    gradient: null,
    border: null,
  }],
};

export const FIXTURE_SHAPE_LINE: Template = {
  ...BASE,
  id: "fixture-shape-line",
  name: "Shape Line",
  width: 400, height: 100,
  orientation: "landscape",
  background_color: "#1f2937",
  layers: [{
    ...SHAPE_BASE,
    id: "s_line", name: "line", shapeKind: "line",
    x: 50, y: 45, width: 300, height: 10, // height = stroke width
    color: "#f59e0b",
    gradient: null,
    border: null,
  }],
};

export const FIXTURE_SHAPE_DIAMOND: Template = {
  ...BASE,
  id: "fixture-shape-diamond",
  name: "Shape Diamond",
  width: 400, height: 300,
  orientation: "landscape",
  background_color: "#4c1d95",
  layers: [{
    ...SHAPE_BASE,
    id: "s_diamond", name: "diamond", shapeKind: "diamond",
    color: null,
    gradient: {
      type: "linear",
      angle: 45,
      stops: [
        { color: "#f9a8d4", position: 0 },
        { color: "#c084fc", position: 1 },
      ],
    },
    border: null,
  }],
};

export const ALL_FIXTURES: Template[] = [
  FIXTURE_TEXT_BASIC,
  FIXTURE_TEXT_SECONDARY,
  FIXTURE_TEXT_GLYPH_BG,
  FIXTURE_RECTANGLE_SOLID,
  FIXTURE_RECTANGLE_GRADIENT,
  FIXTURE_COMPOSITE,
  // Shape layer fixtures (S-renderer)
  FIXTURE_SHAPE_ELLIPSE,
  FIXTURE_SHAPE_TRIANGLE,
  FIXTURE_SHAPE_LINE,
  FIXTURE_SHAPE_DIAMOND,
];
