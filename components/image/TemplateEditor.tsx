"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { toastSuccess } from "@/lib/toast-success";
import type { ImageTemplate, TemplateDefinition } from "@/lib/image/templates";

// ---------------------------------------------------------------------------
// A-NEW-3 — Template editor (Fabric.js canvas).
//
// Fabric.js is loaded dynamically (avoids SSR issues with the browser Canvas API).
// The canvas shows a live preview of the template definition.
//
// Editable via the controls panel:
//   - Composition type (changes text-zone position)
//   - Overlay alpha slider
//   - Font family picker (bundled fonts)
//   - Max headline font size slider
//   - Logo position anchor (9-zone picker)
//   - Logo size + padding sliders
//
// The overlay band on the canvas IS draggable/resizable — moving it sets
// definition.customTextZone. Resetting composition type clears customTextZone.
//
// "Test with real background" fires POST /api/platform/image/templates/preview.
// Save calls PATCH /api/platform/image/templates/[id].
// ---------------------------------------------------------------------------

type CompositionType = "split_layout" | "gradient_fade" | "full_background" | "geometric" | "texture";
type LogoPos = "top-right" | "bottom-right" | "bottom-left" | "watermark-center";

const TEXT_ZONE_MAP: Record<CompositionType, { x: number; y: number; width: number; height: number; alignment: "left" | "center" | "right" }> = {
  split_layout:    { x: 58, y: 15, width: 37, height: 70, alignment: "left" },
  gradient_fade:   { x: 5,  y: 15, width: 37, height: 70, alignment: "left" },
  full_background: { x: 5,  y: 68, width: 90, height: 24, alignment: "center" },
  geometric:       { x: 20, y: 25, width: 60, height: 50, alignment: "center" },
  texture:         { x: 15, y: 20, width: 70, height: 60, alignment: "center" },
};

const COMPOSITION_LABELS: Record<CompositionType, string> = {
  split_layout: "Split layout",
  gradient_fade: "Gradient fade",
  full_background: "Full background",
  geometric: "Geometric",
  texture: "Texture",
};

const LOGO_POSITION_LABELS: Record<LogoPos, string> = {
  "top-right": "Top right",
  "bottom-right": "Bottom right",
  "bottom-left": "Bottom left",
  "watermark-center": "Centre watermark",
};

const BUNDLED_FONTS = ["Inter", "Roboto", "Montserrat", "Open Sans", "Poppins"] as const;

// Canvas dimensions for each aspect ratio
const CANVAS_SIZES: Record<string, { w: number; h: number }> = {
  "1x1":  { w: 480, h: 480 },
  "4x5":  { w: 384, h: 480 },
  "9x16": { w: 270, h: 480 },
  "16x9": { w: 480, h: 270 },
  "4x3":  { w: 480, h: 360 },
};

// Probe A1 background paths (used as sample backgrounds)
const SAMPLE_BG_PATHS: Record<string, string> = {
  "1x1":  "00000000-0000-0000-0000-000000000001/generated/1779998135990-probe-a1-1_1.png",
  "4x5":  "00000000-0000-0000-0000-000000000001/generated/1779998142223-probe-a1-4_5.png",
  "9x16": "00000000-0000-0000-0000-000000000001/generated/1779998147249-probe-a1-9_16.png",
  "16x9": "00000000-0000-0000-0000-000000000001/generated/1779998152163-probe-a1-16_9.png",
  "4x3":  "00000000-0000-0000-0000-000000000001/generated/1779998157510-probe-a1-4_3.png",
};

interface Props {
  template: ImageTemplate;
  companyId: string;
  userId: string;
}

