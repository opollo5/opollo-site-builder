import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  KADENCE_THEME_SLUG,
  serializeKadencePalette,
  type KadencePaletteEntry,
} from "@/lib/kadence-rest";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M13-5c — end-to-end route tests for the appearance sync paths.
//
// WP REST is mocked via global.fetch. Three routes:
//   POST /appearance/preflight       (detect + stamp + audit)
//   POST /appearance/sync-palette    (dry_run | confirmed)
//   POST /appearance/rollback-palette
//
// Site credentials fetching is mocked via vi.mock("@/lib/sites") so we
// don't need real encrypted bytea in the test seed — we only need the
// site row + the public shape getSite returns.
// ---------------------------------------------------------------------------

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Mirror the M13-4 posts-publish tests: mock lib/sites.getSite so the
// route code that calls it with includeCredentials:true gets a row +
// fake creds without decrypt() touching real bytea.
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

import { POST as preflightPOST } from "@/app/api/sites/[id]/appearance/preflight/route";
import { POST as syncPOST } from "@/app/api/sites/[id]/appearance/sync-palette/route";
import { POST as rollbackPOST } from "@/app/api/sites/[id]/appearance/rollback-palette/route";

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

// ---------------------------------------------------------------------------
// WP fetch mock — stateful: a sync-palette confirmed write updates the
// in-memory palette so a follow-up dry-run / rollback reads the new
// value. Emulates WP's actual behavior.
// ---------------------------------------------------------------------------

type MockWpState = {
  caps: Record<string, boolean>;
  activeThemeSlug: string;
  installedThemes: Array<{ stylesheet: string; name: string; version: string }>;
  settings: Record<string, unknown>;
  /** Fail the next settings POST with this WP error shape. */
  failSettingsPost?: { status: number; body: unknown } | null;
};

function defaultWpState(): MockWpState {
  return {
    caps: { edit_posts: true, upload_files: true, edit_theme_options: true },
    activeThemeSlug: KADENCE_THEME_SLUG,
    installedThemes: [
      {
        stylesheet: KADENCE_THEME_SLUG,
        name: "Kadence",
        version: "1.2.3",
      },
    ],
    settings: { kadence_blocks_colors: "" },
    failSettingsPost: null,
  };
}

