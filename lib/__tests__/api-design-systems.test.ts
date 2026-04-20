import { describe, it, expect } from "vitest";
import {
  GET as listDS,
  POST as createDS,
} from "@/app/api/sites/[id]/design-systems/route";
import { POST as activate } from "@/app/api/design-systems/[id]/activate/route";
import { POST as archive } from "@/app/api/design-systems/[id]/archive/route";
import { GET as preview } from "@/app/api/design-systems/[id]/preview/route";
import { createDesignSystem } from "@/lib/design-systems";
import { createComponent } from "@/lib/components";
import { createTemplate } from "@/lib/templates";
import { minimalComponentContentSchema, minimalComposition, seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// Smoke tests for the design-system-scoped routes. Per the M1e plan these
// are thin wrappers around the lib layer, so we only verify:
//   - happy path renders the expected envelope at HTTP 200
//   - one representative error path surfaces the right code at the right
//     status
// Deep lib coverage already lives in design-systems.test.ts / components.test.ts.
// ---------------------------------------------------------------------------

type RouteBody = Record<string, unknown> | undefined;

function jsonReq(url: string, body?: RouteBody, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("GET /api/sites/[id]/design-systems", () => {
  it("lists empty when the site has no DS", async () => {
    const site = await seedSite();
    const res = await listDS(
      new Request(`http://t/api/sites/${site.id}/design-systems`),
      { params: { id: site.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual([]);
  });

  it("400s on a non-UUID site id", async () => {
    const res = await listDS(
      new Request(`http://t/api/sites/nope/design-systems`),
      { params: { id: "nope" } },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("POST /api/sites/[id]/design-systems", () => {
  it("creates a draft with auto-incremented version", async () => {
    const site = await seedSite();
    await createDesignSystem({
      site_id: site.id,
      version: 1,
      tokens_css: "",
      base_styles: "",
    });

    const res = await createDS(
      jsonReq(`http://t/api/sites/${site.id}/design-systems`, {
        tokens_css: ".ls-scope { --ls-blue: #185FA5; }",
        base_styles: "",
      }),
      { params: { id: site.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.version).toBe(2);
    expect(body.data.status).toBe("draft");
  });

  it("400s on malformed body", async () => {
    const site = await seedSite();
    const res = await createDS(
      jsonReq(`http://t/api/sites/${site.id}/design-systems`, {
        tokens_css: 123,
      } as unknown as RouteBody),
      { params: { id: site.id } },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("POST /api/design-systems/[id]/activate", () => {
  it("activates a draft", async () => {
    const site = await seedSite();
    const ds = await createDesignSystem({
      site_id: site.id,
      version: 1,
      tokens_css: "",
      base_styles: "",
    });
    if (!ds.ok) throw new Error("seed failed");

    const res = await activate(
      jsonReq(`http://t/api/design-systems/${ds.data.id}/activate`, {
        expected_version_lock: ds.data.version_lock,
      }),
      { params: { id: ds.data.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("active");
  });

  it("409s on stale expected_version_lock", async () => {
    const site = await seedSite();
    const ds = await createDesignSystem({
      site_id: site.id,
      version: 1,
      tokens_css: "",
      base_styles: "",
    });
    if (!ds.ok) throw new Error("seed failed");

    const res = await activate(
      jsonReq(`http://t/api/design-systems/${ds.data.id}/activate`, {
        expected_version_lock: 999,
      }),
      { params: { id: ds.data.id } },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("VERSION_CONFLICT");
  });
});

describe("POST /api/design-systems/[id]/archive", () => {
  it("archives a draft with no warnings", async () => {
    const site = await seedSite();
    const ds = await createDesignSystem({
      site_id: site.id,
      version: 1,
      tokens_css: "",
      base_styles: "",
    });
    if (!ds.ok) throw new Error("seed failed");

    const res = await archive(
      jsonReq(`http://t/api/design-systems/${ds.data.id}/archive`, {
        expected_version_lock: ds.data.version_lock,
      }),
      { params: { id: ds.data.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.design_system.status).toBe("archived");
    expect(body.data.warnings).toEqual([]);
  });

  it("404s on unknown id", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    const res = await archive(
      jsonReq(`http://t/api/design-systems/${missing}/archive`, {
        expected_version_lock: 1,
      }),
      { params: { id: missing } },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("GET /api/design-systems/[id]/preview", () => {
  it("bundles ds + components + templates", async () => {
    const site = await seedSite();
    const ds = await createDesignSystem({
      site_id: site.id,
      version: 1,
      tokens_css: "",
      base_styles: "",
    });
    if (!ds.ok) throw new Error("seed failed");
    await createComponent({
      design_system_id: ds.data.id,
      name: "hero-centered",
      variant: "default",
      category: "hero",
      html_template: "<section>{{headline}}</section>",
      css: ".ls-hero {}",
      content_schema: minimalComponentContentSchema(),
    });
    await createTemplate({
      design_system_id: ds.data.id,
      page_type: "homepage",
      name: "homepage-default",
      composition: minimalComposition(),
      required_fields: { hero: ["headline"] },
      is_default: true,
    });

    const res = await preview(
      new Request(`http://t/api/design-systems/${ds.data.id}/preview`),
      { params: { id: ds.data.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.design_system.id).toBe(ds.data.id);
    expect(body.data.components).toHaveLength(1);
    expect(body.data.templates).toHaveLength(1);
  });

  it("404s on unknown DS", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    const res = await preview(
      new Request(`http://t/api/design-systems/${missing}/preview`),
      { params: { id: missing } },
    );
    expect(res.status).toBe(404);
  });
});
