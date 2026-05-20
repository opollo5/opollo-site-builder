import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";

import { ComposerErrorBoundary } from "@/components/social/composer/ComposerErrorBoundary";

// ---------------------------------------------------------------------------
// Silence React's expected error output for error boundary tests.
// ---------------------------------------------------------------------------
const originalConsoleError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});
afterEach(() => {
  console.error = originalConsoleError;
});

// ---------------------------------------------------------------------------
// Mock logClientError so tests don't hit the network.
// ---------------------------------------------------------------------------
vi.mock("@/lib/errors/logClientError", () => ({
  logClientError: vi.fn().mockResolvedValue({ trace_id: "test-trace" }),
}));

// A child that throws on demand.
function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("boom from child");
  return <div data-testid="healthy-child">All good</div>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ComposerErrorBoundary", () => {
  it("renders children when there is no error", () => {
    render(
      <ComposerErrorBoundary>
        <div data-testid="child">hello</div>
      </ComposerErrorBoundary>,
    );
    expect(screen.getByTestId("child")).toBeTruthy();
    expect(screen.queryByTestId("composer-error-boundary-fallback")).toBeNull();
  });

  it("renders fallback UI when a child throws", () => {
    render(
      <ComposerErrorBoundary>
        <ThrowingChild shouldThrow />
      </ComposerErrorBoundary>,
    );
    expect(screen.getByTestId("composer-error-boundary-fallback")).toBeTruthy();
    expect(screen.getByText("Composer encountered an unexpected error")).toBeTruthy();
    expect(screen.getByText("boom from child")).toBeTruthy();
  });

  it("shows the reload button in fallback UI", () => {
    render(
      <ComposerErrorBoundary>
        <ThrowingChild shouldThrow />
      </ComposerErrorBoundary>,
    );
    expect(screen.getByTestId("composer-error-boundary-reload")).toBeTruthy();
    expect(screen.getByRole("button", { name: /reload composer/i })).toBeTruthy();
  });

  it("reload button clears the error state", () => {
    // Use a wrapper that can flip shouldThrow to false BEFORE the reload re-render,
    // so the boundary doesn't immediately re-throw after resettig error state.
    function Wrapper() {
      const [shouldThrow, setShouldThrow] = React.useState(true);
      return (
        <>
          <button
            data-testid="stop-throwing"
            onClick={() => setShouldThrow(false)}
          />
          <ComposerErrorBoundary>
            <ThrowingChild shouldThrow={shouldThrow} />
          </ComposerErrorBoundary>
        </>
      );
    }

    render(<Wrapper />);

    // Fallback is visible after the initial throw.
    expect(screen.getByTestId("composer-error-boundary-fallback")).toBeTruthy();

    // First flip shouldThrow=false so the child won't throw when boundary retries.
    fireEvent.click(screen.getByTestId("stop-throwing"));

    // Then click reload to clear the error state.
    fireEvent.click(screen.getByTestId("composer-error-boundary-reload"));

    expect(screen.getByTestId("healthy-child")).toBeTruthy();
    expect(screen.queryByTestId("composer-error-boundary-fallback")).toBeNull();
  });

  it("calls logClientError with composer-overlay component + critical severity", async () => {
    const { logClientError } = await import("@/lib/errors/logClientError");

    render(
      <ComposerErrorBoundary companyId="company-123">
        <ThrowingChild shouldThrow />
      </ComposerErrorBoundary>,
    );

    expect(logClientError).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "composer-overlay",
        severity: "critical",
        message: "boom from child",
        companyId: "company-123",
        context: expect.objectContaining({ error_code: "COMPOSER_RENDER_ERROR" }),
      }),
    );
  });

  it("has role=alert on fallback so screen readers announce the error", () => {
    render(
      <ComposerErrorBoundary>
        <ThrowingChild shouldThrow />
      </ComposerErrorBoundary>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toBeTruthy();
  });

  it("renders without companyId prop (optional)", () => {
    render(
      <ComposerErrorBoundary>
        <ThrowingChild shouldThrow />
      </ComposerErrorBoundary>,
    );
    expect(screen.getByTestId("composer-error-boundary-fallback")).toBeTruthy();
  });
});
