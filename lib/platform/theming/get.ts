import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

import type { CompanyThemeRow, ThemeOverrides } from "./types";
import { THEME_TOKEN_KEYS } from "./types";

export async function getCompanyTheme(
  companyId: string,
): Promise<CompanyThemeRow | null> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("platform_company_theme_overrides")
    .select("company_id, overrides, updated_at, updated_by")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error || !data) return null;

  // Strip unknown keys before returning.
  const raw = (data.overrides as Record<string, unknown>) ?? {};
  const overrides: ThemeOverrides = {};
  for (const key of THEME_TOKEN_KEYS) {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) overrides[key] = v.trim();
  }

  return {
    company_id: data.company_id as string,
    overrides,
    updated_at: data.updated_at as string,
    updated_by: (data.updated_by as string | null) ?? null,
  };
}

export function buildThemeStyleBlock(overrides: ThemeOverrides): string {
  const entries = Object.entries(overrides)
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");

  if (!entries) return "";
  return `:root {\n${entries}\n}`;
}
