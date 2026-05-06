/**
 * lib/design-system/tokens.ts
 *
 * SINGLE SOURCE OF TRUTH for all Opollo design tokens.
 *
 * CSS custom properties in app/globals.css and styles/tokens.css are
 * derived from these values. The admin design system settings page
 * (app/admin/settings/design-system) allows super_admins to override
 * tokens per-instance; overrides are injected as a <style> block in
 * app/layout.tsx at render time.
 *
 * Rules enforced by scripts/audit.ts (static analysis):
 *   - No hardcoded hex colours in app/ or components/ (use token keys)
 *   - No arbitrary Tailwind text-[Xpx] values (use token classes)
 *   - Minimum font size: 1rem (16px) on all operator-facing surfaces
 *     Exception: eyebrow .lbl (0.75rem/12px — hierarchy-critical design exception)
 *
 * To add a token: add it here first, then use it.
 * Never add raw values directly in a component.
 */

// ─── Colours ────────────────────────────────────────────────────────────────

export const colors = {
  /** Pink — primary CTA, highlights */
  pk: "#ff03a5",
  pk2: "#cc0084",
  pkSoft: "rgba(255, 3, 165, 0.12)",

  /** Green — success, focus ring, hover, eyebrow dashes */
  gr: "#00e5a0",
  gr2: "#00c48a",
  grSoft: "rgba(0, 229, 160, 0.10)",

  /** Blue — info */
  bl: "#4da6ff",
  blSoft: "rgba(77, 166, 255, 0.10)",

  /** Amber — warning */
  am: "#ffb300",

  /** Red — destructive */
  rd: "#ff4d6d",

  /** Dark backgrounds — deepest (bg) → lightest (d4) */
  bg: "#04040a",
  d1: "#07070f",
  d2: "#0b0b18",
  d3: "#10101e",
  d4: "#161624",

  white: "#ffffff",

  /** Muted/text alpha ramps */
  m1: "rgba(255, 255, 255, 0.92)",
  m2: "rgba(255, 255, 255, 0.58)",
  m3: "rgba(255, 255, 255, 0.32)",
  m4: "rgba(255, 255, 255, 0.18)",

  /** Dim alpha for inactive icons — between m3 (0.32) and m2 (0.58) */
  iconDim: "rgba(255, 255, 255, 0.40)",

  /** Border/surface alpha ramps */
  b1: "rgba(255, 255, 255, 0.06)",
  b2: "rgba(255, 255, 255, 0.12)",
  b3: "rgba(255, 255, 255, 0.20)",
} as const;

// ─── Typography ─────────────────────────────────────────────────────────────

export const typography = {
  /** Font size scale.
   * 16px is the absolute minimum for operator-facing text.
   * Exception: eyebrow .lbl (0.75rem/12px — hierarchy-critical; sits above headings).
   */
  fontSize: {
    eyebrow: "0.75rem", // 12px — documented design exception (.lbl eyebrow label)
    xs:   "1rem",      // 16px — minimum
    sm:   "1rem",      // 16px — minimum
    base: "1rem",      // 16px — standard body
    lg:   "1.125rem",  // 18px
    xl:   "1.25rem",   // 20px
    "2xl": "1.5rem",   // 24px
    "3xl": "1.875rem", // 30px
    "4xl": "2.25rem",  // 36px
    "5xl": "3rem",     // 48px
    "6xl": "3.75rem",  // 60px
    "7xl": "4.5rem",   // 72px
  },

  /** Line height scale */
  lineHeight: {
    tight:   "1.25",
    snug:    "1.375",
    normal:  "1.5",
    relaxed: "1.625",
  },

  /** Font weight scale */
  fontWeight: {
    normal:   400,
    medium:   500,
    semibold: 600,
    bold:     700,
  },

  /** Font families — CSS variables injected by next/font in app/layout.tsx */
  fontFamily: {
    display: "var(--font-display)",  // Fredoka — headings
    body:    "var(--font-body)",     // Manrope — body + UI
    mono:    "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
  },
} as const;

// ─── Spacing ─────────────────────────────────────────────────────────────────

export const spacing = {
  px:    "1px",
  "0.5": "0.125rem",  //  2px
  "1":   "0.25rem",   //  4px
  "1.5": "0.375rem",  //  6px
  "2":   "0.5rem",    //  8px
  "2.5": "0.625rem",  // 10px
  "3":   "0.75rem",   // 12px
  "3.5": "0.875rem",  // 14px
  "4":   "1rem",      // 16px
  "5":   "1.25rem",   // 20px
  "6":   "1.5rem",    // 24px
  "7":   "1.75rem",   // 28px
  "8":   "2rem",      // 32px
  "10":  "2.5rem",    // 40px
  "12":  "3rem",      // 48px
  "16":  "4rem",      // 64px
  "20":  "5rem",      // 80px
  "24":  "6rem",      // 96px
} as const;

