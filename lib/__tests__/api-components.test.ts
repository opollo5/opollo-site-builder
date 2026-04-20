import { describe, it, expect } from "vitest";
import {
  GET as listComponentsRoute,
  POST as createComponentRoute,
} from "@/app/api/design-systems/[id]/components/route";
import {
  DELETE as deleteComponentRoute,
  PATCH as patchComponentRoute,
} from "@/app/api/design-systems/[id]/components/[cid]/route";
import { createDesignSystem } from "@/lib/design-systems";
import { createComponent } from "@/lib/components";
import { minimalComponentContentSchema, seedSite } from "./_helpers";

async function seedSiteWithDS() {
  const site = await seedSite();
  const ds = await createDesignSystem({
    site_id: site.id,
    version: 1,
    tokens_css: "",
    base_styles: "",
  });
  if (!ds.ok) throw new Error("seed failed");
  return { site, ds: ds.data };
}

function jsonReq(url: string, body?: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("GET /api/design-systems/[id]/components", () => {
  it("lists components for the DS", async () => {
    const { ds } = await seedSiteWithDS();
    await createComponent({
      design_system_id: ds.id,
      name: "hero-centered",
      variant: null,
      category: "hero",
      html_template: "<section>{{headline}}</section>",
      css: ".ls-hero {}",
      content_schema: minimalComponentContentSchema(),
    });

    const res = await listComponentsRoute(
      new Request(`http://t/api/design-systems/${ds.id}/components`),
      { params: { id: ds.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("hero-centered");
  });

  it("400s on a non-UUID DS id", async () => {
    const res = await listComponentsRoute(
      new Request(`http://t/api/design-systems/nope/components`),
      { params: { id: "nope" } },
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/design-systems/[id]/components", () => {
  it("creates a component and passes the scope-prefix check", async () => {
    const { ds } = await seedSiteWithDS();
    const res = await createComponentRoute(
      jsonReq(`http://t/api/design-systems/${ds.id}/components`, {
        name: "hero-centered",
        variant: "default",
        category: "hero",
        html_template: "<section>{{headline}}</section>",
        css: ".ls-hero { padding: 2rem; }",
        content_schema: minimalComponentContentSchema(),
      }),
      { params: { id: ds.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.name).toBe("hero-centered");
  });

  it("400s when CSS contains an unprefixed class selector", async () => {
    const { ds } = await seedSiteWithDS();
    const res = await createComponentRoute(
      jsonReq(`http://t/api/design-systems/${ds.id}/components`, {
        name: "hero-centered",
        variant: null,
        category: "hero",
        html_template: "<section>{{headline}}</section>",
        css: ".hero { padding: 2rem; }",
        content_schema: minimalComponentContentSchema(),
      }),
      { params: { id: ds.id } },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details.prefix).toMatch(/^[a-z0-9]{2,4}$/);
    expect(body.error.details.violations[0].selector).toBe(".hero");
  });
});

describe("PATCH /api/design-systems/[id]/components/[cid]", () => {
  it("updates a component and bumps version_lock", async () => {
    const { ds } = await seedSiteWithDS();
    const created = await createComponent({
      design_system_id: ds.id,
      name: "hero-centered",
      variant: null,
      category: "hero",
      html_template: "<section>{{headline}}</section>",
      css: ".ls-hero {}",
      content_schema: minimalComponentContentSchema(),
    });
    if (!created.ok) throw new Error("seed failed");

    const res = await patchComponentRoute(
      jsonReq(
        `http://t/api/design-systems/${ds.id}/components/${created.data.id}`,
        {
          usage_notes: "Updated.",
          expected_version_lock: created.data.version_lock,
        },
        "PATCH",
      ),
      { params: { id: ds.id, cid: created.data.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.usage_notes).toBe("Updated.");
    expect(body.data.version_lock).toBe(created.data.version_lock + 1);
  });

  it("409s on stale expected_version_lock", async () => {
    const { ds } = await seedSiteWithDS();
    const created = await createComponent({
      design_system_id: ds.id,
      name: "hero-centered",
      variant: null,
      category: "hero",
      html_template: "<section>{{headline}}</section>",
      css: ".ls-hero {}",
      content_schema: minimalComponentContentSchema(),
    });
    if (!created.ok) throw new Error("seed failed");

    const res = await patchComponentRoute(
      jsonReq(
        `http://t/api/design-systems/${ds.id}/components/${created.data.id}`,
        { usage_notes: "Stale.", expected_version_lock: 999 },
        "PATCH",
      ),
      { params: { id: ds.id, cid: created.data.id } },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("VERSION_CONFLICT");
  });
});

describe("DELETE /api/design-systems/[id]/components/[cid]", () => {
  it("deletes when the query-param expected_version_lock matches", async () => {
    const { ds } = await seedSiteWithDS();
    const created = await createComponent({
      design_system_id: ds.id,
      name: "hero-centered",
      variant: null,
      category: "hero",
      html_template: "<section>{{headline}}</section>",
      css: ".ls-hero {}",
      content_schema: minimalComponentContentSchema(),
    });
    if (!created.ok) throw new Error("seed failed");

    const res = await deleteComponentRoute(
      new Request(
        `http://t/api/design-systems/${ds.id}/components/${created.data.id}?expected_version_lock=${created.data.version_lock}`,
        { method: "DELETE" },
      ),
      { params: { id: ds.id, cid: created.data.id } },
    );
    expect(res.status).toBe(200);
  });

  it("400s when expected_version_lock query param is missing", async () => {
    const { ds } = await seedSiteWithDS();
    const cid = "00000000-0000-0000-0000-000000000001";
    const res = await deleteComponentRoute(
      new Request(
        `http://t/api/design-systems/${ds.id}/components/${cid}`,
        { method: "DELETE" },
      ),
      { params: { id: ds.id, cid } },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});
