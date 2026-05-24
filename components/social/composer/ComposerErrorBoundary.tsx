"use client";

import * as React from "react";
import { logClientError } from "@/lib/errors/logClientError";

// ---------------------------------------------------------------------------
// ComposerErrorBoundary — wraps the composer overlay to catch unhandled React
// render errors. Logs to client_errors and shows a recovery UI.
//
// Phase 5.2 / C1.
// ---------------------------------------------------------------------------

interface Props {
  children: React.ReactNode;
  companyId?: string;
}

interface State {
  error: Error | null;
  traceId: string | null;
}

export class ComposerErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, traceId: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    const traceId = crypto.randomUUID();
    this.setState({ traceId });
    void logClientError({
      component: "composer-overlay",
      severity: "critical",
      message: error.message,
      context: {
        componentStack: info.componentStack ?? undefined,
        error_code: "COMPOSER_RENDER_ERROR",
      },
      stack: error.stack,
      traceId,
      companyId: this.props.companyId,
    });
  }

  handleReload = () => {
    this.setState({ error: null, traceId: null });
  };

  override render() {
    if (this.state.error) {
      return (
        <div
          className="flex flex-col items-center justify-center gap-4 rounded-xl border border-destructive/40 bg-destructive/5 p-8 text-center"
          role="alert"
          data-testid="composer-error-boundary-fallback"
        >
          <div className="space-y-1">
            <p className="text-sm font-semibold text-destructive">
              Composer encountered an unexpected error
            </p>
            <p className="text-xs text-muted-foreground">
              {this.state.error.message}
            </p>
            {this.state.traceId && (
              <p className="font-mono text-xs text-muted-foreground">
                trace: {this.state.traceId}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={this.handleReload}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            data-testid="composer-error-boundary-reload"
          >
            Reload composer
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
