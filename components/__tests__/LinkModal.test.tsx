// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { LinkModal } from "@/components/composer/link-modal";

describe("LinkModal", () => {
  it("renders with URL input when open", () => {
    render(<LinkModal open={true} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText(/url/i)).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<LinkModal open={false} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByLabelText(/url/i)).not.toBeInTheDocument();
  });

  it("calls onConfirm with plain URL when UTM is not shown", () => {
    const onConfirm = vi.fn();
    render(<LinkModal open={true} onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /insert link/i }));
    expect(onConfirm).toHaveBeenCalledWith("https://example.com");
  });

  it("builds UTM URL when utm params are filled in", () => {
    const onConfirm = vi.fn();
    render(<LinkModal open={true} onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /add utm/i }));
    fireEvent.change(screen.getByLabelText(/source/i), { target: { value: "linkedin" } });
    fireEvent.change(screen.getByLabelText(/campaign/i), { target: { value: "spring" } });
    fireEvent.click(screen.getByRole("button", { name: /insert link/i }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.stringContaining("utm_source=linkedin"),
    );
    expect(onConfirm).toHaveBeenCalledWith(
      expect.stringContaining("utm_campaign=spring"),
    );
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(<LinkModal open={true} onConfirm={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("insert link button is disabled when URL is empty", () => {
    render(<LinkModal open={true} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /insert link/i })).toBeDisabled();
  });

  it("pre-fills URL from initialUrl prop", () => {
    render(<LinkModal open={true} initialUrl="https://prefilled.com" onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText(/url/i)).toHaveValue("https://prefilled.com");
  });
});
