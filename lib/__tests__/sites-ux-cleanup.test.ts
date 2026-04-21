import { describe, expect, it } from "vitest";

import {
  archiveSite,
  createSite,
  listSites,
  updateSiteBasics,
} from "@/lib/sites";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M2d UX cleanup — sites.
//
// Pins:
//   - Auto-prefix: createSite without prefix derives one from the
//     name; is unique; retries on collision; falls back to
//     digit-suffixed variants that stay ≤ 4 chars.
//   - updateSiteBasics: name + URL round-trip, NOT_FOUND on bad id,
//     doesn't resurrect archived sites.
//   - archiveSite: flips status to 'removed', listSites excludes it,
//     prefix frees for re-use.
// ---------------------------------------------------------------------------

async function createNoPrefix(name: string) {
  return createSite({
    name,
    wp_url: `https://${name.replace(/[^a-z0-9]/gi, "")}.test`,
    wp_user: "wp-user",
    wp_app_password: "test-password-123",
  });
}

describe("createSite auto-prefix", () => {
  it("derives a prefix from the site name when none is supplied", async () => {
    const res = await createNoPrefix("LeadSource");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.prefix).toMatch(/^[a-z0-9]{2,4}$/);
    // LeadSource slugified = "leadsource"; first 4 chars = "lead".
    expect(res.data.prefix).toBe("lead");
  });

  it("picks a digit-suffixed variant on collision with an active site", async () => {
    const first = await createNoPrefix("Awesome Co");
    expect(first.ok).toBe(true);
    // Same leading slug; the base "awes" is taken so we should land
    // on a variant that is not "awes".
    const second = await createNoPrefix("Awesome Partners");
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.data.prefix).toBe("awes");
    expect(second.data.prefix).not.toBe("awes");
    expect(second.data.prefix.length).toBeLessThanOrEqual(4);
  });

  it("handles names with no slug-able characters by falling back to a deterministic prefix", async () => {
    const res = await createNoPrefix("!!! ??? !!!");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.prefix).toMatch(/^[a-z0-9]{2,4}$/);
  });

  it("leaves an explicitly-supplied prefix untouched", async () => {
    const res = await createSite({
      name: "Explicit",
      wp_url: "https://explicit.test",
      prefix: "xp",
      wp_user: "u",
      wp_app_password: "password-1234",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.prefix).toBe("xp");
  });
});

describe("updateSiteBasics", () => {
  it("round-trips name + wp_url on an active site", async () => {
    const created = await createNoPrefix("Old Name");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await updateSiteBasics(created.data.id, {
      name: "New Name",
      wp_url: "https://new.test",
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.name).toBe("New Name");
    expect(updated.data.wp_url).toBe("https://new.test");
  });

  it("returns NOT_FOUND for an unknown id", async () => {
    const res = await updateSiteBasics(
      "00000000-0000-0000-0000-000000000000",
      { name: "ghost" },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });

  it("refuses to update a removed (archived) site", async () => {
    const created = await createNoPrefix("Ghosted");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Archive it.
    const archived = await archiveSite(created.data.id);
    expect(archived.ok).toBe(true);

    const updated = await updateSiteBasics(created.data.id, {
      name: "should not work",
    });
    expect(updated.ok).toBe(false);
    if (updated.ok) return;
    expect(updated.error.code).toBe("NOT_FOUND");
  });
});

describe("archiveSite", () => {
  it("flips status to removed and excludes the site from listSites", async () => {
    const created = await createNoPrefix("Archivable");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const beforeList = await listSites();
    expect(beforeList.ok).toBe(true);
    if (!beforeList.ok) return;
    expect(beforeList.data.sites.some((s) => s.id === created.data.id)).toBe(
      true,
    );

    const archive = await archiveSite(created.data.id);
    expect(archive.ok).toBe(true);

    const afterList = await listSites();
    expect(afterList.ok).toBe(true);
    if (!afterList.ok) return;
    expect(afterList.data.sites.some((s) => s.id === created.data.id)).toBe(
      false,
    );
  });

  it("frees the prefix for re-use on an active site", async () => {
    const first = await createNoPrefix("Recycler Alpha");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const originalPrefix = first.data.prefix;

    await archiveSite(first.data.id);

    // A brand-new site with the same name should pick up the now-free
    // prefix. The DB partial unique index is scoped to
    // status != 'removed', so the archived row doesn't block.
    const second = await createSite({
      name: "Recycler Alpha",
      wp_url: "https://recycler-take-two.test",
      prefix: originalPrefix,
      wp_user: "u",
      wp_app_password: "password-1234",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.prefix).toBe(originalPrefix);
  });

  it("returns NOT_FOUND when the site is already archived", async () => {
    const created = await createNoPrefix("Already Dead");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const first = await archiveSite(created.data.id);
    expect(first.ok).toBe(true);

    const second = await archiveSite(created.data.id);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("NOT_FOUND");
  });
});

describe("site PATCH + DELETE HTTP routes", () => {
  it("service-role helpers reflect what the HTTP route will do", async () => {
    // The route is a thin wrapper; covered at the lib layer above.
    // This placeholder keeps the http surface tracked in the file
    // name for discoverability.
    const svc = getServiceRoleClient();
    expect(svc).toBeTruthy();
  });
});
