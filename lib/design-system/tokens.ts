/**
 * lib/design-system/tokens.ts
 * Single TypeScript source of truth for all Opollo design tokens.
 */

export const colors = {
  pk:  "#ff03a5",
  pk2: "#cc0084",
  gr:  "#00e5a0",
  gr2: "#00c48a",
  bl:  "#4da6ff",
  am:  "#ffb300",
  rd:  "#ff4d6d",
  bg:  "#04040a",
  d1:  "#07070f",
  d2:  "#0b0b18",
  d3:  "#10101e",
  d4:  "#161624",
  m1: "rgba(255, 255, 255, 0.92)",
  m2: "rgba(255, 255, 255, 0.58)",
  m3: "rgba(255, 255, 255, 0.32)",
  m4: "rgba(255, 255, 255, 0.18)",
  iconDim: "rgba(255, 255, 255, 0.40)",
  b1: "rgba(255, 255, 255, 0.06)",
  b2: "rgba(255, 255, 255, 0.12)",
  b3: "rgba(255, 255, 255, 0.20)",
  pkSoft: "rgba(255, 3, 165, 0.12)",
  grSoft: "rgba(0, 229, 160, 0.10)",
  blSoft: "rgba(77, 166, 255, 0.10)",
} as const;

export const typography = {
  fontDisplay: "Fredoka",
  fontBody:    "Manrope",
  // All sizes >= 1rem (16px). Exception: .lbl eyebrow (0.75rem/12px — hierarchy-critical).
  fontSize: {
    eyebrow: "0.75rem",
    xs:      "1rem",
    sm:      "1rem",
    base:    "1rem",
    lg:      "1.125rem",
    xl:      "1.25rem",
    "2xl":   "1.5rem",
    "3xl":   "1.875rem",
    "4xl":   "2.25rem",
    "5xl":   "3rem",
  },
} as const;

export const radii = {
  sm:    "0.25rem",
  md:    "0.375rem",
  base:  "0.5rem",
  xl:    "0.75rem",
  "2xl": "1rem",
  full:  "9999px",
} as const;

export type OverridableTokenKey =
  | "colorPk" | "colorPk2" | "colorGr" | "colorGr2"
  | "colorBl" | "colorAm" | "colorRd"
  | "colorD1" | "colorD2" | "colorD3" | "colorD4" | "colorBg"
  | "fontDisplay" | "fontBody" | "radius";

export type TokenOverrides = Partial<Record<OverridableTokenKey, string>>;

export function buildCssVariableBlock(overrides: TokenOverrides): string {
  const vars: string[] = [];
  if (overrides.colorPk)     vars.push(`--pk: ${overrides.colorPk};`);
  if (overrides.colorPk2)    vars.push(`--pk2: ${overrides.colorPk2};`);
  if (overrides.colorGr)     vars.push(`--gr: ${overrides.colorGr};`);
  if (overrides.colorGr2)    vars.push(`--gr2: ${overrides.colorGr2};`);
  if (overrides.colorBl)     vars.push(`--bl: ${overrides.colorBl};`);
  if (overrides.colorAm)     vars.push(`--am: ${overrides.colorAm};`);
  if (overrides.colorRd)     vars.push(`--rd: ${overrides.colorRd};`);
  if (overrides.colorD1)     vars.push(`--d1: ${overrides.colorD1};`);
  if (overrides.colorD2)     vars.push(`--d2: ${overrides.colorD2};`);
  if (overrides.colorD3)     vars.push(`--d3: ${overrides.colorD3};`);
  if (overrides.colorD4)     vars.push(`--d4: ${overrides.colorD4};`);
  if (overrides.colorBg)     vars.push(`--bg: ${overrides.colorBg};`);
  if (overrides.fontDisplay) vars.push(`--font-display: ${overrides.fontDisplay};`);
  if (overrides.fontBody)    vars.push(`--font-body: ${overrides.fontBody};`);
  if (overrides.radius)      vars.push(`--radius: ${overrides.radius};`);
  if (vars.length === 0) return "";
  return `:root { ${vars.join(" ")} }`;
}
