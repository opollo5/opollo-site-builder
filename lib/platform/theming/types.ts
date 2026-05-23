// Phase 1 — editable token set.
// Only these keys are persisted and injected; unknown keys are stripped on write.

export const THEME_TOKEN_KEYS = [
  "--primary",
  "--color-success-bg",
  "--color-success-fg",
  "--color-success-border",
  "--color-warning-bg",
  "--color-warning-fg",
  "--color-warning-border",
  "--color-danger-bg",
  "--color-danger-fg",
  "--color-danger-border",
  "--radius",
] as const;

export type ThemeTokenKey = (typeof THEME_TOKEN_KEYS)[number];

export type ThemeOverrides = Partial<Record<ThemeTokenKey, string>>;

export interface CompanyThemeRow {
  company_id: string;
  overrides: ThemeOverrides;
  updated_at: string;
  updated_by: string | null;
}
