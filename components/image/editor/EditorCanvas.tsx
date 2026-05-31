"use client";

/**
 * EditorCanvas — center pane wrapper for the v2 template editor.
 *
 * Renders two overlapping layers at true canvas pixel dimensions,
 * then applies CSS scale-to-fit to the whole container:
 *
 *   ┌──────────────────────────────────┐
 *   │  CanvasContent (DOM renderer)    │  ← §6 visual truth
 *   │  KonvaInteractionLayer           │  ← §6.3 handles, transparent
 *   └──────────────────────────────────┘
 *     ↑ transformed: scale(s) where s = min(cw/W, ch/H)
 *
 * Scale recalculated on container resize via ResizeObserver.
 * Konva stage is dynamically imported (browser Canvas API, no SSR).
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { useEditor } from "./EditorContext";
import { CanvasContent } from "./CanvasContent";

// Dynamic imports keep Konva out of the SSR bundle (Canvas API not available server-side).
const KonvaInteractionLayer = dynamic(
  () => import("./KonvaInteractionLayer").then((m) => m.KonvaInteractionLayer),
  { ssr: false },
);

const SafeZoneOverlayKonva = dynamic(
  () => import("./SafeZoneOverlay").then((m) => m.SafeZoneOverlay),
  { ssr: false },
);

export function EditorCanvas() {
  const { state, dispatch, displayTemplate } = useEditor();
  const { selectedLayerId } = state;
  // Use displayTemplate so the canvas shows the reflowed layout for active variants.
  const template = displayTemplate;

  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const computeScale = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { clientWidth: cw, clientHeight: ch } = el;
    const padding = 48;
    const s = Math.min((cw - padding) / template.width, (ch - padding) / template.height);
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
      className="flex-1 overflow-hidden flex items-center justify-center bg-zinc-900"
      style={{ position: "relative" }}
    >
      {/* Scale indicator */}
      <div className="absolute top-2 right-2 text-xs text-white/40 select-none z-10 pointer-events-none">
        {Math.round(scale * 100)}%
      </div>

      {/* Canvas at true pixel dimensions, scaled to fit viewport */}
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          boxShadow: "0 4px 32px rgba(0,0,0,0.5)",
          flexShrink: 0,
          position: "relative",
          width: template.width,
          height: template.height,
        }}
      >
        {/* DOM renderer — visual source of truth */}
        <CanvasContent
          template={template}
          selectedLayerId={selectedLayerId}
          onSelectLayer={handleSelect}
          scale={scale}
        />

        {/* react-konva interaction layer — transparent, handles only */}
        <KonvaInteractionLayer width={template.width} height={template.height} />

        {/* Safe-zone overlay — guides only, no effect on rendered output */}
        <SafeZoneOverlayKonva
          canvasW={template.width}
          canvasH={template.height}
          visible={state.template.settings?.guides !== false}
        />
      </div>
    </div>
  );
}
