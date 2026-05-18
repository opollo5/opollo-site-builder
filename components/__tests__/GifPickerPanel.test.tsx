// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { GifPickerPanel } from "@/components/composer/gif-picker";

const fetchMock = vi.fn();
const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        results: [
          {
            id: "gif1",
            title: "funny cat",
            media_formats: { tinygif: { url: "https://example.com/cat.gif", dims: [200, 150] } },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  vi.clearAllMocks();
});

describe("GifPickerPanel", () => {
  it("renders the panel with search input", async () => {
    render(<GifPickerPanel onSelect={vi.fn()} onClose={vi.fn()} />);
    await act(async () => {});
    expect(screen.getByTestId("gif-picker-panel")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: /search gifs/i })).toBeInTheDocument();
  });

  it("loads trending GIFs on mount and renders results", async () => {
    render(<GifPickerPanel onSelect={vi.fn()} onClose={vi.fn()} />);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("trending"));
    expect(screen.getByAltText("funny cat")).toBeInTheDocument();
  });

  it("calls onSelect with correct MediaRef when a GIF is clicked", async () => {
    const onSelect = vi.fn();
    render(<GifPickerPanel onSelect={onSelect} onClose={vi.fn()} />);
    await act(async () => {});
    fireEvent.click(screen.getByAltText("funny cat"));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ type: "tenor_gif", url: "https://example.com/cat.gif", width: 200, height: 150 }),
    );
  });

  it("calls onClose after selecting a GIF", async () => {
    const onClose = vi.fn();
    render(<GifPickerPanel onSelect={vi.fn()} onClose={onClose} />);
    await act(async () => {});
    fireEvent.click(screen.getByAltText("funny cat"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(<GifPickerPanel onSelect={vi.fn()} onClose={onClose} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: /close gif picker/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows error when Tenor fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("Network error"));
    render(<GifPickerPanel onSelect={vi.fn()} onClose={vi.fn()} />);
    await act(async () => {});
    expect(screen.getByText(/could not load gifs/i)).toBeInTheDocument();
  });
});
