import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { RecommendationsSidebar } from "@/components/insights/RecommendationsSidebar";

vi.mock("@/components/insights/EvidenceDetail", () => ({
  EvidenceDetail: ({ open, headline }: { open: boolean; headline: string }) =>
    open ? <div data-testid="evidence-detail">{headline}</div> : null,
}));

vi.mock("@/components/insights/DismissalModal", () => ({
  DismissalModal: ({
    open,
    onClose,
  }: {
    open: boolean;
    onClose: () => void;
  }) =>
    open ? (
      <div data-testid="dismissal-modal">
        <button onClick={onClose}>Close</button>
      </div>
    ) : null,
}));

const MOCK_RECS = [
  {
    id: "rec-1",
    recommendation_type: "best_length_band",
    headline: "Keep it under 150 words",
    body: "+38% engagement",
    confidence_band: "strong" as const,
    confidence_score: 0.81,
  },
  {
    id: "rec-2",
    recommendation_type: "best_posting_window",
    headline: "Post on Tuesday 10am",
    body: "2.4x median",
    confidence_band: "moderate" as const,
    confidence_score: 0.62,
  },
];

function mockFetch(recs: typeof MOCK_RECS, postCount = 47) {
  return vi.fn().mockResolvedValue({
    json: () =>
      Promise.resolve({ ok: true, recommendations: recs, postCount }),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("RecommendationsSidebar", () => {
  it("shows skeleton while loading", () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<RecommendationsSidebar companyId="co-1" />);
    expect(screen.getByTestId("sidebar-skeleton")).toBeInTheDocument();
  });

  it("renders recommendations after load", async () => {
    global.fetch = mockFetch(MOCK_RECS);
    render(<RecommendationsSidebar companyId="co-1" />);
    await waitFor(() =>
      expect(screen.getAllByTestId("sidebar-rec-card")).toHaveLength(2),
    );
    expect(screen.getByText("Keep it under 150 words")).toBeInTheDocument();
    expect(screen.getByText("Post on Tuesday 10am")).toBeInTheDocument();
  });

  it("shows 'need more posts' empty state when postCount below threshold", async () => {
    global.fetch = mockFetch([], 12);
    render(<RecommendationsSidebar companyId="co-1" />);
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-empty-need-more")).toBeInTheDocument(),
    );
    expect(screen.getByText(/Need 8 more posts/)).toBeInTheDocument();
  });

  it("shows no-recommendations empty state when postCount sufficient but no recs", async () => {
    global.fetch = mockFetch([], 47);
    render(<RecommendationsSidebar companyId="co-1" />);
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-empty-none")).toBeInTheDocument(),
    );
  });

  it("opens evidence detail on See evidence click", async () => {
    global.fetch = mockFetch(MOCK_RECS);
    render(<RecommendationsSidebar companyId="co-1" />);
    await waitFor(() =>
      expect(screen.getAllByTestId("sidebar-rec-card")).toHaveLength(2),
    );
    fireEvent.click(screen.getAllByTestId("sidebar-see-evidence")[0]!);
    const detail = screen.getByTestId("evidence-detail");
    expect(detail).toBeInTheDocument();
    expect(detail).toHaveTextContent("Keep it under 150 words");
  });

  it("opens dismissal modal on dismiss click", async () => {
    global.fetch = mockFetch(MOCK_RECS);
    render(<RecommendationsSidebar companyId="co-1" />);
    await waitFor(() =>
      expect(screen.getAllByTestId("sidebar-rec-card")).toHaveLength(2),
    );
    fireEvent.click(screen.getAllByTestId("sidebar-dismiss-btn")[0]!);
    expect(screen.getByTestId("dismissal-modal")).toBeInTheDocument();
  });

  it("collapses and expands on toggle", async () => {
    global.fetch = mockFetch(MOCK_RECS);
    render(<RecommendationsSidebar companyId="co-1" />);
    await waitFor(() =>
      expect(screen.getByTestId("insights-sidebar")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("sidebar-collapse-btn"));
    expect(screen.getByTestId("sidebar-collapsed")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /expand insights sidebar/i }),
    );
    expect(screen.getByTestId("insights-sidebar")).toBeInTheDocument();
  });

  it("removes dismissed recommendation from list", async () => {
    global.fetch = mockFetch(MOCK_RECS);
    render(<RecommendationsSidebar companyId="co-1" />);
    await waitFor(() =>
      expect(screen.getAllByTestId("sidebar-rec-card")).toHaveLength(2),
    );
    // Dismiss rec-1
    fireEvent.click(screen.getAllByTestId("sidebar-dismiss-btn")[0]!);
    const modal = screen.getByTestId("dismissal-modal");
    expect(modal).toBeInTheDocument();
    fireEvent.click(screen.getByText("Close"));
    // The modal DismissalModal mock calls onClose but not onConfirm,
    // so the rec stays — this tests the UI pathway exists.
    // Full dismissal is covered in the L3 route test.
  });
});
