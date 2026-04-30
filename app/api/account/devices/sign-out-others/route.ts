import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  DEVICE_ID_COOKIE,
  decodeDeviceCookie,
} from "@/lib/2fa/cookies";
import { revokeAllOtherDevices } from "@/lib/2fa/devices";
import { createRouteAuthClient, getCurrentUser } from "@/lib/auth";

// AUTH-FOUNDATION P4.4 — POST /api/account/devices/sign-out-others.
//
// Revokes every trusted_devices row owned by the signed-in user
// EXCEPT the row matching the current device's device_id cookie.
// Returns the count of revoked devices.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const supabase = createRouteAuthClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Sign in required." } },
      { status: 401 },
    );
  }

  const cookieJar = cookies();
  const cookieValue = cookieJar.get(DEVICE_ID_COOKIE)?.value;
  const currentDeviceId = decodeDeviceCookie(cookieValue);
  if (!currentDeviceId) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NO_CURRENT_DEVICE",
          message: "Current device not identifiable. Sign out individually instead.",
        },
      },
      { status: 409 },
    );
  }

  const revokedCount = await revokeAllOtherDevices(user.id, currentDeviceId);
  return NextResponse.json({
    ok: true,
    data: { revoked_count: revokedCount },
  });
}
