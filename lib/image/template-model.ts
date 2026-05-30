/**
 * Layer-based template model — v2 schema.
 *
 * Design spec: docs/briefs/image-generator/v1.1/TEMPLATE_EDITOR_DESIGN_v3.md
 * Build brief: docs/briefs/image-generator/v2-editor/MASS_IMAGE_GEN_EDITOR_v2_BUILD_BRIEF.md
 *
 * This file is the single source of truth for the layer model.  Every consumer
 * (renderer, editor, API, migration helpers) imports from here.  It is
 * deliberately free of server-only imports so it can be used in both
 * client and server contexts.
 *
 * Layer types implemented in V1: text, image, rectangle.
 * Remaining types (svg, qr, barcode, chart) are schema-reserved for post-V1.
 */

// ─── Schema version ───────────────────────────────────────────────────────────

/** Current layer-based schema version written by this programme. */
export const TEMPLATE_SCHEMA_VERSION = 2 as const;

/** Fixed-zone schema version from A-NEW-3 (backward-compat read path in E8). */
export const LEGACY_SCHEMA_VERSION = 1 as const;

export type SchemaVersion = typeof TEMPLATE_SCHEMA_VERSION | typeof LEGACY_SCHEMA_VERSION;

// ─── Constraints (§3.2, §8.1) ─────────────────────────────────────────────────

/**
 * Horizontal pin controlling how a layer reflows when the canvas width changes
 * (e.g. switching from a 1280×720 variant to a 1080×1080 variant).
 *
 * - left        : x is fixed (distance from left edge stays constant)
 * - right       : right margin is fixed
 * - center      : layer tracks horizontal centre of canvas
 * - left_right  : layer stretches — both left margin and right margin are fixed
 * - scale       : position + size scale proportionally with the canvas width
 */
export type ConstraintHorizontal = "left" | "right" | "center" | "left_right" | "scale";

/** Vertical equivalent of ConstraintHorizontal. */
export type ConstraintVertical = "top" | "bottom" | "center" | "top_bottom" | "scale";

export interface Constraints {
  horizontal: ConstraintHorizontal;
  vertical: ConstraintVertical;
}

// ─── Variable metadata (§3.7) — drives auto-forms in N-Series composer ────────

export type VarCategory = "content" | "branding" | "media" | "meta";

export interface VarMetadata {
  /** Human-readable label shown in the auto-generated form. */
  label: string;
  /** Whether the field is mandatory before generating an image. */
  required: boolean;
  /** Pre-filled default value (empty string = no default). */
  default: string;
  /** Logical grouping in the auto-form UI. */
  category: VarCategory;
  /** Help text displayed below the input (e.g. "Wrap emphasis in *asterisks*"). */
  help: string;
}

// ─── Common layer fields (§3.2) ───────────────────────────────────────────────

/**
 * Fields present on every layer type.  Concrete layer types extend this via
 * intersection (TextLayer, ImageLayer, RectangleLayer).
 *
 * Key invariant: `id` is immutable and generated once; `name` is the editable
 * API binding key used in Modification payloads.  Renaming a layer changes only
 * `name` — all internal references (undo log, groups) continue to use `id`.
 */
interface LayerBase {
  /** Immutable internal reference — never changes after creation. */
  id: string;
  /** Editable API binding key — used in Modification.name and /fields output. */
  name: string;
  /** Left edge of the layer in true canvas pixels. */
  x: number;
  /** Top edge of the layer in true canvas pixels. */
  y: number;
  width: number;
  height: number;
  /** Clockwise rotation in degrees around the top-left origin. */
  rotation: number;
  rotate_x: number;
  rotate_y: number;
  rotate_z: number;
  skew_x: number;
  skew_y: number;
  /** 0–1 (0 = fully transparent, 1 = fully opaque). */
  opacity: number;
  /** When true the layer cannot be moved or edited in the editor canvas. */
  locked: boolean;
  /** Unconditionally hide this layer (independent of hide_when_empty). */
  hide: boolean;
  /**
   * Auto-hide when the bound content resolves to empty at render time
   * (empty text string, or no image URL/asset_id).
   */
  hide_when_empty: boolean;
  /** Prevent width/height from being changed independently during resize. */
  lock_aspect_ratio: boolean;
  description: string;
  /** Name of the group this layer belongs to, or null. */
  group: string | null;
  /** Responsive pinning rules applied when the canvas size changes (variant switch). */
  constraints: Constraints;
  /** Optional form metadata; present when this layer should be exposed as an API field. */
  var?: VarMetadata;
}