export function TemplateEditor({ template, companyId, userId: _userId }: Props) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // fabric types are not available as a proper TS package — using unknown
  const fabricRef = useRef<unknown>(null);
  const overlayRectRef = useRef<unknown>(null);

  const [def, setDef] = useState<TemplateDefinition>({ ...template.definition });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [headlineText, setHeadlineText] = useState("Your headline goes here");

  const canvasSize = CANVAS_SIZES[template.aspectRatio] ?? { w: 480, h: 480 };

  // Resolve the effective text zone (custom or default).
  const effectiveZone = useCallback((d: TemplateDefinition) => {
    return d.customTextZone ?? TEXT_ZONE_MAP[d.compositionType];
  }, []);

  // Initialise / update Fabric.js canvas.
  useEffect(() => {
    let cancelled = false;

    async function initCanvas() {
      if (!canvasRef.current) return;
      const { Canvas, Rect, FabricText } = await import("fabric");
      if (cancelled) return;

      // Destroy existing canvas if reinitialising.
      if (fabricRef.current) {
        (fabricRef.current as { dispose(): void }).dispose();
      }

      const canvas = new Canvas(canvasRef.current, {
        width: canvasSize.w,
        height: canvasSize.h,
        backgroundColor: "#e5e7eb",
        selection: false,
      });
      fabricRef.current = canvas;

      // Overlay band.
      const zone = effectiveZone(def);
      const ox = (zone.x / 100) * canvasSize.w;
      const oy = (zone.y / 100) * canvasSize.h;
      const ow = (zone.width / 100) * canvasSize.w;
      const oh = (zone.height / 100) * canvasSize.h;

      const alpha = def.overlayAlpha;
      const r = Math.round(255 * alpha);
      const overlayRect = new Rect({
        left: ox, top: oy, width: ow, height: oh,
        fill: `rgba(0, 0, 0, ${alpha})`,
        stroke: "rgba(255,255,255,0.8)",
        strokeWidth: 2,
        strokeDashArray: [6, 4],
        hasControls: true,
        hasBorders: true,
        cornerColor: "#ffffff",
        cornerSize: 10,
        lockRotation: true,
      });
      void r;
      overlayRectRef.current = overlayRect;
      canvas.add(overlayRect);

      // Headline text placeholder.
      const label = new FabricText(headlineText, {
        left: ox + 8,
        top: oy + 8,
        width: ow - 16,
        fontSize: Math.min(def.maxHeadlineFontSize, 24),
        fill: "#ffffff",
        fontFamily: def.fontFamily ?? "Inter",
        fontWeight: "bold",
        selectable: false,
        evented: false,
      });
      canvas.add(label);

      // Logo zone indicator.
      const logoSize = (def.logoSizePercent / 100) * Math.min(canvasSize.w, canvasSize.h);
      const lp = def.logoPadding;
      let lx = canvasSize.w - logoSize - lp;
      let ly = canvasSize.h - logoSize - lp;
      if (def.logoPosition === "top-right")       { lx = canvasSize.w - logoSize - lp; ly = lp; }
      if (def.logoPosition === "bottom-left")      { lx = lp; }
      if (def.logoPosition === "watermark-center") { lx = (canvasSize.w - logoSize) / 2; ly = (canvasSize.h - logoSize) / 2; }

      const logoRect = new Rect({
        left: lx, top: ly, width: logoSize, height: logoSize,
        fill: "rgba(255,255,255,0.25)",
        stroke: "rgba(255,255,255,0.7)",
        strokeWidth: 1.5,
        strokeDashArray: [4, 3],
        selectable: false, evented: false,
      });
      const logoLabel = new FabricText("Logo", {
        left: lx + logoSize / 2, top: ly + logoSize / 2,
        originX: "center", originY: "center",
        fontSize: 11, fill: "rgba(255,255,255,0.9)",
        fontFamily: "sans-serif", selectable: false, evented: false,
      });
      canvas.add(logoRect, logoLabel);

      // When the overlay rect is moved/resized, update customTextZone.
      overlayRect.on("modified", () => {
        const o = overlayRect;
        const bw = canvas.getWidth();
        const bh = canvas.getHeight();
        const scaleX = o.scaleX ?? 1;
        const scaleY = o.scaleY ?? 1;
        setDef((prev) => ({
          ...prev,
          customTextZone: {
            x: ((o.left ?? 0) / bw) * 100,
            y: ((o.top ?? 0) / bh) * 100,
            width: (((o.width ?? 0) * scaleX) / bw) * 100,
            height: (((o.height ?? 0) * scaleY) / bh) * 100,
            alignment: prev.compositionType === "full_background" ? "center" : "left",
          },
        }));
      });

      canvas.renderAll();
    }

    void initCanvas();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.compositionType, def.overlayAlpha, def.logoPosition, def.logoSizePercent, def.logoPadding, def.maxHeadlineFontSize, def.fontFamily, canvasSize.w, canvasSize.h, headlineText]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/platform/image/templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId, definition: def }),
      });
      const json = await res.json() as { ok: boolean; error?: { message: string } };
      if (json.ok) {
        toastSuccess("Template saved.");
        router.refresh();
      } else {
        toast.error(json.error?.message ?? "Save failed.");
      }
    } catch {
      toast.error("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setPreviewUrl(null);
    try {
      const bgPath = SAMPLE_BG_PATHS[template.aspectRatio];
      if (!bgPath) { toast.error("No sample background for this ratio."); return; }

      const res = await fetch("/api/platform/image/templates/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyId,
          background_storage_path: bgPath,
          definition: def,
          headline_text: headlineText,
        }),
      });
      const json = await res.json() as { ok: boolean; data?: { signedUrl: string | null } };
      if (json.ok && json.data?.signedUrl) {
        setPreviewUrl(json.data.signedUrl);
      } else {
        toast.error("Preview generation failed.");
      }
    } catch {
      toast.error("Network error.");
    } finally {
      setTesting(false);
    }
  }

  function resetComposition(ct: CompositionType) {
    setDef((prev) => ({ ...prev, compositionType: ct, customTextZone: undefined }));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Edit template — {template.name} ({template.aspectRatio})</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Drag the dashed overlay on the canvas, or use the controls below.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" onClick={() => router.push("/company/image/templates")}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
        {/* Canvas */}
        <div className="space-y-3">
          <canvas
            ref={canvasRef}
            width={canvasSize.w}
            height={canvasSize.h}
            className="rounded-xl border border-border shadow-sm"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={headlineText}
              onChange={(e) => setHeadlineText(e.target.value)}
              placeholder="Headline preview"
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
              {testing ? "Generating…" : "Test with background"}
            </Button>
          </div>
          {previewUrl && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Preview result:</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="Template preview" className="rounded-lg border border-border max-w-full" style={{ maxWidth: canvasSize.w }} />
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="space-y-5">
          {/* Composition type */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Composition (text zone position)</label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(COMPOSITION_LABELS) as CompositionType[]).map((ct) => (
                <button
                  key={ct}
                  type="button"
                  onClick={() => resetComposition(ct)}
                  className={`rounded-md px-2.5 py-1 text-xs border transition-colors ${def.compositionType === ct && !def.customTextZone ? "bg-primary text-primary-foreground border-primary" : "border-border bg-muted hover:bg-accent"}`}
                >
                  {COMPOSITION_LABELS[ct]}
                </button>
              ))}
            </div>
            {def.customTextZone && (
              <p className="mt-1 text-xs text-amber-600">
                Custom position active.{" "}
                <button type="button" className="underline" onClick={() => resetComposition(def.compositionType)}>
                  Reset to {COMPOSITION_LABELS[def.compositionType]}
                </button>
              </p>
            )}
          </div>

          {/* Overlay alpha */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Overlay opacity — {Math.round(def.overlayAlpha * 100)}%</label>
            <input
              type="range" min="0.3" max="1" step="0.05"
              value={def.overlayAlpha}
              onChange={(e) => setDef((p) => ({ ...p, overlayAlpha: parseFloat(e.target.value) }))}
              className="w-full"
            />
          </div>

          {/* Font family */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Font family</label>
            <select
              value={def.fontFamily ?? "Inter"}
              onChange={(e) => setDef((p) => ({ ...p, fontFamily: e.target.value }))}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {BUNDLED_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          {/* Max headline font size */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Max headline font size — {def.maxHeadlineFontSize}px</label>
            <input
              type="range" min="24" max="120" step="2"
              value={def.maxHeadlineFontSize}
              onChange={(e) => setDef((p) => ({ ...p, maxHeadlineFontSize: parseInt(e.target.value) }))}
              className="w-full"
            />
          </div>

          {/* Logo position */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Logo position</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.entries(LOGO_POSITION_LABELS) as [LogoPos, string][]).map(([pos, label]) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => setDef((p) => ({ ...p, logoPosition: pos }))}
                  className={`rounded-md px-2.5 py-1.5 text-xs border transition-colors text-left ${def.logoPosition === pos ? "bg-primary text-primary-foreground border-primary" : "border-border bg-muted hover:bg-accent"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Logo size */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Logo size — {def.logoSizePercent}% of frame</label>
            <input
              type="range" min="5" max="40" step="1"
              value={def.logoSizePercent}
              onChange={(e) => setDef((p) => ({ ...p, logoSizePercent: parseInt(e.target.value) }))}
              className="w-full"
            />
          </div>

          {/* Logo padding */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Logo padding — {def.logoPadding}px</label>
            <input
              type="range" min="0" max="60" step="2"
              value={def.logoPadding}
              onChange={(e) => setDef((p) => ({ ...p, logoPadding: parseInt(e.target.value) }))}
              className="w-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
