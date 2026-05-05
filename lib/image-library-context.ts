import "server-only";

import { deliveryUrl } from "@/lib/cloudflare-images";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// DESIGN-SYSTEM-OVERHAUL PR 11 — image library context for generation.
//
// When sites.use_image_library is true, returns a prompt block listing
// up to 5 captioned images from image_library whose search_tsv matches
// the supplied topic keywords. The model can reference the URLs
// directly in <img src="...">.
//
// Hard rules:
//
//   - Skip rows missing caption or alt_text — the brief is explicit
//     that we should only suggest images with confirmed metadata.
//   - Skip soft-deleted rows.
//   - Skip rows whose Cloudflare delivery URL can't be built (hash
//     unset). Without a URL the model has nothing to reference.
//   - Empty topic + no matches → empty block, never a hard fail.
//
// Topic search uses Postgres' websearch_to_tsquery on
// image_library.search_tsv (a GIN-indexed materialised column from
// migration 0010). websearch parsing tolerates phrase quotes, AND/OR,
// and bare words equally well — operators don't have to memorise the
// to_tsquery syntax.
// ---------------------------------------------------------------------------

const MAX_IMAGES = 5;

export interface ImageLibrarySuggestion {
  id: string;
  url: string;
  caption: string;
  alt_text: string;
  tags: string[];
}

export async function fetchImageLibrarySuggestions(opts: {
  siteId: string;
  topic: string;
}): Promise<ImageLibrarySuggestion[]> {
  const { siteId, topic } = opts;
  if (!topic.trim()) return [];

  const supabase = getServiceRoleClient();
  const enabledRow = await supabase
    .from("sites")
    .select("use_image_library")
    .eq("id", siteId)
    .maybeSingle();

  if (enabledRow.error || !enabledRow.data?.use_image_library) {
    return [];
  }

  const { data, error } = await supabase
    .from("image_library")
    .select("id, cloudflare_id, caption, alt_text, tags")
    .is("deleted_at", null)
    .not("caption", "is", null)
    .not("alt_text", "is", null)
    .neq("caption", "")
    .neq("alt_text", "")
    .textSearch("search_tsv", topic, { type: "websearch" })
    .limit(MAX_IMAGES);

  if (error) {
    logger.warn("image-library-context.fetch_failed", {
      site_id: siteId,
      topic,
      error: error.message,
    });
    return [];
  }

  const out: ImageLibrarySuggestion[] = [];
  for (const row of data ?? []) {
    const cloudflareId = row.cloudflare_id as string | null;
    if (!cloudflareId) continue;
    const url = deliveryUrl(cloudflareId, "public");
    if (!url) continue;
    out.push({
      id: row.id as string,
      url,
      caption: row.caption as string,
      alt_text: row.alt_text as string,
      tags: (row.tags as string[]) ?? [],
    });
  }
  return out;
}

export function renderImageLibraryBlock(
  suggestions: ImageLibrarySuggestion[],
): string {
  if (suggestions.length === 0) return "";
  const lines = ["<image_library_context>"];
  lines.push(
    "Use these pre-approved images from our library when an image fits the section. Reference URLs directly in <img src=\"...\"> with the supplied alt text. If none fit, generate without images — do NOT invent URLs.",
  );
  lines.push("");
  for (const s of suggestions) {
    lines.push(`- url: ${s.url}`);
    lines.push(`  caption: ${s.caption}`);
    lines.push(`  alt: ${s.alt_text}`);
    if (s.tags.length > 0) {
      lines.push(`  tags: ${s.tags.join(", ")}`);
    }
  }
  lines.push("</image_library_context>");
  return lines.join("\n");
}

export async function buildImageLibraryContextPrefix(opts: {
  siteId: string;
  topic: string;
}): Promise<string> {
  const suggestions = await fetchImageLibrarySuggestions(opts);
  const block = renderImageLibraryBlock(suggestions);
  if (!block) return "";
  return block + "\n\n";
}
