import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/lib/auth";

// ---------------------------------------------------------------------------
// M15-6 #18 — lib/current-user.ts unit tests.
//
// resolveCurrentUser is a thin conditional wrapper:
//   1. FEATURE_SUPABASE_AUTH off     → null (no Supabase call).
//   2. Kill switch on                → null (no auth call).
//   3. Kill switch off + no session  → null (getCurrentUser returns null).
//   4. Kill switch off + valid user  → SessionUser.
//   5. getCurrentUser throws         → null (catch fallback).
//
// We mock the three dependencies to stay in-process (no Supabase required),
// which lets us pin the conditional logic without re-testing getCurrentUser
// (already covered by admin-gate.test.ts).
// ---------------------------------------------------------------------------

const mockKillSwitch = vi.hoisted(() => ({ value: false, throws: false }));
const mockCurrentUser = vi.hoisted(() => ({
  user: null as SessionUser | null,
  throws: false,
}));

vi.mock("@/lib/auth-kill-switch", () => ({
  isAuthKillSwitchOn: async () => {
    if (mockKillSwitch.throws) throw new Error("kill-switch DB error");
    return mockKillSwitch.value;
  },
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    createRouteAuthClient: () => ({}), // not called by resolveCurrentUser directly
    getCurrentUser: async () => {
      if (mockCurrentUser.throws) throw new Error("auth getUser error");
      return mockCurrentUser.user;
    },
  };
});

import { resolveCurrentUser } from "@/lib/current-user";

const ORIGINAL_FLAG = process.env.FEATURE_SUPABASE_AUTH;

beforeEach(() => {
  mockKillSwitch.value = false;
  mockKillSwitch.throws = false;
  mockCurrentUser.user = null;
  mockCurrentUser.throws = false;
  // Default: flag on so most tests exercise the real code paths.
  process.env.FEATURE_SUPABASE_AUTH = "true";
});

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) {
    delete process.env.FEATURE_SUPABASE_AUTH;
  } else {
    process.env.FEATURE_SUPABASE_AUTH = ORIGINAL_FLAG;
  }
});

const MOCK_USER: SessionUser = {
  id: "user-1",
  email: "admin@example.com",
  role: "admin",
};

describe("resolveCurrentUser", () => {
  describe("FEATURE_SUPABASE_AUTH off", () => {
    it("returns null when flag is missing", async () => {
      delete process.env.FEATURE_SUPABASE_AUTH;
      expect(await resolveCurrentUser()).toBeNull();
    });

    it("returns null when flag is '0'", async () => {
      process.env.FEATURE_SUPABASE_AUTH = "0";
      expect(await resolveCurrentUser()).toBeNull();
    });

    it("returns null when flag is 'false'", async () => {
      process.env.FEATURE_SUPABASE_AUTH = "false";
      expect(await resolveCurrentUser()).toBeNull();
    });
  });

  describe("kill switch on", () => {
    it("returns null when kill switch is active", async () => {
      mockKillSwitch.value = true;
      expect(await resolveCurrentUser()).toBeNull();
    });

    it("returns null when kill switch check throws (fail-closed)", async () => {
      mockKillSwitch.throws = true;
      expect(await resolveCurrentUser()).toBeNull();
    });
  });

  describe("kill switch off + no session", () => {
    it("returns null when getCurrentUser returns null", async () => {
      mockCurrentUser.user = null;
      expect(await resolveCurrentUser()).toBeNull();
    });

    it("returns null when getCurrentUser throws", async () => {
      mockCurrentUser.throws = true;
      expect(await resolveCurrentUser()).toBeNull();
    });
  });

  describe("valid session", () => {
    it("returns the SessionUser when authentication succeeds", async () => {
      mockCurrentUser.user = MOCK_USER;
      const user = await resolveCurrentUser();
      expect(user).toEqual(MOCK_USER);
    });

    it("passes through role correctly", async () => {
      mockCurrentUser.user = { ...MOCK_USER, role: "super_admin" };
      const user = await resolveCurrentUser();
      expect(user?.role).toBe("super_admin");
    });
  });

  describe("flag variants", () => {
    it("recognises '1' as enabled", async () => {
      process.env.FEATURE_SUPABASE_AUTH = "1";
      mockCurrentUser.user = MOCK_USER;
      expect(await resolveCurrentUser()).toEqual(MOCK_USER);
    });

    it("recognises 'true' as enabled", async () => {
      process.env.FEATURE_SUPABASE_AUTH = "true";
      mockCurrentUser.user = MOCK_USER;
      expect(await resolveCurrentUser()).toEqual(MOCK_USER);
    });
  });
});