function mockWp(state: MockWpState) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.includes("/wp-json/wp/v2/users/me")) {
      return new Response(
        JSON.stringify({ id: 7, username: "test-user", capabilities: state.caps }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/wp-json/wp/v2/themes?status=active")) {
      return new Response(
        JSON.stringify([
          {
            stylesheet: state.activeThemeSlug,
            name: "Active",
            version: "1.0",
            status: "active",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/wp-json/wp/v2/themes")) {
      return new Response(JSON.stringify(state.installedThemes), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/wp-json/wp/v2/settings") && method === "POST") {
      if (state.failSettingsPost) {
        const { status, body } = state.failSettingsPost;
        state.failSettingsPost = null; // one-shot
        return new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      }
      const parsed = JSON.parse((init?.body as string) ?? "{}");
      Object.assign(state.settings, parsed);
      return new Response(JSON.stringify(state.settings), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/wp-json/wp/v2/settings")) {
      return new Response(JSON.stringify(state.settings), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: `unmocked: ${url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Seed helpers — site + active DS with enough colour tokens for a proposal
// ---------------------------------------------------------------------------

const EIGHT_COLOR_TOKENS = `
.test-scope {
  --test-primary:   #FF0055;
  --test-secondary: #FF8800;
  --test-accent:    #FFCC00;
  --test-ink:       #111111;
  --test-text:      #2C2C2A;
  --test-muted:     #6B6B66;
  --test-surface:   #FAFAF6;
  --test-border:    #E8E6DE;
}
`;

async function seedSiteWithActiveDs(opts?: {
  prefix?: string;
  tokens_css?: string;
}): Promise<{ site_id: string; site_version_lock: number }> {
  const site = await seedSite({ prefix: opts?.prefix ?? "test" });
  const svc = getServiceRoleClient();
  await svc.from("design_systems").insert({
    site_id: site.id,
    version: 1,
    tokens_css: opts?.tokens_css ?? EIGHT_COLOR_TOKENS,
    base_styles: "",
    status: "active",
  });
  const siteRow = await svc
    .from("sites")
    .select("version_lock")
    .eq("id", site.id)
    .single();
  return {
    site_id: site.id,
    site_version_lock: siteRow.data?.version_lock as number,
  };
}

// Build the exact palette an operator would see as the "after" of a
// sync. Matches the seed tokens above.
const SEED_PROPOSAL: KadencePaletteEntry[] = [
  { slug: "palette1", name: "Primary", color: "#FF0055" },
  { slug: "palette2", name: "Secondary", color: "#FF8800" },
  { slug: "palette3", name: "Accent", color: "#FFCC00" },
  { slug: "palette4", name: "Ink", color: "#111111" },
  { slug: "palette5", name: "Text", color: "#2C2C2A" },
  { slug: "palette6", name: "Muted", color: "#6B6B66" },
  { slug: "palette7", name: "Surface", color: "#FAFAF6" },
  { slug: "palette8", name: "Border", color: "#E8E6DE" },
];

// ---------------------------------------------------------------------------
// /preflight
// ---------------------------------------------------------------------------

describe("POST /appearance/preflight", () => {
  it("happy path: stamps kadence_installed_at + returns diff + proposal", async () => {
    const { site_id } = await seedSiteWithActiveDs();
    const wp = defaultWpState();
    mockWp(wp);

    const res = await preflightPOST(
      new Request(`http://localhost/api/sites/${site_id}/appearance/preflight`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
      { params: { id: site_id } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        install: { kadence_active: boolean };
        proposal: { source: string; slots: unknown[] };
        diff: { any_changes: boolean };
        already_synced: boolean;
        current_palette_sha: string;
        site_version_lock: number;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.data.install.kadence_active).toBe(true);
    expect(body.data.proposal.source).toBe("ordered_hex");
    expect(body.data.proposal.slots).toHaveLength(8);
    expect(body.data.diff.any_changes).toBe(true);
    expect(body.data.already_synced).toBe(false);
    expect(body.data.current_palette_sha).toMatch(/^[0-9a-f]{64}$/);

    // sites.kadence_installed_at stamped + version_lock bumped.
    const svc = getServiceRoleClient();
    const site = await svc
      .from("sites")
      .select("kadence_installed_at, version_lock")
      .eq("id", site_id)
      .single();
    expect(site.data?.kadence_installed_at).toBeTruthy();

    // preflight_run audit event landed with outcome=ready.
    const events = await svc
      .from("appearance_events")
      .select("event, details")
      .eq("site_id", site_id);
    const preflightEvents = (events.data ?? []).filter(
      (e) => e.event === "preflight_run",
    );
    expect(preflightEvents).toHaveLength(1);
    expect(
      (preflightEvents[0]?.details as Record<string, unknown>)?.outcome,
    ).toBe("ready");
  });

  it("KADENCE_NOT_ACTIVE (409) when active theme isn't Kadence", async () => {
    const { site_id } = await seedSiteWithActiveDs();
    const wp = defaultWpState();
    wp.activeThemeSlug = "twentytwentyfour";
    wp.installedThemes = [
      { stylesheet: "twentytwentyfour", name: "Twenty Twenty-Four", version: "1.0" },
    ];
    mockWp(wp);

    const res = await preflightPOST(
      new Request(`http://localhost/api/sites/${site_id}/appearance/preflight`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
      { params: { id: site_id } },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("KADENCE_NOT_ACTIVE");
  });

  it("PREFLIGHT_BLOCKED (403) when WP capabilities are missing", async () => {
    const { site_id } = await seedSiteWithActiveDs();
    const wp = defaultWpState();
    wp.caps = { read: true }; // no edit_posts / upload_files
    mockWp(wp);

    const res = await preflightPOST(
      new Request(`http://localhost/api/sites/${site_id}/appearance/preflight`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
      { params: { id: site_id } },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PREFLIGHT_BLOCKED");
  });
});

// ---------------------------------------------------------------------------
// /sync-palette — dry_run
// ---------------------------------------------------------------------------

describe("POST /appearance/sync-palette — dry_run mode", () => {
  it("returns diff + sha + proposal without any writes", async () => {
    const { site_id } = await seedSiteWithActiveDs();
    const wp = defaultWpState();
    mockWp(wp);

    const res = await syncPOST(
      new Request(`http://localhost/api/sites/${site_id}/appearance/sync-palette`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "dry_run" }),
      }),
      { params: { id: site_id } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        mode: string;
        already_synced: boolean;
        current_palette_sha: string;
      };
    };
    expect(body.data.mode).toBe("dry_run");
    expect(body.data.already_synced).toBe(false);

    // No globals_* events written for a pure dry-run.
    const svc = getServiceRoleClient();
    const events = await svc
      .from("appearance_events")
      .select("event")
      .eq("site_id", site_id);
    const kinds = (events.data ?? []).map((e) => e.event);
    expect(kinds).not.toContain("globals_completed");
    expect(kinds).not.toContain("globals_confirmed");

    // WP state unchanged.
    expect(wp.settings.kadence_blocks_colors).toBe("");
  });
});

// ---------------------------------------------------------------------------
// /sync-palette — confirmed
// ---------------------------------------------------------------------------

describe("POST /appearance/sync-palette — confirmed mode", () => {
  async function runDryRunFirst(site_id: string): Promise<{
    sha: string;
    version_lock: number;
  }> {
    const res = await syncPOST(
      new Request(
        `http://localhost/api/sites/${site_id}/appearance/sync-palette`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "dry_run" }),
        },
      ),
      { params: { id: site_id } },
    );
    const body = (await res.json()) as {
      data: { current_palette_sha: string; site_version_lock: number };
    };
    return {
      sha: body.data.current_palette_sha,
      version_lock: body.data.site_version_lock,
    };
  }

  it("happy path: writes WP, stamps synced_at, audits globals_completed with snapshot", async () => {
    const { site_id } = await seedSiteWithActiveDs();
    const wp = defaultWpState();
    mockWp(wp);

    const { sha, version_lock } = await runDryRunFirst(site_id);

    const res = await syncPOST(
      new Request(
        `http://localhost/api/sites/${site_id}/appearance/sync-palette`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "confirmed",
            expected_site_version_lock: version_lock,
            expected_current_palette_sha: sha,
          }),
        },
      ),
      { params: { id: site_id } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        mode: string;
        outcome: string;
        synced_at: string;
        round_trip_ok: boolean;
      };
    };
    expect(body.data.outcome).toBe("SYNCED");
    expect(body.data.round_trip_ok).toBe(true);

    // WP state now reflects the proposal.
    expect(wp.settings.kadence_blocks_colors).toBe(
      serializeKadencePalette(SEED_PROPOSAL),
    );

    // sites.kadence_globals_synced_at stamped + version_lock bumped.
    const svc = getServiceRoleClient();
    const site = await svc
      .from("sites")
      .select("kadence_globals_synced_at, version_lock")
      .eq("id", site_id)
      .single();
    expect(site.data?.kadence_globals_synced_at).toBeTruthy();

    // globals_completed audit carries the previous_palette snapshot
    // (empty palette, since WP started in 'unset' source state).
    const events = await svc
      .from("appearance_events")
      .select("event, details")
      .eq("site_id", site_id)
      .order("created_at", { ascending: true });
    const kinds = (events.data ?? []).map((e) => e.event);
    expect(kinds).toContain("globals_confirmed");
    expect(kinds).toContain("globals_completed");
    const completed = (events.data ?? []).find(
      (e) => e.event === "globals_completed",
    );
    expect(
      (completed?.details as Record<string, unknown>)?.previous_palette,
    ).toBeTruthy();
  });

  it("ALREADY_SYNCED when current WP palette already matches proposal", async () => {
    const { site_id } = await seedSiteWithActiveDs();
    const wp = defaultWpState();
    // Pre-populate WP with the same palette the proposal will produce.
    wp.settings.kadence_blocks_colors = serializeKadencePalette(SEED_PROPOSAL);
    mockWp(wp);

    const { sha, version_lock } = await runDryRunFirst(site_id);

    const res = await syncPOST(
      new Request(
        `http://localhost/api/sites/${site_id}/appearance/sync-palette`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "confirmed",
            expected_site_version_lock: version_lock,
            expected_current_palette_sha: sha,
          }),
        },
      ),
      { params: { id: site_id } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { outcome: string };
    };
    expect(body.data.outcome).toBe("ALREADY_SYNCED");

    // No globals_completed — empty diff short-circuited.
    const svc = getServiceRoleClient();
    const events = await svc
      .from("appearance_events")
      .select("event")
      .eq("site_id", site_id);
    const kinds = (events.data ?? []).map((e) => e.event);
    expect(kinds).not.toContain("globals_completed");
  });

  it("WP_STATE_DRIFTED (409) when current_palette_sha doesn't match fresh WP read", async () => {
    const { site_id } = await seedSiteWithActiveDs();
    const wp = defaultWpState();
    mockWp(wp);

    const { version_lock } = await runDryRunFirst(site_id);

    // Pass a deliberately wrong sha (operator edited WP between
    // dry-run and confirm; fresh read will differ).
    const res = await syncPOST(
      new Request(
        `http://localhost/api/sites/${site_id}/appearance/sync-palette`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "confirmed",
            expected_site_version_lock: version_lock,
            expected_current_palette_sha: "f".repeat(64),
          }),
        },
      ),
      { params: { id: site_id } },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; details?: unknown };
    };
    expect(body.error.code).toBe("WP_STATE_DRIFTED");
    // WP state unchanged.
    expect(wp.settings.kadence_blocks_colors).toBe("");
  });

  it("VERSION_CONFLICT (409) on stale expected_site_version_lock", async () => {
    const { site_id } = await seedSiteWithActiveDs();
    const wp = defaultWpState();
    mockWp(wp);

    const { sha, version_lock } = await runDryRunFirst(site_id);

    const res = await syncPOST(
      new Request(
        `http://localhost/api/sites/${site_id}/appearance/sync-palette`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "confirmed",
            expected_site_version_lock: version_lock + 5,
            expected_current_palette_sha: sha,
          }),
        },
      ),
      { params: { id: site_id } },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VERSION_CONFLICT");
    // WP state unchanged — we rejected before any WP write.
    expect(wp.settings.kadence_blocks_colors).toBe("");
  });
});

