import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  LinkPreviewCard,
  LinkPreviewLoader,
  type LinkPreviewData,
} from "@/components/social/composer/LinkPreviewCard";

const BASE_DATA: LinkPreviewData = {
  title: "Example Article",
  description: "This is the description of the article.",
  image_url: "https://example.com/og.jpg",
  domain: "example.com",
  fetched_at: "2026-05-20T00:00:00.000Z",
};

describe("LinkPreviewCard", () => {
  it("renders title, description, and domain", () => {
    render(
      <LinkPreviewCard data={BASE_DATA} url="https://example.com" onDismiss={() => {}} />,
    );
    expect(screen.getByTestId("link-preview-title")).toHaveTextContent("Example Article");
    expect(screen.getByTestId("link-preview-description")).toHaveTextContent(
      "This is the description of the article.",
    );
    expect(screen.getByTestId("link-preview-domain")).toHaveTextContent("example.com");
  });

  it("renders the thumbnail image when image_url is set", () => {
    const { container } = render(
      <LinkPreviewCard data={BASE_DATA} url="https://example.com" onDismiss={() => {}} />,
    );
    const img = container.querySelector("img[data-testid='link-preview-image']");
    expect(img).toBeTruthy();
    expect(img).toHaveAttribute("src", "https://example.com/og.jpg");
  });

  it("omits thumbnail when image_url is null", () => {
    const data = { ...BASE_DATA, image_url: null };
    const { container } = render(
      <LinkPreviewCard data={data} url="https://example.com" onDismiss={() => {}} />,
    );
    expect(container.querySelector("[data-testid='link-preview-image']")).toBeNull();
  });

  it("falls back to domain when title is null", () => {
    const data = { ...BASE_DATA, title: null };
    render(
      <LinkPreviewCard data={data} url="https://example.com" onDismiss={() => {}} />,
    );
    expect(screen.getByTestId("link-preview-title")).toHaveTextContent("example.com");
  });

  it("omits description element when description is null", () => {
    const data = { ...BASE_DATA, description: null };
    render(
      <LinkPreviewCard data={data} url="https://example.com" onDismiss={() => {}} />,
    );
    expect(screen.queryByTestId("link-preview-description")).toBeNull();
  });

  it("calls onDismiss when the dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    render(
      <LinkPreviewCard data={BASE_DATA} url="https://example.com" onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByTestId("link-preview-dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("domain link points to the correct URL", () => {
    render(
      <LinkPreviewCard data={BASE_DATA} url="https://example.com/path?q=1" onDismiss={() => {}} />,
    );
    const link = screen.getByTestId("link-preview-domain");
    expect(link).toHaveAttribute("href", "https://example.com/path?q=1");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("has the correct data-testid root", () => {
    render(
      <LinkPreviewCard data={BASE_DATA} url="https://example.com" onDismiss={() => {}} />,
    );
    expect(screen.getByTestId("link-preview-card")).toBeTruthy();
  });
});

describe("LinkPreviewLoader", () => {
  it("renders with correct test id and pulse animation", () => {
    render(<LinkPreviewLoader />);
    const el = screen.getByTestId("link-preview-loading");
    expect(el).toBeTruthy();
    expect(el.className).toContain("animate-pulse");
  });
});
