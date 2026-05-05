import { expect, test, type Page, type Route } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// DESIGN-DISCOVERY-FOLLOWUP PR 4 — Playwright spec for the setup
// wizard's design + tone flows.
//
// Anthropic isn't reachable from CI without a real key — the spec
// stubs every server route that fans out to it (generate-concepts,
// refine-concept, extract-tone, regenerate-tone-samples, apply-tone).
// We DON'T stub /save-brief, /approve-design, /approve-tone, or
// /skip — those write to Supabase and need the real handler so the
// status-column state machine is exercised end-to-end.
//
// Stub pattern matches the existing site-setup.spec.ts +
// sites.spec.ts: page.route("**/api/...", fulfill(...)) before the
// flow starts.
// ---------------------------------------------------------------------------

const HOMEPAGE_HTML = `<!doctype html><html><head><style>body{font-family:Inter,sans-serif;background:#fff;color:#111;}.hero{padding:64px 24px;}h1{font-size:48px;margin:0;}p{margin:16px 0 0;}.cta{margin-top:24px;display:inline-block;padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:8px;}</style></head><body><section class="hero"><h1>Stub Hero — A</h1><p>Fixture homepage produced by the e2e stub.</p><a class="cta" href="#">Get started</a></section></body></html>`;

const INNER_HTML = `<!doctype html><html><head><style>body{font-family:Inter,sans-serif;background:#fff;color:#111;}main{padding:32px 24px;}h1{font-size:32px;}</style></head><body><main><h1>Inner page — A</h1><p>Fixture inner page from the stub.</p></main></body></html>`;

const REFINED_HOMEPAGE_HTML = HOMEPAGE_HTML.replace(
  "Stub Hero — A",
  "Refined Hero — A",
).replace("Get started", "See pricing");

const TONE_SAMPLE_HERO =
  "We help mid-market MSPs ship more, support better, and stop firefighting at 2am.";
const TONE_SAMPLE_SERVICE =
  "Our managed cybersecurity service is the second pair of eyes that catches every silent failure before it bills the client.";
const TONE_SAMPLE_BLOG =
  "Most managed-services blogs read like a CV in an elevator. Ours doesn't — we open with what changed and why it matters this week.";

async function stubTestConnection(page: Page): Promise<void> {
  await page.route("**/api/sites/test-connection", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        user: {
          display_name: "E2E WP Admin",
          username: "wpadmin",
          roles: ["administrator"],
        },
      }),
    });
  });
}

interface ConceptStubOpts {
  homepage?: string;
  inner?: string;
  rationale?: string;
}

function buildConcept(direction: "minimal" | "dense" | "editorial", opts: ConceptStubOpts = {}) {
  return {
    direction,
    label: direction,
    rationale: opts.rationale ?? `Stub rationale for ${direction}.`,
    design_tokens: {
      primary: "#1f2937",
      secondary: "#6b7280",
      accent: "#0ea5e9",
      background: "#ffffff",
      text: "#111111",
      font_heading: "Inter",
      font_body: "Inter",
      border_radius: "8px",
      spacing_unit: "8px",
    },
    homepage_html: opts.homepage ?? HOMEPAGE_HTML,
    inner_page_html: opts.inner ?? INNER_HTML,
    micro_ui: {
      button: '<button style="padding:8px 16px;background:#111;color:#fff;border-radius:8px">Click</button>',
      card: '<div style="padding:16px;border:1px solid #ccc;border-radius:8px">Card</div>',
      input: '<input style="padding:8px;border:1px solid #ccc;border-radius:8px" value="Email" />',
    },
    normalization_warnings: [],
  };
}

async function stubGenerateConcepts(page: Page): Promise<void> {
  await page.route(
    "**/api/admin/sites/*/setup/generate-concepts",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            concepts: [
              buildConcept("minimal", {
                rationale: "Spacious, minimal, lots of whitespace.",
              }),
              buildConcept("dense", {
                rationale: "Conversion-focused: dense grid, clear CTAs.",
              }),
              buildConcept("editorial", {
                rationale: "Editorial type, magazine-style hero.",
              }),
            ],
            errors: [],
          },
          timestamp: new Date().toISOString(),
        }),
      });
    },
  );
}

async function stubRefineConcept(page: Page): Promise<void> {
  await page.route(
    "**/api/admin/sites/*/setup/refine-concept",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: buildConcept("minimal", {
            homepage: REFINED_HOMEPAGE_HTML,
            rationale: "Refined per the operator's feedback.",
          }),
          timestamp: new Date().toISOString(),
        }),
      });
    },
  );
}

