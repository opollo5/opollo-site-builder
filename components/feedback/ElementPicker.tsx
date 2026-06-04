"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { elementLabel, resolveSelector } from "@/lib/feedback/capture/selector";

export type PickResult = {
  cssSelector: string;
  elementLabel: string;
  clickXPct: number;
  clickYPct: number;
  viewportW: number;
  viewportH: number;
  devicePixelRatio: number;
};

type Props = {
  onPick: (result: PickResult) => void;
  onCancel: () => void;
};

// ---------------------------------------------------------------------------
// ElementPicker — crosshair overlay pick mode.
//
// Rules (§13 of spec):
//   - NEVER mutate page styles or capture events outside pick mode.
//   - The highlight box is a single absolutely-positioned overlay div — it
//     tracks getBoundingClientRect() on mousemove. No style is applied to
//     the target element.
//   - Click coords are stored as % of the element's bounding box so they
//     survive viewport resize (§13 "percentage coords, not pixels").
// ---------------------------------------------------------------------------

export function ElementPicker({ onPick, onCancel }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const targetRef = useRef<Element | null>(null);

  const onMouseMove = useCallback((e: MouseEvent) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlayRef.current || overlayRef.current?.contains(el)) return;
    targetRef.current = el;
    setHighlightRect(el.getBoundingClientRect());
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    },
    [onCancel],
  );

  const onClick = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = targetRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const clickXPct = ((e.clientX - rect.left) / rect.width) * 100;
      const clickYPct = ((e.clientY - rect.top) / rect.height) * 100;

      onPick({
        cssSelector: resolveSelector(el),
        elementLabel: elementLabel(el),
        clickXPct: Math.min(100, Math.max(0, clickXPct)),
        clickYPct: Math.min(100, Math.max(0, clickYPct)),
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio ?? 1,
      });
    },
    [onPick],
  );

  useEffect(() => {
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onMouseMove, onClick, onKeyDown]);

  return (
    <>
      {/* Full-screen transparent overlay — cursor only, no pointer-events capture */}
      <div
        ref={overlayRef}
        data-testid="feedback-picker"
        className="pointer-events-none fixed inset-0 z-[9998]"
        style={{ cursor: "crosshair" }}
      />

      {/* Highlight box tracking the hovered element */}
      {highlightRect && (
        <div
          className="pointer-events-none fixed z-[9999] rounded-sm border-2 border-emerald-500 bg-emerald-500/10"
          style={{
            top: highlightRect.top - 2,
            left: highlightRect.left - 2,
            width: highlightRect.width + 4,
            height: highlightRect.height + 4,
          }}
        />
      )}

      {/* Escape hint */}
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-[10000] -translate-x-1/2 rounded-md bg-gray-900/90 px-4 py-2 text-sm text-white shadow-lg">
        Click an element to report a bug — <kbd className="rounded bg-gray-700 px-1">Esc</kbd> to cancel
      </div>
    </>
  );
}
