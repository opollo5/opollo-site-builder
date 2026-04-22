// ---------------------------------------------------------------------------
// M4-3 — Cloudflare Images client.
//
// Minimal wrapper over the Cloudflare Images v1 API used by the image
// transfer worker. Surfaces two operations the worker cares about:
//
//   uploadImage({ id, url })         // POST /images/v1 with the provided id
//                                    // as the idempotency key. On 409
//                                    // (image id already exists) it adopts
//                                    // the existing record via GET.
//   getImage(id)                     // GET /images/v1/{id}
//
// Everything else the API can do (variants, direct creator uploads,
// signed URLs, etc.) is out of scope for M4.
//
// Design decisions:
//
//   1. `id` is ALWAYS passed as the Cloudflare-side idempotency anchor.
//      Per docs/plans/m4.md, every transfer_job_items row carries a
//      pre-computed `cloudflare_idempotency_key` (schema migration
//      0010). Passing it as Cloudflare's `id` parameter guarantees
//      duplicate POSTs return the original image without re-billing.
//
//   2. 409 adoption path is part of the contract, not a retry. A worker
//      that crashed after Cloudflare accepted the upload but before our
//      DB write retried through the reaper; that retry's POST returns
//      409 and we immediately GET the existing record and adopt it.
//      Same idempotency shape M3-6 uses for WP page adoption.
//
//   3. Error classification is based on HTTP status, not Cloudflare's
//      per-body error codes. HTTP status is stable across API minor
//      versions; individual error codes drift. Retryable: 429, 5xx,
//      network/abort. Non-retryable: 400, 401, 403, 404, 413, 422.
//
//   4. No auto-retry inside this module. The worker's retry budget
//      (retry_count + RETRY_BACKOFF_MS) is the single retry policy —
//      adding a second layer here would make backoff windows additive
//      and the audit log confusing.
//
//   5. Request timeout: 30s via AbortController. Cloudflare's upload
//      endpoint occasionally hangs on a poisoned source URL; without a
//      timeout the worker lease expires mid-call and the reaper
//      re-races us. 30s is well under the 180s lease window.
//
//   6. Env-var guard: getCloudflareConfig() throws only when
//      uploadImage/getImage is actually called. Modules that import
//      this file for its types don't pay the cost at build time.
//      (Build can't fail on a missing env var — Vercel provisions
//      secrets in the runtime env, not the build env.)
// ---------------------------------------------------------------------------

const CLOUDFLARE_API_ROOT = "https://api.cloudflare.com/client/v4";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export type CloudflareImageRecord = {
  id: string;
  filename: string | null;
  uploaded: string | null;
  variants: string[];
};

export type CloudflareUploadRequest = {
  id: string;
  url: string;
  metadata?: Record<string, string>;
};

export type CloudflareFailureCode =
  | "CLOUDFLARE_RATE_LIMITED"
  | "CLOUDFLARE_SERVER_ERROR"
  | "CLOUDFLARE_NETWORK_ERROR"
  | "CLOUDFLARE_AUTH_ERROR"
  | "CLOUDFLARE_PAYLOAD_TOO_LARGE"
  | "CLOUDFLARE_BAD_REQUEST"
  | "CLOUDFLARE_NOT_FOUND"
  | "CLOUDFLARE_UNPROCESSABLE"
  | "CLOUDFLARE_CONFIG_MISSING"
  | "CLOUDFLARE_TIMEOUT"
  | "CLOUDFLARE_PARSE_FAILED";

export class CloudflareCallError extends Error {
  public readonly code: CloudflareFailureCode;
  public readonly retryable: boolean;
  public readonly httpStatus: number | null;

  constructor(
    code: CloudflareFailureCode,
    message: string,
    opts: { retryable: boolean; httpStatus?: number | null } = {
      retryable: false,
    },
  ) {
    super(message);
    this.name = "CloudflareCallError";
    this.code = code;
    this.retryable = opts.retryable;
    this.httpStatus = opts.httpStatus ?? null;
  }
}

