import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as React from "react";
import { AddProfileDropdown } from "@/components/social/dashboard/AddProfileDropdown";

// ---------------------------------------------------------------------------
// Regression test for audit gap C-1 (hardening) / G-3 (original audit).
// ---------------------------------------------------------------------------

describe("AddProfileDropdown (audit gap C-1)", () => {
  it("renders the Add profile trigger with correct testid", () => {
    render(<AddProfileDropdown />);
    expect(screen.getByTestId("add-profile-trigger")).toBeDefined();
  });

  it("menu is hidden before button click", () => {
    render(<AddProfileDropdown />);
    expect(screen.queryByTestId("add-profile-menu")).toBeNull();
  });

  it("menu opens on trigger click and shows all 6 platforms including TikTok", () => {
    render(<AddProfileDropdown />);
    fireEvent.click(screen.getByTestId("add-profile-trigger"));

    expect(screen.getByTestId("add-profile-menu")).toBeDefined();
    expect(screen.getByTestId("add-profile-linkedin")).toBeDefined();
    expect(screen.getByTestId("add-profile-facebook")).toBeDefined();
    expect(screen.getByTestId("add-profile-instagram")).toBeDefined();
    expect(screen.getByTestId("add-profile-x")).toBeDefined();
    expect(screen.getByTestId("add-profile-tiktok")).toBeDefined();
    expect(screen.getByTestId("add-profile-google_business_profile")).toBeDefined();
  });

  it("TikTok item shows a 'New' badge", () => {
    render(<AddProfileDropdown />);
    fireEvent.click(screen.getByTestId("add-profile-trigger"));

    const tiktokItem = screen.getByTestId("add-profile-tiktok");
    expect(tiktokItem.textContent).toContain("New");
  });

  it("each platform item links to per-platform connect URL", () => {
    render(<AddProfileDropdown />);
    fireEvent.click(screen.getByTestId("add-profile-trigger"));

    const linkedinLink = screen.getByTestId("add-profile-linkedin") as HTMLAnchorElement;
    expect(linkedinLink.getAttribute("href")).toBe(
      "/company/social/connections/connect/linkedin",
    );

    const googleLink = screen.getByTestId("add-profile-google_business_profile") as HTMLAnchorElement;
    expect(googleLink.getAttribute("href")).toBe(
      "/company/social/connections/connect/google_business_profile",
    );
  });

  it("clicking a platform item closes the menu", () => {
    render(<AddProfileDropdown />);
    fireEvent.click(screen.getByTestId("add-profile-trigger"));
    expect(screen.getByTestId("add-profile-menu")).toBeDefined();

    fireEvent.click(screen.getByTestId("add-profile-linkedin"));
    expect(screen.queryByTestId("add-profile-menu")).toBeNull();
  });
});
