#!/usr/bin/env tsx
/**
 * scripts/probes/a1-ideogram-v3-verify.ts
 *
 * Live-call verification for slice A1 (Ideogram v3 endpoint reshape).
 *
 * Fires one Ideogram v3 FLASH generation per supported aspect ratio from
 * §1.1 of the mass-image-gen brief, downloads each image to the
 * `generated-images` Supabase Storage bucket, and writes marker rows to
 * image_generation_log with triggered_by='a1_verification'.
 *
 * Output: signed URLs for each generated image, ready for Steven's visual
 * review (A1 checkpoint requirement).
 *
 * Usage (from repo root with env loaded):
 *   npx tsx scripts/probes/a1-ideogram-v3-verify.ts
 *
 * Required env:
 *   IDEOGRAM_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   IMAGE_GENERATION_BUCKET (optional, defaults to "generated-images")
 *
 * The bucket is created automatically if absent (idempotent with 0158 migration).
 * All probe rows are filterable via:
 *   SELECT * FROM image_generation_log WHERE triggered_by = 'a1_verification'
 */

import { createClient } from "@supabase/supabase-js";

const IDEOGRAM_URL = "https://api.ideogram.ai/v1/ideogram-v3/generate";
const BUCKET = process.env.IMAGE_GENERATION_BUCKET ?? "generated-images";
const TRIGGERED_BY = "a1_verification";
const SIGNED_URL_TTL = 3600; // 1 hour — for visual review

const NEGATIVE_PROMPT = [
  "text", "words", "letters", "typography", "watermark", "logo", "signature",
  "caption", "label", "title", "heading", "font", "written",
  "blurry", "distorted", "low quality", "pixelated", "noisy",
].join(", ");

// §1.1 aspect ratios — one generation per distinct ratio
const ASPECT_RATIOS: Array<{ ratio: string; label: string }> = [
  { ratio: "1x1",  label: "Square 1:1 (LinkedIn, Facebook)" },
  { ratio: "4x5",  label: "Portrait 4:5 (Instagram feed)" },
  { ratio: "9x16", label: "Story 9:16 (Instagram/Facebook Story)" },
  { ratio: "16x9", label: "Landscape 16:9 (LinkedIn landscape, X)" },
  { ratio: "4x3",  label: "Landscape 4:3 (GBP)" },
];

// Use a stable test company id — the Opollo internal company used in prior probes.
const PROBE_COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const PROBE_STYLE: string = "clean_corporate";
const PROBE_PROMPT =
  "professional corporate background, clean geometric lines, minimal modern elements, " +
  "business aesthetic, asymmetric composition — left two-thirds rich, right third light and open for text, " +
  "blue colour accent, no text, no words, no letters, no typography";

interface IdeogramImage {
  url: string;
}

interface IdeogramResponse {
  data: IdeogramImage[];
}

