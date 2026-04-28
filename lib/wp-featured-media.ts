import { logger } from "@/lib/logger";
import { deliveryUrl } from "@/lib/cloudflare-images";
import type { WpConfig } from "@/lib/wordpress";

// ---------------------------------------------------------------------------
// BP-7 — Featured-image transfer to WP /wp/v2/media.
//
// Used by the publish route. Standalone of lib/wp-media-transfer.ts —
// that helper batches images discovered in a page's HTML body; this
// one transfers a single explicit image_library row to WP and returns
// the new wp_media_id. Idempotency: callers persist the returned id
// onto posts.featured_wp_media_id and skip this call on re-publish.
//
// Failure modes:
//   - Cloudflare delivery fetch fails  → throws WpFeaturedMediaError(
//       "FETCH_FAILED", retryable: true)
//   - WP /media POST returns 4xx        → throws (retryable: false)
//   - WP /media POST returns 5xx / net  → throws (retryable: true)
// ---------------------------------------------------------------------------

export class WpFeaturedMediaError extends Error {
  constructor(
    public readonly code:
      | "FETCH_FAILED"
      | "WP_AUTH_FAILED"
      | "WP_REJECTED"
      | "WP_RETRYABLE"
      | "CONFIG_MISSING",
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "WpFeaturedMediaError";
  }
}

export interface UploadFeaturedMediaInput {
  cloudflareId: string;
  filename?: string | null;
  /** Stable marker WP persists as the file title; lets re-publish recover via search. */
  marker: string;
}

export interface UploadedMediaResult {
  wp_media_id: number;
  source_url: string;
}

const REQUEST_TIMEOUT_MS = 30_000;

async function fetchCloudflareBytes(
  cloudflareId: string,
): Promise<{ bytes: ArrayBuffer; mimeType: string; filename: string }> {
  const url = deliveryUrl(cloudflareId);
  if (!url) {
    throw new WpFeaturedMediaError(
      "CONFIG_MISSING",
      "CLOUDFLARE_IMAGES_HASH not set; cannot construct delivery URL.",
      false,
    );
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch (err) {
    throw new WpFeaturedMediaError(
      "FETCH_FAILED",
      `Cloudflare fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new WpFeaturedMediaError(
      "FETCH_FAILED",
      `Cloudflare returned ${res.status} for ${cloudflareId}.`,
      res.status >= 500,
    );
  }
  const mimeType = res.headers.get("content-type") ?? "image/jpeg";
  const bytes = await res.arrayBuffer();
  const fallbackName = `${cloudflareId.replace(/[^A-Za-z0-9._-]+/g, "_")}.${mimeType.split("/")[1] ?? "jpg"}`;
  return { bytes, mimeType, filename: fallbackName };
}

function basicAuthHeader(user: string, appPassword: string): string {
  const token = Buffer.from(`${user}:${appPassword}`).toString("base64");
  return `Basic ${token}`;
}

export async function uploadFeaturedMedia(
  cfg: WpConfig,
  input: UploadFeaturedMediaInput,
): Promise<UploadedMediaResult> {
  const { bytes, mimeType, filename: cfFilename } = await fetchCloudflareBytes(
    input.cloudflareId,
  );
  // Use the stable marker as the filename so re-publish + WP-side
  // search can find the existing media without a separate metadata
  // round-trip.
  const ext = (cfFilename.split(".").pop() ?? "jpg").toLowerCase();
  const filename = `${input.marker}.${ext}`;

  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(new Uint8Array(bytes));

  const form = new FormData();
  form.append("file", new Blob([ab], { type: mimeType }), filename);
  form.append("title", input.marker);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/wp-json/wp/v2/media`, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(cfg.user, cfg.appPassword),
      },
      body: form,
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new WpFeaturedMediaError(
      "WP_RETRYABLE",
      `WP /media network error: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  } finally {
    clearTimeout(timer);
  }

  const bodyText = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = null;
  }

  if (res.status === 401 || res.status === 403) {
    throw new WpFeaturedMediaError(
      "WP_AUTH_FAILED",
      `WP /media rejected auth (${res.status}).`,
      false,
    );
  }
  if (res.status >= 400 && res.status < 500) {
    logger.warn("wp.featured_media.rejected", {
      status: res.status,
      cloudflare_id: input.cloudflareId,
      body_excerpt: bodyText.slice(0, 200),
    });
    throw new WpFeaturedMediaError(
      "WP_REJECTED",
      `WP /media returned ${res.status}.`,
      false,
    );
  }
  if (res.status >= 500) {
    throw new WpFeaturedMediaError(
      "WP_RETRYABLE",
      `WP /media returned ${res.status}.`,
      true,
    );
  }

  const obj = (body ?? {}) as {
    id?: number;
    source_url?: string;
  };
  if (typeof obj.id !== "number" || obj.id <= 0) {
    throw new WpFeaturedMediaError(
      "WP_REJECTED",
      "WP /media response missing numeric `id`.",
      false,
    );
  }
  return {
    wp_media_id: obj.id,
    source_url: typeof obj.source_url === "string" ? obj.source_url : "",
  };
}
