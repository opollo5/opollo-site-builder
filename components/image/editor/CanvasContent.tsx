"use client";

/**
 * CanvasContent — the DOM renderer for the v2 editor canvas.
 *
 * Design spec §6 (canonical DOM renderer). Each layer renders as an
 * absolutely positioned element. The editor canvas IS this renderer in
 * interactive mode — react-konva adds interaction handles on top (U2).
 *
 * Transform order (§6.1): position → rotateZ → rotateX/Y/Z → skew.
 * transform-origin: top left. box-sizing: content-box.
 */

import React from "react";
import type {
  Layer,
  TextLayer,
  ImageLayer,
  RectangleLayer,
  ShapeLayer,
  Gradient,
} from "@/lib/image/template-model";
import { isV1Layer } from "@/lib/image/template-model";
import { parseSecondaryRuns } from "@/lib/image/secondary-style-parser";
import { fitFontSize } from "@/lib/image/text-fit-utils";

// ─── Transform builder (§6.1) ─────────────────────────────────────────────────

function buildTransform(layer: Layer): string {
  const parts: string[] = [];
  if (layer.rotation) parts.push(`rotateZ(${layer.rotation}deg)`);
  if (layer.rotate_x) parts.push(`rotateX(${layer.rotate_x}deg)`);
  if (layer.rotate_y) parts.push(`rotateY(${layer.rotate_y}deg)`);
  if (layer.rotate_z && layer.rotation !== layer.rotate_z) parts.push(`rotateZ(${layer.rotate_z}deg)`);
  if (layer.skew_x)   parts.push(`skewX(${layer.skew_x}deg)`);
  if (layer.skew_y)   parts.push(`skewY(${layer.skew_y}deg)`);
  return parts.length ? parts.join(" ") : "none";
}

function layerBaseStyle(layer: Layer): React.CSSProperties {
  return {
    position: "absolute",
    left: layer.x,
    top: layer.y,
    width: layer.width,
    height: layer.height,
    opacity: layer.opacity,
    transform: buildTransform(layer),
    transformOrigin: "top left",
    boxSizing: "content-box",
    pointerEvents: "none",
    overflow: "hidden",
  };
}

// ─── Gradient CSS ─────────────────────────────────────────────────────────────

function gradientToCss(g: Gradient): string {
  const stops = g.stops
    .map((s) => {
      // If stop has opacity < 1, convert to rgba() so the CSS gradient respects it.
      if (s.opacity !== undefined && s.opacity < 1 && /^#[0-9a-fA-F]{6}$/.test(s.color)) {
        const r = parseInt(s.color.slice(1, 3), 16);
        const gv = parseInt(s.color.slice(3, 5), 16);
        const b = parseInt(s.color.slice(5, 7), 16);
        return `rgba(${r},${gv},${b},${s.opacity.toFixed(3)}) ${(s.position * 100).toFixed(1)}%`;
      }
      return `${s.color} ${(s.position * 100).toFixed(1)}%`;
    })
    .join(", ");
  if (g.type === "radial") return `radial-gradient(circle, ${stops})`;
  return `linear-gradient(${g.angle ?? 0}deg, ${stops})`;
}

// ─── Layer renderers ──────────────────────────────────────────────────────────

function RectLayer({ layer }: { layer: RectangleLayer }) {
  const bg = layer.gradient
    ? { background: gradientToCss(layer.gradient) }
    : { backgroundColor: layer.color ?? "transparent" };

  const borderStyle = layer.border
    ? {
        borderStyle: layer.border.style,
        borderWidth: layer.border.width,
        borderColor: layer.border.color,
      }
    : {};

  return (
    <div
      style={{
        ...layerBaseStyle(layer),
        ...bg,
        ...borderStyle,
        borderRadius: layer.border_radius || undefined,
      }}
    />
  );
}

// ─── Shape layer renderer ─────────────────────────────────────────────────────
// Uses inline SVG for pixel-identical output with the sharp renderer.
// SVG primitives exactly match buildShapeLayerSvg() in layer-renderer.ts.