async function run() {
  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) {
    console.error("ERROR: IDEOGRAM_API_KEY is not set.");
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Ensure bucket exists (idempotent — migration 0158 creates it formally).
  console.log(`\nEnsuring '${BUCKET}' bucket exists...`);
  const { data: existingBuckets } = await supabase.storage.listBuckets();
  const bucketExists = existingBuckets?.some((b) => b.id === BUCKET);
  if (!bucketExists) {
    const { error: createErr } = await supabase.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: 10485760,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    });
    if (createErr) {
      console.error("ERROR creating bucket:", createErr.message);
      process.exit(1);
    }
    console.log(`  Created '${BUCKET}' bucket.`);
  } else {
    console.log(`  Bucket '${BUCKET}' already exists.`);
  }

  console.log(`\nFiring ${ASPECT_RATIOS.length} generations (one per §1.1 aspect ratio)...\n`);

  const results: Array<{
    ratio: string;
    label: string;
    signedUrl: string | null;
    storagePath: string | null;
    durationMs: number;
    error: string | null;
  }> = [];

  for (const { ratio, label } of ASPECT_RATIOS) {
    const start = Date.now();
    console.log(`  Generating ${ratio} (${label})...`);

    try {
      // Call Ideogram v3 FLASH.
      const form = new FormData();
      form.append("prompt", PROBE_PROMPT);
      form.append("rendering_speed", "FLASH");
      form.append("aspect_ratio", ratio);
      form.append("num_images", "1");
      form.append("style_type", "REALISTIC");
      form.append("negative_prompt", NEGATIVE_PROMPT);

      const resp = await fetch(IDEOGRAM_URL, {
        method: "POST",
        headers: { "Api-Key": apiKey },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Ideogram ${resp.status}: ${body.slice(0, 300)}`);
      }

      const data = (await resp.json()) as IdeogramResponse;
      const imageUrl = data.data[0]?.url;
      if (!imageUrl) throw new Error("Ideogram returned no image URL");

      // Download the image.
      const dlResp = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
      if (!dlResp.ok) throw new Error(`Download failed: ${dlResp.status}`);

      const buffer = Buffer.from(await dlResp.arrayBuffer());
      const contentType = dlResp.headers.get("content-type") ?? "image/jpeg";
      const ext = contentType.includes("png") ? "png" : "jpeg";
      const storagePath = `${PROBE_COMPANY_ID}/generated/${Date.now()}-probe-a1-${ratio.replace("x", "_")}.${ext}`;

      // Upload to Supabase Storage.
      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, buffer, { contentType, upsert: false });

      if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

      // Sign URL for visual review (1 hour TTL).
      const { data: signData, error: signErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(storagePath, SIGNED_URL_TTL);

      const signedUrl = signErr ? null : (signData?.signedUrl ?? null);
      const durationMs = Date.now() - start;

      // Write image_generation_log row.
      await supabase.from("image_generation_log").insert({
        company_id: PROBE_COMPANY_ID,
        style_id: PROBE_STYLE,
        composition_type: "split_layout",
        aspect_ratio: ratio,
        model_used: "ideogram-v3-flash",
        model_tier: "standard",
        prompt_used: PROBE_PROMPT,
        outcome: "success",
        retry_count: 0,
        fallback_used: false,
        background_storage_path: storagePath,
        output_storage_path: storagePath,
        quality_check_passed: true,
        generation_duration_ms: durationMs,
        triggered_by: TRIGGERED_BY,
      });

      console.log(`    ✓ ${ratio} done in ${durationMs}ms — ${storagePath}`);
      results.push({ ratio, label, signedUrl, storagePath, durationMs, error: null });
    } catch (err) {
      const durationMs = Date.now() - start;
      const error = err instanceof Error ? err.message : String(err);
      console.error(`    ✗ ${ratio} FAILED: ${error}`);

      // Write failure row.
      await supabase.from("image_generation_log").insert({
        company_id: PROBE_COMPANY_ID,
        style_id: PROBE_STYLE,
        composition_type: "split_layout",
        aspect_ratio: ratio,
        model_used: "ideogram-v3-flash",
        model_tier: "standard",
        prompt_used: PROBE_PROMPT,
        outcome: "failed",
        retry_count: 0,
        fallback_used: false,
        error_class: "probe_error",
        error_detail: error.slice(0, 500),
        generation_duration_ms: durationMs,
        triggered_by: TRIGGERED_BY,
      });

      results.push({ ratio, label, signedUrl: null, storagePath: null, durationMs, error });
    }
  }

  // Summary table.
  const succeeded = results.filter((r) => !r.error).length;
  const failed = results.filter((r) => r.error).length;

  console.log(`\n${"=".repeat(72)}`);
  console.log(`A1 VERIFICATION RESULTS — ${succeeded}/${ASPECT_RATIOS.length} succeeded`);
  console.log(`triggered_by='${TRIGGERED_BY}' rows written to image_generation_log`);
  console.log("=".repeat(72));

  for (const r of results) {
    if (r.error) {
      console.log(`\n[FAILED] ${r.ratio} (${r.label})`);
      console.log(`  Error: ${r.error}`);
    } else {
      console.log(`\n[OK] ${r.ratio} (${r.label}) — ${r.durationMs}ms`);
      console.log(`  Storage path: ${r.storagePath}`);
      console.log(`  Signed URL (1hr): ${r.signedUrl ?? "(signing failed)"}`);
    }
  }

  if (failed > 0) {
    console.log(`\n${failed} generation(s) failed. Check image_generation_log for details.`);
    process.exit(1);
  }

  console.log(`\nAll ${succeeded} images generated and stored. Ready for Steven's visual review.`);
}

run().catch((err) => {
  console.error("Probe crashed:", err);
  process.exit(1);
});
