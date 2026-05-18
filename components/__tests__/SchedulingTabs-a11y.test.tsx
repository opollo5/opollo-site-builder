// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { SchedulingTabs } from "@/components/composer/scheduling-tabs";
import { ApprovalToggle } from "@/components/composer/approval-toggle";

// ---------------------------------------------------------------------------
// FIX 16 + FIX 17: Accessibility — ARIA roles and labels
// ---------------------------------------------------------------------------

const tabProps = {
  mode: "schedule" as const,
  scheduleDate: "2030-01-15",
  scheduleTimes: ["09:00"],
  onModeChange: vi.fn(),
  onScheduleDate: vi.fn(),
  onScheduleTime: vi.fn(),
  onAddScheduleTime: vi.fn(),
  onRemoveScheduleTime: vi.fn(),
};

describe("SchedulingTabs accessibility", () => {
  it("time input has accessible label", () => {
    render(<SchedulingTabs {...tabProps} />);
    expect(screen.getByLabelText(/schedule time 1/i)).toBeInTheDocument();
  });

  it("remove time button has accessible label", () => {
    render(<SchedulingTabs {...tabProps} scheduleTimes={["09:00", "14:00"]} />);
    expect(screen.getByRole("button", { name: /remove time 1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove time 2/i })).toBeInTheDocument();
  });

  it("tab buttons have expected accessible names", () => {
    render(<SchedulingTabs {...tabProps} />);
    expect(screen.getByRole("button", { name: /post now/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /schedule/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save as draft/i })).toBeInTheDocument();
  });
});

describe("ApprovalToggle accessibility", () => {
  it("switch has role=switch and aria-checked", () => {
    render(<ApprovalToggle value={false} onChange={vi.fn()} />);
    const toggle = screen.getByRole("switch", { name: /post needs approval/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("aria-checked reflects current value", () => {
    render(<ApprovalToggle value={true} onChange={vi.fn()} />);
    const toggle = screen.getByRole("switch", { name: /post needs approval/i });
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});
