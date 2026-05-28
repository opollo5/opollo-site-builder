import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MediaPickerModal } from "@/components/social/composer/MediaPickerModal";

// ---------------------------------------------------------------------------
// MediaPickerModal — component tests (layer 4, jsdom)
// ---------------------------------------------------------------------------

const MOCK_ASSETS = [
  { id: "a1", source_url: "https://cdn.example.com/img1.jpg", mime_type: "image/jpeg", bytes: 12345, created_at: "2026-05-01T00:00:00Z" },
  { id: "a2", source_url: "https://cdn.example.com/img2.gif", mime_type: "image/gif", bytes: 54321, created_at: "2026-05-02T00:00:00Z" },
];

function noop() { /* no-op */ }

function setup(props?: Partial<Parameters<typeof MediaPickerModal>[0]>) {
  const onAttach = vi.fn();
  const onClose = vi.fn();
  render(
    <MediaPickerModal
      open={true}
      onClose={onClose}
      onAttach={onAttach}
      companyId="company-uuid-1"
      draftBody="Check out our product"
      currentMediaCount={0}
      {...props}
    />,
  );
  return { onAttach, onClose };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("MediaPickerModal", () => {
  it("renders with Upload tab active by default", () => {
    setup();
    expect(screen.getByTestId("media-upload-dropzone")).toBeInTheDocument();
    expect(screen.getByTestId("media-picker-tab-upload")).toHaveClass("border-primary");
  });

  it("switches to Library tab", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      json: async () => ({ ok: true, data: { assets: MOCK_ASSETS, next_cursor: null } }),
    } as Response);

    setup();
    await userEvent.click(screen.getByTestId("media-picker-tab-library"));
    await waitFor(() => expect(screen.getByTestId("media-library-grid")).toBeInTheDocument());
    expect(screen.getByTestId("media-library-item-a1")).toBeInTheDocument();
    expect(screen.getByTestId("media-library-item-a2")).toBeInTheDocument();
  });

  it("shows empty state when library has no assets", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      json: async () => ({ ok: true, data: { assets: [], next_cursor: null } }),
    } as Response);

    setup();
    await userEvent.click(screen.getByTestId("media-picker-tab-library"));
    await waitFor(() => expect(screen.getByTestId("media-library-empty")).toBeInTheDocument());
  });

  it("selects library item and enables Use selected button", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      json: async () => ({ ok: true, data: { assets: MOCK_ASSETS, next_cursor: null } }),
    } as Response);

    const { onAttach, onClose } = setup();
    await userEvent.click(screen.getByTestId("media-picker-tab-library"));
    await waitFor(() => screen.getByTestId("media-library-grid"));

    // "Use selected" is disabled before selection
    const useBtn = screen.getByTestId("media-library-use-selected");
    expect(useBtn).toBeDisabled();

    // Select first item
    await userEvent.click(screen.getByTestId("media-library-item-a1"));
    expect(useBtn).not.toBeDisabled();
    expect(useBtn).toHaveTextContent("Use selected (1)");

    // Click Use selected
    await userEvent.click(useBtn);
    expect(onAttach).toHaveBeenCalledWith(["https://cdn.example.com/img1.jpg"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("type filter hides GIFs when 'image' selected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      json: async () => ({ ok: true, data: { assets: MOCK_ASSETS, next_cursor: null } }),
    } as Response);

    setup();
    await userEvent.click(screen.getByTestId("media-picker-tab-library"));
    await waitFor(() => screen.getByTestId("media-library-grid"));

    fireEvent.change(screen.getByTestId("media-library-type-filter"), { target: { value: "image" } });

    expect(screen.getByTestId("media-library-item-a1")).toBeInTheDocument();
    expect(screen.queryByTestId("media-library-item-a2")).not.toBeInTheDocument();
  });

  it("switches to AI tab and shows generate button", async () => {
    // A3: free-form prompt textarea removed; AI tab uses brand-derived params.
    setup({ draftBody: "Check out our product" });
    await userEvent.click(screen.getByTestId("media-picker-tab-ai"));
    expect(screen.getByTestId("ai-generate-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-image-prompt")).not.toBeInTheDocument();
  });

  it("shows error when AI generation fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));
    setup();
    await userEvent.click(screen.getByTestId("media-picker-tab-ai"));
    await userEvent.click(screen.getByTestId("ai-generate-btn"));
    await waitFor(() => expect(screen.getByTestId("ai-generate-error")).toBeInTheDocument());
  });

  it("Cancel button calls onClose", async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("does not render when closed", () => {
    render(
      <MediaPickerModal open={false} onClose={noop} onAttach={noop} companyId="x" />,
    );
    expect(screen.queryByTestId("media-picker-modal")).not.toBeInTheDocument();
  });
});
