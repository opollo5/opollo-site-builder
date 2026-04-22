"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createRouteAuthClient } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// Server Action backing the /login form.
//
// Why an action and not the /api/auth/login route-handler approach PR #21
// shipped: the client-side fetch path breaks when the React client
// component doesn't hydrate. That happens in the real world when
// browser extensions (Grammarly is the usual offender) mutate the
// input DOM during SSR → hydration, which React 18 turns into a
// silent handler-unbind. The user sees a dead "Sign in" button, no
// network request, no console error (the hydration warning is a
// console.warn, not a throw). A Server Action keeps `<form action>`
// as a real URL baked into the HTML, so native form submission
// works pre-hydration and during hydration failure — belt-and-
// suspenders even if JS never executes.
//
// Error channel: we return { error } instead of redirecting to
// /login?error=... so useFormState on the client can surface the
// message without a page reload. The "no session" path still
// redirects via next/navigation.redirect so the fresh session
// cookie rides with the navigation.
// ---------------------------------------------------------------------------

export type LoginState = { error?: string };

function safeNext(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/admin/sites";
  }
  return raw;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  // Rate-limit by IP before any DB call — a brute-force attempt
  // shouldn't cost us Supabase queries. Server actions don't receive
  // a Request; read the IP from `headers()`.
  const ip = getClientIp(headers());
  const rl = await checkRateLimit("login", `ip:${ip}`);
  if (!rl.ok) {
    return {
      error: `Too many sign-in attempts. Try again in ${rl.retryAfterSec} seconds.`,
    };
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = createRouteAuthClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Deliberately identical message for "bad email" vs "bad password"
    // to avoid an account-enumeration oracle.
    return { error: "Invalid email or password." };
  }

  // Server Actions that call redirect() throw internally; this does not
  // return normally. The fresh session cookie was set by the SSR
  // adapter during signInWithPassword and is attached to the redirect
  // response by Next.
  redirect(next);
}
