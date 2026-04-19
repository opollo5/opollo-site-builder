import { describe, it, expect } from "vitest";
import {
  activateDesignSystem,
  archiveDesignSystem,
  createDesignSystem,
  getActiveDesignSystem,
  getDesignSystem,
  listDesignSystems,
  updateDesignSystem,
} from "@/lib/design-systems";
import { seedSite } from "./_helpers";

function validCreateInput(site_id: string, version = 1) {
  return {
    site_id,
    version,
    tokens_css: ":root { --x: 1; }",
    base_styles: "body { margin: 0; }",
    notes: "v1 baseline",
  };
}

describe("design-systems: create", () => {
  it("creates a draft and returns it", async () => {
    const site = await seedSite();
    const res = await createDesignSystem(validCreateInput(site.id));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.site_id).toBe(site.id);
    expect(res.data.status).toBe("draft");
    expect(res.data.version).toBe(1);
    expect(res.data.version_lock).toBe(1);
  });

  it("rejects malformed input with VALIDATION_FAILED", async () => {
    const res = await createDesignSystem({
      site_id: "not-a-uuid",
      version: -1,
      tokens_css: 123,
      base_styles: null,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_FAILED");
    expect(Array.isArray((res.error.details as { issues?: unknown[] })?.issues))
      .toBe(true);
  });

  it("returns FK_VIOLATION when site_id does not exist", async () => {
    const res = await createDesignSystem(
      validCreateInput("00000000-0000-0000-0000-000000000000"),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("FK_VIOLATION");
  });

  it("returns UNIQUE_VIOLATION on duplicate (site_id, version)", async () => {
    const site = await seedSite();
    await createDesignSystem(validCreateInput(site.id, 1));
    const res = await createDesignSystem(validCreateInput(site.id, 1));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("UNIQUE_VIOLATION");
  });
});

describe("design-systems: read", () => {
  it("lists all versions for a site in version-desc order", async () => {
    const site = await seedSite();
    await createDesignSystem(validCreateInput(site.id, 1));
    await createDesignSystem(validCreateInput(site.id, 2));
    await createDesignSystem(validCreateInput(site.id, 3));

    const res = await listDesignSystems(site.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.map((ds) => ds.version)).toEqual([3, 2, 1]);
  });

  it("getDesignSystem returns NOT_FOUND for unknown id", async () => {
    const res = await getDesignSystem("00000000-0000-0000-0000-000000000000");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });

  it("getActiveDesignSystem returns null when none active", async () => {
    const site = await seedSite();
    await createDesignSystem(validCreateInput(site.id, 1));
    const res = await getActiveDesignSystem(site.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toBeNull();
  });

  it("getActiveDesignSystem returns the active row when one exists", async () => {
    const site = await seedSite();
    const created = await createDesignSystem(validCreateInput(site.id, 1));
    if (!created.ok) throw new Error("setup failed");
    const activated = await activateDesignSystem(created.data.id, created.data.version_lock);
    if (!activated.ok) throw new Error("activate failed");

    const res = await getActiveDesignSystem(site.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data?.id).toBe(activated.data.id);
    expect(res.data?.status).toBe("active");
  });
});

describe("design-systems: update", () => {
  it("updates metadata and bumps version_lock", async () => {
    const site = await seedSite();
    const created = await createDesignSystem(validCreateInput(site.id, 1));
    if (!created.ok) throw new Error("setup failed");

    const res = await updateDesignSystem(
      created.data.id,
      { notes: "updated" },
      created.data.version_lock,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.notes).toBe("updated");
    expect(res.data.version_lock).toBe(created.data.version_lock + 1);
  });

  it("rejects empty patch with VALIDATION_FAILED", async () => {
    const site = await seedSite();
    const created = await createDesignSystem(validCreateInput(site.id, 1));
    if (!created.ok) throw new Error("setup failed");

    const res = await updateDesignSystem(
      created.data.id,
      {},
      created.data.version_lock,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns VERSION_CONFLICT on stale version_lock", async () => {
    const site = await seedSite();
    const created = await createDesignSystem(validCreateInput(site.id, 1));
    if (!created.ok) throw new Error("setup failed");
    // First update succeeds and bumps the lock.
    await updateDesignSystem(created.data.id, { notes: "first" }, 1);
    // Second update with the stale lock must fail.
    const res = await updateDesignSystem(created.data.id, { notes: "second" }, 1);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VERSION_CONFLICT");
    expect((res.error.details as { expected_version_lock?: number })?.expected_version_lock).toBe(1);
  });

  it("returns NOT_FOUND for unknown id", async () => {
    const res = await updateDesignSystem(
      "00000000-0000-0000-0000-000000000000",
      { notes: "x" },
      1,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });
});

describe("design-systems: activate", () => {
  it("promotes a draft and archives the previous active atomically", async () => {
    const site = await seedSite();
    const v1 = await createDesignSystem(validCreateInput(site.id, 1));
    const v2 = await createDesignSystem(validCreateInput(site.id, 2));
    if (!v1.ok || !v2.ok) throw new Error("setup failed");

    const act1 = await activateDesignSystem(v1.data.id, v1.data.version_lock);
    expect(act1.ok).toBe(true);
    if (!act1.ok) return;
    expect(act1.data.status).toBe("active");

    const act2 = await activateDesignSystem(v2.data.id, v2.data.version_lock);
    expect(act2.ok).toBe(true);
    if (!act2.ok) return;
    expect(act2.data.status).toBe("active");

    // v1 should now be archived.
    const v1After = await getDesignSystem(v1.data.id);
    expect(v1After.ok).toBe(true);
    if (!v1After.ok) return;
    expect(v1After.data.status).toBe("archived");
    expect(v1After.data.version_lock).toBeGreaterThan(v1.data.version_lock);
  });

  it("returns VERSION_CONFLICT on stale version_lock", async () => {
    const site = await seedSite();
    const ds = await createDesignSystem(validCreateInput(site.id, 1));
    if (!ds.ok) throw new Error("setup failed");

    await updateDesignSystem(ds.data.id, { notes: "bump" }, ds.data.version_lock);
    const res = await activateDesignSystem(ds.data.id, ds.data.version_lock);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VERSION_CONFLICT");
  });

  it("returns NOT_FOUND for unknown id", async () => {
    const res = await activateDesignSystem(
      "00000000-0000-0000-0000-000000000000",
      1,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });
});

describe("design-systems: archive", () => {
  it("archives a draft without warnings", async () => {
    const site = await seedSite();
    const ds = await createDesignSystem(validCreateInput(site.id, 1));
    if (!ds.ok) throw new Error("setup failed");

    const res = await archiveDesignSystem(ds.data.id, ds.data.version_lock);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.design_system.status).toBe("archived");
    expect(res.data.warnings).toEqual([]);
  });

  it("archiving the active DS returns a soft warning", async () => {
    const site = await seedSite();
    const ds = await createDesignSystem(validCreateInput(site.id, 1));
    if (!ds.ok) throw new Error("setup failed");

    const act = await activateDesignSystem(ds.data.id, ds.data.version_lock);
    if (!act.ok) throw new Error("activate failed");

    const res = await archiveDesignSystem(act.data.id, act.data.version_lock);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.design_system.status).toBe("archived");
    expect(res.data.warnings.length).toBeGreaterThan(0);
    expect(res.data.warnings[0]).toMatch(/no active design system/i);
  });

  it("returns VERSION_CONFLICT on stale version_lock", async () => {
    const site = await seedSite();
    const ds = await createDesignSystem(validCreateInput(site.id, 1));
    if (!ds.ok) throw new Error("setup failed");

    await updateDesignSystem(ds.data.id, { notes: "bump" }, ds.data.version_lock);
    const res = await archiveDesignSystem(ds.data.id, ds.data.version_lock);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VERSION_CONFLICT");
  });

  it("returns NOT_FOUND for unknown id", async () => {
    const res = await archiveDesignSystem(
      "00000000-0000-0000-0000-000000000000",
      1,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });
});
