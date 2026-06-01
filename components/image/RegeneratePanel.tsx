"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { coordToGridRegion } from "@/lib/image/generator/safe-zones";
import type { GridRegion } from "@/lib/image/generator/safe-zones";

// ---------------------------------------------------------------------------
// RegeneratePanel — Slice I (D21, D22, D23, D29, D30).
//
// Shown when operator clicks "Request changes" on a carousel card.
// Collects up to 3 pins (x/y + comment) and optional general text.
//
// D23: copy never implies region-only editing.
// D22: pins = { x, y, region, comment } — x/y normalised 0–1 from image.
// ---------------------------------------------------------------------------

interface Pin {
  x: number;
  y: number;
  region: GridRegion;
  comment: string;
}

interface RegeneratePanelProps {
  jobId: string;
  companyId: string;
  imageUrl: string | null;
  onSuccess: (newJobId: string) => void;
  onCancel: () => void;
}

export function RegeneratePanel({
  jobId,
  companyId,
  imageUrl,
  onSuccess,
  onCancel,
}: RegeneratePanelProps) {
  const [feedbackText, setFeedbackText] = useState("");
  const [pins, setPins] = useState<Pin[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLDivElement>(null);

  // D22: click on the image to place a pin (≤3).
  function handleImageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (pins.length >= 3) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const region = coordToGridRegion(x, y);
    setPins((prev) => [...prev, { x, y, region, comment: "" }]);
  }

  function updatePinComment(i: number, comment: string) {
    setPins((prev) => prev.map((p, idx) => idx === i ? { ...p, comment } : p));
  }

  function removePin(i: number) {
    setPins((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function submit() {
    if (!feedbackText.trim() && pins.length === 0) {
      setError("Add feedback text or at least one pin before submitting.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/image/jobs/${jobId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyId,
          feedback_text: feedbackText || undefined,
          pins: pins.length > 0 ? pins : undefined,
        }),
      });
      const json = await res.json() as { ok: boolean; data?: { newJobId: string }; error?: { message: string } };
      if (json.ok && json.data) {
        onSuccess(json.data.newJobId);
      } else {
        setError(json.error?.message ?? "Regeneration failed.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 p-4 bg-muted/30 rounded-xl border border-border" data-testid="regenerate-panel">
      {/* D23: honest copy */}
      <p className="text-sm text-muted-foreground">
        <strong className="text-foreground">Request changes</strong> — your feedback will be used as guidance for the next full-image generation. This regenerates the whole image; it does not edit a specific area.
      </p>

      {/* Image with pin targets (D22) */}
      {imageUrl && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            Click on the image to place up to 3 guidance pins ({pins.length}/3 placed).
          </p>
          <div
            ref={imgRef}
            className="relative cursor-crosshair overflow-hidden rounded-lg select-none"
            onClick={handleImageClick}
            data-testid="pin-image-target"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="Generated" className="w-full" draggable={false} />
            {pins.map((pin, i) => (
              <div
                key={i}
                className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary flex items-center justify-center text-xs font-bold text-primary-foreground"
                style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
                data-testid={`pin-marker-${i}`}
              >
                {i + 1}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pin comments */}
      {pins.length > 0 && (
        <div className="space-y-2">
          {pins.map((pin, i) => (
            <div key={i} className="flex gap-2 items-start">
              <span className="mt-2 h-5 w-5 shrink-0 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-primary-foreground">
                {i + 1}
              </span>
              <div className="flex-1 space-y-1">
                <p className="text-xs text-muted-foreground">{pin.region} area</p>
                <input
                  type="text"
                  placeholder="What should change here?"
                  value={pin.comment}
                  onChange={(e) => updatePinComment(i, e.target.value)}
                  maxLength={200}
                  className="w-full rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  data-testid={`pin-comment-${i}`}
                />
              </div>
              <button
                type="button"
                onClick={() => removePin(i)}
                className="mt-2 text-muted-foreground hover:text-destructive"
                aria-label={`Remove pin ${i + 1}`}
                data-testid={`pin-remove-${i}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* General feedback */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">General feedback (optional)</label>
        <textarea
          value={feedbackText}
          onChange={(e) => setFeedbackText(e.target.value)}
          placeholder="Describe what you'd like changed overall…"
          maxLength={500}
          rows={3}
          className="w-full rounded border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          data-testid="feedback-text"
        />
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={submitting} data-testid="regenerate-submit">
          {submitting ? "Submitting…" : "Regenerate with this guidance"}
        </Button>
      </div>
    </div>
  );
}
