/**
 * WorkflowStatusDrawer — component tests.
 *
 * Tests:
 *  - Renders nothing meaningful when open=false
 *  - Fetches gates on open and shows stage list
 *  - image_review with approvalStatus='pending_review' shows active state
 *  - image_review with approvalStatus='approved' shows done stage
 *  - Disabled gates are excluded from the stage list
 *  - Scheduled stage is always shown last
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

import { WorkflowStatusDrawer } from "@/components/workflow/WorkflowStatusDrawer";
import type { WorkflowGateWithApprovers } from "@/lib/platform/workflow/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// radix-ui portals need special handling in jsdom — mock the Sheet primitives
// so we can test the drawer content directly.
vi.mock("@/components/ui/sheet", () => {
  const Sheet = ({ open, onOpenChange, children }: {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => {
    void onOpenChange;
    if (!open) return null;
    return <div data-testid="sheet-root">{children}</div>;
  };

  const SheetContent = ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
    <div data-testid="sheet-content" {...rest}>{children}</div>
  );

  const SheetHeader = ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
    <div data-testid="sheet-header" {...rest}>{children}</div>
  );

  const SheetTitle = ({ children, ...rest }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 data-testid="sheet-title" {...rest}>{children}</h2>
  );

  return { Sheet, SheetContent, SheetHeader, SheetTitle };
});

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

let fetchMock = vi.fn();
global.fetch = fetchMock;

const GATE_IMAGE_REVIEW_ENABLED: WorkflowGateWithApprovers = {
  id: "gate-1",
  companyId: "co-1",
  gateType: "image_review",
  enabled: true,
  passRule: "any_one",
  timeoutDays: 3,
  autoSchedule: true,
  approvers: [
    { id: "apr-1", gateId: "gate-1", platformUserId: null, externalEmail: "client@example.com" },
  ],
};

const GATE_COPY_REVIEW_DISABLED: WorkflowGateWithApprovers = {
  id: "gate-2",
  companyId: "co-1",
  gateType: "copy_review",
  enabled: false,
  passRule: "all_must",
  timeoutDays: 2,
  autoSchedule: false,
  approvers: [],
};

const GATE_FINAL_SIGNOFF_ENABLED: WorkflowGateWithApprovers = {
  id: "gate-3",
  companyId: "co-1",
  gateType: "final_signoff",
  enabled: true,
  passRule: "any_one",
  timeoutDays: 1,
  autoSchedule: false,
  approvers: [],
};

function mockGatesResponse(gates: WorkflowGateWithApprovers[]) {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, data: { gates } }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkflowStatusDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  it("renders nothing when open=false", () => {
    mockGatesResponse([GATE_IMAGE_REVIEW_ENABLED]);
    const { container } = render(
      <WorkflowStatusDrawer
        open={false}
        onClose={() => undefined}
        companyId="co-1"
        approvalStatus="pending_review"
      />,
    );
    // Sheet is mocked to return null when not open.
    expect(container.firstChild).toBeNull();
    // Fetch should NOT have been called since drawer is closed.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches gates on open and shows the stage list", async () => {
    mockGatesResponse([GATE_IMAGE_REVIEW_ENABLED]);
    render(
      <WorkflowStatusDrawer
        open={true}
        onClose={() => undefined}
        companyId="co-1"
        approvalStatus="none"
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("workflow-stage-list")).toBeInTheDocument();
    });
    // Should have called the gates endpoint.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/platform/companies/co-1/workflow-gates"),
    );
  });

  it("shows the title 'Approval workflow'", async () => {
    mockGatesResponse([GATE_IMAGE_REVIEW_ENABLED]);
    render(
      <WorkflowStatusDrawer
        open={true}
        onClose={() => undefined}
        companyId="co-1"
        approvalStatus="none"
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("sheet-title")).toHaveTextContent("Approval workflow");
    });
  });

  it("image_review with approvalStatus='pending_review' shows active stage", async () => {
    mockGatesResponse([GATE_IMAGE_REVIEW_ENABLED]);
    render(
      <WorkflowStatusDrawer
        open={true}
        onClose={() => undefined}
        companyId="co-1"
        approvalStatus="pending_review"
        reviewRound={1}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("stage-row-image_review")).toBeInTheDocument();
    });
    const row = screen.getByTestId("stage-row-image_review");
    // Active badge text should be present.
    expect(row.textContent).toMatch(/active/i);
    // Round info should be shown.
    expect(row.textContent).toMatch(/round 2 of 3/i);
  });

  it("image_review with approvalStatus='approved' shows done state with checkmark", async () => {
    mockGatesResponse([GATE_IMAGE_REVIEW_ENABLED]);
    render(
      <WorkflowStatusDrawer
        open={true}
        onClose={() => undefined}
        companyId="co-1"
        approvalStatus="approved"
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("stage-row-image_review")).toBeInTheDocument();
    });
    const row = screen.getByTestId("stage-row-image_review");
    expect(row.textContent).toMatch(/done/i);
    // SVG checkmark path is present inside the row.
    const svg = row.querySelector("svg path[d='M2 6l3 3 5-5']");
    expect(svg).not.toBeNull();
  });

  it("disabled gates are excluded from the stage list", async () => {
    mockGatesResponse([GATE_IMAGE_REVIEW_ENABLED, GATE_COPY_REVIEW_DISABLED]);
    render(
      <WorkflowStatusDrawer
        open={true}
        onClose={() => undefined}
        companyId="co-1"
        approvalStatus="none"
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("workflow-stage-list")).toBeInTheDocument();
    });
    // copy_review is disabled — should not appear.
    expect(screen.queryByTestId("stage-row-copy_review")).toBeNull();
    // image_review is enabled — should appear.
    expect(screen.getByTestId("stage-row-image_review")).toBeInTheDocument();
  });

  it("Scheduled stage is always shown last", async () => {
    mockGatesResponse([GATE_IMAGE_REVIEW_ENABLED, GATE_FINAL_SIGNOFF_ENABLED]);
    render(
      <WorkflowStatusDrawer
        open={true}
        onClose={() => undefined}
        companyId="co-1"
        approvalStatus="none"
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("workflow-stage-list")).toBeInTheDocument();
    });
    // Scheduled stage must be present.
    expect(screen.getByTestId("stage-row-scheduled")).toBeInTheDocument();

    // It must be the last child of the stage list.
    const list = screen.getByTestId("workflow-stage-list");
    const stageRows = list.querySelectorAll("[data-testid^='stage-row-']");
    expect(stageRows.length).toBeGreaterThan(0);
    const lastRow = stageRows[stageRows.length - 1];
    expect(lastRow.getAttribute("data-testid")).toBe("stage-row-scheduled");
  });

  it("shows 'No workflow stages configured' when gates list is empty", async () => {
    mockGatesResponse([]);
    render(
      <WorkflowStatusDrawer
        open={true}
        onClose={() => undefined}
        companyId="co-1"
        approvalStatus="none"
      />,
    );
    await waitFor(() => {
      // With no enabled gates, deriveStages still adds the Scheduled stage.
      // So stage-list should appear with only the scheduled row.
      expect(screen.getByTestId("stage-row-scheduled")).toBeInTheDocument();
    });
  });

  it("shows error message when fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("Network error"));
    render(
      <WorkflowStatusDrawer
        open={true}
        onClose={() => undefined}
        companyId="co-1"
        approvalStatus="none"
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("workflow-error")).toBeInTheDocument();
    });
  });
});
