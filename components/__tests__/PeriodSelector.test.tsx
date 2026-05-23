import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const mockPush = vi.fn();
const mockPathname = "/company/social/insights";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => mockPathname,
}));

// Render all options directly so the test doesn't depend on Radix Popover open/close
// state in jsdom. Clicking an option fires onValueChange — same contract as PillSelect.
vi.mock("@/components/ui/pill-select", () => ({
  PillSelect: ({
    options,
    value,
    onValueChange,
  }: {
    options: Array<{ value: string; label: string }>;
    value: string;
    onValueChange: (v: string) => void;
  }) => (
    <div data-testid="pill-select" data-value={value}>
      {options.map((o) => (
        <button
          key={o.value}
          data-testid={`option-${o.value}`}
          data-selected={o.value === value ? "true" : "false"}
          onClick={() => onValueChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  ),
}));

import { PeriodSelector } from "@/components/insights/common/PeriodSelector";

describe("PeriodSelector", () => {
  it("renders all three period options", () => {
    render(<PeriodSelector value="30d" />);
    expect(screen.getByTestId("option-7d")).toBeInTheDocument();
    expect(screen.getByTestId("option-30d")).toBeInTheDocument();
    expect(screen.getByTestId("option-90d")).toBeInTheDocument();
  });

  it("marks the value prop as selected", () => {
    render(<PeriodSelector value="7d" />);
    expect(screen.getByTestId("pill-select")).toHaveAttribute("data-value", "7d");
    expect(screen.getByTestId("option-7d")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId("option-30d")).toHaveAttribute("data-selected", "false");
  });

  it("defaults to 30d when no value prop supplied", () => {
    render(<PeriodSelector />);
    expect(screen.getByTestId("pill-select")).toHaveAttribute("data-value", "30d");
  });

  it("calls router.push with ?period=7d when 7d option clicked", () => {
    mockPush.mockClear();
    render(<PeriodSelector value="30d" />);
    fireEvent.click(screen.getByTestId("option-7d"));
    expect(mockPush).toHaveBeenCalledWith(`${mockPathname}?period=7d`);
  });

  it("calls router.push with ?period=90d when 90d option clicked", () => {
    mockPush.mockClear();
    render(<PeriodSelector value="30d" />);
    fireEvent.click(screen.getByTestId("option-90d"));
    expect(mockPush).toHaveBeenCalledWith(`${mockPathname}?period=90d`);
  });

  it("uses the pathname from usePathname so the URL is correct on any route", () => {
    mockPush.mockClear();
    render(<PeriodSelector value="90d" />);
    fireEvent.click(screen.getByTestId("option-7d"));
    expect(mockPush).toHaveBeenCalledWith(`${mockPathname}?period=7d`);
  });
});
