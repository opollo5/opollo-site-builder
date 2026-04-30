import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import { hashIp, getCookieMaxAgeSeconds } from "./cookies";

// ---------------------------------------------------------------------------
// AUTH-FOUNDATION P4.1 — Trusted-device registry.
//
// One row per (user_id, device_id) that has completed an email-
// approval flow with trust_device=true. Trust matching uses
// (user_id, device_id) ALONE — UA strings are stored as metadata
// only because browser updates rotate UA and we don't want to break
// already-trusted devices.
//
// Operations:
//   - registerTrustedDevice() — UPSERT on (user_id, device_id). A
//     second successful approval on the same trusted device extends
//     trusted_until + bumps last_used_at instead of inserting a
//     duplicate.
//   - isDeviceTrusted() — single hot-path lookup. Filters revoked
//     and not-yet-expired rows.
//   - touchTrustedDevice() — bumps last_used_at on a successful
//     trust-skip login (no challenge needed).
//   - listTrustedDevicesForUser() — for /admin/account/devices.
//   - revokeTrustedDevice() / revokeAllOtherDevices() — for the
//     "Sign out this device" / "Sign out all other devices" buttons.
// ---------------------------------------------------------------------------

export interface RegisterTrustedDeviceInput {
  userId: string;
  deviceId: string;
  ip: string | null;
  userAgent: string | null;
}

export async function registerTrustedDevice(
  input: RegisterTrustedDeviceInput,
): Promise<boolean> {
  const supabase = getServiceRoleClient();
  const trustedUntil = new Date(
    Date.now() + getCookieMaxAgeSeconds() * 1000,
  ).toISOString();
  const { error } = await supabase
    .from("trusted_devices")
    .upsert(
      {
        user_id: input.userId,
        device_id: input.deviceId,
        ua_string: input.userAgent,
        ip_hash: hashIp(input.ip),
        trusted_until: trustedUntil,
        last_used_at: new Date().toISOString(),
        revoked_at: null,
      },
      { onConflict: "user_id,device_id" },
    );
  if (error) {
    logger.error("2fa.devices.register_failed", {
      err: error.message,
      user_id: input.userId,
    });
    return false;
  }
  return true;
}

export interface IsDeviceTrustedInput {
  userId: string;
  deviceId: string;
}

export async function isDeviceTrusted(
  input: IsDeviceTrustedInput,
): Promise<boolean> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("trusted_devices")
    .select("id, trusted_until")
    .eq("user_id", input.userId)
    .eq("device_id", input.deviceId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) {
    logger.error("2fa.devices.check_failed", { err: error.message });
    return false;
  }
  if (!data) return false;
  return new Date(data.trusted_until as string).getTime() > Date.now();
}

export async function touchTrustedDevice(
  input: IsDeviceTrustedInput,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase
    .from("trusted_devices")
    .update({ last_used_at: new Date().toISOString() })
    .eq("user_id", input.userId)
    .eq("device_id", input.deviceId)
    .is("revoked_at", null);
  if (error) {
    logger.warn("2fa.devices.touch_failed", { err: error.message });
  }
}

export interface TrustedDeviceListing {
  id: string;
  device_id: string;
  ua_string: string | null;
  trusted_until: string;
  last_used_at: string;
  created_at: string;
  is_current_device: boolean;
}

export async function listTrustedDevicesForUser(
  userId: string,
  currentDeviceId: string | null,
): Promise<TrustedDeviceListing[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("trusted_devices")
    .select(
      "id, device_id, ua_string, trusted_until, last_used_at, created_at",
    )
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("last_used_at", { ascending: false });
  if (error) {
    logger.error("2fa.devices.list_failed", {
      err: error.message,
      user_id: userId,
    });
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    device_id: row.device_id as string,
    ua_string: (row.ua_string as string | null) ?? null,
    trusted_until: row.trusted_until as string,
    last_used_at: row.last_used_at as string,
    created_at: row.created_at as string,
    is_current_device:
      currentDeviceId !== null && row.device_id === currentDeviceId,
  }));
}

export async function revokeTrustedDevice(
  deviceRowId: string,
  actorUserId: string,
): Promise<boolean> {
  const supabase = getServiceRoleClient();
  const { error, data } = await supabase
    .from("trusted_devices")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", deviceRowId)
    .eq("user_id", actorUserId)        // self-only revocation
    .is("revoked_at", null)
    .select("id");
  if (error) {
    logger.error("2fa.devices.revoke_failed", {
      err: error.message,
      device_id: deviceRowId,
    });
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

export async function revokeAllOtherDevices(
  userId: string,
  keepDeviceId: string,
): Promise<number> {
  const supabase = getServiceRoleClient();
  const { error, data } = await supabase
    .from("trusted_devices")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("revoked_at", null)
    .neq("device_id", keepDeviceId)
    .select("id");
  if (error) {
    logger.error("2fa.devices.revoke_others_failed", {
      err: error.message,
      user_id: userId,
    });
    return 0;
  }
  return Array.isArray(data) ? data.length : 0;
}
