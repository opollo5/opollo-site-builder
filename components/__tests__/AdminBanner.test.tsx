import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { AdminBanner } from "@/components/admin-insights/AdminBanner";

describe("AdminBanner", () => {
  it("shows client name", () => {
    render(<AdminBanner clientName="Acme MSP" />);
    expect(screen.getByTestId("admin-banner")).toBeInTheDocument();
    expect(screen.getByText(/Acme MSP/)).toBeInTheDocument();
    expect(screen.getByText(/All actions logged/)).toBeInTheDocument();
  });

  it("back button navigates to roster", () => {
    render(<AdminBanner clientName="Acme MSP" />);
    fireEvent.click(screen.getByRole("button", { name: /back to roster/i }));
    expect(mockPush).toHaveBeenCalledWith("/admin/insights");
  });
});
