import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { UnsavedChangesDialog } from "@/components/social/composer/UnsavedChangesDialog";

describe("UnsavedChangesDialog (wireframe 08 gap fix)", () => {
  it("renders title and description when open", () => {
    render(
      <UnsavedChangesDialog open onDiscard={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("Unsaved changes")).toBeDefined();
    expect(screen.getByText(/save as a draft/i)).toBeDefined();
  });

  it("calls onCancel when Keep editing is clicked", () => {
    const onCancel = vi.fn();
    render(<UnsavedChangesDialog open onDiscard={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Keep editing"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onDiscard when Discard is clicked", () => {
    const onDiscard = vi.fn();
    render(<UnsavedChangesDialog open onDiscard={onDiscard} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("Discard"));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("renders Save as draft button only when onSave is provided", () => {
    const { rerender } = render(
      <UnsavedChangesDialog open onDiscard={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByTestId("unsaved-save-btn")).toBeNull();

    rerender(
      <UnsavedChangesDialog open onDiscard={vi.fn()} onCancel={vi.fn()} onSave={vi.fn()} />,
    );
    expect(screen.getByTestId("unsaved-save-btn")).toBeDefined();
  });

  it("calls onSave and shows saving state", async () => {
    let resolve: () => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolve = res;
        }),
    );

    render(
      <UnsavedChangesDialog open onDiscard={vi.fn()} onCancel={vi.fn()} onSave={onSave} />,
    );

    fireEvent.click(screen.getByTestId("unsaved-save-btn"));
    expect(screen.getByTestId("unsaved-save-btn").textContent).toBe("Saving…");
    expect(onSave).toHaveBeenCalledTimes(1);

    resolve!();
    await waitFor(() =>
      expect(screen.getByTestId("unsaved-save-btn").textContent).toBe("Save as draft"),
    );
  });
});
