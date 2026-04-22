// ---------------------------------------------------------------------------
// M10 — Sentry server/edge initialisation.
//
// Next.js's canonical pattern as of 15+ (and backported to 14.x by
// @sentry/nextjs 10.x). The framework calls `register()` once per
// runtime (Node / Edge); we route to the matching Sentry init file.
//
// No-op gate: when SENTRY_DSN is not set, `init()` never runs. Tests
// and local dev stay quiet without any other conditional. The SDK's
// own guards would also silently drop without a DSN, but skipping
// init entirely keeps the bundle tree-shakeable when a deployment
// deliberately opts out.
// ---------------------------------------------------------------------------

export async function register() {
  if (!process.env.SENTRY_DSN) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
