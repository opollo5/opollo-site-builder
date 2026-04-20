import { describe, it, expect } from "vitest";
import {
  GET as listTemplatesRoute,
  POST as createTemplateRoute,
} from "@/app/api/design-systems/[id]/templates/route";
import {
  DELETE as deleteTemplateRoute,
  PATCH as patchTemplateRoute,
} from "@/app/api/design-systems/[id]/templates/[tid]/route";
import { createDesignSystem } from "@/lib/design-systems";
import { createComponent } from "@/lib/components";
import { createTemplate } from "@/lib/templates";
import {
  minimalComponentContentSchema,
  minimalComposition,
  seedSite,
} from "./_helpers";

async function seedSiteWithDSAndComponents() {
  const site = await seedSite();
  const ds = await createDesignSystem({
    site_id: site.id,
    version: 1,
    tokens_css: "",
    base_styles: "",
  });
  if (!ds.ok) throw new Error("seed DS failed");

  for (const name of ["hero-centered", "footer-default"]) {
    const r = await createComponent({
      design_system_id: ds.data.id,
      name,
      variant: null,
      category: name.split("-")[0],
      html_template: `<section>${name}</section>`,
      css: ".ls-x {}",
      content_schema: minimalComponentContentSchema(),
    });
    if (!r.ok) throw new Error(`seed component ${name} failed`);
  }

  return { site, ds: ds.data };
}

function jsonReq(url: string, body?: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("GET /api/design-systems/[id]/templates", () => {
  it("lists templates", async () => {
    const { ds } = await seedSiteWithDSAndComponents();
    await createTemplate({
      design_system_id: ds.id,
      page_type: "homepage",
      name: "homepage-default",
      composition: minimalComposition(),
      required_fields: { hero: ["headline"] },
      is_default: true,
    });

    const res = await listTemplatesRoute(
      new Request(`http://t/api/design-systems/${ds.id}/templates`),
      { params: { id: ds.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("homepage-default");
  });

  it("400s on a non-UUID DS id", async () => {
    const res = await listTemplatesRoute(
      new Request(`http://t/api/design-systems/nope/templates`),
      { params: { id: "nope" } },
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/design-systems/[id]/templates", () => {
  it("creates a template when composition references exist", async () => {
    const { ds } = await seedSiteWithDSAndComponents();
    const res = await createTemplateRoute(
      jsonReq(`http://t/api/design-systems/${ds.id}/templates`, {
        page_type: "homepage",
        name: "homepage-default",
        composition: [
          { component: "hero-centered", content_source: "brief.hero" },
          { component: "footer-default", content_source: "site_context.footer" },
        ],
        required_fields: { hero: ["headline"] },
        is_default: true,
      }),
      { params: { id: ds.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe("homepage-default");
  });

  it("400s when composition references an unknown component", async () => {
    const { ds } = await seedSiteWithDSAndComponents();
    const res = await createTemplateRoute(
      jsonReq(`http://t/api/design-systems/${ds.id}/templates`, {
        page_type: "homepage",
        name: "homepage-default",
        composition: [
          { component: "hero-centered", content_source: "brief.hero" },
          { component: "ghost-component", content_source: "brief.ghost" },
        ],
        required_fields: {},
        is_default: false,
      }),
      { params: { id: ds.id } },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details.unknown_components).toEqual(["ghost-component"]);
  });
});

describe("PATCH /api/design-systems/[id]/templates/[tid]", () => {
  it("updates and bumps version_lock", async () => {
    const { ds } = await seedSiteWithDSAndComponents();
    const created = await createTemplate({
      design_system_id: ds.id,
      page_type: "homepage",
      name: "homepage-default",
      composition: minimalComposition(),
      required_fields: { hero: ["headline"] },
    });
    if (!created.ok) throw new Error("seed failed");

    const res = await patchTemplateRoute(
      jsonReq(
        `http://t/api/design-systems/${ds.id}/templates/${created.data.id}`,
        {
          name: "homepage-renamed",
          expected_version_lock: created.data.version_lock,
        },
        "PATCH",
      ),
      { params: { id: ds.id, tid: created.data.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe("homepage-renamed");
    expect(body.data.version_lock).toBe(created.data.version_lock + 1);
  });

  it("409s on stale expected_version_lock", async () => {
    const { ds } = await seedSiteWithDSAndComponents();
    const created = await createTemplate({
      design_system_id: ds.id,
      page_type: "homepage",
      name: "homepage-default",
      composition: minimalComposition(),
      required_fields: {},
    });
    if (!created.ok) throw new Error("seed failed");

    const res = await patchTemplateRoute(
      jsonReq(
        `http://t/api/design-systems/${ds.id}/templates/${created.data.id}`,
        { name: "stale", expected_version_lock: 999 },
        "PATCH",
      ),
      { params: { id: ds.id, tid: created.data.id } },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("VERSION_CONFLICT");
  });
});

describe("DELETE /api/design-systems/[id]/templates/[tid]", () => {
  it("deletes when the query-param expected_version_lock matches", async () => {
    const { ds } = await seedSiteWithDSAndComponents();
    const created = await createTemplate({
      design_system_id: ds.id,
      page_type: "homepage",
      name: "homepage-default",
      composition: minimalComposition(),
      required_fields: {},
    });
    if (!created.ok) throw new Error("seed failed");

    const res = await deleteTemplateRoute(
      new Request(
        `http://t/api/design-systems/${ds.id}/templates/${created.data.id}?expected_version_lock=${created.data.version_lock}`,
        { method: "DELETE" },
      ),
      { params: { id: ds.id, tid: created.data.id } },
    );
    expect(res.status).toBe(200);
  });

  it("400s when expected_version_lock query param is missing", async () => {
    const { ds } = await seedSiteWithDSAndComponents();
    const tid = "00000000-0000-0000-0000-000000000002";
    const res = await deleteTemplateRoute(
      new Request(`http://t/api/design-systems/${ds.id}/templates/${tid}`, {
        method: "DELETE",
      }),
      { params: { id: ds.id, tid } },
    );
    expect(res.status).toBe(400);
  });
});
