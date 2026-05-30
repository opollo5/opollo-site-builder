"use client";

/**
 * KonvaInteractionLayer — react-konva overlay for canvas interaction (U2).
 *
 * Rendered on top of CanvasContent (DOM renderer). Provides:
 *   - Layer selection (click a transparent Rect that mirrors each layer)
 *   - Drag to move (updates x,y in EditorContext on dragEnd)
 *   - Transformer: resize handles + rotation handle (updates w/h/rotation on transformEnd)
 *
 * The DOM renderer (CanvasContent) remains the source of visual truth;
 * this layer handles ONLY interaction. All shapes are fill="transparent".
 *
 * Design spec §6.3: Selected object shows outline + resize handles + rotate handle.
 * Fade heavy content during resize: handled via opacity in CanvasContent (U5+).
 */

import { useEffect, useRef } from "react";
import { Layer, Rect, Stage, Transformer } from "react-konva";
import type Konva from "konva";

import { useEditor } from "./EditorContext";

interface KonvaInteractionLayerProps {
  width: number;
  height: number;
}

export function KonvaInteractionLayer({ width, height }: KonvaInteractionLayerProps) {
  const { state, dispatch } = useEditor();
  const { template, selectedLayerId } = state;

  const transformerRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef<Map<string, Konva.Rect>>(new Map());

  // Attach / detach Transformer when selection changes.
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const node = selectedLayerId ? shapeRefs.current.get(selectedLayerId) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedLayerId]);

  // Sync Konva shape positions when EditorContext changes externally (undo/redo).
  useEffect(() => {
    for (const layer of template.layers) {
      const node = shapeRefs.current.get(layer.id);
      if (node && !node.isDragging()) {
        node.x(layer.x);
        node.y(layer.y);
        node.width(layer.width);
        node.height(layer.height);
        node.rotation(layer.rotation);
      }
    }
  }, [template.layers]);

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
        {template.layers.map((layer) => {
          const locked = layer.locked;
          return (
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
              draggable={!locked}
              fill="transparent"
              listening={!layer.hide}
              onMouseDown={() => dispatch({ type: "select", layerId: layer.id })}
              onDragEnd={(e) => {
                dispatch({
                  type: "update_layer",
                  layerId: layer.id,
                  patch: {
                    x: Math.round(e.target.x()),
                    y: Math.round(e.target.y()),
                  },
                });
              }}
              onTransformEnd={(e) => {
                const node = e.target as Konva.Rect;
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();
                // Absorb scale into width/height; reset scale to 1.
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
          );
        })}

        <Transformer
          ref={transformerRef}
          rotateEnabled
          keepRatio={false}
          enabledAnchors={[
            "top-left",
            "top-center",
            "top-right",
            "middle-right",
            "bottom-right",
            "bottom-center",
            "bottom-left",
            "middle-left",
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
