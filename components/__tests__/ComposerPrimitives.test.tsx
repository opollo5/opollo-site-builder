import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as React from "react";

import { Callout } from "@/components/ui/callout";
import { SectionHeader } from "@/components/ui/section-header";
import { Pagination } from "@/components/ui/pagination";

// ---------------------------------------------------------------------------
// Callout
// ---------------------------------------------------------------------------

describe("Callout", () => {
  it("renders title", () => {
    render(<Callout title="Heads up" />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Heads up")).toBeTruthy();
  });

  it("renders body when provided", () => {
    render(<Callout title="T" body="Some detail" />);
    expect(screen.getByText("Some detail")).toBeTruthy();
  });

  it("renders CTA button when provided", () => {
    const onClick = vi.fn();
    render(<Callout title="T" cta={{ label: "Act now", onClick }} />);
    const btn = screen.getByRole("button", { name: "Act now" });
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders dismiss button when onDismiss provided", () => {
    const onDismiss = vi.fn();
    render(<Callout title="T" onDismiss={onDismiss} />);
    const btn = screen.getByRole("button", { name: /dismiss/i });
    fireEvent.click(btn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not render dismiss button when onDismiss is absent", () => {
    render(<Callout title="T" />);
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });

  it("applies info variant classes", () => {
    const { container } = render(<Callout title="T" variant="info" />);
    expect((container.firstChild as HTMLElement).className).toContain("bg-info-bg");
  });

  it("applies warning variant classes", () => {
    const { container } = render(<Callout title="T" variant="warning" />);
    expect((container.firstChild as HTMLElement).className).toContain("bg-warning-bg");
  });

  it("applies helpful variant classes", () => {
    const { container } = render(<Callout title="T" variant="helpful" />);
    expect((container.firstChild as HTMLElement).className).toContain("bg-warning-bg");
  });
});

// ---------------------------------------------------------------------------
// SectionHeader
// ---------------------------------------------------------------------------

describe("SectionHeader", () => {
  it("renders the title", () => {
    render(<SectionHeader title="My section" />);
    expect(screen.getByText("My section")).toBeTruthy();
  });

  it("renders subtitle when provided", () => {
    render(<SectionHeader title="T" subtitle="Subtitle text" />);
    expect(screen.getByText("Subtitle text")).toBeTruthy();
  });

  it("renders actions slot", () => {
    render(<SectionHeader title="T" actions={<button>New</button>} />);
    expect(screen.getByRole("button", { name: "New" })).toBeTruthy();
  });

  it("does not render subtitle when absent", () => {
    render(<SectionHeader title="T" />);
    expect(screen.queryByRole("paragraph")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe("Pagination", () => {
  it("renders previous and next buttons with accessible labels", () => {
    render(
      <Pagination total={100} page={2} pageSize={10} onPageChange={() => undefined} />,
    );
    expect(screen.getByRole("button", { name: /previous page/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /next page/i })).toBeTruthy();
  });

  it("prev is disabled on page 1", () => {
    render(
      <Pagination total={50} page={1} pageSize={10} onPageChange={() => undefined} />,
    );
    expect(screen.getByRole("button", { name: /previous page/i }).getAttribute("disabled")).toBeDefined();
  });

  it("next is disabled on last page", () => {
    render(
      <Pagination total={20} page={2} pageSize={10} onPageChange={() => undefined} />,
    );
    expect(screen.getByRole("button", { name: /next page/i }).getAttribute("disabled")).toBeDefined();
  });

  it("calls onPageChange with next page on next click", () => {
    const onChange = vi.fn();
    render(<Pagination total={50} page={1} pageSize={10} onPageChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("calls onPageChange with prev page on prev click", () => {
    const onChange = vi.fn();
    render(<Pagination total={50} page={3} pageSize={10} onPageChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /previous page/i }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("wraps in nav with aria-label Pagination", () => {
    const { container } = render(
      <Pagination total={10} page={1} pageSize={10} onPageChange={() => undefined} />,
    );
    const nav = container.querySelector("nav");
    expect(nav?.getAttribute("aria-label")).toBe("Pagination");
  });

  it("shows correct range text", () => {
    render(
      <Pagination total={35} page={2} pageSize={10} onPageChange={() => undefined} />,
    );
    expect(screen.getByText("11–20 of 35")).toBeTruthy();
  });

  it("shows 'No results' when total is 0", () => {
    render(
      <Pagination total={0} page={1} pageSize={10} onPageChange={() => undefined} />,
    );
    expect(screen.getByText("No results")).toBeTruthy();
  });
});
