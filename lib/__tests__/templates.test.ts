import { describe, it, expect } from "vitest";
import {
  createTemplate,
  deleteTemplate,
  getDefaultTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from "@/lib/templates";
import { createDesignSystem } from "@/lib/design-systems";
import { minimalComposition, seedSite } from "./_helpers";

async function seedDS() {
  const site = await seedSite();
  const ds = await createDesignSystem({
    site_id: site.id,
    version: 1,
    tokens_css: "",
    base_styles: "",
  });
  if (!ds.ok) throw new Error("seedDS failed");
  return { site, ds: ds.data };
}

function validTemplate(
  design_system_id: string,
  overrides?: Partial<{ name: string; page_type: string; is_default: boolean }>,
) {
  return {
    design_system_id,
    page_type: overrides?.page_type ?? "homepage",
    name: overrides?.name ?? "homepage-default",
    composition: minimalComposition(),
    required_fields: { hero: ["headline"] },
    seo_defaults: { title_suffix: " — Test" },
    is_default: overrides?.is_default ?? false,
  };
}

describe("templates: create", () => {
  it("creates a template", async () => {
    const { ds } = await seedDS();
    const res = await createTemplate(validTemplate(ds.id));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.page_type).toBe("homepage");
    expect(res.data.is_default).toBe(false);
    expect(res.data.version_lock).toBe(1);
  });

  it("rejects empty composition with VALIDATION_FAILED", async () => {
    const { ds } = await seedDS();
    const res = await createTemplate({
      ...validTemplate(ds.id),
      composition: [],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns FK_VIOLATION when design_system_id does not exist", async () => {
    const res = await createTemplate(
      validTemplate("00000000-0000-0000-0000-000000000000"),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("FK_VIOLATION");
  });

  it("returns UNIQUE_VIOLATION on second default for the same (ds, page_type)", async () => {
    const { ds } = await seedDS();
    await createTemplate(validTemplate(ds.id, { name: "a", is_default: true }));
    const res = await createTemplate(
      validTemplate(ds.id, { name: "b", is_default: true }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("UNIQUE_VIOLATION");
  });

  it("allows multiple non-default templates per (ds, page_type)", async () => {
    const { ds } = await seedDS();
    const a = await createTemplate(validTemplate(ds.id, { name: "a" }));
    const b = await createTemplate(validTemplate(ds.id, { name: "b" }));
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});

describe("templates: read", () => {
  it("lists templates ordered by page_type then name", async () => {
    const { ds } = await seedDS();
    await createTemplate(validTemplate(ds.id, { page_type: "integration", name: "b" }));
    await createTemplate(validTemplate(ds.id, { page_type: "homepage", name: "a" }));
    await createTemplate(validTemplate(ds.id, { page_type: "homepage", name: "z" }));

    const res = await listTemplates(ds.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.map((t) => [t.page_type, t.name])).toEqual([
      ["homepage", "a"],
      ["homepage", "z"],
      ["integration", "b"],
    ]);
  });

  it("getTemplate returns NOT_FOUND for unknown id", async () => {
    const res = await getTemplate("00000000-0000-0000-0000-000000000000");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });

  it("getDefaultTemplate returns the default when present", async () => {
    const { ds } = await seedDS();
    await createTemplate(validTemplate(ds.id, { name: "a", is_default: false }));
    const def = await createTemplate(
      validTemplate(ds.id, { name: "b", is_default: true }),
    );
    if (!def.ok) throw new Error("setup failed");

    const res = await getDefaultTemplate(ds.id, "homepage");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data?.id).toBe(def.data.id);
  });

  it("getDefaultTemplate returns null when no default", async () => {
    const { ds } = await seedDS();
    await createTemplate(validTemplate(ds.id, { is_default: false }));
    const res = await getDefaultTemplate(ds.id, "homepage");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toBeNull();
  });
});

describe("templates: update", () => {
  it("updates and bumps version_lock", async () => {
    const { ds } = await seedDS();
    const created = await createTemplate(validTemplate(ds.id));
    if (!created.ok) throw new Error("setup failed");

    const res = await updateTemplate(
      created.data.id,
      { name: "renamed" },
      created.data.version_lock,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.name).toBe("renamed");
    expect(res.data.version_lock).toBe(created.data.version_lock + 1);
  });

  it("returns VERSION_CONFLICT on stale lock", async () => {
    const { ds } = await seedDS();
    const created = await createTemplate(validTemplate(ds.id));
    if (!created.ok) throw new Error("setup failed");

    await updateTemplate(created.data.id, { name: "first" }, 1);
    const res = await updateTemplate(created.data.id, { name: "second" }, 1);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VERSION_CONFLICT");
  });

  it("rejects empty patch", async () => {
    const { ds } = await seedDS();
    const created = await createTemplate(validTemplate(ds.id));
    if (!created.ok) throw new Error("setup failed");

    const res = await updateTemplate(created.data.id, {}, created.data.version_lock);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("promoting to default clashes with existing default (UNIQUE_VIOLATION)", async () => {
    const { ds } = await seedDS();
    await createTemplate(validTemplate(ds.id, { name: "a", is_default: true }));
    const b = await createTemplate(validTemplate(ds.id, { name: "b", is_default: false }));
    if (!b.ok) throw new Error("setup failed");

    const res = await updateTemplate(
      b.data.id,
      { is_default: true },
      b.data.version_lock,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("UNIQUE_VIOLATION");
  });
});

describe("templates: delete", () => {
  it("deletes when version_lock matches", async () => {
    const { ds } = await seedDS();
    const created = await createTemplate(validTemplate(ds.id));
    if (!created.ok) throw new Error("setup failed");

    const res = await deleteTemplate(created.data.id, created.data.version_lock);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.id).toBe(created.data.id);

    const after = await getTemplate(created.data.id);
    expect(after.ok).toBe(false);
    if (after.ok) return;
    expect(after.error.code).toBe("NOT_FOUND");
  });

  it("returns VERSION_CONFLICT on stale lock", async () => {
    const { ds } = await seedDS();
    const created = await createTemplate(validTemplate(ds.id));
    if (!created.ok) throw new Error("setup failed");

    await updateTemplate(created.data.id, { name: "renamed" }, 1);
    const res = await deleteTemplate(created.data.id, 1);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VERSION_CONFLICT");
  });

  it("returns NOT_FOUND for unknown id", async () => {
    const res = await deleteTemplate(
      "00000000-0000-0000-0000-000000000000",
      1,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });
});
