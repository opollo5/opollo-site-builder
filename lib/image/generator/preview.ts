import "server-only";

import type { GenerationParams } from "../types";
import { buildPrompt } from "./prompt-engine";

// ---------------------------------------------------------------------------
// B5 — preview-mode generator.
//
// §B5 of MASS_IMAGE_GEN_BUILD_BRIEF. Builds the exact prompt that would
// have been sent to Ideogram and returns it. Never calls Ideogram. Never
// writes to storage. Never spends money.
//
// The qstash handler routes here when the QStash payload has previewOnly:
// true. Result is persisted to image_generation_jobs (state=completed,
// result_storage_path=null, generation_params.preview_prompt=<prompt>)
// and to image_generation_log (outcome='preview').
// ---------------------------------------------------------------------------

export interface PreviewResult {
  prompt: string;
}

export function generatePreview(params: GenerationParams): PreviewResult {
  const prompt = buildPrompt({
    styleId: params.styleId,
    primaryColour: params.primaryColour,
    compositionType: params.compositionType,
    industry: params.industry,
    mood: params.mood,
    safeMode: false,
    simplify: params.simplifyPrompt,
  });
  return { prompt };
}
