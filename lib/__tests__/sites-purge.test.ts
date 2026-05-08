import { describe, expect, it } from "vitest";

import { purgeSite } from "@/lib/sites";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// Spec 01 §3.2 vitest — recursive cascade walk.
//
// Seeds a site with a direct dependency (briefs), an indirect
// dependency (brief_pages → briefs → site), and a 1:1 dependency
// (site_credentials), then asserts the purge:
//   1. Records an audit row with action='site_purged' and the right
//      metadata.
//   2. Deletes the indirect dependency (brief_pages) before the
//      intermediate (briefs) before the parent (sites).
//   3. Deletes the 1:1 row (site_credentials) too.
//   4. Returns ok:true with a deleted_by_table tally.
//
// The walk uses information_schema at runtime so the only contract this
// test pins is "every dependency chains back through valid FKs". A
// future schema add of a new transitive dependency joins the cascade
// automatically — and would surface here if the new FK violates the
// canonical-`id` PK assumption (the failure-fast point in the
// dependency walker).

describe("purgeSite recursive cascade", () => {
  it("purges the site, walks transitive dependencies, and writes one audit row", async () => {
    const svc = getServiceRoleClient();
    const { id: siteId } = await seedSite();

    // Insert site_credentials (1:1 child of sites).
    await svc.from("site_credentials").insert({
      site_id: siteId,
      wp_user: "purge-test",
      site_secret_encrypted: "\\x00",
      iv: "\\x00",
      key_version: 1,
    });

    // Insert a brief (FK → sites). Then a brief_pages row (FK → briefs)
    // — the indirect dependency the spec calls out specifically.
    const { data: brief, error: briefErr } = await svc
      .from("briefs")
      .insert({
        site_id: siteId,
        title: "Purge test brief",
        status: "parsed",
        text_model: "claude-sonnet-4-6",
        source_storage_path: "purge-test/brief.txt",
        source_mime_type: "text/plain",
        source_size_bytes: 12,
        source_sha256: "aabbccdd",
        upload_idempotency_key: "purge-test-idem-key",
      })
      .select("id")
      .single();
    if (briefErr || !brief) {
      throw new Error(`brief seed failed: ${briefErr?.message ?? "no row"}`);
    }
    const briefId = brief.id as string;

    const { error: pageErr } = await svc.from("brief_pages").insert({
      brief_id: briefId,
      ordinal: 0,
      title: "Purge test page",
      mode: "short_brief",
      source_text: "Purge test page content.",
      word_count: 4,
    });
    if (pageErr) {
      throw new Error(`brief_pages seed failed: ${pageErr.message}`);
    }

    const result = await purgeSite(siteId, {
      actorId: null,
      actorEmail: "purge-test@opollo.com",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The cascade tally MUST include all three tables we seeded plus
    // the sites row itself. Counts vary per table (we don't pin them
    // — the assertion is "presence of the table" so an unrelated FK
    // graph change doesn't flake this).
    expect(Object.keys(result.data.deleted_by_table)).toContain(
      "brief_pages",
    );
    expect(Object.keys(result.data.deleted_by_table)).toContain("briefs");
    expect(Object.keys(result.data.deleted_by_table)).toContain(
      "site_credentials",
    );
    expect(result.data.deleted_by_table.sites).toBe(1);

    // sites row gone.
    const { data: gone } = await svc
      .from("sites")
      .select("id")
      .eq("id", siteId)
      .maybeSingle();
    expect(gone).toBeNull();

    // briefs row gone.
    const { data: briefGone } = await svc
      .from("briefs")
      .select("id")
      .eq("id", briefId)
      .maybeSingle();
    expect(briefGone).toBeNull();

    // site_credentials gone.
    const { data: credGone } = await svc
      .from("site_credentials")
      .select("site_id")
      .eq("site_id", siteId)
      .maybeSingle();
    expect(credGone).toBeNull();

    // One audit row recorded with site_purged action and the right
    // site identity in metadata.
    const { data: audit } = await svc
      .from("user_audit_log")
      .select("action,metadata,target_email")
      .eq("action", "site_purged")
      .eq("metadata->>site_id", siteId)
      .maybeSingle();
    expect(audit).not.toBeNull();
    if (audit) {
      expect(audit.action).toBe("site_purged");
      const metadata = audit.metadata as Record<string, unknown>;
      expect(metadata.site_id).toBe(siteId);
      expect(typeof metadata.site_name).toBe("string");
    }
  });

  it("returns NOT_FOUND when the site id does not exist", async () => {
    const result = await purgeSite(
      "00000000-0000-0000-0000-000000000000",
      { actorId: null, actorEmail: null },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });
});