async function stubExtractTone(page: Page): Promise<void> {
  await page.route(
    "**/api/admin/sites/*/setup/extract-tone",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            tone_of_voice: {
              formality_level: 3,
              sentence_length: "medium",
              jargon_usage: "neutral",
              personality_markers: ["confident", "warm"],
              avoid_markers: ["robotic"],
              target_audience: "MSP business owners.",
              style_guide:
                "Direct, plain English. No buzzwords. Active voice. Short paragraphs.",
            },
            samples: [
              { kind: "hero", text: TONE_SAMPLE_HERO },
              { kind: "service", text: TONE_SAMPLE_SERVICE },
              { kind: "blog", text: TONE_SAMPLE_BLOG },
            ],
          },
          timestamp: new Date().toISOString(),
        }),
      });
    },
  );
}

async function stubRegenerateToneSamples(page: Page): Promise<void> {
  await page.route(
    "**/api/admin/sites/*/setup/regenerate-tone-samples",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            samples: [
              { kind: "hero", text: `${TONE_SAMPLE_HERO} (regenerated)` },
              { kind: "service", text: `${TONE_SAMPLE_SERVICE} (regenerated)` },
              { kind: "blog", text: `${TONE_SAMPLE_BLOG} (regenerated)` },
            ],
          },
          timestamp: new Date().toISOString(),
        }),
      });
    },
  );
}

async function stubApplyTone(page: Page): Promise<void> {
  // Best-effort fire-and-forget on the client. Stub a 200 so it
  // doesn't pollute logs.
  await page.route(
    "**/api/admin/sites/*/setup/apply-tone",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          timestamp: new Date().toISOString(),
        }),
      });
    },
  );
}

async function createSiteAndOpenSetup(
  page: Page,
  name: string,
): Promise<string> {
  await page.goto("/admin/sites/new");
  await page.getByTestId("site-name").fill(name);
  await page.getByTestId("site-wp-url").fill("https://design-discovery.test");
  await page.getByTestId("site-wp-user").fill("wp");
  await page.getByTestId("site-wp-password").fill("password-1234");
  await page.getByTestId("site-test-connection").click();
  await expect(page.getByTestId("site-test-result")).toContainText(
    /Connected as/i,
  );
  await page.getByTestId("site-create-save").click();
  // DESIGN-SYSTEM-OVERHAUL (PR 6) — fresh sites first land on the
  // /onboarding mode-selection screen. Pick "Build a new website" to
  // reach the design-discovery wizard.
  await page.waitForURL(/\/admin\/sites\/[0-9a-f-]{36}\/onboarding/);
  const id = page.url().match(/\/admin\/sites\/([0-9a-f-]{36})/)?.[1];
  if (!id) throw new Error(`Failed to extract site id from ${page.url()}`);
  await page.getByTestId("site-onboarding-option-new_design").click();
  await page.getByTestId("site-onboarding-submit").click();
  await page.waitForURL(/\/admin\/sites\/[0-9a-f-]{36}\/setup\?step=1/);
  return id;
}

