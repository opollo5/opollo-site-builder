import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

type DbSettings = {
  color_pk?: string | null;
  color_pk2?: string | null;
  color_gr?: string | null;
  color_gr2?: string | null;
  color_bl?: string | null;
  color_am?: string | null;
  color_rd?: string | null;
  color_bg?: string | null;
  color_d1?: string | null;
  color_d2?: string | null;
  color_d3?: string | null;
  color_d4?: string | null;
  font_size_base?: string | null;
  font_size_xl?: string | null;
  font_display?: string | null;
  font_body?: string | null;
  radius_lg?: string | null;
  radius_full?: string | null;
};

function buildCssBlock(s: DbSettings): string {
  const vars: string[] = [];
  if (s.color_pk)       vars.push(`--pk: ${s.color_pk};`);
  if (s.color_pk2)      vars.push(`--pk2: ${s.color_pk2};`);
  if (s.color_gr)       vars.push(`--gr: ${s.color_gr};`);
  if (s.color_gr2)      vars.push(`--gr2: ${s.color_gr2};`);
  if (s.color_bl)       vars.push(`--bl: ${s.color_bl};`);
  if (s.color_am)       vars.push(`--am: ${s.color_am};`);
  if (s.color_rd)       vars.push(`--rd: ${s.color_rd};`);
  if (s.color_bg)       vars.push(`--bg: ${s.color_bg};`);
  if (s.color_d1)       vars.push(`--d1: ${s.color_d1};`);
  if (s.color_d2)       vars.push(`--d2: ${s.color_d2};`);
  if (s.color_d3)       vars.push(`--d3: ${s.color_d3};`);
  if (s.color_d4)       vars.push(`--d4: ${s.color_d4};`);
  if (s.font_size_base) vars.push(`--font-size-base: ${s.font_size_base};`);
  if (s.font_size_xl)   vars.push(`--font-size-xl: ${s.font_size_xl};`);
  if (s.font_display)   vars.push(`--font-display: ${s.font_display};`);
  if (s.font_body)      vars.push(`--font-body: ${s.font_body};`);
  if (s.radius_lg)      vars.push(`--radius: ${s.radius_lg};`);
  if (s.radius_full)    vars.push(`--radius-full: ${s.radius_full};`);
  if (vars.length === 0) return "";
  return `:root { ${vars.join(" ")} }`;
}

/**
 * Reads the global (company_id IS NULL) design_system_settings row and
 * returns a CSS `:root { ... }` override block, or null if no overrides are set.
 *
 * Called once per server-render from app/layout.tsx. Supabase connection is
 * pooled; the query is a point read on a singleton row (~0.5 ms on warm pool).
 * Degrades gracefully: if Supabase is unavailable or the table doesn't exist
 * yet (before migration 0098 runs), returns null and the app uses compiled defaults.
 */
export async function getDesignSystemCssOverride(): Promise<string | null> {
  try {
    const sb = getServiceRoleClient();
    const { data, error } = await sb
      .from("design_system_settings")
      .select(
        "color_pk,color_pk2,color_gr,color_gr2,color_bl,color_am,color_rd," +
        "color_bg,color_d1,color_d2,color_d3,color_d4," +
        "font_size_base,font_size_xl,font_display,font_body," +
        "radius_lg,radius_full",
      )
      .is("company_id", null)
      .maybeSingle();

    if (error) {
      // Table may not exist yet if migration 0098 hasn't run. Log at debug level.
      logger.debug("design_system_settings read failed (may be pre-migration)", { error: error.message });
      return null;
    }

    if (!data) return null;
    const css = buildCssBlock(data as DbSettings);
    return css || null;
  } catch {
    return null;
  }
}
