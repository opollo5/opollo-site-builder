import * as Sentry from "@sentry/nextjs";

// Browser-runtime Sentry init. Next.js 14.2.x auto-discovers this
// file and invokes it on the client side. Gated on NEXT_PUBLIC_
// variants if we ever need client-side DSN separation; for now the
// server DSN is reused. No-op when SENTRY_DSN isn't injected at
// build time (Next.js inlines process.env.NEXT_PUBLIC_* into the
// client bundle but not server-only env vars — so we key off a
// NEXT_PUBLIC mirror if provided, otherwise skip client init).

if (
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SENTRY_DSN
) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment:
      process.env.NEXT_PUBLIC_VERCEL_ENV ??
      process.env.NODE_ENV ??
      "development",
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.1,
  });
}

// Required by @sentry/nextjs 10.x for App Router navigation
// instrumentation. Exporting a top-level const is part of the SDK's
// contract — Next.js wires it into the router transition hook.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
