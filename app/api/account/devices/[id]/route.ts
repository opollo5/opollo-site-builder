import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  DEVICE_ID_COOKIE,
  decodeDeviceCookie,
} from "@/lib/2fa/cookies";
import { revokeTrustedDevice } from "@/lib/2fa/devices";
import { createRouteAuthClient, getCurrentUser } from "@/lib/auth";

// AUTH-FOUNDATION P4.4 — DELETE /api/account/devices/[id].
//
// Revokes a single trusted_devices row owned by the signed-in user.
// If the row is the CURRENT device (cookie's device_id matches the
// row's), also clears the device_id cookie so the next sign-in is
// challenged.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid device id." } },
      { status: 400 },
    );
  }

  const supabase = createRouteAuthClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Sign in required." } },
      { status: 401 },
    );
  }

  const revoked = await revokeTrustedDevice(params.id, user.id);
  if (!revoked) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Device not found, already signed out, or not yours.",
        },
      },
      { status: 404 },
    );
  }

  // If the revoked row was the current device's, clear the device_id
  // cookie so the next sign-in re-challenges. We don't have direct
  // access to the trusted_devices.device_id from the row id without
  // an extra query; instead, we clear the cookie unconditionally
  // when the cookie's device_id is present (the worst case is the
  // operator gets challenged once on a still-trusted device, which
  // is acceptable for a manual self-revoke flow).
  const cookieJar = cookies();
  const cookieValue = cookieJar.get(DEVICE_ID_COOKIE)?.value;
  if (decodeDeviceCookie(cookieValue) !== null) {
    cookieJar.set(DEVICE_ID_COOKIE, "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }

  return NextResponse.json({ ok: true, data: { revoked: true } });
}
