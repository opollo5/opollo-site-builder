import "server-only";

// DESIGN-DISCOVERY — Microlink screenshot fetch.
//
// Per the workstream brief: "use Microlink (microlink.io) — free tier,
// no API key required, works on Vercel serverless." We just need the
// PNG screenshot URL; if Microlink is down, the caller falls back to
// CSS-only extraction silently.

const MICROLINK_TIMEOUT_MS = 12_000;

export interface MicrolinkResult {
  screenshot_url: string | null;
  ok: boolean;
  error: string | null;
}

export async function fetchMicrolinkScreenshot(
  targetUrl: string,
): Promise<MicrolinkResult> {
  const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(
    targetUrl,
  )}&screenshot=true&meta=false&embed=screenshot.url&waitForTimeout=2000`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MICROLINK_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent":
          "Opollo-Site-Builder/1.0 (+https://opollo.com) Design-Discovery",
      },
    });
    if (!res.ok) {
      return {
        screenshot_url: null,
        ok: false,
        error: `Microlink HTTP ${res.status}`,
      };
    }
    // With embed=screenshot.url Microlink returns the raw URL as text
    // in the body. Without embed it returns JSON; we handle both for
    // resilience to API changes.
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const json = (await res.json().catch(() => null)) as
        | { data?: { screenshot?: { url?: string } } }
        | null;
      const url = json?.data?.screenshot?.url ?? null;
      return {
        screenshot_url: typeof url === "string" ? url : null,
        ok: true,
        error: null,
      };
    }
    const body = (await res.text().catch(() => "")).trim();
    return {
      screenshot_url: body.startsWith("http") ? body : null,
      ok: true,
      error: null,
    };
  } catch (err) {
    return {
      screenshot_url: null,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}
