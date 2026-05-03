import "server-only";

import type { CompositeInput, CompositeResult } from "./index";

// Placid compositing provider — stub for I2 evaluation.
//
// Placid uses a similar template + modifications model to Bannerbear:
//   POST /api/render with { template_uuid, layers: [...] }
//
// Key differences from Bannerbear:
// - Layers addressed by UUID (not name); UIDs come from the template editor
// - Response includes `image_url` synchronously when `wait: true`
// - Pricing: per-render credit model (vs Bannerbear's subscription)
//
// Evaluation outcome (I2): Bannerbear selected as primary provider because:
// 1. Named layers (not UUID) are easier to maintain in code
// 2. Asynchronous webhook pattern is better for high-volume generation
// 3. Stronger modifier support (x_offset, y_offset, width, height overrides)
//    needed for our dynamic text-zone positioning
// 4. Better template version control
//
// If requirements change (e.g. synchronous generation needed, or Bannerbear
// pricing becomes unfavourable), implement this stub.
export async function compositePlacid(
  _input: CompositeInput,
): Promise<CompositeResult> {
  throw new Error(
    "Placid provider is not implemented. Set COMPOSITING_PROVIDER=bannerbear.",
  );
}