function ShapeLayerEl({ layer }: { layer: ShapeLayer }) {
  const { width: w, height: h, shapeKind, color, gradient, border } = layer;

  const fill = gradient ? gradientToCss(gradient) : (color ?? "transparent");
  const strokeAttrs = (shapeKind !== "line" && border)
    ? { stroke: border.color, strokeWidth: border.width }
    : {};

  let shapeEl: React.ReactNode;
  switch (shapeKind) {
    case "ellipse":
      shapeEl = (
        <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2}
          fill={fill} {...strokeAttrs} />
      );
      break;
    case "triangle":
      shapeEl = (
        <polygon points={`${w / 2},0 ${w},${h} 0,${h}`}
          fill={fill} {...strokeAttrs} />
      );
      break;
    case "line":
      shapeEl = (
        <line x1={0} y1={h / 2} x2={w} y2={h / 2}
          stroke={color ?? "#000000"} strokeWidth={h} />
      );
      break;
    case "diamond":
      shapeEl = (
        <polygon points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`}
          fill={fill} {...strokeAttrs} />
      );
      break;
    case "right_triangle":
      shapeEl = (
        <polygon points={`0,${h} ${w},${h} 0,0`} fill={fill} {...strokeAttrs} />
      );
      break;
    case "pentagon": {
      const p5 = Array.from({ length: 5 }, (_, i) => {
        const a = (2 * Math.PI * i) / 5 - Math.PI / 2;
        return `${(w / 2 + (w / 2) * Math.cos(a)).toFixed(2)},${(h / 2 + (h / 2) * Math.sin(a)).toFixed(2)}`;
      }).join(" ");
      shapeEl = <polygon points={p5} fill={fill} {...strokeAttrs} />;
      break;
    }
    case "hexagon": {
      const p6 = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI * i) / 3;
        return `${(w / 2 + (w / 2) * Math.cos(a)).toFixed(2)},${(h / 2 + (h / 2) * Math.sin(a)).toFixed(2)}`;
      }).join(" ");
      shapeEl = <polygon points={p6} fill={fill} {...strokeAttrs} />;
      break;
    }
    case "star": {
      const starPts = Array.from({ length: 10 }, (_, i) => {
        const a = (Math.PI * i) / 5 - Math.PI / 2;
        const r = i % 2 === 0 ? 1 : 0.4;
        return `${(w / 2 + (w / 2) * r * Math.cos(a)).toFixed(2)},${(h / 2 + (h / 2) * r * Math.sin(a)).toFixed(2)}`;
      }).join(" ");
      shapeEl = <polygon points={starPts} fill={fill} {...strokeAttrs} />;
      break;
    }
    case "arrow": {
      const arrowPts = [
        `0,${(0.25 * h).toFixed(2)}`,
        `${(0.62 * w).toFixed(2)},${(0.25 * h).toFixed(2)}`,
        `${(0.62 * w).toFixed(2)},0`,
        `${w},${(0.5 * h).toFixed(2)}`,
        `${(0.62 * w).toFixed(2)},${h}`,
        `${(0.62 * w).toFixed(2)},${(0.75 * h).toFixed(2)}`,
        `0,${(0.75 * h).toFixed(2)}`,
      ].join(" ");
      shapeEl = <polygon points={arrowPts} fill={fill} {...strokeAttrs} />;
      break;
    }
  }

  return (
    <div style={{ ...layerBaseStyle(layer), overflow: "visible" }}>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: "block", overflow: "visible" }}
      >
        {gradient && (
          <defs>
            <linearGradient id={`sg_${layer.id}`} x1="0%" y1="0%" x2="0%" y2="100%"
              gradientTransform={`rotate(${gradient.angle ?? 0}, ${w / 2}, ${h / 2})`}>
              {gradient.stops.map((s, i) => (
                <stop key={i} offset={`${(s.position * 100).toFixed(1)}%`}
                  stopColor={s.color}
                  stopOpacity={s.opacity ?? 1} />
              ))}
            </linearGradient>
          </defs>
        )}
        {gradient
          ? React.cloneElement(shapeEl as React.ReactElement, { fill: `url(#sg_${layer.id})` })
          : shapeEl}
      </svg>
    </div>
  );
}

function ImageLayerEl({ layer }: { layer: ImageLayer }) {
  const src = layer.image_url ?? undefined;
  const objectFit = layer.fill === "fit" ? "contain" : "cover";
  const objectPosition = `${layer.anchor_x === "left" ? "left" : layer.anchor_x === "right" ? "right" : "center"} ${layer.anchor_y === "top" ? "top" : layer.anchor_y === "bottom" ? "bottom" : "center"}`;

  return (
    <div style={{ ...layerBaseStyle(layer), borderRadius: layer.border_radius || undefined }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          style={{ width: "100%", height: "100%", objectFit, objectPosition, display: "block" }}
          draggable={false}
        />
      ) : (
        <div
          className="w-full h-full flex items-center justify-center text-xs"
          style={{
            background: "hsl(var(--muted))",
            color: "hsl(var(--muted-foreground))",
            fontFamily: "Inter, sans-serif",
          }}
        >
          {layer.name}
        </div>
      )}
      {layer.tint_color && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: layer.tint_color,
            mixBlendMode: "multiply",
          }}
        />
      )}
    </div>
  );
}

