import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DismissalModal } from "@/components/insights/DismissalModal";

describe("DismissalModal", () => {
  function renderModal(overrides?: Partial<Parameters<typeof DismissalModal>[0]>) {
    const onClose = vi.fn();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <DismissalModal
        open={true}
        onClose={onClose}
        onConfirm={onConfirm}
        headline="Keep it under 150 words"
        {...overrides}
      />,
    );
    return { onClose, onConfirm };
  }

  it("renders all four reason options", () => {
    renderModal();
    expect(screen.getByTestId("reason-not_relevant")).toBeInTheDocument();
    expect(screen.getByTestId("reason-tried_before")).toBeInTheDocument();
    expect(screen.getByTestId("reason-brand_mismatch")).toBeInTheDocument();
    expect(screen.getByTestId("reason-other")).toBeInTheDocument();
  });

  it("shows the three-strike warning copy", () => {
    renderModal();
    const warning = screen.getByTestId("three-strike-warning");
    expect(warning).toBeInTheDocument();
    expect(warning.textContent).toMatch(/3 dismissals with the same reason will suppress/i);
    expect(warning.textContent).toMatch(/Reversible from settings/i);
  });

  it("Dismiss button is disabled until a reason is selected", () => {
    renderModal();
    const btn = screen.getByTestId("dismiss-confirm");
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByTestId("reason-not_relevant").querySelector("input")!);
    expect(btn).not.toBeDisabled();
  });

  it("calls onConfirm with selected reason and notes", async () => {
    const { onConfirm } = renderModal();
    fireEvent.click(screen.getByTestId("reason-tried_before").querySelector("input")!);
    fireEvent.change(screen.getByTestId("dismiss-notes"), {
      target: { value: "Tried this for 6 months" },
    });
    fireEvent.click(screen.getByTestId("dismiss-confirm"));
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(
        "tried_before",
        "Tried this for 6 months",
      );
    });
  });

  it("calls onClose on Cancel", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