// ─── Text layer (§3.3) ────────────────────────────────────────────────────────

export type TextAlignH = "left" | "center" | "right" | "justify";
export type TextAlignV = "top" | "center" | "bottom";
export type TextTransform = "none" | "uppercase" | "lowercase" | "capitalize";
export type TextDecoration = "none" | "underline" | "line-through";
export type WordBreak = "normal" | "break-all" | "keep-all" | "break-word";
export type Direction = "ltr" | "rtl";

/**
 * Text Fit binary-search algorithm parameters (§7, §1.6).
 * The exact algorithm is specified in the design spec §7 and must be
 * implemented identically in the DOM renderer and the sharp renderer.
 */
export interface TextFitOptions {
  enabled: boolean;
  /** Minimum font size the algorithm will emit (px). */
  min_size: number;
  /** Maximum font size the algorithm will try first (px). */
  max_size: number;
  /** Hard line-count ceiling; the algorithm won't exceed this. */
  max_lines: number;
}

/**
 * Glyph-hugging per-line background (the "pink pill" in the design spec §6.5).
 * Uses `box-decoration-break: clone` so padding/radius wraps each line tightly.
 */
export interface TextBackground {
  color: string | null;
  border: string | null;
  border_width: number | null;
  padding_h: number;
  padding_v: number;
  shadow: string | null;
  radius: number | null;
  /** Vertical shift applied to the background box (px). */
  shift: number | null;
}

/** Outer frame around the whole text block — distinct from per-line background. */
export interface TextBox {
  padding: number | null;
  border: string | null;
}

/**
 * Secondary style applied to text wrapped in *asterisks* (§6.6, §1.7).
 * The *asterisks* parser must be identical across every renderer.
 */
export interface SecondaryStyle {
  font_family: string | null;
  color: string | null;
}

export interface TextLayer extends LayerBase {
  type: "text";
  text: string;
  font_family: string;
  font_size: number;
  font_weight: number;
  color: string;
  text_align_h: TextAlignH;
  text_align_v: TextAlignV;
  /** Kerning in tracking units (negative = tighter). */
  letter_spacing: number;
  line_height: number;
  text_transform: TextTransform;
  text_decoration: TextDecoration;
  word_break: WordBreak;
  /** CSS font-style value (e.g. "italic"). Empty string = normal. */
  style: string;
  direction: Direction;
  text_fit: TextFitOptions;
  /**
   * When true and text still overflows at min_size, clamp to max_lines
   * with an ellipsis.  When false, let text overflow within tolerance.
   */
  truncate: boolean;
  text_box: TextBox;
  background: TextBackground;
  secondary: SecondaryStyle;
}

// ─── Image layer (§3.4) ───────────────────────────────────────────────────────

/** How the image fills the layer bounding box. */
export type ImageFill = "cover" | "fit";
export type ImageAnchorX = "left" | "center" | "right";
export type ImageAnchorY = "top" | "center" | "bottom";

export interface ImageLayer extends LayerBase {
  type: "image";
  /**
   * Preferred image source — resolved to a concrete URL at render time via the
   * asset resolver.  Storage/CDN/permissions can change without touching templates.
   * When both asset_id and image_url are present, asset_id takes precedence.
   */
  asset_id: string | null;
  /** Fallback / external / inline image URL. */
  image_url: string | null;
  fill: ImageFill;
  anchor_x: ImageAnchorX;
  anchor_y: ImageAnchorY;
  /** CSS multiply blend colour (null = no tint). */
  tint_color: string | null;
  border_radius: number;
  /** Optional SVG clip-path string for diagonal cuts etc. */
  clip_path: string | null;
  /**
   * Auto-anchor image to keep a detected face in frame.
   * V1 implementation: manual focal-point only; face-detect reserved for post-V1.
   */
  face_detect: boolean;
}

// ─── Rectangle / shape layer (§3.5) ──────────────────────────────────────────

export interface GradientStop {
  color: string;
  /** Stop position 0–1 (0 = start, 1 = end). */
  position: number;
}

export interface Gradient {
  type: "linear" | "radial";
  /** Angle in degrees for linear gradients (0 = top-to-bottom). */
  angle?: number;
  stops: GradientStop[];
}

export interface Border {
  color: string;
  width: number;
  style: "solid" | "dashed" | "dotted";
}

