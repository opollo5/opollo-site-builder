import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// M11-1 — Chat surface smoke test.
//
// The chat builder is the product's headline feature per SCOPE_v3; it
// had zero Playwright coverage pre-M11-1 (audit 2026-04-22 #2). This
// spec locks the UI contract:
//
//   - Happy path: user sends a message → SSE text deltas arrive →
//     the assistant bubble accumulates tokens → "done" closes out.
//   - Error path: SSE "error" event renders an inline error in the
//     assistant bubble, stream terminates cleanly.
//
// We intercept `/api/chat` at the browser boundary and return canned
// SSE. That lets the spec run offline and deterministically — no
// Anthropic keys, no network egress. The server-side Langfuse span +
// logger wiring is exercised by unit tests / real runs; this spec's
// job is "UI → streaming → rendering, end to end."
// ---------------------------------------------------------------------------

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function primeActiveSite(page: import("@playwright/test").Page): Promise<void> {
  // HomePageClient reads the active site from localStorage + the
  // `/api/sites/list` response. Select the seeded E2E site so the
  // textarea + Send button aren't disabled.
  await page.goto("/");
  await page
    .evaluate(async () => {
      const res = await fetch("/api/sites/list", { cache: "no-store" });
      const payload = await res.json();
      const site = payload?.data?.sites?.find(
        (s: { prefix: string }) => s.prefix === "e2e",
      );
      if (!site) throw new Error("E2E site not seeded");
      window.localStorage.setItem("opollo.activeSiteId", site.id);
      window.dispatchEvent(
        new CustomEvent("opollo:active-site-changed", {
          detail: { activeSiteId: site.id, site },
        }),
      );
    })
    .catch(() => {
      // Surface failures with context — the suite can't proceed
      // without a seeded active site.
      throw new Error(
        "Failed to prime the active site via /api/sites/list. Run global-setup.",
      );
    });
}

test.describe("chat builder", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("happy path — user prompt streams back as assistant tokens", async ({
    page,
  }) => {
    await page.route("**/api/chat", async (route) => {
      const body =
        sseFrame("text", { delta: "Hello" }) +
        sseFrame("text", { delta: " there" }) +
        sseFrame("done", { stop_reason: "end_turn" });
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body,
      });
    });

    await primeActiveSite(page);

    const textarea = page.getByPlaceholder(/describe the page you want/i);
    await expect(textarea).toBeEnabled();
    await textarea.fill("Make me a homepage");
    await page.getByRole("button", { name: /send/i }).click();

    // User bubble lands first, then the assistant bubble fills with
    // the streamed deltas.
    await expect(page.getByText("Make me a homepage")).toBeVisible();
    await expect(page.getByText("Hello there")).toBeVisible();

    // Stream closed cleanly: textarea re-enables (the Send button
    // stays disabled because sendDisabled also checks `!input.trim()`
    // and HomePageClient clears input on submit).
    await expect(textarea).toBeEnabled();
  });

  test("error path — upstream failure renders an inline error bubble", async ({
    page,
  }) => {
    await page.route("**/api/chat", async (route) => {
      const body =
        sseFrame("text", { delta: "Thinking…" }) +
        sseFrame("error", {
          code: "INTERNAL_ERROR",
          message: "Anthropic upstream failed",
        });
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body,
      });
    });

    await primeActiveSite(page);

    const textarea = page.getByPlaceholder(/describe the page you want/i);
    await textarea.fill("Break something");
    await page.getByRole("button", { name: /send/i }).click();

    await expect(page.getByText(/Anthropic upstream failed/)).toBeVisible();
    // Stream closed cleanly: textarea is enabled again (disabled
    // only gates on streaming + activeSiteId; no hung "…" indicator).
    await expect(textarea).toBeEnabled();
  });
});
