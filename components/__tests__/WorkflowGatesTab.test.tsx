import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock fetch before component import
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { WorkflowGatesTab } from "@/components/admin/WorkflowGatesTab";
import type { WorkflowGateWithApprovers } from "@/lib/platform/workflow/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";

function makeGate(
  gateType: WorkflowGateWithApprovers["gateType"],
  overrides: Partial<WorkflowGateWithApprovers> = {},
): WorkflowGateWithApprovers {
  return {
    id: `gate-${gateType}`,
    companyId: COMPANY_ID,
    gateType,
    enabled: false,
    passRule: "any_one",
    timeoutDays: 14,
    autoSchedule: false,
    approvers: [],
    ...overrides,
  };
}

const API_GATES: WorkflowGateWithApprovers[] = [
  makeGate("copy_review"),
  makeGate("image_review"),
  makeGate("final_signoff"),
];

const MEMBERS = [
  { id: "user-1", name: "Alice Admin", email: "alice@example.com", role: "admin" },
  { id: "user-2", name: "Bob Approver", email: "bob@example.com", role: "approver" },
  { id: "user-3", name: "Carol Member", email: "carol@example.com", role: "member" },
];

function makeGetResponse(gates: WorkflowGateWithApprovers[] = API_GATES) {
  return Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({ ok: true, data: { gates }, timestamp: new Date().toISOString() }),
  } as Response);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkflowGatesTab", () => {
  it("renders 3 gate cards after fetch resolves", async () => {
    mockFetch.mockReturnValueOnce(makeGetResponse());

    render(<WorkflowGatesTab companyId={COMPANY_ID} members={MEMBERS} />);

    // Loading state first
    expect(screen.getByTestId("workflow-gates-loading")).toBeInTheDocument();

    // Then cards appear
    await waitFor(() => {
      expect(screen.getByTestId("gate-card-copy_review")).toBeInTheDocument();
    });
    expect(screen.getByTestId("gate-card-image_review")).toBeInTheDocument();
    expect(screen.getByTestId("gate-card-final_signoff")).toBeInTheDocument();
  });

  it("toggle enables a gate and reveals controls", async () => {
    mockFetch.mockReturnValueOnce(makeGetResponse());

    render(<WorkflowGatesTab companyId={COMPANY_ID} members={MEMBERS} />);

    await waitFor(() => {
      expect(screen.getByTestId("gate-card-copy_review")).toBeInTheDocument();
    });

    // copy_review is disabled by default; controls should be hidden
    expect(
      screen.queryByTestId("pass-rule-copy_review"),
    ).not.toBeInTheDocument();

    // Toggle it on
    const toggle = screen.getByTestId("gate-toggle-copy_review");
    fireEvent.click(toggle);

    // Controls should now appear
    expect(screen.getByTestId("pass-rule-copy_review")).toBeInTheDocument();
    expect(screen.getByTestId("timeout-copy_review")).toBeInTheDocument();
    expect(
      screen.getByTestId(`external-email-input-copy_review`),
    ).toBeInTheDocument();
  });

  it("toggle disables a gate that was enabled", async () => {
    const enabledGates: WorkflowGateWithApprovers[] = [
      makeGate("copy_review", { enabled: true }),
      makeGate("image_review"),
      makeGate("final_signoff"),
    ];
    mockFetch.mockReturnValueOnce(makeGetResponse(enabledGates));

    render(<WorkflowGatesTab companyId={COMPANY_ID} members={MEMBERS} />);

    await waitFor(() => {
      expect(screen.getByTestId("pass-rule-copy_review")).toBeInTheDocument();
    });

    // Toggle off
    const toggle = screen.getByTestId("gate-toggle-copy_review");
    fireEvent.click(toggle);

    expect(
      screen.queryByTestId("pass-rule-copy_review"),
    ).not.toBeInTheDocument();
  });

  it("adds an external email approver to the list", async () => {
    const enabledGates: WorkflowGateWithApprovers[] = [
      makeGate("copy_review", { enabled: true }),
      makeGate("image_review"),
      makeGate("final_signoff"),
    ];
    mockFetch.mockReturnValueOnce(makeGetResponse(enabledGates));

    render(<WorkflowGatesTab companyId={COMPANY_ID} members={MEMBERS} />);

    await waitFor(() => {
      expect(
        screen.getByTestId("external-email-input-copy_review"),
      ).toBeInTheDocument();
    });

    const emailInput = screen.getByTestId("external-email-input-copy_review");
    fireEvent.change(emailInput, { target: { value: "client@acme.com" } });
    fireEvent.click(screen.getByTestId("add-external-copy_review"));

    // The chip should appear
    await waitFor(() => {
      expect(screen.getByText("client@acme.com")).toBeInTheDocument();
    });
  });

  it("shows validation error for invalid external email", async () => {
    const enabledGates: WorkflowGateWithApprovers[] = [
      makeGate("copy_review", { enabled: true }),
      makeGate("image_review"),
      makeGate("final_signoff"),
    ];
    mockFetch.mockReturnValueOnce(makeGetResponse(enabledGates));

    render(<WorkflowGatesTab companyId={COMPANY_ID} members={MEMBERS} />);

    await waitFor(() => {
      expect(
        screen.getByTestId("external-email-input-copy_review"),
      ).toBeInTheDocument();
    });

    const emailInput = screen.getByTestId("external-email-input-copy_review");
    fireEvent.change(emailInput, { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByTestId("add-external-copy_review"));

    expect(
      screen.getByText(/Please enter a valid email address/i),
    ).toBeInTheDocument();
  });

  it("save button fires PUT with all 3 gates in the body", async () => {
    const enabledGates: WorkflowGateWithApprovers[] = [
      makeGate("copy_review", { enabled: true }),
      makeGate("image_review"),
      makeGate("final_signoff"),
    ];
    mockFetch.mockReturnValueOnce(makeGetResponse(enabledGates));

    render(<WorkflowGatesTab companyId={COMPANY_ID} members={MEMBERS} />);

    await waitFor(() => {
      expect(screen.getByTestId("gate-card-copy_review")).toBeInTheDocument();
    });

    // Set up PUT mock response
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            data: { gates: enabledGates },
            timestamp: new Date().toISOString(),
          }),
      } as Response),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("save-gate-copy_review"));
    });

    // PUT was fired
    expect(mockFetch).toHaveBeenCalledTimes(2); // 1 GET + 1 PUT

    const [putUrl, putOptions] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(putUrl).toContain(`/api/platform/companies/${COMPANY_ID}/workflow-gates`);
    expect(putOptions.method).toBe("PUT");

    const body = JSON.parse(putOptions.body as string) as unknown[];
    expect(body).toHaveLength(3);

    const types = (body as Array<{ gateType: string }>).map((g) => g.gateType);
    expect(types).toContain("copy_review");
    expect(types).toContain("image_review");
    expect(types).toContain("final_signoff");
  });

  it("shows 'Saved ✓' after a successful PUT", async () => {
    const enabledGates: WorkflowGateWithApprovers[] = [
      makeGate("copy_review", { enabled: true }),
      makeGate("image_review"),
      makeGate("final_signoff"),
    ];
    mockFetch.mockReturnValueOnce(makeGetResponse(enabledGates));

    render(<WorkflowGatesTab companyId={COMPANY_ID} members={MEMBERS} />);

    await waitFor(() => {
      expect(screen.getByTestId("gate-card-copy_review")).toBeInTheDocument();
    });

    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            data: { gates: enabledGates },
            timestamp: new Date().toISOString(),
          }),
      } as Response),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("save-gate-copy_review"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("save-success-copy_review")).toBeInTheDocument();
    });
  });

  it("shows auto-schedule toggle only on final_signoff gate", async () => {
    const enabledGates: WorkflowGateWithApprovers[] = [
      makeGate("copy_review", { enabled: true }),
      makeGate("image_review", { enabled: true }),
      makeGate("final_signoff", { enabled: true }),
    ];
    mockFetch.mockReturnValueOnce(makeGetResponse(enabledGates));

    render(<WorkflowGatesTab companyId={COMPANY_ID} members={MEMBERS} />);

    await waitFor(() => {
      expect(screen.getByTestId("gate-card-final_signoff")).toBeInTheDocument();
    });

    // auto-schedule toggle exists
    expect(screen.getByTestId("auto-schedule-toggle")).toBeInTheDocument();

    // Only one — not on copy_review or image_review
    expect(screen.getAllByTestId("auto-schedule-toggle")).toHaveLength(1);
  });

  it("renders internal approver dropdown filtered to admin/approver roles", async () => {
    const enabledGates: WorkflowGateWithApprovers[] = [
      makeGate("copy_review", { enabled: true }),
      makeGate("image_review"),
      makeGate("final_signoff"),
    ];
    mockFetch.mockReturnValueOnce(makeGetResponse(enabledGates));

    render(<WorkflowGatesTab companyId={COMPANY_ID} members={MEMBERS} />);

    await waitFor(() => {
      expect(
        screen.getByTestId("internal-approver-select-copy_review"),
      ).toBeInTheDocument();
    });

    const select = screen.getByTestId("internal-approver-select-copy_review");
    // Carol is role=member and should NOT appear
    expect(select).not.toHaveTextContent("Carol Member");
    // Alice (admin) and Bob (approver) should appear
    expect(select.innerHTML).toContain("Alice Admin");
    expect(select.innerHTML).toContain("Bob Approver");
  });

  it("shows fetch error state when GET fails", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ ok: false }),
      } as Response),
    );

    render(<WorkflowGatesTab companyId={COMPANY_ID} members={MEMBERS} />);

    await waitFor(() => {
      expect(screen.getByTestId("workflow-gates-error")).toBeInTheDocument();
    });
  });
});
