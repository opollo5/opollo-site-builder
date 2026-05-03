import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import type { CompositeInput, CompositeResult } from "./index";

// Bannerbear compositing provider.
//
// Template setup (one-time, per aspect ratio):
//   1. Create a template in app.bannerbear.com for each aspect ratio.
//   2. Each template needs 3 named layers:
//      - "background"  — image layer (full frame)
//      - "text_zone"   — text layer (we override x_offset/y_offset/width/height)
//      - "logo"        — image layer (optional, shown only when logo is provided)
//   3. Set the template UID in the env vars:
//      BANNERBEAR_TEMPLATE_1080x1080  (1:1)
//      BANNERBEAR_TEMPLATE_1080x1350  (4:5)
//      BANNERBEAR_TEMPLATE_1920x1080  (16:9)
//      BANNERBEAR_TEMPLATE_1080x1920  (9:16)
//
// Bannerbear modifications doc: https://www.bannerbear.com/help/articles/modifications/

const BANNERBEAR_API = "https://api.bannerbear.com/v2";
const IMAGE_GEN_BUCKET =
  process.env.IMAGE_GENERATION_BUCKET ?? "generated-images";

// Dimensions map for aspect-ratio → template env key
const DIMENSION_KEY_MAP: Record<string, string> = {
  "1080x1080": "BANNERBEAR_TEMPLATE_1080x1080",
  "1080x1350": "BANNERBEAR_TEMPLATE_1080x1350",
  "1920x1080": "BANNERBEAR_TEMPLATE_1920x1080",
  "1080x1920": "BANNERBEAR_TEMPLATE_1080x1920",
};

// Logo position → pixel offsets as percent of frame (for the Bannerbear logo layer)
const LOGO_POSITIONS: Record<
  NonNullable<CompositeInput["logo"]>["position"],
  (w: number, h: number, sizePercent: number, padding: number) => { x: number; y: number; width: number }
> = {
  "top-right": (w, _h, s, p) => ({
    x: w - Math.round((s / 100) * w) - p,
    y: p,
    width: Math.round((s / 100) * w),
  }),
  "bottom-right": (w, h, s, p) => ({
    x: w - Math.round((s / 100) * w) - p,
    y: h - Math.round((s / 100) * w) - p,
    width: Math.round((s / 100) * w),
  }),
  "bottom-left": (_w, h, s, p) => ({
    x: p,
    y: h - Math.round((s / 100) * _w) - p,
    width: Math.round((s / 100) * _w),
  }),
  "watermark-center": (w, h, s, _p) => ({
    x: Math.round((w - (s / 100) * w) / 2),
    y: Math.round((h - (s / 100) * w) / 2),
    width: Math.round((s / 100) * w),
  }),
};

interface BannerbearModification {
  name: string;
  text?: string;
  image_url?: string;
  x_offset?: number;
  y_offset?: number;
  width?: number;
  height?: number;
  color?: string;
  font_family?: string;
  font_size?: number;
  text_align?: string;
  visible?: boolean;
}

interface BannerbearResponse {
  uid: string;
  status: "pending" | "completed" | "failed";
  image_url: string | null;
  image_url_png: string | null;
}

function resolveTemplateUid(width: number, height: number): string {
  const key = `${width}x${height}`;
  const envKey = DIMENSION_KEY_MAP[key];
  if (!envKey) {
    throw new Error(
      `No Bannerbear template mapping for ${key}. Add to DIMENSION_KEY_MAP.`,
    );
  }
  const uid = process.env[envKey];
  if (!uid) {
    throw new Error(
      `${envKey} is not set. Create a Bannerbear template for ${key} and set the UID.`,
    );
  }
  return uid;
}

async function getBackgroundSignedUrl(
  storagePath: string,
): Promise<string> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.storage
    .from(IMAGE_GEN_BUCKET)
    .createSignedUrl(storagePath, 3600);
  if (error || !data?.signedUrl) {
    throw new Error(
      `Failed to get signed URL for ${storagePath}: ${error?.message ?? "no URL"}`,
    );
  }
  return data.signedUrl;
}