test.describe("design discovery wizard", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await stubTestConnection(page);
  });

  test("happy path: text → 3 concepts → select → approve → tone → samples → approve → done", async ({
    page,
  }, testInfo) => {
    await stubGenerateConcepts(page);
    await stubExtractTone(page);
    await stubRegenerateToneSamples(page);
    await stubApplyTone(page);

    const id = await createSiteAndOpenSetup(
      page,
      `DD Happy ${Date.now()}`,
    );

    // Step 1 — design direction.
    await expect(page.getByTestId("setup-step-1")).toBeVisible();
    await auditA11y(page, testInfo);

    await page
      .getByTestId("dd-description")
      .fill(
        "Premium MSP brand. Lots of whitespace. Subtle blue accents. Two-column hero. Crisp sans-serif headings.",
      );
    await page.getByTestId("dd-generate").click();
    await expect(page.getByTestId("dd-concepts-ready")).toBeVisible();

    // 3 cards rendered.
    await expect(page.getByTestId("concept-card-minimal")).toBeVisible();
    await expect(page.getByTestId("concept-card-dense")).toBeVisible();
    await expect(page.getByTestId("concept-card-editorial")).toBeVisible();

    // Select Direction A (minimal) — opens the refinement view.
    await page.getByTestId("concept-select-minimal").click();
    await expect(page.getByTestId("concept-refinement")).toBeVisible();

    // Approve without refining.
    await page.getByTestId("concept-refinement-approve").click();
    await expect(page.getByTestId("approved-design-readout")).toBeVisible();

    // Continue to Step 2.
    await page.getByTestId("setup-step-1-continue").click();
    await page.waitForURL(new RegExp(`/admin/sites/${id}/setup\\?step=2`));
    await expect(page.getByTestId("setup-step-2")).toBeVisible();
    await auditA11y(page, testInfo);

    // Step 2 — tone of voice.
    await page
      .getByTestId("tov-sample")
      .fill(
        "We're an MSP that's been working with mid-market clients for 10 years. We don't oversell, we don't undersell.",
      );
    await page.getByTestId("tov-extract").click();
    await expect(page.getByTestId("tov-summary")).toBeVisible();
    await expect(page.getByTestId("tov-samples")).toBeVisible();
    await expect(page.getByTestId("tov-sample-hero")).toContainText(
      /MSPs ship more/i,
    );

    // Approve tone.
    await page.getByTestId("tov-approve").click();
    await page.waitForURL(new RegExp(`/admin/sites/${id}/setup\\?step=3`));
    await expect(page.getByTestId("setup-step-3")).toBeVisible();
    await auditA11y(page, testInfo);

    // Done CTA returns to the site detail.
    await page.getByTestId("setup-step-3-finish").click();
    await page.waitForURL(new RegExp(`/admin/sites/${id}$`));
  });

  test("skip path: skip both steps → done with using-defaults messaging", async ({
    page,
  }) => {
    const id = await createSiteAndOpenSetup(
      page,
      `DD Skip ${Date.now()}`,
    );

    await expect(page.getByTestId("setup-step-1")).toBeVisible();
    await page.getByTestId("setup-step-1-skip").click();
    await page.waitForURL(new RegExp(`/admin/sites/${id}/setup\\?step=2`));

    await expect(page.getByTestId("setup-step-2")).toBeVisible();
    await page.getByTestId("tov-skip").click();
    await page.waitForURL(new RegExp(`/admin/sites/${id}/setup\\?step=3`));

    await expect(page.getByTestId("setup-step-3")).toBeVisible();
    await expect(
      page.getByText(
        /You're using default styles\. Set these up any time from Site Settings\./i,
      ),
    ).toBeVisible();
  });

  test("refinement: select direction → refine with feedback → updated concept renders", async ({
    page,
  }) => {
    await stubGenerateConcepts(page);
    await stubRefineConcept(page);

    await createSiteAndOpenSetup(page, `DD Refine ${Date.now()}`);

    await page
      .getByTestId("dd-description")
      .fill("Editorial, type-led, magazine feel.");
    await page.getByTestId("dd-generate").click();
    await expect(page.getByTestId("dd-concepts-ready")).toBeVisible();

    await page.getByTestId("concept-select-minimal").click();
    await expect(page.getByTestId("concept-refinement")).toBeVisible();

    await page
      .getByTestId("concept-refinement-feedback")
      .fill("Make the hero shorter. Use 'See pricing' instead of 'Get started'.");
    await page.getByTestId("concept-refinement-refine").click();

    // Counter advances; previous slot is now populated.
    await expect(page.getByTestId("concept-refinement-counter")).toContainText(
      /1\/10/,
    );
    await expect(page.getByTestId("concept-refinement-previous")).toBeVisible();

    // The current iframe srcdoc reflects the refined fixture HTML.
    const currentFrame = page
      .getByTestId("concept-refinement-current")
      .locator("iframe");
    await expect(currentFrame).toHaveAttribute("srcdoc", /Refined Hero/);
  });

  test("error state: generate-concepts API failure surfaces the banner; retry works on success", async ({
    page,
  }) => {
    let firstAttempt = true;
    const handler = async (route: Route) => {
      if (firstAttempt) {
        firstAttempt = false;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            error: {
              code: "GENERATION_FAILED",
              message: "Stubbed Anthropic outage.",
              retryable: true,
            },
            timestamp: new Date().toISOString(),
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            concepts: [
              buildConcept("minimal"),
              buildConcept("dense"),
              buildConcept("editorial"),
            ],
            errors: [],
          },
          timestamp: new Date().toISOString(),
        }),
      });
    };
    await page.route(
      "**/api/admin/sites/*/setup/generate-concepts",
      handler,
    );

    await createSiteAndOpenSetup(page, `DD Error ${Date.now()}`);
    await page.getByTestId("dd-description").fill("MSP brand, premium feel.");
    await page.getByTestId("dd-generate").click();

    // First attempt → error banner.
    await expect(page.getByTestId("dd-generation-failed")).toBeVisible();
    await expect(page.getByTestId("dd-generation-failed")).toContainText(
      /Stubbed Anthropic outage/i,
    );

    // Retry by clicking the same Generate CTA.
    await page.getByTestId("dd-generate").click();
    await expect(page.getByTestId("dd-concepts-ready")).toBeVisible();
    await expect(page.getByTestId("concept-card-minimal")).toBeVisible();
  });
});
