import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { UnsavedChangesDialog } from "@/components/social/composer/UnsavedChangesDialog";

describe("UnsavedChangesDialog (wireframe 08 gap fix)", () => {
  it("renders title when open (no body text)", () => {
    render(
      <UnsavedChangesDialog open onDiscard={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("Do you want to save your changes?")).toBeDefined();
    expect(screen.queryByText(/save as a draft/i)).toBeNull();
  });

  it("calls onCancel when Continue editing is clicked", () => {
    const onCancel = vi.fn();
    render(<UnsavedChangesDialog open onDiscard={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId("unsaved-continue-btn"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onDiscard when Don't save is clicked", () => {
    const onDiscard = vi.fn();
    render(<UnsavedChangesDialog open onDiscard={onDiscard} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByTestId("unsaved-discard-btn"));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("renders Save button only when onSave is provided", () => {
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
      expect(screen.getByTestId("unsaved-save-btn").textContent).toBe("Save"),
    );
  });
});
