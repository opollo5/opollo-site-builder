"use client";

/**
 * KonvaInteractionLayer — react-konva overlay for canvas interaction (U2+U3).
 *
 * Rendered on top of CanvasContent (DOM renderer). Provides:
 *   - Layer selection (click a transparent Rect that mirrors each layer)
 *   - Drag to move with snap guides (§6.4, U3) — live feedback via update_layer_live
 *   - Transformer: resize handles + rotation handle per §6.3 — live feedback
 *
 * Live drag/resize pattern:
 *   onDragMove / onTransform  → dispatch(update_layer_live)  — no undo entry, real-time DOM update
 *   onDragEnd  / onTransformEnd → dispatch(update_layer)     — one undoable op per gesture
 *
 * The model→Konva sync useEffect is guarded against fighting the Transformer
 * during live resize via isTransformingRef.
 */

import { useEffect, useRef, useState } from "react";
import { Layer, Rect, Stage, Transformer } from "react-konva";
import type Konva from "konva";

import { useEditor } from "./EditorContext";
import { GuideLines, computeSnap, type Guide } from "./GuideLines";

interface KonvaInteractionLayerProps {
  width: number;
  height: number;
}

export function KonvaInteractionLayer({ width, height }: KonvaInteractionLayerProps) {
  const { state, dispatch, displayTemplate } = useEditor();
  const { selectedLayerId } = state;
  // Use displayTemplate so Konva Rects track the reflowed layer positions in
  // active variants. Previously reading state.template (base coords) caused
  // Rects to appear at BASE positions while CanvasContent showed reflowed
  // positions — breaking selection, drag, and Transformer handles in variants.
  const template = displayTemplate;

  const transformerRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef<Map<string, Konva.Rect>>(new Map());
  const [guides, setGuides] = useState<Guide[]>([]);

  // Track which layer ids are actively being transformed (resized/rotated) so
  // the model→Konva sync useEffect doesn't fight the Transformer mid-gesture.
  const isTransformingRef = useRef<Set<string>>(new Set());

  // Attach / detach Transformer when selection changes.
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const node = selectedLayerId ? shapeRefs.current.get(selectedLayerId) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedLayerId]);

  // Sync Konva shape positions when EditorContext changes externally (undo/redo,
  // panel edits). Guarded for dragging AND transforming to avoid feedback loops.
  useEffect(() => {
    for (const layer of template.layers) {
      const node = shapeRefs.current.get(layer.id);
      if (node && !node.isDragging() && !isTransformingRef.current.has(layer.id)) {
        node.x(layer.x);
        node.y(layer.y);
        node.width(layer.width);
        node.height(layer.height);
        node.rotation(layer.rotation);
        node.scaleX(1);
        node.scaleY(1);
      }
    }
  }, [template.layers]);

  const guidesEnabled = template.settings?.guides !== false;

  const snapLayers = template.layers.map((l) => ({
    id: l.id, x: l.x, y: l.y, width: l.width, height: l.height,
  }));

  return (
    <Stage
      width={width}
      height={height}
      style={{ position: "absolute", top: 0, left: 0 }}
      onMouseDown={(e) => {
        if (e.target === e.target.getStage()) {
          dispatch({ type: "select", layerId: null });
        }
      }}
    >
      <Layer>
        {/* Snap guide lines (§6.4) */}
        {guidesEnabled && <GuideLines guides={guides} width={width} height={height} />}

        {/* Render Rects in REVERSE layer order so that the visually-topmost layer
            (layers[0]) is the LAST Rect drawn — Konva top z-order — and receives
            pointer events first. */}
        {[...template.layers].reverse().map((layer) => (
          <Rect
            key={layer.id}
            ref={(node) => {
              if (node) shapeRefs.current.set(layer.id, node);
              else shapeRefs.current.delete(layer.id);
            }}
            x={layer.x}
            y={layer.y}
            width={layer.width}
            height={layer.height}
            rotation={layer.rotation}
            draggable={!layer.locked}
            fill="transparent"
            listening={!layer.hide}
            onMouseDown={() => dispatch({ type: "select", layerId: layer.id })}

            // LIVE drag: snap + dispatch update_layer_live on every frame so the
            // DOM renderer (CanvasContent) tracks the cursor in real-time.
            onDragMove={(e) => {
              const node = e.target as Konva.Rect;
              let x = node.x();
              let y = node.y();
              if (guidesEnabled) {
                const snapped = computeSnap(
                  { x, y, width: layer.width, height: layer.height, id: layer.id },
                  snapLayers, width, height,
                );
                x = snapped.x;
                y = snapped.y;
                node.x(x);
                node.y(y);
                setGuides(snapped.guides);
              }
              dispatch({
                type: "update_layer_live",
                layerId: layer.id,
                patch: { x: Math.round(x), y: Math.round(y) },
              });
            }}

            // Commit drag: single undoable op capturing pre-drag → post-drag.
            onDragEnd={(e) => {
              setGuides([]);
              dispatch({
                type: "update_layer",
                layerId: layer.id,
                patch: { x: Math.round(e.target.x()), y: Math.round(e.target.y()) },
              });
            }}

            // LIVE resize/rotate: absorb scale into w/h on every frame so the DOM
            // renderer tracks the Transformer handles in real-time.
            onTransform={(e) => {
              isTransformingRef.current.add(layer.id);
              const node = e.target as Konva.Rect;
              dispatch({
                type: "update_layer_live",
                layerId: layer.id,
                patch: {
                  x: Math.round(node.x()),
                  y: Math.round(node.y()),
                  width: Math.max(4, Math.round(node.width() * node.scaleX())),
                  height: Math.max(4, Math.round(node.height() * node.scaleY())),
                  rotation: Math.round(node.rotation() * 100) / 100,
                },
              });
            }}

            // Commit resize/rotate: absorb scale, then single undoable op.
            onTransformEnd={(e) => {
              isTransformingRef.current.delete(layer.id);
              const node = e.target as Konva.Rect;
              const scaleX = node.scaleX();
              const scaleY = node.scaleY();
              node.scaleX(1);
              node.scaleY(1);
              dispatch({
                type: "update_layer",
                layerId: layer.id,
                patch: {
                  x: Math.round(node.x()),
                  y: Math.round(node.y()),
                  width: Math.max(4, Math.round(node.width() * scaleX)),
                  height: Math.max(4, Math.round(node.height() * scaleY)),
                  rotation: Math.round(node.rotation() * 100) / 100,
                },
              });
            }}
          />
        ))}

        <Transformer
          ref={transformerRef}
          rotateEnabled
          keepRatio={false}
          enabledAnchors={[
            "top-left", "top-center", "top-right",
            "middle-right", "bottom-right", "bottom-center",
            "bottom-left", "middle-left",
          ]}
          boundBoxFunc={(oldBox, newBox) => {
            if (Math.abs(newBox.width) < 4 || Math.abs(newBox.height) < 4) return oldBox;
            return newBox;
          }}
          anchorStroke="#3b82f6"
          anchorFill="#ffffff"
          anchorSize={8}
          borderStroke="#3b82f6"
          borderDash={[]}
          rotateAnchorOffset={24}
        />
      </Layer>
    </Stage>
  );
}
