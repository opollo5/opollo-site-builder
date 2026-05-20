import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import * as React from "react";

import { LinkedInPreviewCard } from "@/components/social/preview/LinkedInPreviewCard";
import { FacebookPreviewCard } from "@/components/social/preview/FacebookPreviewCard";

// ---------------------------------------------------------------------------
// Component tests — Phase 3.2 / B3 — LinkedIn + Facebook preview cards
// ---------------------------------------------------------------------------

const LI_PROFILE = { name: "Acme Corp", headline: "Marketing Director at Acme" };
const FB_PROFILE = { name: "Acme Facebook Page" };
const SAMPLE_CONTENT = "Hello world — this is a test post.";
const MEDIA = ["https://example.com/image.jpg"];

describe("LinkedInPreviewCard", () => {
  it("renders name and body text", () => {
    render(<LinkedInPreviewCard profile={LI_PROFILE} content={SAMPLE_CONTENT} />);
    expect(screen.getByTestId("li-preview-name")).toHaveTextContent("Acme Corp");
    expect(screen.getByTestId("li-preview-body")).toHaveTextContent(SAMPLE_CONTENT);
  });

  it("renders headline when provided", () => {
    render(<LinkedInPreviewCard profile={LI_PROFILE} content={SAMPLE_CONTENT} />);
    expect(screen.getByTestId("li-preview-headline")).toHaveTextContent(
      "Marketing Director at Acme",
    );
  });

  it("does not render headline when omitted", () => {
    render(<LinkedInPreviewCard profile={{ name: "Acme" }} content={SAMPLE_CONTENT} />);
    expect(screen.queryByTestId("li-preview-headline")).toBeNull();
  });

  it("renders avatar initials fallback when no avatarUrl", () => {
    render(<LinkedInPreviewCard profile={LI_PROFILE} content={SAMPLE_CONTENT} />);
    const avatar = screen.getByTestId("li-preview-avatar");
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveTextContent("AC");
  });

  it("renders image at 1.91:1 aspect when media provided", () => {
    render(
      <LinkedInPreviewCard profile={LI_PROFILE} content={SAMPLE_CONTENT} media={MEDIA} />,
    );
    const container = screen.getByTestId("li-preview-image");
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img).toHaveAttribute("src", MEDIA[0]);
    expect(img.className).toContain("aspect-[1.91/1]");
  });

  it("renders action row with Like, Comment, Repost, Send", () => {
    render(<LinkedInPreviewCard profile={LI_PROFILE} content={SAMPLE_CONTENT} />);
    expect(screen.getByRole("button", { name: "Like" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Comment" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repost" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("renders reaction row", () => {
    render(<LinkedInPreviewCard profile={LI_PROFILE} content={SAMPLE_CONTENT} />);
    expect(screen.getByTestId("li-preview-reactions")).toBeInTheDocument();
  });

  it("shows see-more button when content exceeds 210 chars", () => {
    const longContent = "x".repeat(220);
    render(<LinkedInPreviewCard profile={LI_PROFILE} content={longContent} />);
    const btn = screen.getByRole("button", { name: /see more/i });
    expect(btn).toBeInTheDocument();
    // Click expands
    fireEvent.click(btn);
    expect(screen.getByTestId("li-preview-body")).toHaveTextContent(longContent);
    expect(screen.getByRole("button", { name: /see less/i })).toBeInTheDocument();
  });

  it("does not show see-more when content is short", () => {
    render(<LinkedInPreviewCard profile={LI_PROFILE} content={SAMPLE_CONTENT} />);
    expect(screen.queryByRole("button", { name: /see more/i })).toBeNull();
  });

  it("shows placeholder when content is empty", () => {
    render(<LinkedInPreviewCard profile={LI_PROFILE} content="" />);
    expect(screen.getByTestId("li-preview-body")).toHaveTextContent(
      "Your post content will appear here.",
    );
  });
});

describe("FacebookPreviewCard", () => {
  it("renders name and body text", () => {
    render(<FacebookPreviewCard profile={FB_PROFILE} content={SAMPLE_CONTENT} />);
    expect(screen.getByTestId("fb-preview-name")).toHaveTextContent("Acme Facebook Page");
    expect(screen.getByTestId("fb-preview-body")).toHaveTextContent(SAMPLE_CONTENT);
  });

  it("renders avatar initials fallback when no avatarUrl", () => {
    render(<FacebookPreviewCard profile={FB_PROFILE} content={SAMPLE_CONTENT} />);
    const avatar = screen.getByTestId("fb-preview-avatar");
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveTextContent("AF");
  });

  it("renders image when media provided", () => {
    render(<FacebookPreviewCard profile={FB_PROFILE} content={SAMPLE_CONTENT} media={MEDIA} />);
    const container = screen.getByTestId("fb-preview-image");
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img).toHaveAttribute("src", MEDIA[0]);
    expect(img.className).toContain("aspect-[1.91/1]");
  });

  it("renders action row with Like, Comment, Share", () => {
    render(<FacebookPreviewCard profile={FB_PROFILE} content={SAMPLE_CONTENT} />);
    expect(screen.getByRole("button", { name: "Like" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Comment" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
  });

  it("renders reactions bar", () => {
    render(<FacebookPreviewCard profile={FB_PROFILE} content={SAMPLE_CONTENT} />);
    expect(screen.getByTestId("fb-preview-reactions")).toBeInTheDocument();
  });

  it("shows placeholder when content is empty", () => {
    render(<FacebookPreviewCard profile={FB_PROFILE} content="" />);
    expect(screen.getByTestId("fb-preview-body")).toHaveTextContent(
      "Your post content will appear here.",
    );
  });
});
