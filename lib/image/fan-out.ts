import "server-only";

import { MASS_GEN_PLATFORM_MAP, type AspectRatio } from "@/lib/image/types";
import type { InterpretedPost } from "@/lib/ingestion/interpret";
import type { DispatchJobSpec } from "@/lib/image/dispatch";

// ---------------------------------------------------------------------------
// C4 — fan-out helper.
//
// §1.7 of MASS_IMAGE_GEN_BUILD_BRIEF. Given the C3 InterpretedPost[] plus a
// per-source-row publish_date lookup (built from the C1/C2 parser output),
// produce one DispatchJobSpec per (post, distinct aspect_ratio) pair.
//
// Lives in lib/ (not in the route file) because App Router rejects
// non-handler exports from route.ts modules.
// ---------------------------------------------------------------------------

export function fanOutJobs(
  posts: InterpretedPost[],
  publishDateBySourceRow: Map<number, string> = new Map(),
): DispatchJobSpec[] {
  const out: DispatchJobSpec[] = [];
  posts.forEach((post, postIndex) => {
    const ratios = uniqueRatiosForPlatforms(post.image_brief.target_platforms);
    const publishDate = publishDateBySourceRow.get(post.sourceRow);
    for (const aspectRatio of ratios) {
      out.push({
        styleId: post.image_brief.style_id,
        primaryColour: post.image_brief.primary_colour,
        compositionType: post.image_brief.composition_type,
        aspectRatio,
        targetPlatforms: platformsForRatio(post.image_brief.target_platforms, aspectRatio),
        ...(publishDate && { targetPublishDate: publishDate }),
        parentPostIndex: postIndex,
      });
    }
  });
  return out;
}

function uniqueRatiosForPlatforms(platforms: string[]): AspectRatio[] {
  const seen = new Set<AspectRatio>();
  const out: AspectRatio[] = [];
  for (const p of platforms) {
    const r = MASS_GEN_PLATFORM_MAP[p];
    if (!r || seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
}

function platformsForRatio(platforms: string[], ratio: AspectRatio): string[] {
  return platforms.filter((p) => MASS_GEN_PLATFORM_MAP[p] === ratio);
}
