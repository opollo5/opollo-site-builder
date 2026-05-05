import { describe, expect, it } from "vitest";

import { minRoleFor, roleSatisfies } from "@/lib/platform/auth";

// ---------------------------------------------------------------------------
// S8 — unit tests for the reconnect_connection permission change.
//
// Verifies:
//   1. reconnect_connection is accessible to editor+ (not just admin).
//   2. manage_connections still requires admin.
//   3. The role hierarchy still works correctly around the boundary.
// ---------------------------------------------------------------------------

describe("reconnect_connection permission (S8)", () => {
  it("requires editor as minimum role", () => {
    expect(minRoleFor("reconnect_connection")).toBe("editor");
  });

  it("editor satisfies reconnect_connection", () => {
    expect(roleSatisfies("editor", minRoleFor("reconnect_connection"))).toBe(true);
  });

  it("approver satisfies reconnect_connection", () => {
    expect(roleSatisfies("approver", minRoleFor("reconnect_connection"))).toBe(true);
  });

  it("admin satisfies reconnect_connection", () => {
    expect(roleSatisfies("admin", minRoleFor("reconnect_connection"))).toBe(true);
  });

  it("viewer does NOT satisfy reconnect_connection", () => {
    expect(roleSatisfies("viewer", minRoleFor("reconnect_connection"))).toBe(false);
  });
});

describe("manage_connections permission (unchanged)", () => {
  it("still requires admin", () => {
    expect(minRoleFor("manage_connections")).toBe("admin");
  });

  it("editor does NOT satisfy manage_connections", () => {
    expect(roleSatisfies("editor", minRoleFor("manage_connections"))).toBe(false);
  });

  it("admin satisfies manage_connections", () => {
    expect(roleSatisfies("admin", minRoleFor("manage_connections"))).toBe(true);
  });
});
