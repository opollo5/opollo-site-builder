/**
 * Test: Composer "Delete post" button calls DELETE endpoint and closes.
 *
 * - Delete button only appears when draft.id is set (editing existing draft)
 * - Delete button absent for new drafts (no id)
 * - Clicking Delete shows ConfirmDialog (no immediate delete)
 * - Confirming in dialog calls DELETE /api/platform/social/drafts/[id]
 * - After delete, onClose is called
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("swr", () => ({ mutate: vi.fn(), default: vi.fn(() => ({ data: null })) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("date-fns-tz", () => ({
  toZonedTime: (d: Date) => d,
  fromZonedTime: (d: Date) => d,
}));

// Stub heavy child components so the test focuses on delete behaviour only.
vi.mock("@/components/social/composer/ComposerEditor", () => ({
  // Render the schedulingSlot prop so the delete button inside it is testable.
  ComposerEditor: ({ schedulingSlot }: { schedulingSlot?: React.ReactNode }) => (
    <div data-testid="composer-editor">{schedulingSlot}</div>
  ),
}));
vi.mock("@/components/social/composer/ProfileSelector", () => ({
  ProfileSelector: () => <div data-testid="profile-selector" />,
}));
vi.mock("@/components/social/composer/SchedulingCard", () => ({
  SchedulingCard: () => <div data-testid="scheduling-card" />,
  defaultSchedulingCardValue: () => ({
    mode: "draft",
    scheduledTimes: [],
    approvalRequired: false,
    plannedForAt: null,
    recurrence: null,
  }),
}));
vi.mock("@/components/social/composer/PreviewCard", () => ({
  PreviewCard: () => <div data-testid="preview-card" />,
}));
vi.mock("@/components/social/calendar/SocialCalendarGrid", () => ({
  SocialCalendarGrid: () => <div data-testid="calendar-grid" />,
}));
vi.mock("@/components/social/composer/ComposerErrorBoundary", () => ({
  ComposerErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/social/composer/UnsavedChangesDialog", () => ({
  UnsavedChangesDialog: () => null,
}));

import { ComposerOverlay } from "@/components/social/composer/ComposerOverlay";
import type { Draft } from "@/lib/social/types";

const DRAFT_ID  = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const BASE_DRAFT: Draft = {
  id: DRAFT_ID,
  draft_version: 1,
  content: "Test post",
  media_urls: [],
  target_profile_ids: [],
  platform_variants: {},
  approval_required: false,
};

function renderComposer(draft: Draft, onClose = vi.fn()) {
  return render(
    <ComposerOverlay
      open
      onClose={onClose}
      initialDraft={draft}
      companyId="co-1"
      companyTimezone="UTC"
      availableConnections={[]}
    />,
  );
}

describe("ComposerOverlay — delete post", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  });

  it("shows Delete post button when draft.id is set", () => {
    renderComposer(BASE_DRAFT);
    expect(screen.getByTestId("delete-post-btn")).toBeInTheDocument();
  });

  it("does NOT show Delete post button for new (unsaved) drafts", () => {
    const newDraft: Draft = { ...BASE_DRAFT, id: undefined };
    renderComposer(newDraft);
    expect(screen.queryByTestId("delete-post-btn")).toBeNull();
  });

  it("clicking Delete post shows confirm dialog, does NOT immediately delete", () => {
    renderComposer(BASE_DRAFT);
    fireEvent.click(screen.getByTestId("delete-post-btn"));

    // Dialog should now be visible
    expect(screen.getByText("Delete this post?")).toBeInTheDocument();
    // Fetch must NOT have been called yet
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("confirming in dialog calls DELETE and closes the Composer", async () => {
    const onClose = vi.fn();
    renderComposer(BASE_DRAFT, onClose);

    fireEvent.click(screen.getByTestId("delete-post-btn"));
    // Click the "Delete" confirm button in the dialog
    const confirmBtn = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/platform/social/drafts/${DRAFT_ID}`,
        { method: "DELETE" },
      );
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("cancelling the confirm dialog does not call DELETE", async () => {
    renderComposer(BASE_DRAFT);
    fireEvent.click(screen.getByTestId("delete-post-btn"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
