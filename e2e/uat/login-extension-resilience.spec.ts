import { test, expect } from "@playwright/test";

// Regression test: Chrome extensions (Grammarly, ClickUp, LastPass, Bitwarden)
// inject attributes/elements into <html> and <body> before React hydrates.
// Without suppressHydrationWarning + ssr:false on LoginForm, this causes a
// hydration bailout that leaves the page blank for users with extensions.
test("login renders with simulated extension injection", async ({ page }) => {
  // Inject Grammarly attributes before page load, exactly as the extension does
  await page.addInitScript(() => {
    document.documentElement.setAttribute(
      "data-new-gr-c-s-check-loaded",
      "14.1294.0",
    );
    document.documentElement.setAttribute("data-gr-ext-installed", "");
  });

  await page.goto(
    "https://opollo-site-builder-git-staging-opollo5.vercel.app/login",
  );

  // Inject ClickUp + LastPass DOM mutations after navigation (as extensions do)
  await page.evaluate(() => {
    document.body.classList.add("clickup-chrome-ext_installed");
    const lp = document.createElement("div");
    lp.setAttribute("data-lastpass-root", "");
    document.body.appendChild(lp);
  });

  await page.waitForTimeout(3000);

  await expect(page.locator('input[type="email"]')).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});
