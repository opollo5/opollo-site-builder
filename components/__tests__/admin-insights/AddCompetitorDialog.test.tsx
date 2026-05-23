import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { AddCompetitorDialog } from "@/components/admin-insights/AddCompetitorDialog";

const COMPANY_ID = "aaaaaaaa-0000-0000-0000-000000000001";

const NEW_COMPETITOR = {
  id: "c3000000-0000-0000-0000-000000000003",
  platform: "LINKEDIN",
  competitor_handle: "newco",
  competitor_display_name: "New Co",
  created_at: new Date().toISOString(),
};

function makeFetch(ok: boolean, status = 200, data?: unknown) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(ok ? { ok: true, competitor: data } : { ok: false, error: { message: "Error" } }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AddCompetitorDialog", () => {
  it("renders trigger button", () => {
    render(<AddCompetitorDialog companyId={COMPANY_ID} onAdded={vi.fn()} />);
    expect(screen.getByTestId("add-competitor-trigger")).toBeInTheDocument();
  });

  it("opens dialog on trigger click", async () => {
    render(<AddCompetitorDialog companyId={COMPANY_ID} onAdded={vi.fn()} />);
    fireEvent.click(screen.getByTestId("add-competitor-trigger"));
    await waitFor(() => {
      expect(screen.getByTestId("handle-input")).toBeInTheDocument();
    });
  });

  it("calls onAdded with new competitor on success", async () => {
    const user = userEvent.setup();
    const onAdded = vi.fn();
    vi.stubGlobal("fetch", makeFetch(true, 201, NEW_COMPETITOR));

    render(<AddCompetitorDialog companyId={COMPANY_ID} onAdded={onAdded} />);

    await user.click(screen.getByTestId("add-competitor-trigger"));
    await waitFor(() => screen.getByTestId("handle-input"));

    await user.type(screen.getByTestId("handle-input"), "newco");
    await user.type(screen.getByTestId("display-name-input"), "New Co");
    await user.click(screen.getByTestId("add-competitor-submit"));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `/api/admin/insights/clients/${COMPANY_ID}/competitors`,
        expect.objectContaining({ method: "POST" }),
      );
      expect(onAdded).toHaveBeenCalledWith(NEW_COMPETITOR);
    });
  });

  it("shows duplicate error on 409", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ ok: false, error: { message: "already tracked" } }),
      }),
    );

    render(<AddCompetitorDialog companyId={COMPANY_ID} onAdded={vi.fn()} />);

    await user.click(screen.getByTestId("add-competitor-trigger"));
    await waitFor(() => screen.getByTestId("handle-input"));

    await user.type(screen.getByTestId("handle-input"), "existing");
    await user.click(screen.getByTestId("add-competitor-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("add-competitor-error")).toHaveTextContent(/already being tracked/);
    });
  });

  it("shows error when handle is empty on submit", async () => {
    const user = userEvent.setup();
    render(<AddCompetitorDialog companyId={COMPANY_ID} onAdded={vi.fn()} />);

    await user.click(screen.getByTestId("add-competitor-trigger"));
    await waitFor(() => screen.getByTestId("handle-input"));

    await user.click(screen.getByTestId("add-competitor-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("add-competitor-error")).toHaveTextContent(/Handle is required/);
    });
  });
});
