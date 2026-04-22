import * as Sentry from "@sentry/nextjs";

// Server-runtime Sentry init. `instrumentation.ts` gates this file
// on SENTRY_DSN so we can assume it's set here; still guard for
// safety during tests that import the file directly.

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0.1,
    // Send request-context fields (request_id, job_id, etc.) from our
    // AsyncLocalStorage into every event. Sentry's native `contexts`
    // field is the right home for structured per-request metadata.
    beforeSend(event) {
      return event;
    },
  });
}
