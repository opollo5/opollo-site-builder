import { describe, it, expect, beforeEach } from "vitest";
import { getServiceRoleClient } from "@/lib/supabase";
import {
  isAuthKillSwitchOn,
  __resetAuthKillSwitchCacheForTests,
} from "@/lib/auth-kill-switch";

// ---------------------------------------------------------------------------
// M2c-1 — opollo_config.auth_kill_switch read with 5s per-instance cache.
//
// The cache itself isn't TTL-tested here (5s waits aren't worth the CI
// cost). What these tests pin:
//   - absent row → false
//   - value='on' → true
//   - any other value → false
//   - cache ISOLATION: second read reuses the first read's result until
//     __resetAuthKillSwitchCacheForTests() is called.
// ---------------------------------------------------------------------------

async function setKillSwitch(value: string | null): Promise<void> {
  const svc = getServiceRoleClient();
  if (value === null) {
    const { error } = await svc
      .from("opollo_config")
      .delete()
      .eq("key", "auth_kill_switch");
    if (error) throw new Error(`setKillSwitch(null): ${error.message}`);
    return;
  }
  const { error } = await svc
    .from("opollo_config")
    .upsert(
      { key: "auth_kill_switch", value },
      { onConflict: "key" },
    );
  if (error) throw new Error(`setKillSwitch('${value}'): ${error.message}`);
}

beforeEach(() => {
  __resetAuthKillSwitchCacheForTests();
});

describe("isAuthKillSwitchOn", () => {
  it("returns false when the config row is absent", async () => {
    expect(await isAuthKillSwitchOn()).toBe(false);
  });

  it("returns true when value='on'", async () => {
    await setKillSwitch("on");
    expect(await isAuthKillSwitchOn()).toBe(true);
  });

  it("returns false for any other value", async () => {
    await setKillSwitch("off");
    expect(await isAuthKillSwitchOn()).toBe(false);

    __resetAuthKillSwitchCacheForTests();
    await setKillSwitch("true"); // not 'on' — must still read false
    expect(await isAuthKillSwitchOn()).toBe(false);
  });

  it("caches the result until the reset helper is called", async () => {
    await setKillSwitch("on");
    expect(await isAuthKillSwitchOn()).toBe(true);

    // Flip the underlying row without resetting the cache — the cached
    // value must stick around.
    await setKillSwitch(null);
    expect(await isAuthKillSwitchOn()).toBe(true);

    // Reset and the next read reflects reality.
    __resetAuthKillSwitchCacheForTests();
    expect(await isAuthKillSwitchOn()).toBe(false);
  });
});
