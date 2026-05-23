import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Mock echarts-for-react — canvas not available in jsdom.
vi.mock("echarts-for-react", () => ({
  default: ({ style }: { style?: React.CSSProperties }) => (
    <div data-testid="echart" style={style} />
  ),
}));

import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { AreaChart } from "@/components/charts/AreaChart";
import { DonutChart } from "@/components/charts/DonutChart";

describe("Chart wrappers — render without error", () => {
  it("LineChart renders with aria-label", () => {
    render(
      <LineChart
        data={[
          { x: "2026-01-01", y: 10 },
          { x: "2026-01-02", y: 20 },
        ]}
        ariaLabel="Test line chart"
      />,
    );
    expect(screen.getByRole("img", { name: "Test line chart" })).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
  });

  it("LineChart groups multi-series data", () => {
    render(
      <LineChart
        data={[
          { x: "2026-01-01", y: 10, series: "A" },
          { x: "2026-01-01", y: 5, series: "B" },
        ]}
        showLegend
        ariaLabel="Multi-series line chart"
      />,
    );
    expect(screen.getByRole("img", { name: "Multi-series line chart" })).toBeInTheDocument();
  });

  it("BarChart renders vertical layout", () => {
    render(
      <BarChart
        data={[
          { label: "LinkedIn", value: 42 },
          { label: "Facebook", value: 18 },
        ]}
        ariaLabel="Posts by platform"
      />,
    );
    expect(screen.getByRole("img", { name: "Posts by platform" })).toBeInTheDocument();
  });

  it("BarChart renders horizontal layout", () => {
    render(
      <BarChart
        data={[
          { label: "draft", value: 10 },
          { label: "published", value: 30 },
        ]}
        layout="horizontal"
        ariaLabel="Posts by status"
      />,
    );
    expect(screen.getByRole("img", { name: "Posts by status" })).toBeInTheDocument();
  });

  it("AreaChart renders with x/y data", () => {
    render(
      <AreaChart
        data={[
          { x: "2026-01-01", y: 5 },
          { x: "2026-01-02", y: 8 },
        ]}
        ariaLabel="Published trend"
      />,
    );
    expect(screen.getByRole("img", { name: "Published trend" })).toBeInTheDocument();
  });

  it("DonutChart renders with named segments", () => {
    render(
      <DonutChart
        data={[
          { name: "cap", value: 30 },
          { name: "manual", value: 70 },
        ]}
        ariaLabel="Post source breakdown"
      />,
    );
    expect(screen.getByRole("img", { name: "Post source breakdown" })).toBeInTheDocument();
  });

  it("chart applies custom height", () => {
    render(
      <AreaChart
        data={[{ x: "2026-01-01", y: 1 }]}
        height={400}
        ariaLabel="Height test"
      />,
    );
    const container = screen.getByRole("img", { name: "Height test" });
    expect(container).toHaveStyle({ height: '400px' });
  });
});
