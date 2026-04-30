import { redirect } from "next/navigation";

import { resolveCurrentUser } from "@/lib/current-user";

// ---------------------------------------------------------------------------
// / — root route redirect.
//
// The root path used to render the chat builder (HomePageClient). With
// the admin surfaces as the canonical product entry point, `/` now
// short-circuits to either /admin/sites (signed-in operator) or /login
// (anonymous). Middleware already gates non-public paths, so the
// signed-out branch here is belt-and-suspenders for flag-off / kill-
// switch modes where resolveCurrentUser returns null.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default async function HomePage(): Promise<never> {
  const user = await resolveCurrentUser();
  redirect(user ? "/admin/sites" : "/login");
}
