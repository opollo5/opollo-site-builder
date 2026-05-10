"use client";

import { lazy, Suspense, useEffect } from "react";

const ErrorReportButton = lazy(() =>
  import("@/components/error-reporting/ErrorReportButton").then((m) => ({
    default: m.ErrorReportButton,
  })),
);

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Errors are already captured by Sentry via instrumentation.ts.
    // No extra reporting needed here.
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-page-title text-foreground">Something went wrong</h1>
      <p className="text-base text-muted-foreground">
        An unexpected error occurred. Try again — if it keeps happening, contact
        support.
      </p>
      <button
        type="button"
        onClick={reset}
        className="text-sm font-medium underline underline-offset-4"
      >
        Try again
      </button>
      <Suspense fallback={null}>
        <ErrorReportButton
          context={{
            message: error.message,
            type: error.name,
            stack: error.stack,
          }}
        />
      </Suspense>
    </main>
  );
}
