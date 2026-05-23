import type { GapAnalysisResult } from "@/lib/insights/gap-analysis";

interface FormatGapCardProps {
  formatGap: GapAnalysisResult["formatGap"];
}

function pct(count: number, total: number) {
  if (total === 0) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}

function mixTotal(mix: GapAnalysisResult["formatGap"]["yourMix"]) {
  return mix.image + mix.video + mix.text + mix.carousel;
}

export function FormatGapCard({ formatGap }: FormatGapCardProps) {
  const yourTotal = mixTotal(formatGap.yourMix);
  const compTotal = mixTotal(formatGap.competitorMix);

  if (yourTotal === 0) return null;

  return (
    <div className="rounded-lg border border-b2 bg-b1 p-4 space-y-3" data-testid="format-gap-card">
      <h3 className="text-sm font-semibold text-tx-primary">Format mix</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-sm text-tx-muted mb-2">Your posts</p>
          <ul className="space-y-1 text-sm text-tx-primary">
            <li>Image: {pct(formatGap.yourMix.image, yourTotal)}</li>
            <li>Video: {pct(formatGap.yourMix.video, yourTotal)}</li>
            <li>Carousel: {pct(formatGap.yourMix.carousel, yourTotal)}</li>
            <li>Text: {pct(formatGap.yourMix.text, yourTotal)}</li>
          </ul>
        </div>
        {compTotal > 0 && (
          <div>
            <p className="text-sm text-tx-muted mb-2">Competitors</p>
            <ul className="space-y-1 text-sm text-tx-primary">
              <li>Image: {pct(formatGap.competitorMix.image, compTotal)}</li>
              <li>Video: {pct(formatGap.competitorMix.video, compTotal)}</li>
              <li>Carousel: {pct(formatGap.competitorMix.carousel, compTotal)}</li>
              <li>Text: {pct(formatGap.competitorMix.text, compTotal)}</li>
            </ul>
          </div>
        )}
      </div>
      {formatGap.videoMultiplier > 1.2 && (
        <p className="text-sm text-pk-600 font-medium">
          Video posts get {formatGap.videoMultiplier.toFixed(1)}× your average engagement — consider increasing video output.
        </p>
      )}
    </div>
  );
}
