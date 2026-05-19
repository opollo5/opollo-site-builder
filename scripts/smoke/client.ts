/**
 * scripts/smoke/client.ts
 *
 * Typed fetch wrapper for smoke tests. Reads SMOKE_BASE_URL (default:
 * https://app.opollo.com) and injects the SMOKE_SESSION_COOKIE if set.
 *
 * Usage:
 *   const res = await smokeGet("/api/platform/social/drafts/123");
 *   const res = await smokePost("/api/platform/social/drafts", { ... });
 */

export const SMOKE_BASE_URL =
  process.env.SMOKE_BASE_URL ?? "https://app.opollo.com";

const SMOKE_SESSION_COOKIE = process.env.SMOKE_SESSION_COOKIE ?? "";

function buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extra,
  };
  if (SMOKE_SESSION_COOKIE) {
    headers["Cookie"] = SMOKE_SESSION_COOKIE;
  }
  return headers;
}

export async function smokeGet(path: string): Promise<Response> {
  return fetch(`${SMOKE_BASE_URL}${path}`, {
    method: "GET",
    headers: buildHeaders(),
  });
}

export async function smokePost(path: string, body: unknown): Promise<Response> {
  return fetch(`${SMOKE_BASE_URL}${path}`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });
}

export async function smokePatch(path: string, body: unknown): Promise<Response> {
  return fetch(`${SMOKE_BASE_URL}${path}`, {
    method: "PATCH",
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });
}

export async function smokeDelete(path: string): Promise<Response> {
  return fetch(`${SMOKE_BASE_URL}${path}`, {
    method: "DELETE",
    headers: buildHeaders(),
  });
}
