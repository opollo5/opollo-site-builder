import { describe, expect, it } from "vitest";

import {
  hashPalette,
  hashProposalSlots,
  stampFirstDetection,
} from "@/lib/kadence-palette-sync";
import type { KadencePalette } from "@/lib/kadence-rest";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M13-5c — unit tests for pure helpers + the CAS-stamping helper.
//
// hashPalette / hashProposalSlots are pure (no I/O). stampFirstDetection
// touches the sites table but doesn't go near WP — integration tests
// for the end-to-end route are in appearance-sync-routes.test.ts.
// ---------------------------------------------------------------------------

describe("hashPalette — determinism", () => {
  const PALETTE_A: KadencePalette = {
    palette: [
      { slug: "palette1", name: "Blue", color: "#185FA5" },
      { slug: "palette2", name: "Teal", color: "#1D9E75" },
    ],
    source: "populated",
  };

  it("returns the same hex digest on repeat calls", () => {
    expect(hashPalette(PALETTE_A)).toBe(hashPalette(PALETTE_A));
  });

  it("is insensitive to slot declaration order", () => {
    const shuffled: KadencePalette = {
      palette: [...PALETTE_A.palette].reverse(),
      source: "populated",
    };
    expect(hashPalette(PALETTE_A)).toBe(hashPalette(shuffled));
  });

  it("is case-insensitive on hex colors", () => {
    const lower: KadencePalette = {
      palette: PALETTE_A.palette.map((p) => ({
        ...p,
        color: p.color.toLowerCase(),
      })),
      source: "populated",
    };
    expect(hashPalette(PALETTE_A)).toBe(hashPalette(lower));
  });

  it("changes when a color changes (even by one hex digit)", () => {
    const tweaked: KadencePalette = {
      palette: [
        { ...PALETTE_A.palette[0]!, color: "#185FA6" }, // last digit 5→6
        PALETTE_A.palette[1]!,
      ],
      source: "populated",
    };
    expect(hashPalette(PALETTE_A)).not.toBe(hashPalette(tweaked));
  });

  it("changes when a slot's name changes", () => {
    const renamed: KadencePalette = {
      palette: [
        { ...PALETTE_A.palette[0]!, name: "Primary Blue" },
        PALETTE_A.palette[1]!,
      ],
      source: "populated",
    };
    expect(hashPalette(PALETTE_A)).not.toBe(hashPalette(renamed));
  });

  it("returns a stable hash for an empty palette", () => {
    const empty: KadencePalette = { palette: [], source: "empty" };
    const h1 = hashPalette(empty);
    const h2 = hashPalette(empty);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // sha256 hex
  });
});

describe("hashProposalSlots", () => {
  it("matches hashPalette output for the same slot contents", () => {
    const slots = [
      { slug: "palette1", name: "Blue", color: "#185FA5" },
      { slug: "palette2", name: "Teal", color: "#1D9E75" },
    ];
    const palette: KadencePalette = {
      palette: slots,
      source: "populated",
    };
    expect(hashProposalSlots(slots)).toBe(hashPalette(palette));
  });
});

describe("stampFirstDetection — CAS + idempotency", () => {
  it("stamps kadence_installed_at on a fresh site and bumps version_lock", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const before = await svc
      .from("sites")
      .select("version_lock, kadence_installed_at")
      .eq("id", site.id)
      .single();
    expect(before.data?.kadence_installed_at).toBeNull();
    const origLock = before.data?.version_lock as number;

    const res = await stampFirstDetection({
      site_id: site.id,
      expected_version_lock: origLock,
      created_by: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.stamped).toBe(true);
    expect(res.new_version_lock).toBe(origLock + 1);

    const after = await svc
      .from("sites")
      .select("kadence_installed_at, version_lock")
      .eq("id", site.id)
      .single();
    expect(after.data?.kadence_installed_at).toBeTruthy();
    expect(after.data?.version_lock).toBe(origLock + 1);
  });

  it("is idempotent — second call returns stamped=false without mutating the row", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const before = await svc
      .from("sites")
      .select("version_lock")
      .eq("id", site.id)
      .single();
    const origLock = before.data?.version_lock as number;

    const first = await stampFirstDetection({
      site_id: site.id,
      expected_version_lock: origLock,
      created_by: null,
    });
    expect(first.ok).toBe(true);

    const afterFirst = await svc
      .from("sites")
      .select("kadence_installed_at, version_lock")
      .eq("id", site.id)
      .single();
    const stampedAt = afterFirst.data?.kadence_installed_at;
    const afterFirstLock = afterFirst.data?.version_lock as number;

    const second = await stampFirstDetection({
      site_id: site.id,
      expected_version_lock: afterFirstLock,
      created_by: null,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.stamped).toBe(false);
    expect(second.new_version_lock).toBe(afterFirstLock);

    const finalRow = await svc
      .from("sites")
      .select("kadence_installed_at, version_lock")
      .eq("id", site.id)
      .single();
    expect(finalRow.data?.kadence_installed_at).toBe(stampedAt);
    expect(finalRow.data?.version_lock).toBe(afterFirstLock);
  });

  it("returns VERSION_CONFLICT on stale expected_version_lock", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const before = await svc
      .from("sites")
      .select("version_lock")
      .eq("id", site.id)
      .single();
    const origLock = before.data?.version_lock as number;

    const res = await stampFirstDetection({
      site_id: site.id,
      expected_version_lock: origLock + 5,
      created_by: null,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("VERSION_CONFLICT");
  });
});