function TextLayerEl({ layer }: { layer: TextLayer }) {
  const runs = parseSecondaryRuns(layer.text);
  const hasSecondary = runs.some((r) => r.secondary);

  // Compute display font size: use text-fit binary search if enabled (§7, §1.6).
  // This keeps the DOM renderer in sync with the sharp renderer for text-fit layers.
  const displayFontSize = layer.text_fit.enabled && layer.text.trim()
    ? fitFontSize(
        layer.text,
        { width: layer.width, height: layer.height },
        layer.text_fit,
        layer.font_weight,
        layer.letter_spacing,
        layer.line_height,
        layer.word_break,
      )
    : layer.font_size;

  const textAlignH = layer.text_align_h === "justify" ? "justify" : layer.text_align_h;
  const justifyContent =
    layer.text_align_h === "left" ? "flex-start"
    : layer.text_align_h === "right" ? "flex-end"
    : "center";
  const alignItems =
    layer.text_align_v === "top" ? "flex-start"
    : layer.text_align_v === "bottom" ? "flex-end"
    : "center";

  const textStyle: React.CSSProperties = {
    fontFamily: `'${layer.font_family}', sans-serif`,
    fontSize: displayFontSize,
    fontWeight: layer.font_weight,
    color: layer.color,
    textAlign: textAlignH as React.CSSProperties["textAlign"],
    letterSpacing: layer.letter_spacing,
    lineHeight: layer.line_height,
    textTransform: layer.text_transform as React.CSSProperties["textTransform"],
    textDecoration: layer.text_decoration === "none" ? "none" : layer.text_decoration,
    wordBreak: layer.word_break as React.CSSProperties["wordBreak"],
    direction: layer.direction,
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
    textRendering: "optimizeLegibility",
  };

  const bgStyle: React.CSSProperties = layer.background.color
    ? {
        backgroundColor: layer.background.color,
        padding: `${layer.background.padding_v}px ${layer.background.padding_h}px`,
        borderRadius: layer.background.radius ?? undefined,
        boxDecorationBreak: "clone" as React.CSSProperties["boxDecorationBreak"],
        WebkitBoxDecorationBreak: "clone" as React.CSSProperties["WebkitBoxDecorationBreak"],
      }
    : {};

  return (
    <div
      style={{
        ...layerBaseStyle(layer),
        display: "flex",
        flexDirection: "column",
        justifyContent,
        alignItems,
        padding: layer.text_box.padding ?? undefined,
      }}
    >
      <span style={{ ...textStyle, ...bgStyle }}>
        {hasSecondary
          ? runs.map((run, i) =>
              run.secondary ? (
                <span
                  key={i}
                  style={{
                    color: layer.secondary.color ?? layer.color,
                    fontFamily: layer.secondary.font_family
                      ? `'${layer.secondary.font_family}', sans-serif`
                      : undefined,
                  }}
                >
                  {run.text}
                </span>
              ) : (
                <React.Fragment key={i}>{run.text}</React.Fragment>
              ),
            )
          : layer.text || <span style={{ opacity: 0.3 }}>Empty text layer</span>}
      </span>
    </div>
  );
}

// ─── Selection outline ────────────────────────────────────────────────────────

function SelectionOutline({ layer }: { layer: Layer }) {
  return (
    <div
      style={{
        position: "absolute",
        left: layer.x - 1,
        top: layer.y - 1,
        width: layer.width + 2,
        height: layer.height + 2,
        border: "2px solid hsl(var(--primary))",
        pointerEvents: "none",
        boxSizing: "content-box",
        transform: buildTransform(layer),
        transformOrigin: "top left",
      }}
    />
  );
}

// ─── Canvas content ───────────────────────────────────────────────────────────

interface CanvasContentProps {
  template: import("@/lib/image/template-model").Template;
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
  /** scale factor applied by the parent canvas wrapper */
  scale: number;
}

export function CanvasContent({ template, selectedLayerId, onSelectLayer }: CanvasContentProps) {
  // Layers are top-first; DOM paints in document order (bottom child = on top visually).
  // Reverse so index 0 (visual top) is rendered last (DOM bottom = on top).
  const renderOrder = [...template.layers].reverse();

  return (
    <div
      style={{
        position: "relative",
        width: template.width,
        height: template.height,
        backgroundColor: template.background_color,
        overflow: "hidden",
        cursor: "default",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelectLayer(null);
      }}
    >
      {renderOrder.map((layer) => {
        if (layer.hide) return null;
        if (!isV1Layer(layer)) return null; // reserved types not rendered in V1

        let el: React.ReactNode;
        if (layer.type === "text") {
          el = <TextLayerEl key={layer.id} layer={layer} />;
        } else if (layer.type === "image") {
          el = <ImageLayerEl key={layer.id} layer={layer} />;
        } else if (layer.type === "shape") {
          el = <ShapeLayerEl key={layer.id} layer={layer as ShapeLayer} />;
        } else {
          el = <RectLayer key={layer.id} layer={layer as RectangleLayer} />;
        }

        return (
          <div
            key={layer.id}
            style={{ position: "absolute", inset: 0 }}
            onClick={(e) => { e.stopPropagation(); onSelectLayer(layer.id); }}
          >
            {el}
          </div>
        );
      })}

      {selectedLayerId && (() => {
        const sel = template.layers.find((l) => l.id === selectedLayerId);
        return sel ? <SelectionOutline key="sel" layer={sel} /> : null;
      })()}
    </div>
  );
}