export function classifyHttpStatus(status: number): {
  code: CloudflareFailureCode;
  retryable: boolean;
} {
  if (status === 429) return { code: "CLOUDFLARE_RATE_LIMITED", retryable: true };
  if (status >= 500) return { code: "CLOUDFLARE_SERVER_ERROR", retryable: true };
  if (status === 401 || status === 403) {
    return { code: "CLOUDFLARE_AUTH_ERROR", retryable: false };
  }
  if (status === 404) return { code: "CLOUDFLARE_NOT_FOUND", retryable: false };
  if (status === 413) {
    return { code: "CLOUDFLARE_PAYLOAD_TOO_LARGE", retryable: false };
  }
  if (status === 422) return { code: "CLOUDFLARE_UNPROCESSABLE", retryable: false };
  return { code: "CLOUDFLARE_BAD_REQUEST", retryable: false };
}

export type CloudflareConfig = {
  accountId: string;
  apiToken: string;
  deliveryHash: string | null;
};

export function readCloudflareConfig(): CloudflareConfig {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_IMAGES_API_TOKEN;
  const deliveryHash = process.env.CLOUDFLARE_IMAGES_HASH ?? null;
  if (!accountId || !apiToken) {
    throw new CloudflareCallError(
      "CLOUDFLARE_CONFIG_MISSING",
      "CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_IMAGES_API_TOKEN must be set for uploads.",
      { retryable: false },
    );
  }
  return { accountId, apiToken, deliveryHash };
}

type CloudflareApiEnvelope<T> = {
  result: T | null;
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
};

function parseRecord(raw: unknown): CloudflareImageRecord {
  if (!raw || typeof raw !== "object") {
    throw new CloudflareCallError(
      "CLOUDFLARE_PARSE_FAILED",
      "Cloudflare response body missing `result`.",
      { retryable: false },
    );
  }
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  if (!id) {
    throw new CloudflareCallError(
      "CLOUDFLARE_PARSE_FAILED",
      "Cloudflare response body missing `result.id`.",
      { retryable: false },
    );
  }
  const variants = Array.isArray(record.variants)
    ? (record.variants.filter((v) => typeof v === "string") as string[])
    : [];
  return {
    id,
    filename: typeof record.filename === "string" ? record.filename : null,
    uploaded: typeof record.uploaded === "string" ? record.uploaded : null,
    variants,
  };
}

// Narrow detector for "id already in use" across api versions. When this
// signal appears we switch to the GET-by-id adoption path; everything
// else is a real error.
function isIdAlreadyExistsError(
  envelope: CloudflareApiEnvelope<unknown>,
): boolean {
  return envelope.errors.some((e) => {
    const msg = (e.message ?? "").toLowerCase();
    return (
      msg.includes("already exists") ||
      msg.includes("resource_already_exists") ||
      e.code === 5461
    );
  });
}

async function httpCall(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new CloudflareCallError(
        "CLOUDFLARE_TIMEOUT",
        `Cloudflare request timed out after ${timeoutMs}ms`,
        { retryable: true, httpStatus: null },
      );
    }
    throw new CloudflareCallError(
      "CLOUDFLARE_NETWORK_ERROR",
      err instanceof Error ? err.message : String(err),
      { retryable: true, httpStatus: null },
    );
  } finally {
    clearTimeout(timer);
  }
}

export type CloudflareFetchFn = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export type UploadOptions = {
  config?: CloudflareConfig;
  fetchImpl?: CloudflareFetchFn;
  timeoutMs?: number;
};

