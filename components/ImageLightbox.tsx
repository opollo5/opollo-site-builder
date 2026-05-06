"use client";

import { useEffect } from "react";

type ImageLightboxProps = {
  src: string;
  alt: string;
  title: string | null;
  caption: string | null;
  tags: string[];
  width_px: number | null;
  height_px: number | null;
  onClose: () => void;
};

export function ImageLightbox({
  src,
  alt,
  title,
  caption,
  tags,
  width_px,
  height_px,
  onClose,
}: ImageLightboxProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Prevent body scroll while open.
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const dims =
    width_px && height_px ? `${width_px}×${height_px} px` : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? alt}
      data-testid="image-lightbox"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex max-h-[90vh] max-w-5xl flex-col overflow-hidden rounded-lg bg-background shadow-xl">
        {/* Close button */}
        <button
          type="button"
          aria-label="Close image viewer"
          data-testid="lightbox-close"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          ×
        </button>

        {/* Image */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="max-h-[70vh] w-full object-contain"
          data-testid="lightbox-image"
        />

        {/* Metadata strip */}
        <div className="flex flex-col gap-2 p-4 text-sm">
          {title && (
            <p className="text-base font-semibold leading-snug" data-testid="lightbox-title">
              {title}
            </p>
          )}
          {caption && (
            <p className="text-muted-foreground" data-testid="lightbox-caption">
              {caption}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
            {dims && <span data-testid="lightbox-dims">{dims}</span>}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.slice(0, 8).map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-muted px-2 py-0.5 text-xs"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
