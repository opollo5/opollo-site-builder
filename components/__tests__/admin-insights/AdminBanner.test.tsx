import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AdminBanner } from "@/components/admin-insights/AdminBanner";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

beforeEach(() => {
  mockPush.mockClear();
});

const COMPANY_ID = "test-company-id";

describe("AdminBanner", () => {
  it("renders the client name and admin label", () => {
    render(<AdminBanner clientName="Acme Corp" companyId={COMPANY_ID} />);
    expect(screen.getByTestId("admin-banner")).toBeInTheDocument();
    expect(screen.getByText(/Viewing as admin · Acme Corp/)).toBeInTheDocument();
  });

  it("back button navigates to roster", () => {
    render(<AdminBanner clientName="Acme Corp" companyId={COMPANY_ID} />);
    fireEvent.click(screen.getByText(/Back to roster/));
    expect(mockPush).toHaveBeenCalledWith("/admin/insights");
  });

  it("manage competitors button navigates to competitors page", () => {
    render(<AdminBanner clientName="Acme Corp" companyId={COMPANY_ID} />);
    fireEvent.click(screen.getByText("Manage competitors"));
    expect(mockPush).toHaveBeenCalledWith(
      `/admin/insights/clients/${COMPANY_ID}/competitors`,
    );
  });
});
