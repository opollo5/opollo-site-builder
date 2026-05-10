import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// LAYER 1 — Unit. Pure functions, no Supabase, no SDK.
//
// BSP-4: tests the reconciliation diff and delete-safety filters that
// drive scripts/bundlesocial-reconcile-orphans.ts. These functions are
// the only ones a misconfigured operator could use to delete real teams,
// so they MUST have hard-floor tests independent of the script wrapper.
// ---------------------------------------------------------------------------

import {
  computeReconcileDiff,
  filterDeleteSafeOrphans,
  type ReconcileTeam,
} from "@/lib/platform/social/bundle-social/reconcile";

const T0 = new Date("2026-05-10T12:00:00Z");

function team(id: string, createdAt: string | null = null): ReconcileTeam {
  return { id, name: `team-${id}`, createdAt };
}

describe("BSP-4 — computeReconcileDiff", () => {
  it("identifies remote teams not present in tracked set as orphans", () => {
    const remote: ReconcileTeam[] = [
      team("a"),
      team("b"),
      team("c"),
    ];
    const tracked = new Set(["a", "c"]);

    const r = computeReconcileDiff(remote, tracked);
    expect(r.totalRemote).toBe(3);
    expect(r.totalTracked).toBe(2);
    expect(r.orphans.map((t) => t.id)).toEqual(["b"]);
    expect(r.danglingRefs).toEqual([]);
  });

  it("identifies tracked ids missing from remote as dangling refs", () => {
    const remote: ReconcileTeam[] = [team("a")];
    const tracked = new Set(["a", "ghost-1", "ghost-2"]);

    const r = computeReconcileDiff(remote, tracked);
    expect(r.orphans).toEqual([]);
    expect(r.danglingRefs.sort()).toEqual(["ghost-1", "ghost-2"]);
  });

  it("returns zero of each when sets match exactly", () => {
    const remote: ReconcileTeam[] = [team("a"), team("b")];
    const tracked = new Set(["a", "b"]);

    const r = computeReconcileDiff(remote, tracked);
    expect(r.orphans).toEqual([]);
    expect(r.danglingRefs).toEqual([]);
  });

  it("handles empty inputs without throwing", () => {
    const r = computeReconcileDiff([], new Set());
    expect(r.totalRemote).toBe(0);
    expect(r.totalTracked).toBe(0);
    expect(r.orphans).toEqual([]);
    expect(r.danglingRefs).toEqual([]);
  });

  it("preserves orphan team metadata (name, createdAt) for the report", () => {
    const remote: ReconcileTeam[] = [
      { id: "x", name: "Race Loser", createdAt: "2026-05-09T10:00:00Z" },
    ];
    const r = computeReconcileDiff(remote, new Set());
    expect(r.orphans).toHaveLength(1);
    expect(r.orphans[0]?.name).toBe("Race Loser");
    expect(r.orphans[0]?.createdAt).toBe("2026-05-09T10:00:00Z");
  });
});

describe("BSP-4 — filterDeleteSafeOrphans", () => {
  it("REGRESSION: never deletes teams created within minAgeMs of now", () => {
    // Orphan created 30s ago; minAge = 60s → must NOT be returned as
    // delete-safe. This is the protection against deleting a team that
    // a concurrent provisioner just created but hasn't yet committed
    // to the DB.
    const orphans: ReconcileTeam[] = [
      team("recent", "2026-05-10T11:59:30Z"), // 30s before T0
      team("old", "2026-05-09T10:00:00Z"),
    ];
    const safe = filterDeleteSafeOrphans(orphans, T0, 60_000);
    expect(safe.map((t) => t.id)).toEqual(["old"]);
  });

  it("REGRESSION: refuses to mark teams with null createdAt as delete-safe", () => {
    // A team with unknown age is never delete-safe. Better to leak an
    // orphan than to nuke a team that might be in flight.
    const orphans: ReconcileTeam[] = [team("unknown-age", null)];
    const safe = filterDeleteSafeOrphans(orphans, T0, 60_000);
    expect(safe).toEqual([]);
  });

  it("REGRESSION: refuses to mark teams with malformed createdAt as delete-safe", () => {
    const orphans: ReconcileTeam[] = [team("bad-date", "not-a-date")];
    const safe = filterDeleteSafeOrphans(orphans, T0, 60_000);
    expect(safe).toEqual([]);
  });

  it("returns delete-safe orphans when minAge is satisfied", () => {
    const orphans: ReconcileTeam[] = [
      team("a", "2026-05-09T10:00:00Z"),
      team("b", "2026-05-08T10:00:00Z"),
    ];
    const safe = filterDeleteSafeOrphans(orphans, T0, 60_000);
    expect(safe.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });
});
