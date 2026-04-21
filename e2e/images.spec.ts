import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// M5-1 — /admin/images E2E coverage.
//
// Seeds three image_library rows via the service-role REST client
// (the globalSetup script only knows how to seed users + a site), then
// drives the real sign-in flow + navigates to the images surface.
//
// Each test re-seeds to work alongside the per-test TRUNCATE that the
// unit suite relies on — the E2E suite hits the same local Supabase,
// so the data must be established after sign-in but before the nav.
// ---------------------------------------------------------------------------

type ImageSeed = {
  source_ref: string;
  caption: string;
  alt_text: string;
  tags: string[];
  source?: "istock" | "upload" | "generated";
};

const E2E_SEEDS: ImageSeed[] = [
  {
    source_ref: "e2e-img-cat",
    caption: "E2E fixture: tabby cat seated by a bright window.",
    alt_text: "Tabby cat by window.",
    tags: ["cat", "indoor", "e2e-fixture"],
    source: "istock",
  },
  {
    source_ref: "e2e-img-river",
    caption: "E2E fixture: wide river cutting a forest valley at dusk.",
    alt_text: "River at dusk.",
    tags: ["river", "landscape", "e2e-fixture"],
    source: "istock",
  },
  {
    source_ref: "e2e-img-upload",
    caption: "E2E fixture: operator-uploaded product hero shot.",
    alt_text: "Product hero.",
    tags: ["product", "upload", "e2e-fixture"],
    source: "upload",
  },
];

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`E2E images.spec: ${name} is not set.`);
  return v;
}

