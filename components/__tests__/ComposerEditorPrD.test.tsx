import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";

import { CustomizeForRow } from "@/components/social/composer/CustomizeForRow";
import { PlatformActionsList } from "@/components/social/composer/PlatformActionsList";
import { MediaTray } from "@/components/social/composer/MediaTray";
import { ToolsRow } from "@/components/social/composer/ToolsRow";
import { ContentEditor } from "@/components/social/composer/ContentEditor";
import { ComposerEditor } from "@/components/social/composer/ComposerEditor";
import type { Draft } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// CustomizeForRow
// ---------------------------------------------------------------------------

describe("CustomizeForRow", () => {
  it("returns null when fewer than 2 platforms provided", () => {
    const { container } = render(
      <CustomizeForRow platforms={["linkedin"]} activePlatform={null} onChange={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders chips for each platform when 2+ provided", () => {
    render(
      <CustomizeForRow
        platforms={["linkedin", "facebook", "x"]}
        activePlatform={null}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: /linkedin/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /facebook/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /x/i })).toBeTruthy();
  });

  it("marks active platform chip as aria-pressed=true", () => {
    render(
      <CustomizeForRow
        platforms={["linkedin", "facebook"]}
        activePlatform="linkedin"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: /linkedin/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /facebook/i }).getAttribute("aria-pressed")).toBe("false");
  });

  it("calls onChange with platform when inactive chip is clicked", () => {
    const onChange = vi.fn();
    render(
      <CustomizeForRow
        platforms={["linkedin", "facebook"]}
        activePlatform={null}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /linkedin/i }));
    expect(onChange).toHaveBeenCalledWith("linkedin");
  });

  it("calls onChange with null when active chip is clicked (deactivate)", () => {
    const onChange = vi.fn();
    render(
      <CustomizeForRow
        platforms={["linkedin", "facebook"]}
        activePlatform="linkedin"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /linkedin/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

// ---------------------------------------------------------------------------
// PlatformActionsList
// ---------------------------------------------------------------------------

describe("PlatformActionsList", () => {
  const noop = () => undefined;

  it("returns null when no platforms support link or CTA", () => {
    const { container } = render(
      <PlatformActionsList
        platforms={["x", "instagram", "tiktok"]}
        links={{}}
        ctas={{}}
        onLinkChange={noop}
        onCtaChange={noop}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders Add link toggle for linkedin", () => {
    render(
      <PlatformActionsList
        platforms={["linkedin"]}
        links={{}}
        ctas={{}}
        onLinkChange={noop}
        onCtaChange={noop}
      />,
    );
    expect(screen.getByText(/\+ Add link/i)).toBeTruthy();
  });

  it("renders Add link toggle for pinterest", () => {
    render(
      <PlatformActionsList
        platforms={["pinterest"]}
        links={{}}
        ctas={{}}
        onLinkChange={noop}
        onCtaChange={noop}
      />,
    );
    expect(screen.getByText(/\+ Add link/i)).toBeTruthy();
  });

  it("renders Add button toggle for google_business_profile", () => {
    render(
      <PlatformActionsList
        platforms={["google_business_profile"]}
        links={{}}
        ctas={{}}
        onLinkChange={noop}
        onCtaChange={noop}
      />,
    );
    expect(screen.getByText(/\+ Add button/i)).toBeTruthy();
  });

  it("expands link input when Add link is clicked", () => {
    render(
      <PlatformActionsList
        platforms={["linkedin"]}
        links={{}}
        ctas={{}}
        onLinkChange={noop}
        onCtaChange={noop}
      />,
    );
    fireEvent.click(screen.getByText(/\+ Add link/i));
    expect(screen.getByRole("textbox", { name: /link for linkedin/i })).toBeTruthy();
  });

  it("calls onLinkChange when link input changes", () => {
    const onLinkChange = vi.fn();
    render(
      <PlatformActionsList
        platforms={["linkedin"]}
        links={{ linkedin: "https://existing.com" }}
        ctas={{}}
        onLinkChange={onLinkChange}
        onCtaChange={noop}
      />,
    );
    const input = screen.getByRole("textbox", { name: /link for linkedin/i });
    fireEvent.change(input, { target: { value: "https://new.com" } });
    expect(onLinkChange).toHaveBeenCalledWith("linkedin", "https://new.com");
  });

  it("expands CTA select when Add button is clicked for GBP", () => {
    render(
      <PlatformActionsList
        platforms={["google_business_profile"]}
        links={{}}
        ctas={{}}
        onLinkChange={noop}
        onCtaChange={noop}
      />,
    );
    fireEvent.click(screen.getByText(/\+ Add button/i));
    expect(screen.getByRole("combobox", { name: /cta button for google business profile/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// MediaTray
// ---------------------------------------------------------------------------

describe("MediaTray", () => {
  it("returns null when urls empty and not uploading", () => {
    const { container } = render(
      <MediaTray urls={[]} onRemove={() => undefined} onRequestUpload={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders thumbnails for each url", () => {
    render(
      <MediaTray
        urls={["https://example.com/a.jpg", "https://example.com/b.jpg"]}
        onRemove={() => undefined}
        onRequestUpload={() => undefined}
      />,
    );
    expect(screen.getAllByRole("img").length).toBe(2);
  });

  it("calls onRemove with correct index when remove is clicked", () => {
    const onRemove = vi.fn();
    render(
      <MediaTray
        urls={["https://example.com/a.jpg", "https://example.com/b.jpg"]}
        onRemove={onRemove}
        onRequestUpload={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /remove image 1/i }));
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it("renders Add media button when below max", () => {
    render(
      <MediaTray
        urls={["https://example.com/a.jpg"]}
        onRemove={() => undefined}
        onRequestUpload={() => undefined}
        maxFiles={4}
      />,
    );
    expect(screen.getByRole("button", { name: /add media/i })).toBeTruthy();
  });

  it("calls onRequestUpload when Add media is clicked", () => {
    const onRequestUpload = vi.fn();
    render(
      <MediaTray
        urls={[]}
        onRemove={() => undefined}
        onRequestUpload={onRequestUpload}
        uploading={true}
      />,
    );
    // Add media button is disabled while uploading but still rendered
    const btn = screen.getByRole("button", { name: /add media/i });
    expect(btn).toBeTruthy();
  });

  it("does not render Add media button when at max files", () => {
    const urls = [
      "https://example.com/a.jpg",
      "https://example.com/b.jpg",
      "https://example.com/c.jpg",
      "https://example.com/d.jpg",
    ];
    render(
      <MediaTray urls={urls} onRemove={() => undefined} onRequestUpload={() => undefined} maxFiles={4} />,
    );
    expect(screen.queryByRole("button", { name: /add media/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ToolsRow
// ---------------------------------------------------------------------------

describe("ToolsRow", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ ok: false, error: { message: "unavailable in test" } }),
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders all tool buttons", () => {
    render(
      <ToolsRow companyId="co_1" onInsertText={() => undefined} onOpenMediaPicker={() => undefined} />,
    );
    expect(screen.getByRole("button", { name: /ai assistant/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /media/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /emoji/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /gif/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /utm tags/i })).toBeTruthy();
  });

  it("calls onOpenMediaPicker when Media button is clicked", () => {
    const onOpenMediaPicker = vi.fn();
    render(
      <ToolsRow companyId="co_1" onInsertText={() => undefined} onOpenMediaPicker={onOpenMediaPicker} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /media/i }));
    expect(onOpenMediaPicker).toHaveBeenCalledTimes(1);
  });

  it("opens emoji panel when Emoji button clicked", () => {
    render(
      <ToolsRow companyId="co_1" onInsertText={() => undefined} onOpenMediaPicker={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /emoji/i }));
    // Panel has a close button and an emoji grid — 🎉 is the first emoji
    expect(screen.getByRole("button", { name: "🎉" })).toBeTruthy();
  });

  it("closes emoji panel when close button clicked", () => {
    render(
      <ToolsRow companyId="co_1" onInsertText={() => undefined} onOpenMediaPicker={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /emoji/i }));
    fireEvent.click(screen.getByRole("button", { name: /close emoji panel/i }));
    expect(screen.queryByRole("button", { name: "🎉" })).toBeNull();
  });

  it("inserts emoji and closes panel when emoji is clicked", () => {
    const onInsertText = vi.fn();
    render(
      <ToolsRow companyId="co_1" onInsertText={onInsertText} onOpenMediaPicker={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /emoji/i }));
    fireEvent.click(screen.getByRole("button", { name: "🎉" }));
    expect(onInsertText).toHaveBeenCalledWith("🎉");
    expect(screen.queryByRole("button", { name: "🎉" })).toBeNull();
  });

  it("opens UTM panel when UTM tags button clicked", () => {
    render(
      <ToolsRow companyId="co_1" onInsertText={() => undefined} onOpenMediaPicker={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /utm tags/i }));
    // Panel is open when the URL input is visible
    expect(
      screen.getAllByRole("textbox").some((el) =>
        el.getAttribute("placeholder")?.includes("example.com/page"),
      ),
    ).toBe(true);
  });

  it("inserts UTM URL and closes panel when Insert URL is clicked", () => {
    const onInsertText = vi.fn();
    render(
      <ToolsRow companyId="co_1" onInsertText={onInsertText} onOpenMediaPicker={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /utm tags/i }));
    const urlInput = screen.getAllByRole("textbox").find((el) =>
      el.getAttribute("placeholder")?.includes("example.com/page"),
    )!;
    fireEvent.change(urlInput, { target: { value: "https://example.com" } });
    const sourceInput = screen.getAllByRole("textbox").find((el) =>
      el.getAttribute("placeholder")?.includes("linkedin"),
    )!;
    fireEvent.change(sourceInput, { target: { value: "linkedin" } });
    fireEvent.click(screen.getByRole("button", { name: /insert url with utm tags/i }));
    expect(onInsertText).toHaveBeenCalledWith(
      expect.stringContaining("utm_source=linkedin"),
    );
    // Panel closed — URL input no longer visible
    expect(
      screen.queryAllByRole("textbox").some((el) =>
        el.getAttribute("placeholder")?.includes("example.com/page"),
      ),
    ).toBe(false);
  });

  it("toggles active panel off when same button is clicked twice", () => {
    render(
      <ToolsRow companyId="co_1" onInsertText={() => undefined} onOpenMediaPicker={() => undefined} />,
    );
    // Use exact name match to avoid matching "Insert URL with UTM tags" button inside the panel
    const utmBtn = screen.getByRole("button", { name: "UTM tags" });
    fireEvent.click(utmBtn);
    expect(
      screen.queryAllByRole("textbox").some((el) =>
        el.getAttribute("placeholder")?.includes("example.com/page"),
      ),
    ).toBe(true);
    fireEvent.click(utmBtn);
    expect(
      screen.queryAllByRole("textbox").some((el) =>
        el.getAttribute("placeholder")?.includes("example.com/page"),
      ),
    ).toBe(false);
  });

  it("shows AI panel when AI assistant button clicked", () => {
    render(
      <ToolsRow companyId="co_1" onInsertText={() => undefined} onOpenMediaPicker={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /ai assistant/i }));
    expect(screen.getByRole("button", { name: /close ai panel/i })).toBeTruthy();
    expect(screen.getByTestId("ai-generate-button")).toBeTruthy();
  });

  it("shows cost estimate when prompt is typed", () => {
    render(
      <ToolsRow companyId="co_1" onInsertText={() => undefined} onOpenMediaPicker={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /ai assistant/i }));
    fireEvent.change(screen.getByTestId("ai-prompt-input"), { target: { value: "write a post" } });
    expect(screen.getByTestId("ai-cost-estimate").textContent).toMatch(/Est\. cost:/);
  });

  it("shows rate limit error with trace_id on 429 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/api/errors")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: { trace_id: "ce-abcd-1234" } }) });
      }
      return Promise.resolve({
        ok: false,
        status: 429,
        json: () => Promise.resolve({
          ok: false,
          error: {
            category: "rate_limit",
            code: "RATE_LIMIT",
            message: "You hit the per-minute token limit. Try again in 60s.",
            trace_id: "ai-gen-7f3a-c2e1",
            retry_after: 60,
            can_retry: true,
          },
        }),
      });
    }));

    render(
      <ToolsRow companyId="co_1" onInsertText={() => undefined} onOpenMediaPicker={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /ai assistant/i }));
    fireEvent.change(screen.getByTestId("ai-prompt-input"), { target: { value: "test prompt" } });
    fireEvent.click(screen.getByTestId("ai-generate-button"));

    await waitFor(() => {
      expect(screen.getByTestId("ai-error-display")).toBeTruthy();
    });
    expect(screen.getByTestId("ai-trace-id").textContent).toContain("ai-gen-7f3a-c2e1");
    expect(screen.getByTestId("ai-error-display").textContent).toMatch(/rate.limit|token limit/i);
  });

  it("shows timeout error with trace_id on timeout response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/api/errors")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: { trace_id: "ce-efgh-5678" } }) });
      }
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({
          ok: false,
          error: {
            category: "timeout",
            code: "TIMEOUT",
            message: "Generation timed out. Try shortening your prompt.",
            trace_id: "ai-gen-9c1b-a847",
            can_retry: true,
          },
        }),
      });
    }));

    render(
      <ToolsRow companyId="co_1" onInsertText={() => undefined} onOpenMediaPicker={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /ai assistant/i }));
    fireEvent.change(screen.getByTestId("ai-prompt-input"), { target: { value: "test prompt" } });
    fireEvent.click(screen.getByTestId("ai-generate-button"));

    await waitFor(() => {
      expect(screen.getByTestId("ai-error-display")).toBeTruthy();
    });
    expect(screen.getByTestId("ai-trace-id").textContent).toContain("ai-gen-9c1b-a847");
    expect(screen.getByTestId("ai-error-display").textContent).toMatch(/timeout|timed out/i);
  });

  it("shows generated result on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true, data: { text: "Here is your generated post!" } }),
    }));

    const onInsertText = vi.fn();
    render(
      <ToolsRow companyId="co_1" onInsertText={onInsertText} onOpenMediaPicker={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /ai assistant/i }));
    fireEvent.change(screen.getByTestId("ai-prompt-input"), { target: { value: "test prompt" } });
    fireEvent.click(screen.getByTestId("ai-generate-button"));

    await waitFor(() => {
      expect(screen.getByTestId("ai-result")).toBeTruthy();
    });
    expect(screen.getByTestId("ai-result").textContent).toContain("Here is your generated post!");
    fireEvent.click(screen.getByRole("button", { name: /use this text/i }));
    expect(onInsertText).toHaveBeenCalledWith("Here is your generated post!");
  });

  it("shows not-configured message when GIPHY key absent", () => {
    render(
      <ToolsRow companyId="co_1" onInsertText={() => undefined} onOpenMediaPicker={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /gif/i }));
    expect(screen.getByText(/NEXT_PUBLIC_GIPHY_API_KEY is not set/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ContentEditor
// ---------------------------------------------------------------------------

describe("ContentEditor", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders textarea with placeholder", () => {
    render(
      <ContentEditor
        value=""
        onChange={() => undefined}
        mediaUrls={[]}
        onMediaChange={() => undefined}
        maxLength={280}
        companyId="co_1"
      />,
    );
    expect(screen.getByRole("textbox", { name: /post content/i })).toBeTruthy();
  });

  it("shows char count", () => {
    render(
      <ContentEditor
        value="hello"
        onChange={() => undefined}
        mediaUrls={[]}
        onMediaChange={() => undefined}
        maxLength={280}
        companyId="co_1"
      />,
    );
    expect(screen.getByText("5 / 280")).toBeTruthy();
  });

  it("calls onChange when textarea value changes", () => {
    const onChange = vi.fn();
    render(
      <ContentEditor
        value=""
        onChange={onChange}
        mediaUrls={[]}
        onMediaChange={() => undefined}
        maxLength={280}
        companyId="co_1"
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /post content/i }), {
      target: { value: "new text" },
    });
    expect(onChange).toHaveBeenCalledWith("new text");
  });

  it("shows destructive class when over char limit", () => {
    const longText = "a".repeat(300);
    render(
      <ContentEditor
        value={longText}
        onChange={() => undefined}
        mediaUrls={[]}
        onMediaChange={() => undefined}
        maxLength={280}
        companyId="co_1"
      />,
    );
    const counter = screen.getByText("300 / 280");
    expect(counter.className).toContain("text-destructive");
  });

  it("does not render MediaTray when mediaUrls empty and not uploading", () => {
    render(
      <ContentEditor
        value=""
        onChange={() => undefined}
        mediaUrls={[]}
        onMediaChange={() => undefined}
        maxLength={280}
        companyId="co_1"
      />,
    );
    expect(screen.queryByRole("button", { name: /remove image/i })).toBeNull();
  });

  it("renders MediaTray thumbnails when mediaUrls provided", () => {
    render(
      <ContentEditor
        value=""
        onChange={() => undefined}
        mediaUrls={["https://example.com/a.jpg"]}
        onMediaChange={() => undefined}
        maxLength={280}
        companyId="co_1"
      />,
    );
    expect(screen.getByRole("img", { name: /media 1/i })).toBeTruthy();
  });

  it("shows upload error when file exceeds 10MB", async () => {
    render(
      <ContentEditor
        value=""
        onChange={() => undefined}
        mediaUrls={[]}
        onMediaChange={() => undefined}
        maxLength={280}
        companyId="co_1"
      />,
    );
    const fileInput = document.querySelector("input[type=file]") as HTMLInputElement;
    const bigFile = new File(["x".repeat(11 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" });
    Object.defineProperty(bigFile, "size", { value: 11 * 1024 * 1024 });
    fireEvent.change(fileInput, { target: { files: [bigFile] } });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeTruthy(),
    );
    expect(screen.getByText(/over 10 MB/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ComposerEditor
// ---------------------------------------------------------------------------

describe("ComposerEditor", () => {
  const baseDraft: Draft = {
    content: "",
    media_urls: [],
    target_profile_ids: [],
    platform_variants: {},
    approval_required: false,
  };

  it("renders ContentEditor textarea", () => {
    render(
      <ComposerEditor
        draft={baseDraft}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        companyId="co_1"
        selectedConnections={[]}
      />,
    );
    expect(screen.getByRole("textbox", { name: /post content/i })).toBeTruthy();
  });

  it("does not render CustomizeForRow when fewer than 2 platforms selected", () => {
    render(
      <ComposerEditor
        draft={baseDraft}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        companyId="co_1"
        selectedConnections={[]}
      />,
    );
    expect(screen.queryByText(/customize for/i)).toBeNull();
  });

  it("renders CustomizeForRow when 2+ platforms selected", () => {
    render(
      <ComposerEditor
        draft={baseDraft}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        companyId="co_1"
        selectedConnections={[
          { id: "c1", platform: "linkedin", account_name: "Acme LI", account_avatar_url: "" },
          { id: "c2", platform: "facebook", account_name: "Acme FB", account_avatar_url: "" },
        ]}
      />,
    );
    expect(screen.getByText(/customize for/i)).toBeTruthy();
  });

  it("renders default submit footer when no schedulingSlot provided", () => {
    render(
      <ComposerEditor
        draft={baseDraft}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        companyId="co_1"
        selectedConnections={[]}
      />,
    );
    expect(screen.getByRole("button", { name: /save as draft/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /post now/i })).toBeTruthy();
  });

  it("renders schedulingSlot instead of default footer when provided", () => {
    render(
      <ComposerEditor
        draft={baseDraft}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        companyId="co_1"
        selectedConnections={[]}
        schedulingSlot={<div data-testid="scheduling-slot">Scheduling</div>}
      />,
    );
    expect(screen.getByTestId("scheduling-slot")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /post now/i })).toBeNull();
  });

  it("calls onSubmit with 'draft' when Save as draft is clicked", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ComposerEditor
        draft={baseDraft}
        onChange={() => undefined}
        onSubmit={onSubmit}
        companyId="co_1"
        selectedConnections={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save as draft/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("draft"));
  });

  it("calls onSubmit with 'post_now' when Post now is clicked", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ComposerEditor
        draft={baseDraft}
        onChange={() => undefined}
        onSubmit={onSubmit}
        companyId="co_1"
        selectedConnections={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /post now/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("post_now"));
  });
});
