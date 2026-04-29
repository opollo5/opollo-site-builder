import "server-only";

import { headers } from "next/headers";

// AUTH-FOUNDATION P1-FIX — Environment-aware gate for /admin/email-test.
//
// The original P1 surface gated on `NODE_ENV !== "production"`. Vercel
// builds every deployment (preview AND prod) with NODE_ENV=production,
// so staging at opollo-site-builder.vercel.app 404'd just like real prod.
// The fix: check the actual request host so the page is reachable on
// the staging .vercel.app aliases but not on the cut-over prod domain
// (mgmt.opollo.com).
//
// Allow when:
//   1. Local dev (NODE_ENV !== "production"), OR
//   2. Vercel preview deploy (PR previews), OR
//   3. Vercel production build hitting a *.vercel.app host (i.e. the
//      staging alias on the same project — same env vars as prod, but
//      a host string that's clearly not a customer-facing domain).
//
// Block when:
//   - Any host that doesn't end in .vercel.app while NODE_ENV=production.
//     mgmt.opollo.com falls through this branch. Localhost in a prod
//     build is also blocked (shouldn't happen in practice, but explicit).
//
// This is a temporary host-string check. Phase 3 replaces it with a
// `super_admin` role gate in `lib/admin-gate.ts` and the host hack
// goes away.

export function isEmailTestAllowed(): boolean {
  // Local dev always passes.
  if (process.env.NODE_ENV !== "production") return true;

  // PR preview deploys are inherently non-prod surfaces.
  if (process.env.VERCEL_ENV === "preview") return true;

  // Production build (VERCEL_ENV === "production"). Use the request
  // host to disambiguate staging-on-vercel-domain vs real-prod-on-
  // custom-domain.
  const host = headers().get("host") ?? "";
  return host.endsWith(".vercel.app");
}
