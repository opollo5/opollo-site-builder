import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { __resetAuthKillSwitchCacheForTests } from "@/lib/auth-kill-switch";

import { seedAuthUser } from "./_auth-helpers";
import { minimalComponentContentSchema, minimalComposition, seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// Security audit §1 Findings 1 + 2 — role gate on every design-systems
// mutation and on sites/register. Middleware only authenticates; the
// handlers now also authorize. This file pins:
//
//   - FEATURE_SUPABASE_AUTH unset → gate allows through (flag-off bypass),
//     so existing tests in api-design-systems.test.ts etc. keep working.
//   - Flag on + viewer → 403 FORBIDDEN on every mutating handler.
//   - Flag on + operator → not 403 (the allow path; exact success code is
//     covered by per-route feature tests, not duplicated here).
//
// Mock pattern lifted directly from lib/__tests__/admin-api-gate.test.ts.
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  client: null as SupabaseClient | null,
}));

vi.mock("@/lib/auth", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    createRouteAuthClient: () => {
      if (!mockState.client) {
        throw new Error(
          "api-design-systems-auth.test: mockState.client not set before requireAdminForApi",
        );
      }
      return mockState.client;
    },
  };
});

// sites/register calls revalidatePath("/admin/sites") on success, which
// needs Next.js's static-generation store. Stubbing it out lets the
// operator-allow test hit the lib layer without a Next.js runtime.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { POST as activateRoute } from "@/app/api/design-systems/[id]/activate/route";
import { POST as archiveRoute } from "@/app/api/design-systems/[id]/archive/route";
import { POST as createComponentRoute } from "@/app/api/design-systems/[id]/components/route";
import {
  DELETE as deleteComponentRoute,
  PATCH as patchComponentRoute,
} from "@/app/api/design-systems/[id]/components/[cid]/route";
import { POST as createTemplateRoute } from "@/app/api/design-systems/[id]/templates/route";
import {
  DELETE as deleteTemplateRoute,
  PATCH as patchTemplateRoute,
} from "@/app/api/design-systems/[id]/templates/[tid]/route";
import { POST as createDesignSystemRoute } from "@/app/api/sites/[id]/design-systems/route";
import { POST as registerSiteRoute } from "@/app/api/sites/register/route";

import { createComponent } from "@/lib/components";
import { createDesignSystem } from "@/lib/design-systems";

function anonClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "api-design-systems-auth.test: SUPABASE_URL and SUPABASE_ANON_KEY must be set",
    );
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signedInClient(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email,
    password: "test-password-1234",
  });
  if (error) throw new Error(`signedInClient: ${error.message}`);
  return client;
}

function jsonReq(url: string, body?: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Viewer tests don't need a real DS — the gate runs before param
// validation, so any UUID-shaped string gets 403'd first.
const FAKE_DS_ID = "00000000-0000-0000-0000-000000000001";
const FAKE_CID = "00000000-0000-0000-0000-000000000002";
const FAKE_TID = "00000000-0000-0000-0000-000000000003";
const FAKE_SITE_ID = "00000000-0000-0000-0000-000000000004";

// Every mutating handler in the role-gate scope. Each entry invokes the
// route with a minimally-valid request; under a viewer session the gate
// returns 403 before the body is parsed.
const MUTATING_CASES: ReadonlyArray<{
  name: string;
  call: () => Promise<Response>;
}> = [
  {
    name: "POST /api/design-systems/[id]/activate",
    call: () =>
      activateRoute(
        jsonReq(`http://t/api/design-systems/${FAKE_DS_ID}/activate`, {
          expected_version_lock: 1,
        }),
        { params: { id: FAKE_DS_ID } },
      ),
  },
  {
    name: "POST /api/design-systems/[id]/archive",
    call: () =>
      archiveRoute(
        jsonReq(`http://t/api/design-systems/${FAKE_DS_ID}/archive`, {
          expected_version_lock: 1,
        }),
        { params: { id: FAKE_DS_ID } },
      ),
  },
  {
    name: "POST /api/design-systems/[id]/components",
    call: () =>
      createComponentRoute(
        jsonReq(`http://t/api/design-systems/${FAKE_DS_ID}/components`, {}),
        { params: { id: FAKE_DS_ID } },
      ),
  },
  {
    name: "PATCH /api/design-systems/[id]/components/[cid]",
    call: () =>
      patchComponentRoute(
        jsonReq(
          `http://t/api/design-systems/${FAKE_DS_ID}/components/${FAKE_CID}`,
          { expected_version_lock: 1 },
          "PATCH",
        ),
        { params: { id: FAKE_DS_ID, cid: FAKE_CID } },
      ),
  },
  {
    name: "DELETE /api/design-systems/[id]/components/[cid]",
    call: () =>
      deleteComponentRoute(
        new Request(
          `http://t/api/design-systems/${FAKE_DS_ID}/components/${FAKE_CID}?expected_version_lock=1`,
          { method: "DELETE" },
        ),
        { params: { id: FAKE_DS_ID, cid: FAKE_CID } },
      ),
  },
  {
    name: "POST /api/design-systems/[id]/templates",
    call: () =>
      createTemplateRoute(
        jsonReq(`http://t/api/design-systems/${FAKE_DS_ID}/templates`, {}),
        { params: { id: FAKE_DS_ID } },
      ),
  },
  {
    name: "PATCH /api/design-systems/[id]/templates/[tid]",
    call: () =>
      patchTemplateRoute(
        jsonReq(
          `http://t/api/design-systems/${FAKE_DS_ID}/templates/${FAKE_TID}`,
          { expected_version_lock: 1 },
          "PATCH",
        ),
        { params: { id: FAKE_DS_ID, tid: FAKE_TID } },
      ),
  },
  {
    name: "DELETE /api/design-systems/[id]/templates/[tid]",
    call: () =>
      deleteTemplateRoute(
        new Request(
          `http://t/api/design-systems/${FAKE_DS_ID}/templates/${FAKE_TID}?expected_version_lock=1`,
          { method: "DELETE" },
        ),
        { params: { id: FAKE_DS_ID, tid: FAKE_TID } },
      ),
  },
  {
    name: "POST /api/sites/[id]/design-systems",
    call: () =>
      createDesignSystemRoute(
        jsonReq(`http://t/api/sites/${FAKE_SITE_ID}/design-systems`, {
          tokens_css: "",
          base_styles: "",
        }),
        { params: { id: FAKE_SITE_ID } },
      ),
  },
  {
    name: "POST /api/sites/register",
    call: () =>
      registerSiteRoute(
        jsonReq(`http://t/api/sites/register`, {
          name: "Test",
          wp_url: "https://example.test",
          wp_user: "wp",
          wp_app_password: "hunter2hunter2",
        }),
      ),
  },
];

const ENV_KEYS = ["FEATURE_SUPABASE_AUTH"] as const;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = {};
  for (const k of ENV_KEYS) originalEnv[k] = process.env[k];
  mockState.client = null;
  __resetAuthKillSwitchCacheForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = originalEnv[k];
    }
  }
  mockState.client = null;
  __resetAuthKillSwitchCacheForTests();
});

