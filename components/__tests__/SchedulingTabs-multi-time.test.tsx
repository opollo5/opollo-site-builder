// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { SchedulingTabs } from "@/components/composer/scheduling-tabs";

const baseProps = {
  mode: "schedule" as const,
  scheduleDate: "2030-01-15",
  scheduleTimes: ["09:00"],
  onModeChange: vi.fn(),
  onScheduleDate: vi.fn(),
  onScheduleTime: vi.fn(),
  onAddScheduleTime: vi.fn(),
  onRemoveScheduleTime: vi.fn(),
};

describe("SchedulingTabs multi-time", () => {
  it("renders a single time input in schedule mode", () => {
    render(<SchedulingTabs {...baseProps} />);
    expect(screen.getAllByLabelText(/schedule time/i)).toHaveLength(1);
  });

  it("renders multiple time inputs when scheduleTimes has more than one entry", () => {
    render(<SchedulingTabs {...baseProps} scheduleTimes={["09:00", "14:00", "18:00"]} />);
    expect(screen.getAllByLabelText(/schedule time/i)).toHaveLength(3);
  });

  it("shows + Add time button when under 10 times", () => {
    render(<SchedulingTabs {...baseProps} />);
    expect(screen.getByRole("button", { name: /\+ add time/i })).toBeInTheDocument();
  });

  it("hides + Add time button when at 10 times", () => {
    render(
      <SchedulingTabs
        {...baseProps}
        scheduleTimes={Array.from({ length: 10 }, (_, i) => `${String(i).padStart(2, "0")}:00`)}
      />,
    );
    expect(screen.queryByRole("button", { name: /\+ add time/i })).not.toBeInTheDocument();
  });

  it("calls onAddScheduleTime when + Add time is clicked", () => {
    const onAdd = vi.fn();
    render(<SchedulingTabs {...baseProps} onAddScheduleTime={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: /\+ add time/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("shows remove button only when there are multiple times", () => {
    render(<SchedulingTabs {...baseProps} scheduleTimes={["09:00", "14:00"]} />);
    expect(screen.getAllByRole("button", { name: /remove time/i })).toHaveLength(2);
  });

  it("hides remove button when there is only one time", () => {
    render(<SchedulingTabs {...baseProps} scheduleTimes={["09:00"]} />);
    expect(screen.queryByRole("button", { name: /remove time/i })).not.toBeInTheDocument();
  });

  it("calls onRemoveScheduleTime with correct index", () => {
    const onRemove = vi.fn();
    render(<SchedulingTabs {...baseProps} scheduleTimes={["09:00", "14:00"]} onRemoveScheduleTime={onRemove} />);
    fireEvent.click(screen.getAllByRole("button", { name: /remove time/i })[1]);
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it("calls onScheduleTime with updated value and index", () => {
    const onTime = vi.fn();
    render(<SchedulingTabs {...baseProps} scheduleTimes={["09:00", "14:00"]} onScheduleTime={onTime} />);
    fireEvent.change(screen.getAllByLabelText(/schedule time/i)[0], { target: { value: "11:00" } });
    expect(onTime).toHaveBeenCalledWith("11:00", 0);
  });

  it("does not show time pickers in post_now mode", () => {
    render(<SchedulingTabs {...baseProps} mode="post_now" />);
    expect(screen.queryByLabelText(/schedule time/i)).not.toBeInTheDocument();
  });
});
