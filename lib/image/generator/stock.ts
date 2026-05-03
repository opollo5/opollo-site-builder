import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

import type { GeneratedImage, GenerationParams } from "../types";
import { StockUnavailableError } from "../types";

interface StockRow {
  id: string;
  storage_path: string;
  style_id: string;
  industry_tags: string[] | null;
  luminance_score: number | null;
  width: number;
  height: number;
  format: string;
}

export async function stockFallback(
  params: Pick<GenerationParams, "styleId" | "industry" | "compositionType">,
): Promise<GeneratedImage[]> {
  const supabase = getServiceRoleClient();

  const { data: candidates } = await supabase
    .from("image_stock_library")
    .select(
      "id, storage_path, style_id, industry_tags, luminance_score, width, height, format",
    )
    .is("deleted_at", null)
    .in("style_id", [params.styleId, "neutral"])
    .limit(20);

  if (!candidates?.length) {
    throw new StockUnavailableError(
      `No stock images available for style ${params.styleId}`,
    );
  }

  const ranked = (candidates as StockRow[])
    .map((img) => ({
      img,
      score:
        (img.style_id === params.styleId ? 3 : 0) +
        (params.industry && img.industry_tags?.includes(params.industry)
          ? 2
          : 0) +
        (img.luminance_score !== null
          ? img.luminance_score < 160 || img.luminance_score > 180
            ? 2
            : 0
          : 1),
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0].img;
  return [
    {
      storagePath: best.storage_path,
      width: best.width,
      height: best.height,
      format: best.format,
    },
  ];
}
