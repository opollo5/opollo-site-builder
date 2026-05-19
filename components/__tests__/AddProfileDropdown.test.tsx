import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as React from "react";
import { AddProfileDropdown } from "@/components/social/dashboard/AddProfileDropdown";

// ---------------------------------------------------------------------------
// Regression test for audit gap G-3 — AddProfileDropdown must exist in the
// dashboard FilterBar and surface all five platform options.
// ---------------------------------------------------------------------------

describe("AddProfileDropdown (audit gap G-3)", () => {
  it("renders the Add profile button", () => {
    render(<AddProfileDropdown />);
    expect(screen.getByTestId("add-profile-btn")).toBeDefined();
  });

  it("menu is hidden before button click", () => {
    render(<AddProfileDropdown />);
    expect(screen.queryByTestId("add-profile-menu")).toBeNull();
  });

  it("menu opens on button click and shows all 5 platforms", () => {
    render(<AddProfileDropdown />);
    fireEvent.click(screen.getByTestId("add-profile-btn"));

    expect(screen.getByTestId("add-profile-menu")).toBeDefined();
    expect(screen.getByTestId("add-profile-linkedin")).toBeDefined();
    expect(screen.getByTestId("add-profile-facebook")).toBeDefined();
    expect(screen.getByTestId("add-profile-instagram")).toBeDefined();
    expect(screen.getByTestId("add-profile-twitter")).toBeDefined();
    expect(screen.getByTestId("add-profile-google_business")).toBeDefined();
  });

  it("each platform item links to /company/social/connections", () => {
    render(<AddProfileDropdown />);
    fireEvent.click(screen.getByTestId("add-profile-btn"));

    const linkedinLink = screen.getByTestId("add-profile-linkedin");
    expect((linkedinLink as HTMLAnchorElement).getAttribute("href")).toBe(
      "/company/social/connections",
    );
  });

  it("clicking a platform item closes the menu", () => {
    render(<AddProfileDropdown />);
    fireEvent.click(screen.getByTestId("add-profile-btn"));
    expect(screen.getByTestId("add-profile-menu")).toBeDefined();

    fireEvent.click(screen.getByTestId("add-profile-linkedin"));
    expect(screen.queryByTestId("add-profile-menu")).toBeNull();
  });
});
