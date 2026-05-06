import "server-only";
import { buildCssVariableBlock, type TokenOverrides } from "@/lib/design-system/tokens";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

type DbRow = {
  color_pk: string | null; color_pk2: string | null;
  color_gr: string | null; color_gr2: string | null;
  color_bl: string | null; color_am: string | null; color_rd: string | null;
  color_d1: string | null; color_d2: string | null;
  color_d3: string | null; color_d4: string | null; color_bg: string | null;
  font_display: string | null; font_body: string | null; radius: string | null;
};

function rowToOverrides(row: DbRow): TokenOverrides {
  const o: TokenOverrides = {};
  if (row.color_pk)     o.colorPk     = row.color_pk;
  if (row.color_pk2)    o.colorPk2    = row.color_pk2;
  if (row.color_gr)     o.colorGr     = row.color_gr;
  if (row.color_gr2)    o.colorGr2    = row.color_gr2;
  if (row.color_bl)     o.colorBl     = row.color_bl;
  if (row.color_am)     o.colorAm     = row.color_am;
  if (row.color_rd)     o.colorRd     = row.color_rd;
  if (row.color_d1)     o.colorD1     = row.color_d1;
  if (row.color_d2)     o.colorD2     = row.color_d2;
  if (row.color_d3)     o.colorD3     = row.color_d3;
  if (row.color_d4)     o.colorD4     = row.color_d4;
  if (row.color_bg)     o.colorBg     = row.color_bg;
  if (row.font_display) o.fontDisplay = row.font_display;
  if (row.font_body)    o.fontBody    = row.font_body;
  if (row.radius)       o.radius      = row.radius;
  return o;
}

/**
 * Returns a :root { ... } CSS block for the global design_system_settings row,
 * or null if no overrides are saved or the table doesn't exist yet.
 */
export async function getDesignSystemCssOverride(): Promise<string | null> {
  try {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("design_system_settings")
      .select(
        "color_pk,color_pk2,color_gr,color_gr2,color_bl,color_am,color_rd,color_d1,color_d2,color_d3,color_d4,color_bg,font_display,font_body,radius",
      )
      .is("company_id", null)
      .maybeSingle();

    if (error) {
      logger.error("design_system_settings read failed", { error: error.message });
      return null;
    }
    if (!data) return null;

    const block = buildCssVariableBlock(rowToOverrides(data as DbRow));
    return block || null;
  } catch (err) {
    logger.error("getDesignSystemCssOverride threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