// ---------------------------------------------------------------------------
// /rollback-palette
// ---------------------------------------------------------------------------

describe("POST /appearance/rollback-palette", () => {
  it("NO_PRIOR_SNAPSHOT (409) when no globals_completed has been written", async () => {
    const { site_id, site_version_lock } = await seedSiteWithActiveDs();
    const wp = defaultWpState();
    mockWp(wp);

    const res = await rollbackPOST(
      new Request(
        `http://localhost/api/sites/${site_id}/appearance/rollback-palette`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expected_site_version_lock: site_version_lock,
          }),
        },
      ),
      { params: { id: site_id } },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NO_PRIOR_SNAPSHOT");
  });

  it("ROLLED_BACK happy path: reverts WP to the snapshot from the last globals_completed event", async () => {
    const { site_id } = await seedSiteWithActiveDs();
    const wp = defaultWpState();
    // Pre-populate WP with a DIFFERENT palette (the "original") that
    // the snapshot will restore to.
    const ORIGINAL: KadencePaletteEntry[] = [
      { slug: "palette1", name: "Old-1", color: "#AAAAAA" },
      { slug: "palette2", name: "Old-2", color: "#BBBBBB" },
      { slug: "palette3", name: "Old-3", color: "#CCCCCC" },
      { slug: "palette4", name: "Old-4", color: "#DDDDDD" },
      { slug: "palette5", name: "Old-5", color: "#EEEEEE" },
      { slug: "palette6", name: "Old-6", color: "#FFFFFF" },
      { slug: "palette7", name: "Old-7", color: "#111111" },
      { slug: "palette8", name: "Old-8", color: "#222222" },
    ];
    wp.settings.kadence_blocks_colors = serializeKadencePalette(ORIGINAL);
    mockWp(wp);

    // 1) Do a full sync (dry-run → confirm) to establish a snapshot.
    const dryRes = await syncPOST(
      new Request(
        `http://localhost/api/sites/${site_id}/appearance/sync-palette`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "dry_run" }),
        },
      ),
      { params: { id: site_id } },
    );
    const dry = (await dryRes.json()) as {
      data: { current_palette_sha: string; site_version_lock: number };
    };
    const confirmRes = await syncPOST(
      new Request(
        `http://localhost/api/sites/${site_id}/appearance/sync-palette`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "confirmed",
            expected_site_version_lock: dry.data.site_version_lock,
            expected_current_palette_sha: dry.data.current_palette_sha,
          }),
        },
      ),
      { params: { id: site_id } },
    );
    const confirm = (await confirmRes.json()) as {
      data: { new_site_version_lock: number };
    };

    // After sync, WP has SEED_PROPOSAL.
    expect(wp.settings.kadence_blocks_colors).toBe(
      serializeKadencePalette(SEED_PROPOSAL),
    );

    // 2) Rollback.
    const rbRes = await rollbackPOST(
      new Request(
        `http://localhost/api/sites/${site_id}/appearance/rollback-palette`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expected_site_version_lock: confirm.data.new_site_version_lock,
          }),
        },
      ),
      { params: { id: site_id } },
    );
    expect(rbRes.status).toBe(200);
    const rbBody = (await rbRes.json()) as {
      data: { outcome: string; reverted_from_event_id: string };
    };
    expect(rbBody.data.outcome).toBe("ROLLED_BACK");

    // WP now reflects the ORIGINAL palette again.
    expect(wp.settings.kadence_blocks_colors).toBe(
      serializeKadencePalette(ORIGINAL),
    );

    // rollback_completed event written with reverted_from_event_id.
    const svc = getServiceRoleClient();
    const events = await svc
      .from("appearance_events")
      .select("event, details")
      .eq("site_id", site_id)
      .order("created_at", { ascending: true });
    const rollbackCompleted = (events.data ?? []).find(
      (e) => e.event === "rollback_completed",
    );
    expect(rollbackCompleted).toBeTruthy();
    expect(
      (rollbackCompleted?.details as Record<string, unknown>)
        ?.reverted_from_event_id,
    ).toBe(rbBody.data.reverted_from_event_id);
  });

  it("ALREADY_ROLLED_BACK (idempotent) when current WP palette already matches the snapshot", async () => {
    const { site_id, site_version_lock } = await seedSiteWithActiveDs();
    const wp = defaultWpState();
    // Pre-populate WP with a specific palette.
    const MATCHING: KadencePaletteEntry[] = [
      { slug: "palette1", name: "One", color: "#111111" },
      { slug: "palette2", name: "Two", color: "#222222" },
      { slug: "palette3", name: "Three", color: "#333333" },
      { slug: "palette4", name: "Four", color: "#444444" },
      { slug: "palette5", name: "Five", color: "#555555" },
      { slug: "palette6", name: "Six", color: "#666666" },
      { slug: "palette7", name: "Seven", color: "#777777" },
      { slug: "palette8", name: "Eight", color: "#888888" },
    ];
    wp.settings.kadence_blocks_colors = serializeKadencePalette(MATCHING);
    mockWp(wp);

    // Hand-seed a globals_completed event whose previous_palette
    // matches the current WP state exactly — rollback should detect
    // the no-op and return ALREADY_ROLLED_BACK.
    const svc = getServiceRoleClient();
    await svc.from("appearance_events").insert({
      site_id,
      event: "globals_completed",
      details: {
        previous_palette: { palette: MATCHING, source: "populated" },
      },
    });

    const res = await rollbackPOST(
      new Request(
        `http://localhost/api/sites/${site_id}/appearance/rollback-palette`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expected_site_version_lock: site_version_lock,
          }),
        },
      ),
      { params: { id: site_id } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { outcome: string } };
    expect(body.data.outcome).toBe("ALREADY_ROLLED_BACK");

    // WP state untouched.
    expect(wp.settings.kadence_blocks_colors).toBe(
      serializeKadencePalette(MATCHING),
    );

    // No rollback_completed event — rollback was a no-op; only a
    // rollback_requested event (with outcome=already_rolled_back)
    // should exist.
    const events = await svc
      .from("appearance_events")
      .select("event")
      .eq("site_id", site_id);
    const kinds = (events.data ?? []).map((e) => e.event);
    expect(kinds).not.toContain("rollback_completed");
    expect(kinds).toContain("rollback_requested");
  });
});
