"use client";

import { useState } from "react";

import { ImageLightbox } from "@/components/ImageLightbox";

type ImageDetailLightboxProps = {
  src: string;
  alt: string;
  title: string | null;
  caption: string | null;
  tags: string[];
  width_px: number | null;
  height_px: number | null;
};

export function ImageDetailLightbox(props: ImageDetailLightboxProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm hover:underline"
        data-testid="open-lightbox-button"
      >
        Open
      </button>
      {open && (
        <ImageLightbox
          {...props}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
