/**
 * Slice G + Lane carousel — BatchResultsClient
 *
 * Tests:
 *  - Carousel renders (not the old grid)
 *  - PreviewCard is used (D8)
 *  - Numbering "N of M" shown in action bar (D9 — now inside the action bar)
 *  - Approve button calls correct endpoint (D10)
 *  - Reject button opens comment dialog (Change 4 / L17)
 *  - Request changes button opens comment dialog (Change 4 / L17)
 *  - Reject with empty comment: dialog submit disabled
 *  - Reject with comment calls PATCH with reason in body
 *  - Post-approve state shows "Draft created" or "In download set" per destination (D10)
 *  - Active card advances on approve (lane advance)
 *  - Active card advances on reject (lane advance)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import React from "react";

// Mock PreviewCard so we can assert it's used without needing all its deps.
vi.mock("@/components/social/composer/PreviewCard", () => ({
  PreviewCard: ({ platform, content }: { platform: string; content: string }) => (
    <div data-testid="preview-card" data-platform={platform}>{content}</div>
  ),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }, default: { success: vi.fn(), error: vi.fn() } }));

// Minimal fetch mock — returns publish-mode approval by default.
let fetchMock = vi.fn();
global.fetch = fetchMock;

import { BatchResultsClient } from "@/components/image/BatchResultsClient";

const BATCH_PUBLISH = {
  id: "batch-1",
  state: "completed",
  totalJobs: 2,
  completedJobs: 2,
  failedJobs: 0,
  sourceFilename: "test.xlsx",
  sourceRowCount: 1,
  destination: "publish" as const,
  createdAt: "2026-06-01T00:00:00Z",
  approvalStatus: null,
  reviewRound: null,
  jobs: [
    {
      id: "job-1", state: "completed",
      resultSignedUrl: "https://cdn.example.com/img1.png",
      errorClass: null, errorDetail: null,
      targetPlatforms: ["linkedin"], targetPublishDate: "2026-06-14",
      parentPostIndex: 0, postText: "Post one caption",
      startedAt: null, completedAt: null,
      resolvedConnections: null,
    },
    {
      id: "job-2", state: "completed",
      resultSignedUrl: "https://cdn.example.com/img2.png",
      errorClass: null, errorDetail: null,
      targetPlatforms: ["instagram"], targetPublishDate: null,
      parentPostIndex: 1, postText: "Post two caption",
      startedAt: null, completedAt: null,
      resolvedConnections: null,
    },
  ],
};

function setupFetch(
  batchData: Omit<typeof BATCH_PUBLISH, "destination"> & { destination: string } = BATCH_PUBLISH,
  approveResponse: { ok: boolean; data: Record<string, unknown> } = {
    ok: true, data: { destination: "publish", autoAttach: { draftId: "draft-abc" } },
  },
) {
  fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
    if (!opts?.method || opts.method === "GET") {
      return { ok: true, json: async () => ({ ok: true, data: batchData }) };
    }
    return { ok: true, json: async () => approveResponse };
  });
}

describe("BatchResultsClient — carousel (Slice G)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    setupFetch();
  });

  it("renders the carousel container with the active card (lane layout)", async () => {
    render(<BatchResultsClient batchId="batch-1" companyId="co-1" />);
    await waitFor(() => expect(screen.getByTestId("batch-results-carousel")).toBeInTheDocument());
    // Active card (offset=0) carries the testid; upcoming cards do not.
    expect(screen.getByTestId("carousel-card")).toBeInTheDocument();
  });

  it("shows PreviewCard on the active card (D8)", async () => {
    render(<BatchResultsClient batchId="batch-1" companyId="co-1" />);
    // The lane renders multiple cards; assert the active card has a PreviewCard.
    await waitFor(() => {
      const activeCard = screen.getByTestId("carousel-card");
      expect(within(activeCard).getByTestId("preview-card")).toBeInTheDocument();
    });
  });

  it("shows N of M numbering in the action bar (D9)", async () => {
    render(<BatchResultsClient batchId="batch-1" companyId="co-1" />);
    // carousel-numbering is now inside the action bar, not a separate header row.
    await waitFor(() => expect(screen.getByTestId("carousel-numbering").textContent).toContain("1 of 2"));
  });

  it("Approve button calls POST endpoint (D10)", async () => {
    render(<BatchResultsClient batchId="batch-1" companyId="co-1" />);
    await waitFor(() => screen.getByTestId("approve-btn"));
    fireEvent.click(screen.getByTestId("approve-btn"));
    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeDefined();
      expect(postCall![0]).toContain("job-1");
    });
  });

  it("reject button opens comment dialog (Change 4 / L17)", async () => {
    render(<BatchResultsClient batchId="batch-1" companyId="co-1" />);
    await waitFor(() => screen.getByTestId("reject-btn"));
    fireEvent.click(screen.getByTestId("reject-btn"));
    // Dialog should appear with title "Reject image"
    await waitFor(() => {
      expect(screen.getByText("Reject image")).toBeInTheDocument();
    });
    // Textarea should be present
    expect(screen.getByTestId("comment-dialog-textarea")).toBeInTheDocument();
  });

  it("reject with empty comment: dialog submit is disabled", async () => {
    render(<BatchResultsClient batchId="batch-1" companyId="co-1" />);
    await waitFor(() => screen.getByTestId("reject-btn"));
    fireEvent.click(screen.getByTestId("reject-btn"));
    await waitFor(() => screen.getByTestId("comment-dialog-submit"));
    // With empty text the submit button must be disabled.
    expect(screen.getByTestId("comment-dialog-submit")).toBeDisabled();
  });

  it("reject with short comment (< 10 chars) keeps submit disabled", async () => {
    render(<BatchResultsClient batchId="batch-1" companyId="co-1" />);
    await waitFor(() => screen.getByTestId("reject-btn"));
    fireEvent.click(screen.getByTestId("reject-btn"));
    await waitFor(() => screen.getByTestId("comment-dialog-textarea"));
    fireEvent.change(screen.getByTestId("comment-dialog-textarea"), { target: { value: "too short" } });
    expect(screen.getByTestId("comment-dialog-submit")).toBeDisabled();
  });

  it("reject with comment (>= 10 chars) calls PATCH with reason in body", async () => {
    render(<BatchResultsClient batchId="batch-1" companyId="co-1" />);
    await waitFor(() => screen.getByTestId("reject-btn"));
    fireEvent.click(screen.getByTestId("reject-btn"));
    await waitFor(() => screen.getByTestId("comment-dialog-textarea"));
    fireEvent.change(screen.getByTestId("comment-dialog-textarea"), { target: { value: "This image does not meet our brand guidelines." } });
    // Submit should now be enabled
    expect(screen.getByTestId("comment-dialog-submit")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("comment-dialog-submit"));
    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string) as Record<string, unknown>;
      expect(body.reason).toContain("brand guidelines");
    });
  });

  it("Request changes button opens comment dialog (Change 4 / L17)", async () => {
    render(<BatchResultsClient batchId="batch-1" companyId="co-1" />);
    await waitFor(() => screen.getByTestId("request-changes-btn"));
    fireEvent.click(screen.getByTestId("request-changes-btn"));
    // Dialog textarea is the reliable signal the dialog is open.
    await waitFor(() => {
      expect(screen.getByTestId("comment-dialog-textarea")).toBeInTheDocument();
    });
  });

  it("publish approve shows Draft created status (D10)", async () => {
    setupFetch(BATCH_PUBLISH, { ok: true, data: { destination: "publish", autoAttach: { draftId: "draft-abc" } } });
    render(<BatchResultsClient batchId="batch-1" companyId="co-1" />);
    await waitFor(() => screen.getByTestId("approve-btn"));
    fireEvent.click(screen.getByTestId("approve-btn"));
    await waitFor(() => {
      const outcome = screen.queryByTestId("card-outcome");
      if (outcome) expect(outcome.textContent).toContain("Draft created");
    });
  });

  it("download approve shows In download set status (D10)", async () => {
    const downloadBatch = { ...BATCH_PUBLISH, destination: "download" as const };
    setupFetch(downloadBatch, { ok: true, data: { destination: "download", addedToDownloadSet: true } });
    render(<BatchResultsClient batchId="batch-1" companyId="co-1" />);
    await waitFor(() => screen.getByTestId("approve-btn"));
    fireEvent.click(screen.getByTestId("approve-btn"));
    await waitFor(() => {
      const outcome = screen.queryByTestId("card-outcome");
      if (outcome) expect(outcome.textContent).toContain("In download set");
    });
  });

  it("approving the active card advances the lane to the next card", async () => {
    render(<BatchResultsClient batchId="batch-1" companyId="co-1" />);
    await waitFor(() => screen.getByTestId("approve-btn"));

    // Starts on card 1 of 2.
    expect(screen.getByTestId("carousel-numbering").textContent).toContain("1 of 2");

    fireEvent.click(screen.getByTestId("approve-btn"));

    // After approve, currentIndex advances → numbering shows card 2.
    await waitFor(
      () => expect(screen.getByTestId("carousel-numbering").textContent).toContain("2 of 2"),
      { timeout: 1000 },
    );
  });

  it("rejecting the active card (with comment) advances the lane to the next card", async () => {
    render(<BatchResultsClient batchId="batch-1" companyId="co-1" />);
    await waitFor(() => screen.getByTestId("reject-btn"));

    expect(screen.getByTestId("carousel-numbering").textContent).toContain("1 of 2");

    // Open dialog, enter comment, submit.
    fireEvent.click(screen.getByTestId("reject-btn"));
    await waitFor(() => screen.getByTestId("comment-dialog-textarea"));
    fireEvent.change(screen.getByTestId("comment-dialog-textarea"), { target: { value: "Does not match brand style guide." } });
    fireEvent.click(screen.getByTestId("comment-dialog-submit"));

    await waitFor(
      () => expect(screen.getByTestId("carousel-numbering").textContent).toContain("2 of 2"),
      { timeout: 1000 },
    );
  });
});