function serviceRoleClient() {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function seedImages(): Promise<void> {
  const supabase = serviceRoleClient();
  // Clear any prior fixture rows by source_ref so the assertions stay
  // deterministic even if a prior run aborted mid-flight.
  const refs = E2E_SEEDS.map((s) => s.source_ref);
  await supabase.from("image_library").delete().in("source_ref", refs);
  for (const seed of E2E_SEEDS) {
    const { error } = await supabase.from("image_library").insert({
      source: seed.source ?? "istock",
      source_ref: seed.source_ref,
      filename: `${seed.source_ref}.jpg`,
      caption: seed.caption,
      alt_text: seed.alt_text,
      tags: seed.tags,
      width_px: 1024,
      height_px: 768,
    });
    if (error) throw new Error(`seedImages insert failed: ${error.message}`);
  }
}

test.describe("images admin surface", () => {
  test.beforeEach(async ({ page }) => {
    await seedImages();
    await signInAsAdmin(page);
  });

  test("/admin/images renders the library + filter form + a11y pass", async ({
    page,
  }, testInfo) => {
    await page.goto("/admin/images");
    await expect(
      page.getByRole("heading", { name: /image library/i }),
    ).toBeVisible();
    await auditA11y(page, testInfo);

    // Every seeded caption appears in the rendered list.
    for (const seed of E2E_SEEDS) {
      await expect(page.getByText(seed.caption)).toBeVisible();
    }

    // The filter bar exposes a search box + source selector + apply button.
    await expect(page.getByLabel("Search")).toBeVisible();
    await expect(page.getByLabel("Source")).toBeVisible();
    await expect(page.getByRole("button", { name: /apply/i })).toBeVisible();
  });

  test("tag filter narrows results + clear link restores", async ({ page }) => {
    await page.goto("/admin/images");

    // Apply tag filter "indoor" — only the cat fixture should remain.
    await page.getByTestId("images-tag-input").fill("indoor");
    await page.getByRole("button", { name: /apply/i }).click();

    await expect(
      page.getByText(/tabby cat seated by a bright window/i),
    ).toBeVisible();
    await expect(
      page.getByText(/wide river cutting a forest valley/i),
    ).toHaveCount(0);

    // Clear link restores the unfiltered view.
    await page.getByRole("link", { name: /clear/i }).click();
    await expect(
      page.getByText(/wide river cutting a forest valley/i),
    ).toBeVisible();
  });

  test("source filter narrows to the selected source", async ({ page }) => {
    await page.goto("/admin/images");
    await page.getByLabel("Source").selectOption("upload");
    await page.getByRole("button", { name: /apply/i }).click();

    await expect(
      page.getByText(/operator-uploaded product hero shot/i),
    ).toBeVisible();
    await expect(
      page.getByText(/tabby cat seated by a bright window/i),
    ).toHaveCount(0);
  });

  test("Images nav link is reachable from /admin/sites", async ({ page }) => {
    await page.goto("/admin/sites");
    await page.getByRole("link", { name: "Images" }).click();
    await page.waitForURL(/\/admin\/images/);
    await expect(
      page.getByRole("heading", { name: /image library/i }),
    ).toBeVisible();
  });

  test("list → detail round-trip preserves filter state on back-nav", async ({
    page,
  }, testInfo) => {
    // Start on a filtered list.
    await page.goto("/admin/images?source=upload");
    await expect(
      page.getByText(/operator-uploaded product hero shot/i),
    ).toBeVisible();

    // Click the caption link to open the detail page.
    await page
      .getByTestId("image-row-link")
      .filter({ hasText: /operator-uploaded product hero shot/i })
      .click();
    await page.waitForURL(/\/admin\/images\/[0-9a-f-]{36}/);
    await expect(
      page.getByTestId("image-detail-fields"),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /e2e-img-upload\.jpg/ }),
    ).toBeVisible();
    await auditA11y(page, testInfo);

    // Back link returns to /admin/images?source=upload (via the
    // ?from= query param the list writes into each row).
    await page.getByRole("link", { name: /back to library/i }).click();
    await page.waitForURL(/\/admin\/images\?source=upload/);
    await expect(
      page.getByText(/operator-uploaded product hero shot/i),
    ).toBeVisible();
  });

  test("detail page 404s on an unknown UUID", async ({ page }) => {
    const response = await page.goto(
      "/admin/images/00000000-0000-0000-0000-000000000000",
    );
    expect(response?.status()).toBe(404);
  });

  test("archive flow removes image from active list; restore returns it", async ({
    page,
  }) => {
    await page.goto("/admin/images");

    // Pick the river fixture — deterministic caption.
    await page
      .getByTestId("image-row-link")
      .filter({ hasText: /wide river cutting a forest valley/i })
      .click();
    await page.waitForURL(/\/admin\/images\/[0-9a-f-]{36}/);

    // Auto-accept the confirm() dialog the archive button fires.
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await page.getByTestId("archive-image-button").click();

    // After router.refresh, the detail page shows the archived banner
    // + the Restore button replaces Archive.
    await expect(page.getByTestId("restore-image-button")).toBeVisible();

    // Active list no longer includes it.
    await page.goto("/admin/images");
    await expect(
      page.getByText(/wide river cutting a forest valley/i),
    ).toHaveCount(0);

    // Archived view does.
    await page.goto("/admin/images?deleted=1");
    await expect(
      page.getByText(/wide river cutting a forest valley/i),
    ).toBeVisible();

    // Restore from the detail page.
    await page
      .getByTestId("image-row-link")
      .filter({ hasText: /wide river cutting a forest valley/i })
      .click();
    await page.waitForURL(/\/admin\/images\/[0-9a-f-]{36}/);
    await page.getByTestId("restore-image-button").click();
    await expect(page.getByTestId("archive-image-button")).toBeVisible();

    // Active list shows it again.
    await page.goto("/admin/images");
    await expect(
      page.getByText(/wide river cutting a forest valley/i),
    ).toBeVisible();
  });

  test("edit modal updates caption + tags and the list reflects the change", async ({
    page,
  }) => {
    await page.goto("/admin/images?source=upload");

    // Navigate to the upload fixture's detail page.
    await page
      .getByTestId("image-row-link")
      .filter({ hasText: /operator-uploaded product hero shot/i })
      .click();
    await page.waitForURL(/\/admin\/images\/[0-9a-f-]{36}/);

    // Open edit modal.
    await page.getByTestId("edit-image-button").click();
    await expect(
      page.getByRole("heading", { name: /edit image metadata/i }),
    ).toBeVisible();

    // Change caption + replace tags.
    const newCaption =
      "Edited: tabletop product hero shot, warm studio lighting.";
    await page.getByLabel("Caption").fill(newCaption);
    await page.getByLabel("Tags").fill("product, edited, hero-shot");
    await page.getByRole("button", { name: /save changes/i }).click();

    // Modal closes, caption reflects on the detail page after refresh.
    await expect(
      page.getByRole("heading", { name: /edit image metadata/i }),
    ).toHaveCount(0);
    // Scope to the detail-fields dd. M5-2 added a Breadcrumbs row that
    // also renders the caption (truncated to 60 chars), so a naked
    // getByText is a strict-mode violation.
    await expect(
      page.getByTestId("image-detail-fields").getByText(newCaption),
    ).toBeVisible();
    // exact: true so we match the "edited" tag <span> specifically;
    // the capitalised "Edited:" at the start of the caption dd is a
    // substring hit that caused a strict-mode violation on the first
    // rebased-on-main run.
    await expect(
      page.getByTestId("image-detail-fields").getByText("edited", {
        exact: true,
      }),
    ).toBeVisible();
  });
});
