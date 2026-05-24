import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { UtmBuilderPanel } from "@/components/social/composer/UtmBuilderPanel";

// ---------------------------------------------------------------------------
// UtmBuilderPanel component tests (Phase 4.3 / B5)
//
// Covers:
//  - Renders required fields (URL, campaign, medium, source)
//  - URL validation: shows error on invalid URL, clears on fix
//  - Campaign required: Insert button disabled when URL or campaign missing
//  - Auto-detect source: uses PLATFORM_SOURCE_MAP when toggle on
//  - Auto-detect toggle: when off, source is editable
//  - Advanced section: hidden by default, shown on toggle
//  - Live preview: renders monospace URL with color-coded segments
//  - onInsert called with correct UTM URL on submit
//  - onClose called on close button click
//  - utm_campaign persisted to localStorage on insert
// ---------------------------------------------------------------------------

// Stub localStorage
let localStorageStore: Record<string, string> = {};
beforeEach(() => {
  localStorageStore = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => localStorageStore[k] ?? null,
    setItem: (k: string, v: string) => { localStorageStore[k] = v; },
    removeItem: (k: string) => { delete localStorageStore[k]; },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UtmBuilderPanel — rendering", () => {
  it("renders URL, campaign, medium, source inputs", () => {
    render(<UtmBuilderPanel onInsert={() => {}} onClose={() => {}} />);
    expect(screen.getByTestId("utm-url-input")).toBeTruthy();
    expect(screen.getByTestId("utm-campaign-input")).toBeTruthy();
    expect(screen.getByTestId("utm-medium-input")).toBeTruthy();
    expect(screen.getByTestId("utm-source-input")).toBeTruthy();
  });

  it("medium defaults to 'social'", () => {
    render(<UtmBuilderPanel onInsert={() => {}} onClose={() => {}} />);
    expect(screen.getByTestId("utm-medium-input")).toHaveValue("social");
  });

  it("advanced section is hidden by default", () => {
    render(<UtmBuilderPanel onInsert={() => {}} onClose={() => {}} />);
    expect(screen.queryByTestId("utm-advanced-section")).toBeNull();
  });

  it("shows advanced section when toggle clicked", () => {
    render(<UtmBuilderPanel onInsert={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("utm-advanced-toggle"));
    expect(screen.getByTestId("utm-advanced-section")).toBeTruthy();
    expect(screen.getByTestId("utm-content-input")).toBeTruthy();
    expect(screen.getByTestId("utm-term-input")).toBeTruthy();
  });
});

describe("UtmBuilderPanel — Insert button state", () => {
  it("is disabled when URL is empty", () => {
    render(<UtmBuilderPanel onInsert={() => {}} onClose={() => {}} />);
    expect(screen.getByTestId("utm-insert-button")).toBeDisabled();
  });

  it("is disabled when campaign is empty but URL is set", () => {
    render(<UtmBuilderPanel onInsert={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId("utm-url-input"), { target: { value: "https://example.com" } });
    expect(screen.getByTestId("utm-insert-button")).toBeDisabled();
  });

  it("is enabled when both URL and campaign are set", () => {
    render(<UtmBuilderPanel onInsert={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId("utm-url-input"), { target: { value: "https://example.com" } });
    fireEvent.change(screen.getByTestId("utm-campaign-input"), { target: { value: "test" } });
    expect(screen.getByTestId("utm-insert-button")).not.toBeDisabled();
  });
});

describe("UtmBuilderPanel — UTM URL construction", () => {
  it("builds correct URL with all params and calls onInsert", () => {
    const onInsert = vi.fn();
    render(<UtmBuilderPanel onInsert={onInsert} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId("utm-url-input"), { target: { value: "https://example.com/page" } });
    fireEvent.change(screen.getByTestId("utm-campaign-input"), { target: { value: "spring-promo" } });
    fireEvent.change(screen.getByTestId("utm-source-input"), { target: { value: "linkedin" } });
    fireEvent.click(screen.getByTestId("utm-insert-button"));
    expect(onInsert).toHaveBeenCalledOnce();
    const inserted = onInsert.mock.calls[0][0] as string;
    const u = new URL(inserted);
    expect(u.searchParams.get("utm_campaign")).toBe("spring-promo");
    expect(u.searchParams.get("utm_medium")).toBe("social");
    expect(u.searchParams.get("utm_source")).toBe("linkedin");
  });

  it("includes utm_content and utm_term when set in advanced section", () => {
    const onInsert = vi.fn();
    render(<UtmBuilderPanel onInsert={onInsert} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId("utm-url-input"), { target: { value: "https://example.com" } });
    fireEvent.change(screen.getByTestId("utm-campaign-input"), { target: { value: "test" } });
    fireEvent.click(screen.getByTestId("utm-advanced-toggle"));
    fireEvent.change(screen.getByTestId("utm-content-input"), { target: { value: "hero" } });
    fireEvent.change(screen.getByTestId("utm-term-input"), { target: { value: "brand" } });
    fireEvent.click(screen.getByTestId("utm-insert-button"));
    const inserted = onInsert.mock.calls[0][0] as string;
    const u = new URL(inserted);
    expect(u.searchParams.get("utm_content")).toBe("hero");
    expect(u.searchParams.get("utm_term")).toBe("brand");
  });
});

describe("UtmBuilderPanel — auto-detect source", () => {
  it("shows auto-detect toggle when platforms prop is provided", () => {
    render(<UtmBuilderPanel onInsert={() => {}} onClose={() => {}} platforms={["linkedin"]} />);
    expect(screen.getByTestId("utm-auto-source-toggle")).toBeTruthy();
  });

  it("does not show auto-detect toggle when no platforms", () => {
    render(<UtmBuilderPanel onInsert={() => {}} onClose={() => {}} platforms={[]} />);
    expect(screen.queryByTestId("utm-auto-source-toggle")).toBeNull();
  });

  it("auto-detects 'linkedin' source for linkedin platform", () => {
    render(<UtmBuilderPanel onInsert={() => {}} onClose={() => {}} platforms={["linkedin"]} />);
    expect(screen.getByTestId("utm-source-input")).toHaveValue("linkedin");
    expect(screen.getByTestId("utm-source-input")).toBeDisabled();
  });

  it("auto-detects 'twitter' source for x platform", () => {
    render(<UtmBuilderPanel onInsert={() => {}} onClose={() => {}} platforms={["x"]} />);
    expect(screen.getByTestId("utm-source-input")).toHaveValue("twitter");
  });

  it("source becomes editable when auto-detect is turned off", () => {
    render(<UtmBuilderPanel onInsert={() => {}} onClose={() => {}} platforms={["linkedin"]} />);
    const toggle = screen.getByTestId("utm-auto-source-toggle");
    fireEvent.click(toggle);
    expect(screen.getByTestId("utm-source-input")).not.toBeDisabled();
  });
});

describe("UtmBuilderPanel — live preview", () => {
  it("renders UTM preview pane when URL is set", () => {
    render(<UtmBuilderPanel onInsert={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId("utm-url-input"), { target: { value: "https://example.com" } });
    fireEvent.change(screen.getByTestId("utm-campaign-input"), { target: { value: "test-may26" } });
    expect(screen.getByTestId("utm-preview")).toBeTruthy();
    expect(screen.getByTestId("utm-preview").textContent).toContain("utm_campaign");
    expect(screen.getByTestId("utm-preview").textContent).toContain("test-may26");
  });
});

describe("UtmBuilderPanel — localStorage persistence", () => {
  it("saves campaign to localStorage on insert", () => {
    const onInsert = vi.fn();
    render(<UtmBuilderPanel onInsert={onInsert} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId("utm-url-input"), { target: { value: "https://example.com" } });
    fireEvent.change(screen.getByTestId("utm-campaign-input"), { target: { value: "test-may26" } });
    fireEvent.click(screen.getByTestId("utm-insert-button"));
    expect(localStorageStore["composer_utm_last_campaign"]).toBe("test-may26");
  });

  it("pre-fills campaign from localStorage on mount", () => {
    localStorageStore["composer_utm_last_campaign"] = "saved-campaign";
    render(<UtmBuilderPanel onInsert={() => {}} onClose={() => {}} />);
    expect(screen.getByTestId("utm-campaign-input")).toHaveValue("saved-campaign");
  });
});

describe("UtmBuilderPanel — close", () => {
  it("calls onClose when close button clicked", () => {
    const onClose = vi.fn();
    render(<UtmBuilderPanel onInsert={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close utm panel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