/**
 * POST /accounts/{id}/images/v1 with the supplied id as idempotency.
 *
 * Success cases:
 *   - 200 + success=true → upload accepted; return the record.
 *   - 409 OR 200+success=false with "already exists" error → adopt
 *     via GET /accounts/{id}/images/v1/{id} and return that record.
 *
 * Failure cases:
 *   - Retryable (429, 5xx, network, timeout) → CloudflareCallError with
 *     retryable=true.
 *   - Non-retryable (4xx other than 409) → CloudflareCallError with
 *     retryable=false.
 */
export async function uploadImage(
  req: CloudflareUploadRequest,
  opts: UploadOptions = {},
): Promise<CloudflareImageRecord> {
  const config = opts.config ?? readCloudflareConfig();
  const endpoint = `${CLOUDFLARE_API_ROOT}/accounts/${config.accountId}/images/v1`;

  const body = new FormData();
  body.append("id", req.id);
  body.append("url", req.url);
  if (req.metadata) {
    body.append("metadata", JSON.stringify(req.metadata));
  }

  const call: CloudflareFetchFn =
    opts.fetchImpl ??
    ((url, init) => httpCall(url, init, opts.timeoutMs));

  const res = await call(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiToken}` },
    body,
  });

  // Parse envelope regardless of status — Cloudflare returns JSON on all
  // non-network error paths.
  let envelope: CloudflareApiEnvelope<unknown> | null = null;
  try {
    envelope = (await res.json()) as CloudflareApiEnvelope<unknown>;
  } catch {
    // body wasn't JSON — fall through to status-based classification.
  }

  if (res.ok && envelope?.success && envelope.result) {
    return parseRecord(envelope.result);
  }

  // Adoption: existing image with our id. Happens on retry after a
  // partial-commit crash.
  if (
    res.status === 409 ||
    (envelope != null && !envelope.success && isIdAlreadyExistsError(envelope))
  ) {
    return getImage(req.id, { config, fetchImpl: opts.fetchImpl });
  }

  // Classify remaining errors by HTTP status.
  const classified = classifyHttpStatus(res.status);
  const detail =
    envelope?.errors
      ?.map((e) => `${e.code}:${e.message}`)
      .join("; ") || `HTTP ${res.status}`;
  throw new CloudflareCallError(classified.code, detail, {
    retryable: classified.retryable,
    httpStatus: res.status,
  });
}

export async function getImage(
  id: string,
  opts: UploadOptions = {},
): Promise<CloudflareImageRecord> {
  const config = opts.config ?? readCloudflareConfig();
  const endpoint = `${CLOUDFLARE_API_ROOT}/accounts/${config.accountId}/images/v1/${encodeURIComponent(id)}`;

  const call: CloudflareFetchFn =
    opts.fetchImpl ??
    ((url, init) => httpCall(url, init, opts.timeoutMs));

  const res = await call(endpoint, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.apiToken}` },
  });

  let envelope: CloudflareApiEnvelope<unknown> | null = null;
  try {
    envelope = (await res.json()) as CloudflareApiEnvelope<unknown>;
  } catch {
    // fall through
  }

  if (res.ok && envelope?.success && envelope.result) {
    return parseRecord(envelope.result);
  }

  const classified = classifyHttpStatus(res.status);
  const detail =
    envelope?.errors
      ?.map((e) => `${e.code}:${e.message}`)
      .join("; ") || `HTTP ${res.status}`;
  throw new CloudflareCallError(classified.code, detail, {
    retryable: classified.retryable,
    httpStatus: res.status,
  });
}

// Constructs the delivery URL for a variant. Not needed by the upload
// worker but useful for M4-7's WP transfer stage and ad-hoc inspection.
export function deliveryUrl(
  cloudflareId: string,
  variant: string = "public",
  config?: Pick<CloudflareConfig, "deliveryHash">,
): string | null {
  const hash = config?.deliveryHash ?? process.env.CLOUDFLARE_IMAGES_HASH ?? null;
  if (!hash) return null;
  return `https://imagedelivery.net/${hash}/${cloudflareId}/${variant}`;
}