// ─── Border radius ────────────────────────────────────────────────────────────

export const radii = {
  sm:   "0.25rem",  //  4px
  md:   "0.375rem", //  6px
  lg:   "0.5rem",   //  8px
  xl:   "0.75rem",  // 12px
  "2xl": "1rem",    // 16px
  full: "9999px",
} as const;

// ─── Shadows ─────────────────────────────────────────────────────────────────

export const shadows = {
  xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
  sm: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
  md: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
  lg: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
  xl: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
} as const;

// ─── Transitions ──────────────────────────────────────────────────────────────

export const transitions = {
  fast:   "150ms ease",
  normal: "200ms ease",
  slow:   "300ms ease",
} as const;

// ─── Z-index scale ────────────────────────────────────────────────────────────

export const zIndex = {
  base:     0,
  raised:   10,
  dropdown: 100,
  sticky:   200,
  overlay:  300,
  modal:    400,
  toast:    500,
} as const;

// ─── Overridable token keys ────────────────────────────────────────────────────
//
// These are the token keys that the admin design system settings page allows
// super_admins to edit. Matches the columns in the design_system_settings table.

export type OverridableTokenKey =
  | "colorPk"
  | "colorPk2"
  | "colorGr"
  | "colorGr2"
  | "colorBl"
  | "colorAm"
  | "colorRd"
  | "colorBg"
  | "colorD1"
  | "colorD2"
  | "colorD3"
  | "colorD4"
  | "fontSizeBase"
  | "fontSizeXl"
  | "fontDisplay"
  | "fontBody"
  | "radiusLg"
  | "radiusFull"
  | "radius";

export interface TokenOverrides {
  colorPk?: string;
  colorPk2?: string;
  colorGr?: string;
  colorGr2?: string;
  colorBl?: string;
  colorAm?: string;
  colorRd?: string;
  colorBg?: string;
  colorD1?: string;
  colorD2?: string;
  colorD3?: string;
  colorD4?: string;
  fontSizeBase?: string;
  fontSizeXl?: string;
  fontDisplay?: string;
  fontBody?: string;
  radiusLg?: string;
  radiusFull?: string;
  /** @deprecated Use radiusLg instead. Kept for backwards compat with older settings rows. */
  radius?: string;
}

/**
 * Builds a CSS variable block from token overrides.
 * Used by app/layout.tsx to inject `<style>` tags from design_system_settings.
 */
export function buildCssVariableBlock(overrides: TokenOverrides): string {
  const vars: string[] = [];

  if (overrides.colorPk)    vars.push(`--pk: ${overrides.colorPk};`);
  if (overrides.colorPk2)   vars.push(`--pk2: ${overrides.colorPk2};`);
  if (overrides.colorGr)    vars.push(`--gr: ${overrides.colorGr};`);
  if (overrides.colorGr2)   vars.push(`--gr2: ${overrides.colorGr2};`);
  if (overrides.colorBl)    vars.push(`--bl: ${overrides.colorBl};`);
  if (overrides.colorAm)    vars.push(`--am: ${overrides.colorAm};`);
  if (overrides.colorRd)    vars.push(`--rd: ${overrides.colorRd};`);
  if (overrides.colorBg)    vars.push(`--bg: ${overrides.colorBg}; --canvas: ${overrides.colorBg};`);
  if (overrides.colorD1)    vars.push(`--d1: ${overrides.colorD1}; --background: ${overrides.colorD1};`);
  if (overrides.colorD2)    vars.push(`--d2: ${overrides.colorD2};`);
  if (overrides.colorD3)    vars.push(`--d3: ${overrides.colorD3};`);
  if (overrides.colorD4)    vars.push(`--d4: ${overrides.colorD4};`);
  if (overrides.fontSizeBase) vars.push(`--font-size-base: ${overrides.fontSizeBase};`);
  if (overrides.fontSizeXl)   vars.push(`--font-size-xl: ${overrides.fontSizeXl};`);
  if (overrides.fontDisplay)  vars.push(`--font-display: ${overrides.fontDisplay};`);
  if (overrides.fontBody)     vars.push(`--font-body: ${overrides.fontBody};`);
  if (overrides.radiusLg)     vars.push(`--radius: ${overrides.radiusLg};`);
  else if (overrides.radius)  vars.push(`--radius: ${overrides.radius};`);
  if (overrides.radiusFull)   vars.push(`--radius-full: ${overrides.radiusFull};`);

  if (vars.length === 0) return "";
  return `:root { ${vars.join(" ")} }`;
}

// ─── Default token export ─────────────────────────────────────────────────────

export const tokens = {
  colors,
  typography,
  spacing,
  radii,
  shadows,
  transitions,
  zIndex,
} as const;

export type Tokens = typeof tokens;
