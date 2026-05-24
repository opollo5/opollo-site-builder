import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// UAT harness auth helper.
//
// Signs in as the ghost user (uat-bot@staging.opollo.com) via the
// /api/uat/sign-in bypass route. The route requires a bearer token
// (STAGING_UAT_SECRET) and returns a Supabase session.
//
// The POST is made via page.request (bound to the browser context), so
// the Set-Cookie headers from the response are automatically stored in
// the browser context. Subsequent page.goto() calls to the staging app
// will carry those cookies.
//
// Required env vars (set in GitHub Actions secrets + Playwright config):
//   UAT_BASE_URL      — staging URL (defaults to the known Vercel alias)
//   STAGING_UAT_SECRET — bearer token matching the Vercel env var
//   STAGING_UAT_EMAIL  — ghost user email (defaults to uat-bot@staging.opollo.com)
// ---------------------------------------------------------------------------

export const UAT_BASE_URL =
  process.env.UAT_BASE_URL ??
  "https://opollo-site-builder-git-staging-opollo5.vercel.app";

export const UAT_EMAIL =
  process.env.STAGING_UAT_EMAIL ?? "uat-bot@staging.opollo.com";

export type UatSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email: string; role: string };
};

/**
 * Authenticate as the UAT ghost user.
 *
 * Makes a POST to /api/uat/sign-in on the staging deployment. The
 * response cookies are written into the browser context automatically
 * by Playwright (page.request is context-bound). After this call,
 * page.goto() to any staging page will use the authenticated session.
 *
 * Throws if STAGING_UAT_SECRET is missing or the sign-in request fails.
 */
export async function signInAsUatBot(page: Page): Promise<UatSession> {
  const secret = process.env.STAGING_UAT_SECRET;
  if (!secret) {
    throw new Error(
      "STAGING_UAT_SECRET is not set. Add it to your .env.uat or GitHub Actions secrets.",
    );
  }

  const signInUrl = `${UAT_BASE_URL}/api/uat/sign-in`;

  const res = await page.request.post(signInUrl, {
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    data: { email: UAT_EMAIL },
  });

  if (!res.ok()) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(
      `UAT sign-in failed: HTTP ${res.status()} — ${body}`,
    );
  }

  const session = (await res.json()) as UatSession;

  // Verify the response has the expected shape before trusting it
  if (!session.access_token || !session.refresh_token) {
    throw new Error(
      "UAT sign-in: response missing access_token or refresh_token",
    );
  }

  return session;
}

/**
 * Navigate to a page as the authenticated UAT ghost user.
 * Calls signInAsUatBot then navigates to the given path.
 */
export async function navigateAsUatBot(
  page: Page,
  path: string,
): Promise<UatSession> {
  const session = await signInAsUatBot(page);
  await page.goto(`${UAT_BASE_URL}${path}`);
  return session;
}
