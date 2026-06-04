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
// Rules:
//   - NEVER mutate page styles or capture events outside pick mode.
//   - The highlight box is a single absolutely-positioned overlay div — it
//     tracks getBoundingClientRect() on mousemove. pointer-events-none
//     ensures the highlight never blocks the click it's marking.
//   - Click coords are stored as % of the VIEWPORT (not the element box).
//   - Crosshair cursor is set on document.body for the pick session and
//     restored on cleanup (the pointer-events-none overlay div approach
//     doesn't propagate cursor to all browsers reliably).
// ---------------------------------------------------------------------------

export function ElementPicker({ onPick, onCancel }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const targetRef = useRef<Element | null>(null);

  // Set crosshair cursor on the document body for the duration of pick mode.
  useEffect(() => {
    const prev = document.body.style.cursor;
    document.body.style.cursor = "crosshair";
    return () => { document.body.style.cursor = prev; };
  }, []);

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

      const clickXPct = (e.clientX / window.innerWidth) * 100;
      const clickYPct = (e.clientY / window.innerHeight) * 100;

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
      {/* Transparent overlay — identifies the picker layer for elementFromPoint
          exclusion. No pointer-events so clicks pass through to page elements. */}
      <div
        ref={overlayRef}
        data-testid="feedback-picker"
        className="pointer-events-none fixed inset-0 z-[9998]"
      />

      {/* Element highlight — 2px emerald outline + faint fill. pointer-events-none
          so it never blocks the click it is showing. */}
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

      {/* Persistent hint bar — emerald, bottom-center, high z-index, ≥14px text. */}
      <div
        data-testid="feedback-picker-hint"
        className="pointer-events-none fixed bottom-0 left-0 right-0 z-[10000] flex items-center justify-center bg-emerald-600 px-4 py-3 text-sm font-medium text-white shadow-lg"
      >
        Click the part of the page that isn&apos;t working
        <span className="mx-3 opacity-50">·</span>
        <kbd className="rounded bg-emerald-800/60 px-1.5 py-0.5 text-xs font-mono">Esc</kbd>
        <span className="ml-1">to cancel</span>
      </div>
    </>
  );
}
