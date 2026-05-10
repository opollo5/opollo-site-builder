import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// ErrorReportButton — component tests.
// ---------------------------------------------------------------------------

// Feature flag on by default.
vi.mock("@/lib/error-reporting/flag", () => ({
  isErrorReportingEnabled: vi.fn().mockReturnValue(true),
}));

// Mock the context collector to return a stable report.
vi.mock("@/components/error-reporting/context-collector", () => ({
  assembleErrorReport: vi.fn().mockReturnValue({
    errorMessage: "Test error",
    browser: "TestBrowser",
    viewport: "1280×800",
    locale: "en",
    timezone: "UTC",
    timestamp: "2026-05-10T00:00:00.000Z",
    currentUrl: "http://localhost/admin",
    routeHistory: [],
    breadcrumbs: [],
  }),
}));

import { isErrorReportingEnabled } from "@/lib/error-reporting/flag";
import { ErrorReportButton } from "@/components/error-reporting/ErrorReportButton";

const BASE_CONTEXT = {
  message: "Test error",
  type: "Error",
};

function makeFetch(ok: boolean, body?: object) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: vi.fn().mockResolvedValue(
      ok ? { ok: true, data: { report_id: "uuid-1" } } : { ok: false, error: { message: "Server error" } },
    ),
  });
}

beforeEach(() => {
  vi.mocked(isErrorReportingEnabled).mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErrorReportButton", () => {
  it("renders when feature flag is on", () => {
    render(<ErrorReportButton context={BASE_CONTEXT} />);
    expect(screen.getByRole("button", { name: /report to admin/i })).toBeInTheDocument();
  });

  it("does not render when feature flag is off", () => {
    vi.mocked(isErrorReportingEnabled).mockReturnValue(false);
    render(<ErrorReportButton context={BASE_CONTEXT} />);
    expect(screen.queryByRole("button", { name: /report to admin/i })).toBeNull();
  });

  it("opens the modal on click", async () => {
    render(<ErrorReportButton context={BASE_CONTEXT} />);
    fireEvent.click(screen.getByRole("button", { name: /report to admin/i }));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByText(/report issue to admin/i)).toBeInTheDocument();
  });

  it("closes modal on Cancel", async () => {
    render(<ErrorReportButton context={BASE_CONTEXT} />);
    fireEvent.click(screen.getByRole("button", { name: /report to admin/i }));
    await waitFor(() => screen.getByRole("dialog"));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("closes modal on ESC", async () => {
    render(<ErrorReportButton context={BASE_CONTEXT} />);
    fireEvent.click(screen.getByRole("button", { name: /report to admin/i }));
    await waitFor(() => screen.getByRole("dialog"));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("sends report on Send report click and shows success", async () => {
    vi.stubGlobal("fetch", makeFetch(true));
    render(<ErrorReportButton context={BASE_CONTEXT} />);
    fireEvent.click(screen.getByRole("button", { name: /report to admin/i }));
    await waitFor(() => screen.getByRole("dialog"));
    fireEvent.click(screen.getByRole("button", { name: /send report/i }));
    await waitFor(() => {
      expect(screen.getByText(/report sent/i)).toBeInTheDocument();
    });
    vi.unstubAllGlobals();
  });

  it("shows error and retry on network failure", async () => {
    vi.stubGlobal("fetch", makeFetch(false));
    render(<ErrorReportButton context={BASE_CONTEXT} />);
    fireEvent.click(screen.getByRole("button", { name: /report to admin/i }));
    await waitFor(() => screen.getByRole("dialog"));
    fireEvent.click(screen.getByRole("button", { name: /send report/i }));
    await waitFor(() => {
      expect(screen.getByText(/server error/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("is idempotent — double-clicking Send does not send twice", async () => {
    const fetchMock = makeFetch(true);
    vi.stubGlobal("fetch", fetchMock);
    render(<ErrorReportButton context={BASE_CONTEXT} />);
    fireEvent.click(screen.getByRole("button", { name: /report to admin/i }));
    await waitFor(() => screen.getByRole("dialog"));
    const sendBtn = screen.getByRole("button", { name: /send report/i });
    fireEvent.click(sendBtn);
    fireEvent.click(sendBtn);
    await waitFor(() => screen.getByText(/report sent/i));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("respects the feature flag — no render when off, button appears when on", () => {
    vi.mocked(isErrorReportingEnabled).mockReturnValue(false);
    const { rerender } = render(<ErrorReportButton context={BASE_CONTEXT} />);
    expect(screen.queryByRole("button", { name: /report/i })).toBeNull();

    vi.mocked(isErrorReportingEnabled).mockReturnValue(true);
    rerender(<ErrorReportButton context={BASE_CONTEXT} />);
    expect(screen.getByRole("button", { name: /report to admin/i })).toBeInTheDocument();
  });
});
