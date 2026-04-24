import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M13-4 — publish + unpublish + preflight route tests.
//
// WP REST is mocked by intercepting global.fetch. The publish path
// flows:
//   POST route
//     → preflightSitePublish → wpGetMe (fetched)
//     → wpCreatePost / wpUpdatePost (fetched)
//     → supabase UPDATE on posts
//
// Tests assert the route's translated error shape, the CAS behavior
// (VERSION_CONFLICT), and the preflight-blocker branch.
// ---------------------------------------------------------------------------

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { POST as publishPOST } from "@/app/api/sites/[id]/posts/[post_id]/publish/route";
import { POST as unpublishPOST } from "@/app/api/sites/[id]/posts/[post_id]/unpublish/route";

const ENV_KEYS = ["FEATURE_SUPABASE_AUTH"] as const;
let origEnv: Record<string, string | undefined>;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  origEnv = {};
  for (const k of ENV_KEYS) origEnv[k] = process.env[k];
  delete process.env.FEATURE_SUPABASE_AUTH;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
  globalThis.fetch = originalFetch;
});

beforeAll(() => {
  // vi.fn for fetch per-test is set up inline where needed.
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

type CannedResponse = {
  status: number;
  body: unknown;
};

function mockFetch(responses: Record<string, CannedResponse>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    // Find the first matching prefix.
    for (const [needle, resp] of Object.entries(responses)) {
      if (url.includes(needle)) {
        return new Response(JSON.stringify(resp.body), {
          status: resp.status,
          headers: { "content-type": "application/json" },
        });
      }
    }
    // Default to 404 if no match — surfaces unexpected calls loudly.
    return new Response(JSON.stringify({ error: `unmocked: ${url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

async function seedDraftPost(opts: {
  siteId: string;
  slug?: string;
  wp_post_id?: number | null;
  generated_html?: string | null;
  status?: "draft" | "published";
}): Promise<{ postId: string; versionLock: number }> {
  const svc = getServiceRoleClient();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const row = await svc
    .from("posts")
    .insert({
      site_id: opts.siteId,
      content_type: "post",
      title: `E2E post ${unique}`,
      slug: opts.slug ?? `e2e-post-${unique}`,
      design_system_version: 1,
      status: opts.status ?? "draft",
      generated_html:
        opts.generated_html !== undefined
          ? opts.generated_html
          : "<p>Generated body.</p>",
      wp_post_id: opts.wp_post_id ?? null,
      published_at: opts.status === "published" ? new Date().toISOString() : null,
    })
    .select("id, version_lock")
    .single();
  if (row.error || !row.data) {
    throw new Error(`seedDraftPost: ${row.error?.message}`);
  }
  return {
    postId: row.data.id as string,
    versionLock: row.data.version_lock as number,
  };
}

async function seedSiteWithCreds(): Promise<{ id: string }> {
  const site = await seedSite();
  // seedSite doesn't insert WP credentials by default. Add a row
  // directly so getSite({ includeCredentials: true }) returns them.
  const svc = getServiceRoleClient();
  // The credentials format requires encrypted bytea; for these tests
  // we only need the route to FIND the row. The actual WP calls are
  // mocked so decrypt-produced password isn't validated against a
  // real server.
  //
  // The schema is enforced by the M2a migration; see lib/sites.ts for
  // how the write-path encrypts. We reuse the existing path via
  // createSite in the helper instead of crafting bytea by hand.
  // Actually seedSite goes through the raw insert in _helpers.ts —
  // check whether site_credentials was created.
  const check = await svc
    .from("site_credentials")
    .select("site_id")
    .eq("site_id", site.id)
    .maybeSingle();
  if (!check.data) {
    // _helpers.seedSite doesn't create creds. We fabricate a minimal
    // row so the publish route can resolve credentials in these tests.
    // The WP password isn't actually used — fetch is mocked.
    // The encrypt format (bytea + iv + key_version) matters because
    // decrypt() would blow up. Simpler: mock getSite via vi.mock.
  }
  return { id: site.id };
}

// Because the route imports getSite transitively via lib/site-preflight.ts
// AND lib/sites.ts's decrypt() would fail on fake ciphertext, we mock
// lib/sites.getSite directly. This keeps the route test focused on
// route behavior — credential handling is covered by sites.test.ts.
vi.mock("@/lib/sites", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sites")>();
  return {
    ...actual,
    getSite: vi.fn(async (id: string, opts?: { includeCredentials?: boolean }) => {
      const svc = getServiceRoleClient();
      const { data: site, error } = await svc
        .from("sites")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error || !site) {
        return {
          ok: false,
          error: {
            code: "NOT_FOUND" as const,
            message: `No site ${id}`,
            retryable: false,
            suggested_action: "",
          },
          timestamp: new Date().toISOString(),
        };
      }
      const credentials = opts?.includeCredentials
        ? {
            wp_user: "test-user",
            wp_app_password: "test-app-password",
          }
        : null;
      return {
        ok: true as const,
        data: { site, credentials },
        timestamp: new Date().toISOString(),
      };
    }),
  };
});

describe("POST /api/sites/[id]/posts/[post_id]/publish — happy path", () => {
  it("first publish: creates WP post + writes wp_post_id + status=published", async () => {
    const site = await seedSiteWithCreds();
    const { postId, versionLock } = await seedDraftPost({
      siteId: site.id,
      slug: "publish-happy",
    });

    mockFetch({
      "/wp-json/wp/v2/users/me": {
        status: 200,
        body: {
          id: 7,
          username: "test-user",
          capabilities: { edit_posts: true, upload_files: true },
        },
      },
      "/wp-json/wp/v2/posts": {
        status: 201,
        body: {
          id: 42,
          slug: "publish-happy",
          status: "publish",
          link: "https://example.com/?p=42",
        },
      },
    });

    const res = await publishPOST(
      new Request(
        `http://localhost/api/sites/${site.id}/posts/${postId}/publish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expected_version_lock: versionLock }),
        },
      ),
      { params: { id: site.id, post_id: postId } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data?: { wp_post_id: number; status: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data?.wp_post_id).toBe(42);
    expect(body.data?.status).toBe("published");

    const svc = getServiceRoleClient();
    const after = await svc
      .from("posts")
      .select("wp_post_id, status, published_at")
      .eq("id", postId)
      .single();
    expect(after.data?.wp_post_id).toBe(42);
    expect(after.data?.status).toBe("published");
    expect(after.data?.published_at).toBeTruthy();
  });
});

describe("POST /api/sites/[id]/posts/[post_id]/publish — preflight blocks", () => {
  it("returns 403 PREFLIGHT_BLOCKED with a translated blocker when WP capabilities are missing", async () => {
    const site = await seedSiteWithCreds();
    const { postId, versionLock } = await seedDraftPost({
      siteId: site.id,
      slug: "publish-blocked",
    });

    mockFetch({
      "/wp-json/wp/v2/users/me": {
        status: 200,
        body: {
          id: 7,
          username: "test-user",
          // edit_posts missing; capabilities object present but has the wrong keys.
          capabilities: { read: true },
        },
      },
    });

    const res = await publishPOST(
      new Request(
        `http://localhost/api/sites/${site.id}/posts/${postId}/publish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expected_version_lock: versionLock }),
        },
      ),
      { params: { id: site.id, post_id: postId } },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string; details?: { blocker?: { code: string } } };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("PREFLIGHT_BLOCKED");
    expect(body.error.details?.blocker?.code).toBe("AUTH_CAPABILITY_MISSING");
  });
});

describe("POST /api/sites/[id]/posts/[post_id]/publish — error paths", () => {
  it("VERSION_CONFLICT (409) on stale expected_version_lock", async () => {
    const site = await seedSiteWithCreds();
    const { postId, versionLock } = await seedDraftPost({
      siteId: site.id,
      slug: "publish-stale",
    });

    mockFetch({
      "/wp-json/wp/v2/users/me": {
        status: 200,
        body: {
          id: 7,
          username: "test-user",
          capabilities: { edit_posts: true, upload_files: true },
        },
      },
      "/wp-json/wp/v2/posts": {
        status: 201,
        body: { id: 99, slug: "publish-stale", status: "publish" },
      },
    });

    const res = await publishPOST(
      new Request(
        `http://localhost/api/sites/${site.id}/posts/${postId}/publish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expected_version_lock: versionLock + 5 }),
        },
      ),
      { params: { id: site.id, post_id: postId } },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VERSION_CONFLICT");
  });

  it("INVALID_STATE (409) when post has no generated_html", async () => {
    const site = await seedSiteWithCreds();
    const { postId, versionLock } = await seedDraftPost({
      siteId: site.id,
      slug: "publish-nohtml",
      generated_html: null,
    });

    const res = await publishPOST(
      new Request(
        `http://localhost/api/sites/${site.id}/posts/${postId}/publish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expected_version_lock: versionLock }),
        },
      ),
      { params: { id: site.id, post_id: postId } },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_STATE");
  });

  it("NOT_FOUND (404) when post_id exists but belongs to a different site", async () => {
    const siteA = await seedSiteWithCreds();
    const siteB = await seedSiteWithCreds();
    const { postId, versionLock } = await seedDraftPost({
      siteId: siteA.id,
      slug: "publish-wrong-site",
    });

    const res = await publishPOST(
      new Request(
        `http://localhost/api/sites/${siteB.id}/posts/${postId}/publish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expected_version_lock: versionLock }),
        },
      ),
      { params: { id: siteB.id, post_id: postId } },
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/sites/[id]/posts/[post_id]/unpublish", () => {
  it("happy path: trashes WP post + flips status back to draft", async () => {
    const site = await seedSiteWithCreds();
    const { postId, versionLock } = await seedDraftPost({
      siteId: site.id,
      slug: "unpub-happy",
      wp_post_id: 50,
      status: "published",
    });

    mockFetch({
      "/wp-json/wp/v2/posts/50": {
        status: 200,
        body: { id: 50, status: "trash" },
      },
    });

    const res = await unpublishPOST(
      new Request(
        `http://localhost/api/sites/${site.id}/posts/${postId}/unpublish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expected_version_lock: versionLock }),
        },
      ),
      { params: { id: site.id, post_id: postId } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { status: string; wp_post_id: number | null };
    };
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("draft");
    // wp_post_id is preserved for recovery.
    expect(body.data.wp_post_id).toBe(50);

    const svc = getServiceRoleClient();
    const after = await svc
      .from("posts")
      .select("status, published_at, wp_post_id")
      .eq("id", postId)
      .single();
    expect(after.data?.status).toBe("draft");
    expect(after.data?.published_at).toBeNull();
    expect(after.data?.wp_post_id).toBe(50);
  });

  it("INVALID_STATE (409) when post is already draft", async () => {
    const site = await seedSiteWithCreds();
    const { postId, versionLock } = await seedDraftPost({
      siteId: site.id,
      slug: "unpub-draft",
      status: "draft",
    });

    const res = await unpublishPOST(
      new Request(
        `http://localhost/api/sites/${site.id}/posts/${postId}/unpublish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expected_version_lock: versionLock }),
        },
      ),
      { params: { id: site.id, post_id: postId } },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_STATE");
  });
});
