// ---------------------------------------------------------------------------
// M10 — Sentry server/edge initialisation.
// M15-3 — env coupling validation at boot.
//
// Next.js's canonical pattern as of 15+ (and backported to 14.x by
// @sentry/nextjs 10.x). The framework calls `register()` once per
// runtime (Node / Edge); we route to the matching Sentry init file.
//
// No-op gate: when SENTRY_DSN is not set, `init()` never runs. Tests
// and local dev stay quiet without any other conditional.
//
// Env coupling validation runs on the Node.js runtime only — it uses
// the shared logger which depends on @axiomhq/js, which we don't try
// to run on the edge. One warning emission per cold start when a
// misconfig is detected; silent when everything agrees.
// ---------------------------------------------------------------------------

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvCouplingOnce } = await import("./lib/env-validation");
    validateEnvCouplingOnce();
  }

  if (!process.env.SENTRY_DSN) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
