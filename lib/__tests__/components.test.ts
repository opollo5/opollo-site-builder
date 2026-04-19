import { describe, it, expect } from "vitest";
import {
  createComponent,
  deleteComponent,
  getComponent,
  listComponents,
  updateComponent,
} from "@/lib/components";
import { createDesignSystem } from "@/lib/design-systems";
import { minimalComponentContentSchema, seedSite } from "./_helpers";

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

function validComponent(design_system_id: string, overrides?: Partial<{ name: string; variant: string | null; category: string }>) {
  return {
    design_system_id,
    name: overrides?.name ?? "hero-centered",
    variant: overrides?.variant === undefined ? "default" : overrides.variant,
    category: overrides?.category ?? "hero",
    html_template: "<section class=\"ls-hero\">{{headline}}</section>",
    css: ".ls-hero { padding: 2rem; }",
    content_schema: minimalComponentContentSchema(),
  };
}

describe("components: create", () => {
  it("creates a component and returns it", async () => {
    const { ds } = await seedDS();
    const res = await createComponent(validComponent(ds.id));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.name).toBe("hero-centered");
    expect(res.data.variant).toBe("default");
    expect(res.data.version_lock).toBe(1);
  });

  it("rejects bad component name with VALIDATION_FAILED", async () => {
    const { ds } = await seedDS();
    const res = await createComponent({
      ...validComponent(ds.id),
      name: "Hero_Centered",  // uppercase + underscore fails the regex
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns FK_VIOLATION when design_system_id does not exist", async () => {
    const res = await createComponent(
      validComponent("00000000-0000-0000-0000-000000000000"),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("FK_VIOLATION");
  });

  it("returns UNIQUE_VIOLATION on duplicate (ds, name, variant)", async () => {
    const { ds } = await seedDS();
    await createComponent(validComponent(ds.id));
    const res = await createComponent(validComponent(ds.id));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("UNIQUE_VIOLATION");
  });

  it("allows same name with different variant", async () => {
    const { ds } = await seedDS();
    const a = await createComponent(validComponent(ds.id, { variant: "default" }));
    const b = await createComponent(validComponent(ds.id, { variant: "dark" }));
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});

describe("components: read", () => {
  it("lists components ordered by category then name", async () => {
    const { ds } = await seedDS();
    await createComponent(validComponent(ds.id, { name: "footer-default", category: "footer" }));
    await createComponent(validComponent(ds.id, { name: "hero-centered", category: "hero" }));
    await createComponent(validComponent(ds.id, { name: "cta-dark", category: "cta" }));

    const res = await listComponents(ds.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.map((c) => c.category)).toEqual(["cta", "footer", "hero"]);
  });

  it("getComponent returns NOT_FOUND for unknown id", async () => {
    const res = await getComponent("00000000-0000-0000-0000-000000000000");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });
});

describe("components: update", () => {
  it("updates and bumps version_lock", async () => {
    const { ds } = await seedDS();
    const created = await createComponent(validComponent(ds.id));
    if (!created.ok) throw new Error("setup failed");

    const res = await updateComponent(
      created.data.id,
      { usage_notes: "Use sparingly." },
      created.data.version_lock,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.usage_notes).toBe("Use sparingly.");
    expect(res.data.version_lock).toBe(created.data.version_lock + 1);
  });

  it("rejects empty patch", async () => {
    const { ds } = await seedDS();
    const created = await createComponent(validComponent(ds.id));
    if (!created.ok) throw new Error("setup failed");

    const res = await updateComponent(created.data.id, {}, created.data.version_lock);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns VERSION_CONFLICT on stale lock", async () => {
    const { ds } = await seedDS();
    const created = await createComponent(validComponent(ds.id));
    if (!created.ok) throw new Error("setup failed");

    await updateComponent(created.data.id, { css: ".a{}" }, 1);
    const res = await updateComponent(created.data.id, { css: ".b{}" }, 1);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VERSION_CONFLICT");
  });

  it("returns NOT_FOUND for unknown id", async () => {
    const res = await updateComponent(
      "00000000-0000-0000-0000-000000000000",
      { css: ".x{}" },
      1,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });
});

describe("components: delete", () => {
  it("deletes when version_lock matches", async () => {
    const { ds } = await seedDS();
    const created = await createComponent(validComponent(ds.id));
    if (!created.ok) throw new Error("setup failed");

    const res = await deleteComponent(created.data.id, created.data.version_lock);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.id).toBe(created.data.id);

    const after = await getComponent(created.data.id);
    expect(after.ok).toBe(false);
    if (after.ok) return;
    expect(after.error.code).toBe("NOT_FOUND");
  });

  it("returns VERSION_CONFLICT on stale lock", async () => {
    const { ds } = await seedDS();
    const created = await createComponent(validComponent(ds.id));
    if (!created.ok) throw new Error("setup failed");

    await updateComponent(created.data.id, { css: ".a{}" }, 1);
    const res = await deleteComponent(created.data.id, 1);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VERSION_CONFLICT");
  });

  it("returns NOT_FOUND for unknown id", async () => {
    const res = await deleteComponent(
      "00000000-0000-0000-0000-000000000000",
      1,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });
});