describe("role gate — FEATURE_SUPABASE_AUTH off (bypass)", () => {
  // Proves existing tests in api-design-systems.test.ts and peers, which
  // run with the flag unset, still work — the gate allows through with
  // user: null and the route proceeds to its own validation / lib calls.
  it("activate route processes its body when the flag is off", async () => {
    delete process.env.FEATURE_SUPABASE_AUTH;
    mockState.client = anonClient();
    const res = await activateRoute(
      jsonReq(`http://t/api/design-systems/${FAKE_DS_ID}/activate`, {
        expected_version_lock: 1,
      }),
      { params: { id: FAKE_DS_ID } },
    );
    // Gate passed (no 403); route then 404s because the DS doesn't
    // exist. We care that it is NOT 401/403 — the gate got out of the way.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

describe("role gate — viewer is denied on every mutating route", () => {
  beforeEach(async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    const viewer = await seedAuthUser({ role: "user" });
    mockState.client = await signedInClient(viewer.email);
  });

  it.each(MUTATING_CASES)("$name → 403 FORBIDDEN", async ({ call }) => {
    const res = await call();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

describe("role gate — operator is allowed (representative routes)", () => {
  // Operator is the minimum role for every mutation under this slice. We
  // cover one real mutation per surface (design-systems activate, component
  // create, template create, site register) to prove the allow path; the
  // other handlers share the same gate call and are already pinned by
  // the viewer deny tests above.

  beforeEach(async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    const operator = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(operator.email);
  });

  it("activate route reaches the lib layer (200 on valid payload)", async () => {
    // Restore the real auth module for the service-role calls that
    // seedSite + createDesignSystem make; leave the mocked
    // createRouteAuthClient in place so the gate still sees the operator.
    const site = await seedSite();
    const ds = await createDesignSystem({
      site_id: site.id,
      version: 1,
      tokens_css: "",
      base_styles: "",
    });
    if (!ds.ok) throw new Error("seed DS failed");

    const res = await activateRoute(
      jsonReq(`http://t/api/design-systems/${ds.data.id}/activate`, {
        expected_version_lock: ds.data.version_lock,
      }),
      { params: { id: ds.data.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("components POST reaches the lib layer (creates on valid payload)", async () => {
    const site = await seedSite();
    const ds = await createDesignSystem({
      site_id: site.id,
      version: 1,
      tokens_css: "",
      base_styles: "",
    });
    if (!ds.ok) throw new Error("seed DS failed");

    const res = await createComponentRoute(
      jsonReq(`http://t/api/design-systems/${ds.data.id}/components`, {
        name: "hero-centered",
        variant: "default",
        category: "hero",
        html_template: "<section>{{headline}}</section>",
        css: `.${site.prefix}-hero { padding: 2rem; }`,
        content_schema: minimalComponentContentSchema(),
      }),
      { params: { id: ds.data.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("templates POST reaches the lib layer (creates on valid payload)", async () => {
    const site = await seedSite();
    const ds = await createDesignSystem({
      site_id: site.id,
      version: 1,
      tokens_css: "",
      base_styles: "",
    });
    if (!ds.ok) throw new Error("seed DS failed");
    await createComponent({
      design_system_id: ds.data.id,
      name: "hero-centered",
      variant: null,
      category: "hero",
      html_template: "<section>{{headline}}</section>",
      css: `.${site.prefix}-hero {}`,
      content_schema: minimalComponentContentSchema(),
    });
    await createComponent({
      design_system_id: ds.data.id,
      name: "footer-default",
      variant: null,
      category: "footer",
      html_template: "<footer></footer>",
      css: `.${site.prefix}-footer {}`,
      content_schema: minimalComponentContentSchema(),
    });

    const res = await createTemplateRoute(
      jsonReq(`http://t/api/design-systems/${ds.data.id}/templates`, {
        page_type: "homepage",
        name: "homepage-default",
        composition: minimalComposition(),
        required_fields: { hero: ["headline"] },
        is_default: true,
      }),
      { params: { id: ds.data.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("sites/register reaches the lib layer (creates on valid payload)", async () => {
    const res = await registerSiteRoute(
      jsonReq(`http://t/api/sites/register`, {
        name: "Operator Test Site",
        wp_url: "https://op.example.test",
        wp_user: "admin",
        wp_app_password: "hunter2hunter2",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
