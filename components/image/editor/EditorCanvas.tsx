"use client";

/**
 * EditorCanvas — center pane wrapper for the v2 template editor.
 *
 * Handles scale-to-fit (§4): geometry stored in true canvas px; this
 * wrapper applies CSS transform: scale() so the canvas fits the viewport.
 * The scale is recalculated on container resize via ResizeObserver.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CanvasContent } from "./CanvasContent";
import { useEditor } from "./EditorContext";

export function EditorCanvas() {
  const { state, dispatch } = useEditor();
  const { template, selectedLayerId } = state;

  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const computeScale = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { clientWidth: cw, clientHeight: ch } = el;
    const padding = 48; // px breathing room on each axis
    const s = Math.min(
      (cw - padding) / template.width,
      (ch - padding) / template.height,
    );
    setScale(Math.max(0.05, Math.min(s, 4)));
  }, [template.width, template.height]);

  useEffect(() => {
    computeScale();
    const ro = new ResizeObserver(computeScale);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [computeScale]);

  const handleSelect = useCallback(
    (id: string | null) => dispatch({ type: "select", layerId: id }),
    [dispatch],
  );

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden flex items-center justify-center bg-[#1e1e1e]"
      style={{ position: "relative" }}
    >
      {/* Scale indicator */}
      <div className="absolute top-2 right-2 text-xs text-white/40 select-none z-10">
        {Math.round(scale * 100)}%
      </div>

      {/* Canvas at true pixel size, scaled to fit */}
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          boxShadow: "0 4px 32px rgba(0,0,0,0.5)",
          flexShrink: 0,
        }}
      >
        <CanvasContent
          template={template}
          selectedLayerId={selectedLayerId}
          onSelectLayer={handleSelect}
          scale={scale}
        />
      </div>
    </div>
  );
}
