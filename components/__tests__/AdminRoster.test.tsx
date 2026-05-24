import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { AdminRoster } from "@/components/admin-insights/AdminRoster";
import type { AdminClientRow } from "@/lib/insights/admin-dashboard";

function makeRow(overrides: Partial<AdminClientRow> = {}): AdminClientRow {
  return {
    companyId: "co-1",
    name: "Acme MSP",
    lastPostAt: new Date(Date.now() - 2 * 3600000).toISOString(),
    lastPostRelative: "2h ago",
    trendData30d: [0.03, 0.04, 0.05, 0.04, 0.06],
    healthStatus: "green",
    openRecs: 5,
    dismissedRecs: 1,
    lastAdminActionAt: null,
    lastAdminActionOperator: null,
    ...overrides,
  };
}

const FIXTURE: AdminClientRow[] = [
  makeRow({ companyId: "co-1", name: "Acme MSP", healthStatus: "green" }),
  makeRow({ companyId: "co-2", name: "Beta Tech", healthStatus: "amber" }),
  makeRow({ companyId: "co-3", name: "Gamma Cloud", healthStatus: "red" }),
];

describe("AdminRoster", () => {
  it("renders all rows", () => {
    render(<AdminRoster roster={FIXTURE} />);
    expect(screen.getByTestId("admin-roster")).toBeInTheDocument();
    expect(screen.getByText("Acme MSP")).toBeInTheDocument();
    expect(screen.getByText("Beta Tech")).toBeInTheDocument();
    expect(screen.getByText("Gamma Cloud")).toBeInTheDocument();
  });

  it("filters by search", () => {
    render(<AdminRoster roster={FIXTURE} />);
    const input = screen.getByRole("searchbox", { name: /search clients/i });
    fireEvent.change(input, { target: { value: "beta" } });
    expect(screen.getByText("Beta Tech")).toBeInTheDocument();
    expect(screen.queryByText("Acme MSP")).not.toBeInTheDocument();
  });

  it("filters by health", () => {
    render(<AdminRoster roster={FIXTURE} />);
    const select = screen.getByRole("combobox", { name: /filter by health/i });
    fireEvent.change(select, { target: { value: "red" } });
    expect(screen.getByText("Gamma Cloud")).toBeInTheDocument();
    expect(screen.queryByText("Acme MSP")).not.toBeInTheDocument();
  });

  it("shows empty message when no match", () => {
    render(<AdminRoster roster={FIXTURE} />);
    const input = screen.getByRole("searchbox", { name: /search clients/i });
    fireEvent.change(input, { target: { value: "xyzzy-no-match" } });
    expect(screen.getByText(/no clients match/i)).toBeInTheDocument();
  });
});
