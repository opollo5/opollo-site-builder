import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { OperatorOverrideControls } from "@/components/admin-insights/OperatorOverrideControls";

describe("OperatorOverrideControls", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ ok: true }),
      }),
    );
  });

  it("shows dismiss and add note buttons when not suppressed", () => {
    render(
      <OperatorOverrideControls
        recommendationId="rec-1"
        companyId="co-1"
        suppressed={false}
      />,
    );
    expect(screen.getByTestId("dismiss-for-client-btn")).toBeInTheDocument();
    expect(screen.getByTestId("add-note-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("unsuppress-btn")).not.toBeInTheDocument();
  });

  it("shows unsuppress button when suppressed", () => {
    render(
      <OperatorOverrideControls
        recommendationId="rec-1"
        companyId="co-1"
        suppressed={true}
      />,
    );
    expect(screen.getByTestId("unsuppress-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("dismiss-for-client-btn")).not.toBeInTheDocument();
  });

  it("calls dismiss API on click", async () => {
    const onActionComplete = vi.fn();
    render(
      <OperatorOverrideControls
        recommendationId="rec-1"
        companyId="co-1"
        suppressed={false}
        onActionComplete={onActionComplete}
      />,
    );
    fireEvent.click(screen.getByTestId("dismiss-for-client-btn"));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/insights/clients/co-1/dismiss/rec-1",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => expect(onActionComplete).toHaveBeenCalled());
  });

  it("shows error when API returns ok:false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({
          ok: false,
          error: { message: "Action blocked: audit log unavailable" },
        }),
      }),
    );
    render(
      <OperatorOverrideControls
        recommendationId="rec-1"
        companyId="co-1"
        suppressed={false}
      />,
    );
    fireEvent.click(screen.getByTestId("dismiss-for-client-btn"));
    await waitFor(() =>
      expect(screen.getByText(/Action blocked/i)).toBeInTheDocument(),
    );
  });
});
