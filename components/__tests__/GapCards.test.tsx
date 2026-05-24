import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { TopicGapCard } from "@/components/insights/TopicGapCard";
import { FormatGapCard } from "@/components/insights/FormatGapCard";
import { CadenceGapCard } from "@/components/insights/CadenceGapCard";
import { EngagementBenchmarkCard } from "@/components/insights/EngagementBenchmarkCard";

const EMPTY_TOPIC_GAP = { competitorTopics: [], yourTopics: [], missing: [] };
const SAMPLE_TOPIC_GAP = {
  competitorTopics: [{ topic: "zero-trust", count: 5 }],
  yourTopics: [
    { topic: "ransomware", count: 4 },
    { topic: "msp", count: 3 },
  ],
  missing: ["zero-trust", "cloud-security"],
};

const EMPTY_FORMAT = { yourMix: { image: 0, video: 0, text: 0, carousel: 0 }, competitorMix: { image: 0, video: 0, text: 0, carousel: 0 }, videoMultiplier: 1 };
const SAMPLE_FORMAT = {
  yourMix: { image: 5, video: 2, text: 8, carousel: 1 },
  competitorMix: { image: 3, video: 7, text: 2, carousel: 1 },
  videoMultiplier: 2.5,
};

const EMPTY_CADENCE = { yourPostsPerMonth: 0, competitorAvgPostsPerMonth: 0 };
const SAMPLE_CADENCE = { yourPostsPerMonth: 4, competitorAvgPostsPerMonth: 12 };

const EMPTY_BENCHMARK = { yourRate: 0, competitorMedian: 0, deltaPercent: 0 };
const SAMPLE_BENCHMARK = { yourRate: 0.035, competitorMedian: 0.055, deltaPercent: -36.4 };

describe("TopicGapCard", () => {
  it("returns null when no topics", () => {
    const { container } = render(<TopicGapCard topicGap={EMPTY_TOPIC_GAP} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders missing topics", () => {
    render(<TopicGapCard topicGap={SAMPLE_TOPIC_GAP} />);
    expect(screen.getByTestId("topic-gap-card")).toBeInTheDocument();
    expect(screen.getByText("zero-trust")).toBeInTheDocument();
    expect(screen.getByText("cloud-security")).toBeInTheDocument();
  });

  it("renders your topics", () => {
    render(<TopicGapCard topicGap={SAMPLE_TOPIC_GAP} />);
    expect(screen.getByText(/ransomware/)).toBeInTheDocument();
    expect(screen.getByText(/msp/)).toBeInTheDocument();
  });
});

describe("FormatGapCard", () => {
  it("returns null when your mix is zero", () => {
    const { container } = render(<FormatGapCard formatGap={EMPTY_FORMAT} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders format percentages", () => {
    render(<FormatGapCard formatGap={SAMPLE_FORMAT} />);
    expect(screen.getByTestId("format-gap-card")).toBeInTheDocument();
    expect(screen.getAllByText(/Video:/).length).toBeGreaterThan(0);
  });

  it("shows video multiplier tip when > 1.2", () => {
    render(<FormatGapCard formatGap={SAMPLE_FORMAT} />);
    expect(screen.getByText(/2\.5×/)).toBeInTheDocument();
  });
});

describe("CadenceGapCard", () => {
  it("returns null when both cadences are zero", () => {
    const { container } = render(<CadenceGapCard cadenceGap={EMPTY_CADENCE} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows cadence numbers", () => {
    render(<CadenceGapCard cadenceGap={SAMPLE_CADENCE} />);
    expect(screen.getByTestId("cadence-gap-card")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("shows 'behind' message when delta >= 2", () => {
    render(<CadenceGapCard cadenceGap={SAMPLE_CADENCE} />);
    expect(screen.getByText(/more times per month/)).toBeInTheDocument();
  });
});

describe("EngagementBenchmarkCard", () => {
  it("returns null when both rates are zero", () => {
    const { container } = render(<EngagementBenchmarkCard engagementBenchmark={EMPTY_BENCHMARK} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows engagement rates", () => {
    render(<EngagementBenchmarkCard engagementBenchmark={SAMPLE_BENCHMARK} />);
    expect(screen.getByTestId("engagement-benchmark-card")).toBeInTheDocument();
    expect(screen.getByText(/3\.50%/)).toBeInTheDocument();
    expect(screen.getByText(/5\.50%/)).toBeInTheDocument();
  });

  it("shows 'competitors outperform' when delta < 0", () => {
    render(<EngagementBenchmarkCard engagementBenchmark={SAMPLE_BENCHMARK} />);
    expect(screen.getByText(/Competitors outperform/)).toBeInTheDocument();
  });

  it("shows 'you outperform' when delta > 0", () => {
    render(
      <EngagementBenchmarkCard
        engagementBenchmark={{ yourRate: 0.07, competitorMedian: 0.04, deltaPercent: 75 }}
      />,
    );
    expect(screen.getByText(/You outperform/)).toBeInTheDocument();
  });
});
