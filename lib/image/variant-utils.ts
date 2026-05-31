/**
 * variant-utils — client-safe variant reflow utilities.
 *
 * Extracted from lib/image/compositing/layer-renderer.ts (which has
 * `import "server-only"`) so the editor can use them on the client side
 * to preview how layers reflow when switching between format variants.
 *
 * Design spec §8.1 (constraints), §8.2 (variants, resolution order).
 * Multi-format brief: docs/briefs/image-generator/v2-editor/MULTI_FORMAT_BRIEF.md
 */

import type {
  Layer,
  Variant,
  VariantOverride,
  Template,
} from "./template-model";

// ─── Constraint reflow ────────────────────────────────────────────────────────

/**
 * Reflow a single layer from (sourceW × sourceH) to (targetW × targetH)
 * using its Figma-style constraint pins. Text layers with text_fit re-fit
 * automatically because the renderer reads layer.width/height.
 */
export function reflowLayerForVariant(
  layer: Layer,
  sourceW: number,
  sourceH: number,
  targetW: number,
  targetH: number,
): Layer {
  const { horizontal, vertical } = layer.constraints;
  const ratioW = targetW / sourceW;
  const ratioH = targetH / sourceH;

  let x = layer.x;
  let width = layer.width;
  let y = layer.y;
  let height = layer.height;

  // Horizontal reflow
  switch (horizontal) {
    case "right": {
      const rightMargin = sourceW - (layer.x + layer.width);
      x = targetW - layer.width - rightMargin;
      break;
    }
    case "center": {
      const offsetFromCenter = (layer.x + layer.width / 2) - sourceW / 2;
      x = targetW / 2 + offsetFromCenter - layer.width / 2;
      break;
    }
    case "left_right": {
      const rightMargin = sourceW - (layer.x + layer.width);
      x = layer.x;
      width = targetW - layer.x - rightMargin;
      break;
    }
    case "scale":
      x = layer.x * ratioW;
      width = layer.width * ratioW;
      break;
    default: // "left"
      break;
  }

  // Vertical reflow
  switch (vertical) {
    case "bottom": {
      const bottomMargin = sourceH - (layer.y + layer.height);
      y = targetH - layer.height - bottomMargin;
      break;
    }
    case "center": {
      const offsetFromCenter = (layer.y + layer.height / 2) - sourceH / 2;
      y = targetH / 2 + offsetFromCenter - layer.height / 2;
      break;
    }
    case "top_bottom": {
      const bottomMargin = sourceH - (layer.y + layer.height);
      y = layer.y;
      height = targetH - layer.y - bottomMargin;
      break;
    }
    case "scale":
      y = layer.y * ratioH;
      height = layer.height * ratioH;
      break;
    default: // "top"
      break;
  }

  return { ...layer, x, y, width, height };
}

/**
 * Apply per-variant layer overrides. Overrides are keyed by layer.name.
 * Only properties present in the override are changed.
 */
export function applyVariantLayerOverride(
  layer: Layer,
  override: VariantOverride,
): Layer {
  const { name: _name, ...rest } = override;
  return { ...layer, ...rest };
}

/**
 * Reflow a full template's layers to a variant's canvas size.
 * Resolution order: base layer → constraint reflow → variant override.
 */
export function applyVariant(
  template: Pick<Template, "width" | "height" | "layers">,
  variant: Variant,
): { width: number; height: number; layers: Layer[] } {
  const { width: sW, height: sH, layers } = template;
  const { width: tW, height: tH, overrides } = variant;

  const reflowed = layers.map((layer) => {
    const reflowedLayer = reflowLayerForVariant(layer, sW, sH, tW, tH);
    const override = overrides.find((o) => o.name === layer.name);
    return override ? applyVariantLayerOverride(reflowedLayer, override) : reflowedLayer;
  });

  return { width: tW, height: tH, layers: reflowed };
}
