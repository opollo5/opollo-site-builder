/**
 * Component tests for Phase 3.3 preview cards: Instagram, X, GBP
 */
import { describe, it, expect } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { InstagramPreviewCard } from "@/components/social/preview/InstagramPreviewCard";
import { XPreviewCard } from "@/components/social/preview/XPreviewCard";
import { GoogleBusinessPreviewCard } from "@/components/social/preview/GoogleBusinessPreviewCard";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const IG_PROFILE = { name: "Acme Brand", handle: "acme_brand", avatarUrl: null };
const X_PROFILE = { name: "Acme Corp", handle: "@acmecorp", avatarUrl: null };
const GBP_PROFILE = {
  name: "Acme Store",
  avatarUrl: null,
  category: "Retail",
  address: "123 Main St",
};
const MEDIA = ["https://example.com/image.jpg"];
const CONTENT = "Hello world, this is a test post.";

// ─── InstagramPreviewCard ────────────────────────────────────────────────────

describe("InstagramPreviewCard", () => {
  it("renders card container and handle", () => {
    render(<InstagramPreviewCard profile={IG_PROFILE} content={CONTENT} />);
    expect(screen.getByTestId("ig-preview-card")).toBeInTheDocument();
    expect(screen.getByTestId("ig-preview-name")).toHaveTextContent("acme_brand");
  });

  it("renders avatar with gradient ring fallback", () => {
    render(<InstagramPreviewCard profile={IG_PROFILE} content={CONTENT} />);
    expect(screen.getByTestId("ig-preview-avatar")).toBeInTheDocument();
  });

  it("renders avatar image when avatarUrl provided", () => {
    render(
      <InstagramPreviewCard
        profile={{ ...IG_PROFILE, avatarUrl: "https://example.com/avatar.jpg" }}
        content={CONTENT}
      />,
    );
    const avatarContainer = screen.getByTestId("ig-preview-avatar");
    const img = avatarContainer.querySelector("img") as HTMLImageElement;
    expect(img).toHaveAttribute("src", "https://example.com/avatar.jpg");
  });

  it("shows warning when no media provided", () => {
    render(<InstagramPreviewCard profile={IG_PROFILE} content={CONTENT} />);
    expect(screen.getByTestId("ig-preview-no-image")).toBeInTheDocument();
    expect(screen.queryByTestId("ig-preview-image")).not.toBeInTheDocument();
  });

  it("renders square image when media provided", () => {
    render(<InstagramPreviewCard profile={IG_PROFILE} content={CONTENT} media={MEDIA} />);
    const img = screen.getByTestId("ig-preview-image") as HTMLImageElement;
    expect(img).toHaveAttribute("src", MEDIA[0]);
    expect(img).toHaveClass("aspect-square");
  });

  it("renders action row", () => {
    render(<InstagramPreviewCard profile={IG_PROFILE} content={CONTENT} />);
    expect(screen.getByTestId("ig-preview-actions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /like/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /comment/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });

  it("renders body content with handle prefix", () => {
    render(<InstagramPreviewCard profile={IG_PROFILE} content={CONTENT} />);
    const body = screen.getByTestId("ig-preview-body");
    expect(body).toHaveTextContent("acme_brand");
    expect(body).toHaveTextContent(CONTENT);
  });

  it("shows placeholder when content is empty", () => {
    render(<InstagramPreviewCard profile={IG_PROFILE} content="" />);
    expect(screen.getByTestId("ig-preview-body")).toHaveTextContent("Caption will appear here.");
  });

  it("uses only first media item", () => {
    render(
      <InstagramPreviewCard
        profile={IG_PROFILE}
        content={CONTENT}
        media={[...MEDIA, "https://example.com/second.jpg"]}
      />,
    );
    const img = screen.getByTestId("ig-preview-image") as HTMLImageElement;
    expect(img).toHaveAttribute("src", MEDIA[0]);
  });
});

// ─── XPreviewCard ────────────────────────────────────────────────────────────

describe("XPreviewCard", () => {
  it("renders card container", () => {
    render(<XPreviewCard profile={X_PROFILE} content={CONTENT} />);
    expect(screen.getByTestId("x-preview-card")).toBeInTheDocument();
  });

  it("renders name and handle", () => {
    render(<XPreviewCard profile={X_PROFILE} content={CONTENT} />);
    expect(screen.getByTestId("x-preview-name")).toHaveTextContent("Acme Corp");
    expect(screen.getByTestId("x-preview-handle")).toHaveTextContent("@acmecorp");
  });

  it("normalises handle — prepends @ if missing", () => {
    render(<XPreviewCard profile={{ ...X_PROFILE, handle: "acmecorp" }} content={CONTENT} />);
    expect(screen.getByTestId("x-preview-handle")).toHaveTextContent("@acmecorp");
  });

  it("derives handle from name when not supplied", () => {
    render(<XPreviewCard profile={{ name: "Acme Corp" }} content={CONTENT} />);
    expect(screen.getByTestId("x-preview-handle")).toHaveTextContent("@acmecorp");
  });

  it("renders avatar image when provided", () => {
    render(
      <XPreviewCard
        profile={{ ...X_PROFILE, avatarUrl: "https://example.com/av.jpg" }}
        content={CONTENT}
      />,
    );
    const avatarContainer = screen.getByTestId("x-preview-avatar");
    const img = avatarContainer.querySelector("img") as HTMLImageElement;
    expect(img).toHaveAttribute("src", "https://example.com/av.jpg");
  });

  it("renders body content", () => {
    render(<XPreviewCard profile={X_PROFILE} content={CONTENT} />);
    expect(screen.getByTestId("x-preview-body")).toHaveTextContent(CONTENT);
  });

  it("shows placeholder when content is empty", () => {
    render(<XPreviewCard profile={X_PROFILE} content="" />);
    expect(screen.getByTestId("x-preview-body")).toHaveTextContent("Your post content will appear here.");
  });

  it("truncates content beyond 280 chars", () => {
    const long = "a".repeat(300);
    render(<XPreviewCard profile={X_PROFILE} content={long} />);
    const body = screen.getByTestId("x-preview-body");
    expect(body.textContent).toHaveLength(281); // 280 chars + "…" (U+2026, 1 char)
  });

  it("shows char counter — within limit", () => {
    render(<XPreviewCard profile={X_PROFILE} content={CONTENT} />);
    const counter = screen.getByTestId("x-preview-char-count");
    expect(counter).toHaveTextContent(`${CONTENT.length}/280`);
    expect(counter).not.toHaveClass("text-red-500");
  });

  it("shows char counter in red when over limit", () => {
    const long = "a".repeat(290);
    render(<XPreviewCard profile={X_PROFILE} content={long} />);
    const counter = screen.getByTestId("x-preview-char-count");
    expect(counter).toHaveClass("text-red-500");
    expect(counter).toHaveTextContent("290/280");
  });

  it("renders 16:9 image when media provided", () => {
    render(<XPreviewCard profile={X_PROFILE} content={CONTENT} media={MEDIA} />);
    const container = screen.getByTestId("x-preview-image");
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img).toHaveAttribute("src", MEDIA[0]);
    expect(img).toHaveClass("aspect-[16/9]");
  });

  it("renders 5-action row", () => {
    render(<XPreviewCard profile={X_PROFILE} content={CONTENT} />);
    expect(screen.getByTestId("x-preview-actions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reply/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /repost/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /like/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /views/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /bookmark/i })).toBeInTheDocument();
  });
});

// ─── GoogleBusinessPreviewCard ───────────────────────────────────────────────

describe("GoogleBusinessPreviewCard", () => {
  it("renders card container", () => {
    render(<GoogleBusinessPreviewCard profile={GBP_PROFILE} content={CONTENT} />);
    expect(screen.getByTestId("gbp-preview-card")).toBeInTheDocument();
  });

  it("renders business name", () => {
    render(<GoogleBusinessPreviewCard profile={GBP_PROFILE} content={CONTENT} />);
    expect(screen.getByTestId("gbp-preview-name")).toHaveTextContent("Acme Store");
  });

  it("renders category and address in subtitle", () => {
    render(<GoogleBusinessPreviewCard profile={GBP_PROFILE} content={CONTENT} />);
    const card = screen.getByTestId("gbp-preview-card");
    expect(card).toHaveTextContent("Retail · 123 Main St");
  });

  it("renders only category when address omitted", () => {
    render(
      <GoogleBusinessPreviewCard
        profile={{ name: "Store", category: "Retail" }}
        content={CONTENT}
      />,
    );
    const card = screen.getByTestId("gbp-preview-card");
    expect(card).toHaveTextContent("Retail");
    expect(card).not.toHaveTextContent("·");
  });

  it("renders avatar fallback with first letter of name", () => {
    render(<GoogleBusinessPreviewCard profile={GBP_PROFILE} content={CONTENT} />);
    expect(screen.getByTestId("gbp-preview-avatar")).toHaveTextContent("A");
  });

  it("renders avatar image when avatarUrl provided", () => {
    render(
      <GoogleBusinessPreviewCard
        profile={{ ...GBP_PROFILE, avatarUrl: "https://example.com/biz.jpg" }}
        content={CONTENT}
      />,
    );
    const avatarContainer = screen.getByTestId("gbp-preview-avatar");
    const img = avatarContainer.querySelector("img") as HTMLImageElement;
    expect(img).toHaveAttribute("src", "https://example.com/biz.jpg");
  });

  it("renders body content", () => {
    render(<GoogleBusinessPreviewCard profile={GBP_PROFILE} content={CONTENT} />);
    expect(screen.getByTestId("gbp-preview-body")).toHaveTextContent(CONTENT);
  });

  it("shows placeholder when content is empty", () => {
    render(<GoogleBusinessPreviewCard profile={GBP_PROFILE} content="" />);
    expect(screen.getByTestId("gbp-preview-body")).toHaveTextContent(
      "Your post content will appear here.",
    );
  });

  it("renders 1.91:1 image when media provided", () => {
    render(<GoogleBusinessPreviewCard profile={GBP_PROFILE} content={CONTENT} media={MEDIA} />);
    const container = screen.getByTestId("gbp-preview-image");
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img).toHaveAttribute("src", MEDIA[0]);
    expect(img).toHaveClass("aspect-[1.91/1]");
  });

  it("omits image section when no media", () => {
    render(<GoogleBusinessPreviewCard profile={GBP_PROFILE} content={CONTENT} />);
    expect(screen.queryByTestId("gbp-preview-image")).not.toBeInTheDocument();
  });

  it("renders CTA button with default label", () => {
    render(<GoogleBusinessPreviewCard profile={GBP_PROFILE} content={CONTENT} />);
    expect(screen.getByTestId("gbp-preview-cta")).toHaveTextContent("Learn more");
  });

  it("renders CTA button with custom label", () => {
    render(
      <GoogleBusinessPreviewCard
        profile={GBP_PROFILE}
        content={CONTENT}
        ctaLabel="Book now"
      />,
    );
    expect(screen.getByTestId("gbp-preview-cta")).toHaveTextContent("Book now");
  });
});
