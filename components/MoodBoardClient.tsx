"use client";

import { useState } from "react";
import { toast } from "sonner";

import type { AspectRatio, CompositionType, StyleId } from "@/lib/image/types";

// ---------------------------------------------------------------------------
// I4 — mood board UI client component.
//
// Receives brand-derived props from the server page; owns all interactive
// state. Calls POST /api/platform/image/generate and renders a 2–3 col
// grid of results. Clicking an image marks it selected + copies its
// signed URL to the clipboard.
// ---------------------------------------------------------------------------

interface GeneratedImageResult {
  storagePath: string;
  signedUrl: string | null;
  width: number;
  height: number;
  format: string;
}

const STYLE_LABELS: Record<StyleId, string> = {
  clean_corporate: "Clean corporate",
  bold_promo: "Bold promo",
  minimal_modern: "Minimal modern",
  editorial: "Editorial",
  product_focus: "Product focus",
};

const COMPOSITION_LABELS: Record<CompositionType, string> = {
  split_layout: "Split layout",
  gradient_fade: "Gradient fade",
  full_background: "Full background",
  geometric: "Geometric",
  texture: "Texture",
};

const ASPECT_RATIO_LABELS: Record<AspectRatio, string> = {
  ASPECT_1_1: "1:1 Square",
  ASPECT_4_5: "4:5 Portrait",
  ASPECT_16_9: "16:9 Landscape",
  ASPECT_9_16: "9:16 Story",
};

const ALL_COMPOSITIONS: CompositionType[] = [
  "split_layout",
  "gradient_fade",
  "full_background",
  "geometric",
  "texture",
];

const ALL_ASPECT_RATIOS: AspectRatio[] = [
  "ASPECT_1_1",
  "ASPECT_4_5",
  "ASPECT_16_9",
  "ASPECT_9_16",
];

const COUNT_OPTIONS = [4, 5, 6] as const;

interface Props {
  companyId: string;
  allowedStyles: StyleId[];
  primaryColour: string | null;
}

export function MoodBoardClient({
  companyId,
  allowedStyles,
  primaryColour: _primaryColour,
}: Props) {
  const [style, setStyle] = useState<StyleId>(
    allowedStyles[0] ?? "clean_corporate",
  );
  const [composition, setComposition] = useState<CompositionType>(
    "split_layout",
  );
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("ASPECT_1_1");
  const [count, setCount] = useState<(typeof COUNT_OPTIONS)[number]>(4);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<GeneratedImageResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  async function generate() {
    setIsLoading(true);
    setError(null);
    setImages([]);
    setSelectedIdx(null);

    try {
      const res = await fetch("/api/platform/image/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyId,
          style_id: style,
          composition_type: composition,
          aspect_ratio: aspectRatio,
          count,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { images: GeneratedImageResult[] };
        error?: { code: string; message: string };
      };
      if (!json.ok) {
        setError(json.error?.message ?? "Generation failed. Please try again.");
        return;
      }
      setImages(json.data?.images ?? []);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  async function selectImage(idx: number) {
    const img = images[idx];
    if (!img?.signedUrl) {
      toast.error("No URL available for this image.");
      return;
    }
    setSelectedIdx(idx);
    try {
      await navigator.clipboard.writeText(img.signedUrl);
      toast.success("Image URL copied to clipboard.");
    } catch {
      toast.error(
        "Could not copy to clipboard — check browser permissions.",
      );
    }
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {/* Style selector */}
        <div>
          <p className="mb-1.5 text-sm font-medium">Style</p>
          <div className="flex flex-wrap gap-1.5">
            {allowedStyles.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStyle(s)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  style === s
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:border-primary/50"
                }`}
              >
                {STYLE_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Composition selector */}
        <div>
          <p className="mb-1.5 text-sm font-medium">Composition</p>
          <div className="flex flex-wrap gap-1.5">
            {ALL_COMPOSITIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setComposition(c)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  composition === c
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:border-primary/50"
                }`}
              >
                {COMPOSITION_LABELS[c]}
              </button>
            ))}
          </div>
        </div>

        {/* Aspect ratio selector */}
        <div>
          <p className="mb-1.5 text-sm font-medium">Aspect ratio</p>
          <div className="flex flex-wrap gap-1.5">
            {ALL_ASPECT_RATIOS.map((ar) => (
              <button
                key={ar}
                type="button"
                onClick={() => setAspectRatio(ar)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  aspectRatio === ar
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:border-primary/50"
                }`}
              >
                {ASPECT_RATIO_LABELS[ar]}
              </button>
            ))}
          </div>
        </div>

        {/* Count selector */}
        <div>
          <p className="mb-1.5 text-sm font-medium">Count</p>
          <div className="flex gap-1.5">
            {COUNT_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCount(n)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  count === n
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:border-primary/50"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Generate button */}
      <div>
        <button
          type="button"
          onClick={generate}
          disabled={isLoading || allowedStyles.length === 0}
          className="inline-flex min-w-[160px] items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {isLoading ? "Generating…" : "Generate images"}
        </button>
        {isLoading ? (
          <p className="mt-2 text-xs text-muted-foreground">
            This can take up to 60 seconds for {count} images — please wait.
          </p>
        ) : null}
      </div>

      {/* Error state */}
      {error ? (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {/* Results grid */}
      {images.length > 0 ? (
        <section aria-label="Generated images">
          <p className="mb-3 text-sm text-muted-foreground">
            {images.length} image{images.length !== 1 ? "s" : ""} generated.
            Click an image to select it and copy its URL.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((img, idx) => {
              const isSelected = selectedIdx === idx;
              return (
                <button
                  key={img.storagePath}
                  type="button"
                  onClick={() => selectImage(idx)}
                  aria-pressed={isSelected}
                  aria-label={`Image ${idx + 1}${isSelected ? " (selected)" : ""}`}
                  className={`group relative overflow-hidden rounded-md border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                    isSelected
                      ? "border-primary"
                      : "border-transparent hover:border-primary/40"
                  }`}
                >
                  {img.signedUrl ? (
                    // Use <img> rather than next/image — Supabase Storage
                    // signed URLs are external and don't go through the
                    // Next.js image optimiser.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img.signedUrl}
                      alt={`Generated background ${idx + 1}`}
                      className="aspect-square w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center bg-muted text-xs text-muted-foreground">
                      URL unavailable
                    </div>
                  )}

                  {/* Hover / focus overlay */}
                  <div
                    className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                    aria-hidden="true"
                  >
                    <span className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-black">
                      {isSelected ? "Selected" : "Select"}
                    </span>
                  </div>

                  {/* Selected checkmark badge */}
                  {isSelected ? (
                    <div
                      className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow"
                      aria-hidden="true"
                    >
                      <svg
                        viewBox="0 0 12 12"
                        fill="none"
                        className="h-3 w-3"
                      >
                        <path
                          d="M2 6l3 3 5-5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
