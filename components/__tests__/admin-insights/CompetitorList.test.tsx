import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { CompetitorList } from "@/components/admin-insights/CompetitorList";

const COMPANY_ID = "aaaaaaaa-0000-0000-0000-000000000001";

const COMPETITORS = [
  {
    id: "c1000000-0000-0000-0000-000000000001",
    platform: "LINKEDIN",
    competitor_handle: "acme-corp",
    competitor_display_name: "Acme Corp",
    created_at: new Date().toISOString(),
  },
  {
    id: "c2000000-0000-0000-0000-000000000002",
    platform: "FACEBOOK",
    competitor_handle: "rivalco",
    competitor_display_name: null,
    created_at: new Date().toISOString(),
  },
];

function makeFetch(ok: boolean, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve({ ok }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CompetitorList", () => {
  it("renders empty state when no competitors", () => {
    render(
      <CompetitorList competitors={[]} companyId={COMPANY_ID} onDeleted={vi.fn()} />,
    );
    expect(screen.getByText(/No competitors tracked/i)).toBeInTheDocument();
  });

  it("renders all competitors", () => {
    render(
      <CompetitorList competitors={COMPETITORS} companyId={COMPANY_ID} onDeleted={vi.fn()} />,
    );
    expect(screen.getByTestId("competitor-list")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("@acme-corp")).toBeInTheDocument();
    expect(screen.getByText("@rivalco")).toBeInTheDocument();
  });

  it("calls onDeleted after successful DELETE", async () => {
    const onDeleted = vi.fn();
    vi.stubGlobal("fetch", makeFetch(true));

    render(
      <CompetitorList competitors={COMPETITORS} companyId={COMPANY_ID} onDeleted={onDeleted} />,
    );

    const deleteBtn = screen.getByTestId(`remove-competitor-${COMPETITORS[0]!.id}`);
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `/api/admin/insights/clients/${COMPANY_ID}/competitors/${COMPETITORS[0]!.id}`,
        { method: "DELETE" },
      );
      expect(onDeleted).toHaveBeenCalledWith(COMPETITORS[0]!.id);
    });
  });

  it("shows alert on delete failure", async () => {
    const alertMock = vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.stubGlobal("fetch", makeFetch(false, 500));

    render(
      <CompetitorList competitors={COMPETITORS} companyId={COMPANY_ID} onDeleted={vi.fn()} />,
    );

    const deleteBtn = screen.getByTestId(`remove-competitor-${COMPETITORS[0]!.id}`);
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(alertMock).toHaveBeenCalled();
    });

    alertMock.mockRestore();
  });
});
