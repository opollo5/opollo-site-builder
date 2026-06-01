/**
 * Slice A — Calendar side-pane editing + hover (D1, D2)
 *
 * D1: In-cell click = select day only (no Composer). Side-pane post item = opens Composer.
 * D2: Muted at rest; hover reveals Open + Delete buttons. Delete uses confirm dialog.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, transform: null, isDragging: false }),
}));
vi.mock("@dnd-kit/utilities", () => ({ CSS: { Translate: { toString: () => "" } } }));
vi.mock("@/components/ui/SocialPlatformIcon", () => ({
  SocialPlatformIcon: () => <span data-testid="platform-icon" />,
}));

import { DayDetailPostCard } from "@/components/social/dashboard/DayDetailPostCard";
import { DayDetail } from "@/components/social/dashboard/DayDetail";
import type { CalendarPost } from "@/lib/social/types";

const POST: CalendarPost = {
  id: "post-1",
  state: "scheduled",
  scheduled_at: "2026-06-14T09:00:00Z",
  published_at: null,
  planned_for_at: null,
  content_excerpt: "Test post content",
  primary_media_url: null,
  link_url: null,
  target_profiles: [],
  is_recurring_child: false,
};

// ─── DayDetailPostCard ────────────────────────────────────────────────────────

describe("DayDetailPostCard — D2 hover", () => {
  it("renders hover-actions container (hidden at rest via CSS, present in DOM)", () => {
    const onClick = vi.fn();
    const onDelete = vi.fn();
    render(<DayDetailPostCard post={POST} onClick={onClick} onDelete={onDelete} />);
    // Hover actions exist in DOM (CSS hides them; group-hover reveals)
    expect(screen.getByTestId("hover-actions")).toBeInTheDocument();
  });

  it("hover Open button calls onClick with the post — opens Composer", () => {
    const onClick = vi.fn();
    const onDelete = vi.fn();
    render(<DayDetailPostCard post={POST} onClick={onClick} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId("hover-open-btn"));
    expect(onClick).toHaveBeenCalledWith(POST);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("hover Delete button calls onDelete with the post id — not onClick", () => {
    const onClick = vi.fn();
    const onDelete = vi.fn();
    render(<DayDetailPostCard post={POST} onClick={onClick} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId("hover-delete-btn"));
    expect(onDelete).toHaveBeenCalledWith("post-1");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("card body click calls onClick — opens Composer from side pane (D1)", () => {
    const onClick = vi.fn();
    const onDelete = vi.fn();
    render(<DayDetailPostCard post={POST} onClick={onClick} onDelete={onDelete} />);
    // The flex-1 div wrapping content has the onClick
    fireEvent.click(screen.getByText("Test post content"));
    expect(onClick).toHaveBeenCalledWith(POST);
  });

  it("card has muted-at-rest opacity class", () => {
    render(<DayDetailPostCard post={POST} onClick={vi.fn()} onDelete={vi.fn()} />);
    const card = screen.getByTestId("day-detail-post-card");
    expect(card.className).toContain("opacity-80");
  });

  it("card has hover-shadow lift class (hover:shadow-md)", () => {
    render(<DayDetailPostCard post={POST} onClick={vi.fn()} onDelete={vi.fn()} />);
    const card = screen.getByTestId("day-detail-post-card");
    expect(card.className).toContain("hover:shadow-md");
  });
});

// ─── DayDetail ────────────────────────────────────────────────────────────────

describe("DayDetail — D1 side-pane opens Composer", () => {
  const date = new Date("2026-06-14T09:00:00Z");

  it("renders a card per post", () => {
    const onPostClick = vi.fn();
    render(
      <DayDetail
        date={date}
        posts={[POST]}
        onPostClick={onPostClick}
        onDelete={vi.fn()}
        onAddPost={vi.fn()}
      />,
    );
    expect(screen.getByTestId("day-detail-post-card")).toBeInTheDocument();
    expect(screen.getByTestId("day-detail-list")).toBeInTheDocument();
  });

  it("clicking a card body calls onPostClick (opens Composer)", () => {
    const onPostClick = vi.fn();
    render(
      <DayDetail
        date={date}
        posts={[POST]}
        onPostClick={onPostClick}
        onDelete={vi.fn()}
        onAddPost={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Test post content"));
    expect(onPostClick).toHaveBeenCalledWith(POST);
  });

  it("shows empty state when no posts", () => {
    render(
      <DayDetail
        date={date}
        posts={[]}
        onPostClick={vi.fn()}
        onDelete={vi.fn()}
        onAddPost={vi.fn()}
      />,
    );
    expect(screen.getByText("No posts scheduled.")).toBeInTheDocument();
  });
});