export interface RectangleLayer extends LayerBase {
  type: "rectangle";
  /** Solid fill colour (null when gradient is used instead). */
  color: string | null;
  /** Gradient fill (null when color is used instead). */
  gradient: Gradient | null;
  border_radius: number;
  border: Border | null;
}

// ─── Reserved layer types (post-V1 — schema space only, §2, §5 out-of-scope) ─
// These types carry only the base fields.  The renderer treats them as inert
// in V1.  Do not implement rendering logic for these until post-V1.

export interface SvgLayer extends LayerBase {
  type: "svg";
}

export interface QrLayer extends LayerBase {
  type: "qr";
}

export interface BarcodeLayer extends LayerBase {
  type: "barcode";
}

export interface ChartLayer extends LayerBase {
  type: "chart";
}

// ─── Layer union ──────────────────────────────────────────────────────────────

export type Layer =
  | TextLayer
  | ImageLayer
  | RectangleLayer
  | SvgLayer
  | QrLayer
  | BarcodeLayer
  | ChartLayer;

export type LayerType = Layer["type"];

/** V1 layer types — the only types that have full renderer implementations. */
export type V1LayerType = "text" | "image" | "rectangle";

/** Type guard: narrows Layer to a V1-implemented type. */
export function isV1Layer(
  layer: Layer,
): layer is TextLayer | ImageLayer | RectangleLayer {
  return (
    layer.type === "text" ||
    layer.type === "image" ||
    layer.type === "rectangle"
  );
}

// ─── Modification payload (§3.6, §1.5) ───────────────────────────────────────

/**
 * Properties that can be overridden on a text layer via a Modification.
 * Extend this as renderer capabilities grow.
 */
export type ModifiableTextProps = Partial<
  Pick<
    TextLayer,
    | "text"
    | "color"
    | "font_family"
    | "font_size"
    | "font_weight"
    | "letter_spacing"
    | "line_height"
    | "text_align_h"
    | "text_align_v"
    | "text_transform"
    | "hide"
    | "opacity"
  >
>;

/**
 * Properties that can be overridden on an image layer via a Modification.
 */
export type ModifiableImageProps = Partial<
  Pick<
    ImageLayer,
    | "asset_id"
    | "image_url"
    | "tint_color"
    | "fill"
    | "anchor_x"
    | "anchor_y"
    | "border_radius"
    | "hide"
    | "opacity"
  >
>;

/**
 * Properties that can be overridden on a rectangle layer via a Modification.
 */
export type ModifiableRectangleProps = Partial<
  Pick<
    RectangleLayer,
    "color" | "gradient" | "border_radius" | "border" | "hide" | "opacity"
  >
>;

/**
 * A runtime override of a named layer's properties.
 *
 * - `name` matches the layer's binding key (`Layer.name`), not its `id`.
 * - Only supplied keys override; unknown names are ignored (optionally warned).
 * - Multiple modifications for the same `name` are merged in order (last wins).
 * - Resolution order: base layer → variant override → request modification (§1.5).
 */
export type Modification = {
  name: string;
} & ModifiableTextProps &
  ModifiableImageProps &
  ModifiableRectangleProps;

// ─── Computed / expression fields (§3.8 — reserved, not V1) ──────────────────

/**
 * Schema space reserved for future `{{var}}` interpolation and computed values.
 * The renderer treats these as inert in V1; adding them now avoids a migration
 * later.  Do not implement resolution logic until post-V1.
 */
export interface ComputedFields {
  /** Template string interpolating other variable values, e.g. "{{guest}} on {{show}}". */
  expression?: string;
  computed?: Record<string, string>;
}

// ─── Variant (§8.2, §1.8) ─────────────────────────────────────────────────────

/**
 * A per-variant layer override — a subset of Modification restricted to
 * properties that make sense as permanent design adjustments per size,
 * as opposed to runtime content overrides.
 */
export type VariantOverride = {
  /** Matches the layer's binding key (`Layer.name`). */
  name: string;
} & Partial<Pick<LayerBase, "hide" | "opacity">> &
  Partial<
    Pick<TextLayer, "font_size" | "color" | "text_align_h" | "text_align_v">
  > &
  Partial<Pick<ImageLayer, "fill" | "anchor_x" | "anchor_y">> &
  Partial<Pick<RectangleLayer, "color">>;

/**
 * An alternate canvas size derived from the same template design.
 * Layers reflow via their `constraints`; per-variant `overrides` provide
 * additional adjustments beyond what constraint reflow handles.
 *
 * Resolution order: base layer → variant override → request modification.
 */
