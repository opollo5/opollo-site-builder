import { test, expect } from "@playwright/test";

// Regression test: Chrome extensions (Grammarly, ClickUp, LastPass, Bitwarden)
// inject attributes/elements into <html> and <body> before React hydrates.
// suppressHydrationWarning on both elements prevents React from bailing out
// on hydration mismatch — the form is server-rendered and remains visible.
//
// Key invariants:
// 1. The form must be in the server-rendered HTML (not JS-only)
// 2. The form must remain visible after extension DOM injections
// 3. React must not call history.replaceState excessively (>5 calls would
//    indicate the BailoutToCSR/ssr:false pattern is re-introduced, which
//    triggers Chrome's navigation throttling at 100+ calls/30s)
test("login renders with simulated extension injection", async ({ page }) => {
  let replaceStateCalls = 0;
  await page.addInitScript(() => {
    // Track history.replaceState calls — excessive calls indicate the
    // ssr:false BailoutToCSR pattern which causes Chrome throttling.
    const orig = history.replaceState.bind(history);
    history.replaceState = function (...args) {
      (window as unknown as Record<string, number>).__replaceStateCount =
        ((window as unknown as Record<string, number>).__replaceStateCount ??
          0) + 1;
      return orig(...args);
    };

    // Inject Grammarly attributes before page load, exactly as the extension does.
    document.documentElement.setAttribute(
      "data-new-gr-c-s-check-loaded",
      "14.1294.0",
    );
    document.documentElement.setAttribute("data-gr-ext-installed", "");
  });

  await page.goto(
    "https://opollo-site-builder-git-staging-opollo5.vercel.app/login",
  );

  // Inject ClickUp + LastPass DOM mutations after navigation (as extensions do post-load).
  await page.evaluate(() => {
    document.body.classList.add("clickup-chrome-ext_installed");
    const lp = document.createElement("div");
    lp.setAttribute("data-lastpass-root", "");
    document.body.appendChild(lp);
    const gr = document.createElement("grammarly-desktop-integration");
    document.body.appendChild(gr);
  });

  // Wait for React to hydrate — 3s is ample for cold start.
  await page.waitForTimeout(3000);

  // 1. Form inputs are visible.
  await expect(page.locator('input[type="email"]')).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();

  // 2. The form must be in the initial server-rendered HTML — not JS-only.
  //    Disable JS and reload to verify.
  const context2 = await page.context().browser()!.newContext({
    javaScriptEnabled: false,
  });
  const noJsPage = await context2.newPage();
  await noJsPage.goto(
    "https://opollo-site-builder-git-staging-opollo5.vercel.app/login",
  );
  await expect(noJsPage.locator('input[type="email"]')).toBeVisible({
    timeout: 10000,
  });
  await expect(noJsPage.locator('input[type="password"]')).toBeVisible();
  await context2.close();

  // 3. No excessive replaceState calls (>5 indicates a re-render loop).
  replaceStateCalls = await page.evaluate(
    () =>
      (window as unknown as Record<string, number>).__replaceStateCount ?? 0,
  );
  expect(replaceStateCalls).toBeLessThan(5);
});
