// Pure-logic helpers for the CustomerBrandProfileEditor form.
// Extracted into a non-JSX module so Vitest can import them without the
// React / next/navigation deps that live in the component file.

import type { BrandFormality, BrandPov, BrandProfile } from "@/lib/platform/brand";

export type FormState = {
  primary_colour: string;
  secondary_colour: string;
  accent_colour: string;
  heading_font: string;
  body_font: string;
  formality: BrandFormality | "";
  point_of_view: BrandPov | "";
  industry: string;
  safe_mode: boolean;
  change_summary: string;
  submitting: boolean;
  error: string | null;
  success: string | null;
};

// Build the patch payload — only include fields whose value differs
// from the current brand. Empty string is sent as null (operator
// clearing a value); unchanged fields are dropped from the patch.
export function buildPatch(
  state: FormState,
  brand: BrandProfile | null,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  function diff<K extends keyof BrandProfile>(
    key: K,
    formValue: string | boolean,
  ): void {
    const formNormalised =
      typeof formValue === "string" ? formValue.trim() : formValue;
    const formForCompare =
      formNormalised === "" ? null : formNormalised;
    const currentValue = brand?.[key] ?? null;
    if (formForCompare !== currentValue) {
      patch[key] = formForCompare;
    }
  }

  diff("primary_colour", state.primary_colour);
  diff("secondary_colour", state.secondary_colour);
  diff("accent_colour", state.accent_colour);
  diff("heading_font", state.heading_font);
  diff("body_font", state.body_font);
  diff("industry", state.industry);
  diff("formality", state.formality);
  diff("point_of_view", state.point_of_view);
  if ((brand?.safe_mode ?? false) !== state.safe_mode) {
    patch.safe_mode = state.safe_mode;
  }

  return patch;
}
