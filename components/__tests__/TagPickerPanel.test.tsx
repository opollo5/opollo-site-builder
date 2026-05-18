// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { TagPickerPanel } from "@/components/composer/tag-picker";

describe("TagPickerPanel", () => {
  it("renders with search input", () => {
    render(<TagPickerPanel onInsert={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("tag-picker-panel")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /type a hashtag/i })).toBeInTheDocument();
  });

  it("shows suggested tags on open", () => {
    render(<TagPickerPanel onInsert={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /#marketing/i })).toBeInTheDocument();
  });

  it("calls onInsert with #tag when a suggestion is clicked", () => {
    const onInsert = vi.fn();
    render(<TagPickerPanel onInsert={onInsert} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /#marketing/i }));
    expect(onInsert).toHaveBeenCalledWith("#marketing");
  });

  it("calls onInsert when Enter is pressed with a custom tag", () => {
    const onInsert = vi.fn();
    render(<TagPickerPanel onInsert={onInsert} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /type a hashtag/i }), { target: { value: "customtag" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: /type a hashtag/i }), { key: "Enter" });
    expect(onInsert).toHaveBeenCalledWith("#customtag");
  });

  it("strips leading # from typed input", () => {
    const onInsert = vi.fn();
    render(<TagPickerPanel onInsert={onInsert} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /type a hashtag/i }), { target: { value: "#cleantag" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: /type a hashtag/i }), { key: "Enter" });
    expect(onInsert).toHaveBeenCalledWith("#cleantag");
  });

  it("surfaces existing tags from draftText", () => {
    render(
      <TagPickerPanel
        draftText="Check out #growthhacking and #SEO tips"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /#growthhacking/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /#SEO/i })).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", () => {
    const onClose = vi.fn();
    render(<TagPickerPanel onInsert={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close tag picker/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose after inserting a tag", () => {
    const onClose = vi.fn();
    render(<TagPickerPanel onInsert={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /#marketing/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
