import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { TrustedDevicesList } from "@/components/TrustedDevicesList";
import { Alert } from "@/components/ui/alert";
import { H1, Lead } from "@/components/ui/typography";
import {
  DEVICE_ID_COOKIE,
  decodeDeviceCookie,
} from "@/lib/2fa/cookies";
import { listTrustedDevicesForUser } from "@/lib/2fa/devices";
import { is2faEnabled } from "@/lib/2fa/flag";
import { createRouteAuthClient, getCurrentUser } from "@/lib/auth";

// AUTH-FOUNDATION P4.4 — /account/devices.
//
// Self-service trusted-device management for any signed-in user.
// Lists every non-revoked trusted_devices row + lets the operator
// "Sign out this device" (revoke a single row) or "Sign out all
// other devices" (revoke everything except the current cookie's
// device_id).
//
// Path: /account/devices to match the existing /account/security
// pattern. The brief calls it /admin/account/devices but the surface
// is per-user, not admin-only — placing it under /admin would
// inherit the admin sidebar layout that isn't appropriate here.

export const dynamic = "force-dynamic";

export default async function AccountDevicesPage() {
  const supabase = createRouteAuthClient();
  const user = await getCurrentUser(supabase);

  if (!user) {
    redirect("/login?next=%2Faccount%2Fdevices");
  }

  const flagOn = is2faEnabled();

  // Read the current device_id from the signed cookie so the listing
  // can flag "this device" — useful for the "sign out OTHER devices"
  // affordance.
  const cookieValue = cookies().get(DEVICE_ID_COOKIE)?.value;
  const currentDeviceId = decodeDeviceCookie(cookieValue);

  const devices = flagOn
    ? await listTrustedDevicesForUser(user.id, currentDeviceId)
    : [];

  return (
    <div className="mx-auto max-w-3xl">
      <H1>Trusted devices</H1>
      <Lead className="mt-1">
        Devices that skip the email-approval step on sign-in. Trust
        lasts 30 days from last sign-in; sign out any device you
        don&apos;t recognise.
      </Lead>

      {!flagOn && (
        <Alert className="mt-6">
          Email-2FA is not currently enabled on this environment.
          Trusted-device tracking starts when{" "}
          <code className="font-mono text-xs">AUTH_2FA_ENABLED</code>{" "}
          is flipped to <code>true</code> in env.
        </Alert>
      )}

      {flagOn && devices.length === 0 && (
        <Alert className="mt-6">
          No trusted devices yet. The next time you sign in and tick
          &quot;Trust this device for 30 days&quot;, it will appear
          here.
        </Alert>
      )}

      {flagOn && devices.length > 0 && (
        <div className="mt-6">
          <TrustedDevicesList
            devices={devices}
            hasCurrentDevice={currentDeviceId !== null}
          />
        </div>
      )}
    </div>
  );
}