async function pollUntilComplete(
  uid: string,
  apiKey: string,
  maxWaitMs = 60_000,
): Promise<BannerbearResponse> {
  const start = Date.now();
  const delay = 2000;

  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, delay));

    const res = await fetch(`${BANNERBEAR_API}/images/${uid}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`Bannerbear poll ${uid} returned ${res.status}`);
    }
    const data = (await res.json()) as BannerbearResponse;
    if (data.status === "completed") return data;
    if (data.status === "failed") {
      throw new Error(`Bannerbear image ${uid} failed`);
    }
  }
  throw new Error(`Bannerbear image ${uid} timed out after ${maxWaitMs}ms`);
}

async function downloadAndStoreComposite(
  imageUrl: string,
  companyId: string,
  format: "jpeg" | "png",
): Promise<string> {
  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`Failed to download composite from Bannerbear: ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = format === "png" ? "png" : "jpg";
  const storagePath = `${companyId}/composite/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const supabase = getServiceRoleClient();
  const { error } = await supabase.storage
    .from(IMAGE_GEN_BUCKET)
    .upload(storagePath, buffer, {
      contentType: format === "png" ? "image/png" : "image/jpeg",
      upsert: false,
    });

  if (error) {
    throw new Error(`Failed to store composite: ${error.message}`);
  }
  return storagePath;
}

// Determine the company ID from the background storage path.
// Convention: `<companyId>/generated/<filename>` → `<companyId>`.
function extractCompanyId(storagePath: string): string {
  const parts = storagePath.split("/");
  return parts[0] ?? "unknown";
}

export async function compositeBannerbear(
  input: CompositeInput,
): Promise<CompositeResult> {
  const apiKey = process.env.BANNERBEAR_API_KEY;
  if (!apiKey) throw new Error("BANNERBEAR_API_KEY is not set");

  const start = Date.now();
  const { outputWidth: w, outputHeight: h } = input;
  const templateUid = resolveTemplateUid(w, h);
  const bgUrl = await getBackgroundSignedUrl(input.backgroundStoragePath);

  const modifications: BannerbearModification[] = [];

  // Background layer
  modifications.push({ name: "background", image_url: bgUrl });

  // Text zones (we take the first zone for now; multi-zone is I4+)
  const primaryZone = input.textZones[0];
  if (primaryZone) {
    const zoneX = Math.round((primaryZone.x / 100) * w);
    const zoneY = Math.round((primaryZone.y / 100) * h);
    const zoneW = Math.round((primaryZone.width / 100) * w);
    const zoneH = Math.round((primaryZone.height / 100) * h);

    // For overlay colour: pass a background color on the text layer
    const textColor =
      primaryZone.colour === "white"
        ? "#FFFFFF"
        : primaryZone.colour === "dark"
          ? "#1A1A1A"
          : "#FFFFFF"; // overlay: white text with semi-transparent bg (handled in template)

    modifications.push({
      name: "text_zone",
      text: primaryZone.text,
      x_offset: zoneX,
      y_offset: zoneY,
      width: zoneW,
      height: zoneH,
      color: textColor,
      font_family: primaryZone.fontFamily,
      font_size: Math.min(primaryZone.maxFontSize, Math.floor(zoneH / 4)),
      text_align: primaryZone.alignment,
    });
  }

  // Logo layer
  if (input.logo) {
    const logoCalc = LOGO_POSITIONS[input.logo.position](
      w,
      h,
      input.logo.sizePercent,
      input.logo.padding,
    );
    modifications.push({
      name: "logo",
      image_url: input.logo.url,
      x_offset: logoCalc.x,
      y_offset: logoCalc.y,
      width: logoCalc.width,
      visible: true,
    });
  } else {
    modifications.push({ name: "logo", visible: false });
  }

  // Create image in Bannerbear
  const createRes = await fetch(`${BANNERBEAR_API}/images`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      template: templateUid,
      modifications,
    }),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(
      `Bannerbear create image failed ${createRes.status}: ${body.slice(0, 200)}`,
    );
  }

  const created = (await createRes.json()) as BannerbearResponse;
  logger.info("Bannerbear image creation started", { uid: created.uid });

  // Synchronous response if status=completed immediately (unlikely but handle it)
  const completed =
    created.status === "completed"
      ? created
      : await pollUntilComplete(created.uid, apiKey);

  const imageUrl =
    input.outputFormat === "png"
      ? (completed.image_url_png ?? completed.image_url)
      : completed.image_url;

  if (!imageUrl) {
    throw new Error(`Bannerbear completed but no image URL for ${created.uid}`);
  }

  const companyId = extractCompanyId(input.backgroundStoragePath);
  const storagePath = await downloadAndStoreComposite(
    imageUrl,
    companyId,
    input.outputFormat,
  );

  const durationMs = Date.now() - start;
  logger.info("Bannerbear composite complete", {
    uid: created.uid,
    storagePath,
    durationMs,
  });

  return { storagePath, provider: "bannerbear", durationMs };
}
