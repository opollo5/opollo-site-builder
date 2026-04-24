import { describe, expect, it } from "vitest";

import { logAppearanceEvent } from "@/lib/appearance-events";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M13-5a migration 0022 pin.
//
// Asserts:
//   - sites gains kadence_installed_at + kadence_globals_synced_at
//     (both nullable timestamptz, default NULL)
//   - appearance_events table exists with the right CHECK-enum events
//   - appearance_events rejects unknown event strings
//   - appearance_events blocks site hard-delete when rows exist
//     (ON DELETE RESTRICT)
//
// _setup.ts truncates all tables in beforeEach, so each test seeds a
// fresh site.
// ---------------------------------------------------------------------------

describe("M13-5a: sites gains kadence_installed_at + kadence_globals_synced_at", () => {
  it("fresh site has NULL for both kadence_installed_at + kadence_globals_synced_at", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const { data, error } = await svc
      .from("sites")
      .select("kadence_installed_at, kadence_globals_synced_at")
      .eq("id", site.id)
      .single();
    expect(error).toBeNull();
    expect(data?.kadence_installed_at).toBeNull();
    expect(data?.kadence_globals_synced_at).toBeNull();
  });

  it("accepts a timestamptz value in kadence_installed_at", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const now = new Date().toISOString();
    const upd = await svc
      .from("sites")
      .update({ kadence_installed_at: now })
      .eq("id", site.id)
      .select("kadence_installed_at")
      .single();
    expect(upd.error).toBeNull();
    expect(upd.data?.kadence_installed_at).toBeTruthy();
  });
});

describe("M13-5a: appearance_events CHECK-enum", () => {
  const VALID_EVENTS = [
    "preflight_run",
    "install_dry_run",
    "install_confirmed",
    "install_completed",
    "install_failed",
    "globals_dry_run",
    "globals_confirmed",
    "globals_completed",
    "globals_failed",
    "rollback_requested",
    "rollback_completed",
    "rollback_failed",
  ];

  it.each(VALID_EVENTS)("accepts event '%s'", async (event) => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const res = await svc
      .from("appearance_events")
      .insert({ site_id: site.id, event, details: {} })
      .select("id, event")
      .single();
    expect(res.error).toBeNull();
    expect(res.data?.event).toBe(event);
  });

  it("rejects an unknown event string via CHECK (23514)", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const res = await svc
      .from("appearance_events")
      .insert({ site_id: site.id, event: "not-a-real-event", details: {} });
    expect(res.error).not.toBeNull();
    expect((res.error as { code?: string }).code).toBe("23514");
  });
});

describe("M13-5a: appearance_events ON DELETE RESTRICT preserves audit history", () => {
  it("blocks hard-delete of sites while appearance_events rows exist", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    await svc
      .from("appearance_events")
      .insert({
        site_id: site.id,
        event: "install_completed",
        details: { prior_active_theme_slug: "twentytwentyfour" },
      });

    const del = await svc.from("sites").delete().eq("id", site.id);
    expect(del.error).not.toBeNull();
    // ON DELETE RESTRICT → 23503 (foreign_key_violation).
    expect((del.error as { code?: string }).code).toBe("23503");
  });
});

describe("M13-5a: logAppearanceEvent helper", () => {
  it("appends a row and returns its id", async () => {
    const site = await seedSite();
    const res = await logAppearanceEvent({
      site_id: site.id,
      event: "preflight_run",
      details: { cap_check: "passed" },
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.id).toBeTruthy();

    const svc = getServiceRoleClient();
    const rows = await svc
      .from("appearance_events")
      .select("event, details")
      .eq("site_id", site.id);
    expect(rows.data?.length).toBe(1);
    expect(rows.data?.[0]?.event).toBe("preflight_run");
    expect((rows.data?.[0]?.details as Record<string, unknown>)?.cap_check).toBe(
      "passed",
    );
  });

  it("preserves details shape per event — install_completed round-trip", async () => {
    const site = await seedSite();
    const details = {
      prior_active_theme_slug: "twentytwentyfour",
      installed_version: "1.2.3",
      wp_response_id: 7,
    };
    await logAppearanceEvent({
      site_id: site.id,
      event: "install_completed",
      details,
    });
    const svc = getServiceRoleClient();
    const row = await svc
      .from("appearance_events")
      .select("details")
      .eq("site_id", site.id)
      .single();
    expect(row.data?.details).toEqual(details);
  });

  it("listAppearanceEventsForSite returns newest first", async () => {
    const { listAppearanceEventsForSite } = await import(
      "@/lib/appearance-events"
    );
    const site = await seedSite();
    // Insert in order; the query orders by created_at DESC.
    await logAppearanceEvent({ site_id: site.id, event: "preflight_run" });
    // Tiny delay to ensure timestamps differ at millisecond precision
    // — Supabase's now() source has µs precision but some CI clocks
    // round up; a 5ms sleep is overkill but eliminates flake.
    await new Promise((r) => setTimeout(r, 5));
    await logAppearanceEvent({ site_id: site.id, event: "install_dry_run" });

    const rows = await listAppearanceEventsForSite(site.id);
    expect(rows.length).toBe(2);
    expect(rows[0]?.event).toBe("install_dry_run");
    expect(rows[1]?.event).toBe("preflight_run");
  });
});
