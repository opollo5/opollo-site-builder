import * as Sentry from "@sentry/nextjs";

// Edge-runtime Sentry init. Middleware.ts runs on the Edge;
// capturing exceptions from the gate flow lands here.

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0.1,
  });
}