export interface Variant {
  /** Unique key used in GenerationRequest.variant and the /variants API. */
  key: string;
  width: number;
  height: number;
  /** Optional per-layer adjustments on top of constraint-driven reflow. */
  overrides: VariantOverride[];
}

// ─── Template root (§3.1) ─────────────────────────────────────────────────────

export type RenderFormat = "png" | "jpg" | "webp";
export type Orientation = "landscape" | "portrait" | "square";

/**
 * Render output settings — defaults live at the template root; overridable
 * per generation request (§13, §1.3).
 */
export interface RenderSettings {
  format: RenderFormat;
  /** Output quality 0–100, applies to jpg and webp only. */
  quality: number;
  /** Output size multiplier (2 = retina/2×). */
  scale: number;
  dpi: number;
}

/**
 * A named set of layers that can be shown/hidden or modified as a unit.
 * Layer membership is tracked by `name` (the binding key), not `id`.
 */
export interface TemplateGroup {
  name: string;
  layer_names: string[];
}

/** A custom font face bundled with this template. */
export interface TemplateFont {
  family: string;
  /** Absolute URL to the woff2 file.  Must be loadable both client-side and server-side. */
  url: string;
  weight: number | "normal" | "bold";
  style: "normal" | "italic";
}

/**
 * The full layer-based template (schema_version = 2).
 *
 * - `layers` is ordered **top-of-stack first**.  The renderer paints in
 *   reverse so the first array element ends up visually on top.
 * - All coordinates are in true canvas pixels.  The editor wrapper scales
 *   the canvas for display only; geometry stored here is never scaled.
 * - Pure data — no CSS class names.  The renderer decides how to paint it.
 */
export interface Template {
  /** Matches the `image_templates.id` primary key. */
  id: string;
  /** Schema version — bump when the data model changes so migrations can upgrade on load. */
  version: typeof TEMPLATE_SCHEMA_VERSION;
  name: string;
  width: number;
  height: number;
  orientation: Orientation;
  /** CSS colour string for the canvas background. */
  background_color: string;
  /** Ordered top-of-stack first; renderer paints in reverse. */
  layers: Layer[];
  groups: TemplateGroup[];
  /** Custom font faces used by this template (beyond the bundled defaults). */
  fonts: TemplateFont[];
  variants: Variant[];
  /** Default render settings; overridable per generation request. */
  render_settings: RenderSettings;
  settings: {
    guides: boolean;
  };
}

// ─── Undo / redo operation log (§5.1, §1.9) ───────────────────────────────────

/** 2-D position in canvas pixels. */
export interface XY {
  x: number;
  y: number;
}

/** Width × height dimensions in canvas pixels. */
export interface WH {
  width: number;
  height: number;
}

/**
 * A single invertible operation in the editor's undo/redo log.
 *
 * All ops reference the stable layer `id`, so they survive renames.
 * Rapid same-key edits (e.g. dragging a colour slider) are coalesced into one
 * `set` or `batch` op before being pushed onto the log.
 */
export type Op =
  | { t: "move";    id: string; from: XY;      to: XY }
  | { t: "resize";  id: string; from: WH;      to: WH }
  | { t: "set";     id: string; key: string;   from: unknown; to: unknown }
  | { t: "add";     layer: Layer; index: number }
  | { t: "remove";  layer: Layer; index: number }
  | { t: "reorder"; id: string; from: number;  to: number }
  | { t: "batch";   ops: Op[] };

// ─── Generation request (§13) ─────────────────────────────────────────────────

/**
 * Payload for `POST /images` (§13, §1.5).
 * Sync for single images; QStash-queued for batch jobs (existing infrastructure).
 */
export interface GenerationRequest {
  /** `image_templates.id` of the template to render. */
  template: string;
  /** Variant key from Template.variants[].key; omit for base canvas size. */
  variant?: string;
  modifications: Modification[];
  /** Per-request render_settings overrides; merged onto Template.render_settings. */
  render_settings?: Partial<RenderSettings>;
}

// ─── /fields API response (§13, §1.5) ────────────────────────────────────────

/**
 * Single entry in the `GET /templates/:id/fields` response.
 * Enough for the N-Series composer to auto-build a typed form input.
 */
export interface TemplateField {
  name: string;
  type: V1LayerType;
  var: VarMetadata;
}

// ─── /variants API response (§13) ────────────────────────────────────────────

/**
 * Single entry in the `GET /templates/:id/variants` response.
 */
export interface TemplateVariantSummary {
  key: string;
  width: number;
  height: number;
}
