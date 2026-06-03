// lib/feedback/capture/annotate.ts — overlay shape types persisted with a screenshot.
// The actual annotation drawing lives in components/feedback/AnnotateOverlay.tsx (P9).
// This file defines the shared type only so P3 and P4 can reference it without
// pulling in the canvas/react-konva dependency.

export type AnnotationShape =
  | { type: "arrow"; x1: number; y1: number; x2: number; y2: number; colour: string }
  | { type: "rect"; x: number; y: number; w: number; h: number; colour: string }
  | { type: "text"; x: number; y: number; body: string; colour: string };

export type Annotation = {
  shapes: AnnotationShape[];
  // Viewport the annotation was drawn on (for scaling on replay).
  viewportW: number;
  viewportH: number;
};
