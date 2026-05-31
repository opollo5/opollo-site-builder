"use client";

/**
 * TextLayerPanel — properties panel for a selected TextLayer (U5, U6, U7).
 *
 * U5: Typography — font family, size, weight, kerning, line-height, align,
 *     transform, decoration, direction, color.
 * U6: Text Fit toggle, text box padding/border, secondary styles.
 * U7: Glyph-hugging background — color, padding H/V, shadow, radius, shift.
 */

import { useCallback } from "react";
import {
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useEditor } from "../EditorContext";
import type { TextLayer } from "@/lib/image/template-model";
import { VarMetadataPanel } from "./VarMetadataPanel";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-xs text-muted-foreground w-24 shrink-0">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider pb-1 border-b border-border mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

function NumInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  className = "",
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  return (
    <Input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      className={`h-7 text-xs px-2 ${className}`}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) onChange(v);
      }}
    />
  );
}

function ColorInput({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={value ?? "#ffffff"}
        className="w-7 h-7 rounded border border-border cursor-pointer p-0.5 bg-transparent"
        onChange={(e) => onChange(e.target.value)}
      />
      <Input
        value={value ?? ""}
        placeholder="None"
        className="h-7 text-xs flex-1"
        onChange={(e) => onChange(e.target.value || null)}
      />
      {value && (
        <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onChange(null)}>✕</button>
      )}
    </div>
  );
}

function SelectInput<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      value={value}
      className="h-7 text-xs w-full border border-input rounded px-2 bg-background"
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

const FONT_FAMILIES = ["Inter", "Roboto", "Montserrat", "Open Sans", "Poppins"];

const H_ALIGN_ICONS = {
  left:    { icon: AlignLeft,    label: "Align left" },
  center:  { icon: AlignCenter,  label: "Align centre" },
  right:   { icon: AlignRight,   label: "Align right" },
  justify: { icon: AlignJustify, label: "Justify" },
} as const;

const V_ALIGN_ICONS = {
  top:    { icon: AlignVerticalJustifyStart,  label: "Align top" },
  center: { icon: AlignVerticalJustifyCenter, label: "Align middle" },
  bottom: { icon: AlignVerticalJustifyEnd,    label: "Align bottom" },
} as const;
const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

// ─── Panel ────────────────────────────────────────────────────────────────────

export function TextLayerPanel({ layer }: { layer: TextLayer }) {
  const { dispatch } = useEditor();
  const up = useCallback(
    (patch: Partial<TextLayer>) =>
      dispatch({ type: "update_layer", layerId: layer.id, patch }),
    [dispatch, layer.id],
  );

  return (
    <div className="px-3 py-2 space-y-1 text-sm">

      {/* ── U5: TYPOGRAPHY ─────────────────────────────────────────── */}
      <Section title="Typography">
        <Field label="Font">
          {/* Each option renders in its own typeface so the user can visually compare */}
          <select
            value={layer.font_family}
            className="h-7 text-xs w-full border border-input rounded px-2 bg-background"
            onChange={(e) => up({ font_family: e.target.value })}
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
            ))}
          </select>
        </Field>
        <Field label="Size">
          <NumInput value={layer.font_size} onChange={(v) => up({ font_size: v })} min={4} max={400} />
        </Field>
        <Field label="Weight">
          <SelectInput
            value={String(layer.font_weight) as typeof layer.font_weight extends number ? string : never}
            options={FONT_WEIGHTS.map((w) => ({ value: String(w), label: String(w) }))}
            onChange={(v) => up({ font_weight: parseInt(v, 10) })}
          />
        </Field>
        <Field label="Color">
          <ColorInput value={layer.color} onChange={(v) => up({ color: v ?? "#000000" })} />
        </Field>
        <div className="flex gap-1">
          <div className="flex-1">
            <Field label="Kerning">
              <NumInput value={layer.letter_spacing} onChange={(v) => up({ letter_spacing: v })} min={-20} max={40} step={0.5} />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Line Ht">
              <NumInput value={layer.line_height} onChange={(v) => up({ line_height: v })} min={0.5} max={4} step={0.05} />
            </Field>
          </div>
        </div>

        <Field label="H-Align">
          <TooltipProvider delayDuration={400}>
            <div className="flex gap-1">
              {(["left", "center", "right", "justify"] as const).map((a) => {
                const { icon: Icon, label } = H_ALIGN_ICONS[a];
                return (
                  <Tooltip key={a}>
                    <TooltipTrigger asChild>
                      <Button
                        variant={layer.text_align_h === a ? "default" : "outline"}
                        size="sm"
                        className="flex-1 h-7 px-1"
                        onClick={() => up({ text_align_h: a })}
                        aria-label={label}
                      >
                        <Icon size={14} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">{label}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </TooltipProvider>
        </Field>
        <Field label="V-Align">
          <TooltipProvider delayDuration={400}>
            <div className="flex gap-1">
              {(["top", "center", "bottom"] as const).map((a) => {
                const { icon: Icon, label } = V_ALIGN_ICONS[a];
                return (
                  <Tooltip key={a}>
                    <TooltipTrigger asChild>
                      <Button
                        variant={layer.text_align_v === a ? "default" : "outline"}
                        size="sm"
                        className="flex-1 h-7 px-1"
                        onClick={() => up({ text_align_v: a })}
                        aria-label={label}
                      >
                        <Icon size={14} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">{label}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </TooltipProvider>
        </Field>
        <Field label="Transform">
          <SelectInput
            value={layer.text_transform}
            options={[
              { value: "none", label: "None" },
              { value: "uppercase", label: "UPPER" },
              { value: "lowercase", label: "lower" },
              { value: "capitalize", label: "Title" },
            ]}
            onChange={(v) => up({ text_transform: v as TextLayer["text_transform"] })}
          />
        </Field>
        <Field label="Decoration">
          <SelectInput
            value={layer.text_decoration}
            options={[
              { value: "none", label: "None" },
              { value: "underline", label: "Underline" },
              { value: "line-through", label: "Strike" },
            ]}
            onChange={(v) => up({ text_decoration: v as TextLayer["text_decoration"] })}
          />
        </Field>
        <Field label="Direction">
          <SelectInput
            value={layer.direction}
            options={[
              { value: "ltr", label: "LTR" },
              { value: "rtl", label: "RTL" },
            ]}
            onChange={(v) => up({ direction: v as TextLayer["direction"] })}
          />
        </Field>
      </Section>

      {/* ── U6: TEXT FIT + TEXT BOX + SECONDARY ────────────────────── */}
      <Section title="Text Fit">
        <div className="flex items-center gap-2 py-1">
          <input
            type="checkbox"
            id="text-fit-enabled"
            checked={layer.text_fit.enabled}
            onChange={(e) => up({ text_fit: { ...layer.text_fit, enabled: e.target.checked } })}
            className="cursor-pointer"
          />
          <label htmlFor="text-fit-enabled" className="text-xs cursor-pointer">Auto-size to fit box</label>
        </div>
        {layer.text_fit.enabled && (
          <div className="flex gap-1">
            <div className="flex-1">
              <Field label="Min size">
                <NumInput value={layer.text_fit.min_size} onChange={(v) => up({ text_fit: { ...layer.text_fit, min_size: v } })} min={4} max={200} />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Max size">
                <NumInput value={layer.text_fit.max_size} onChange={(v) => up({ text_fit: { ...layer.text_fit, max_size: v } })} min={4} max={400} />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Max lines">
                <NumInput value={layer.text_fit.max_lines} onChange={(v) => up({ text_fit: { ...layer.text_fit, max_lines: Math.round(v) } })} min={1} max={20} />
              </Field>
            </div>
          </div>
        )}
      </Section>

      <Section title="Text Box">
        <Field label="Padding">
          <NumInput
            value={layer.text_box.padding ?? 0}
            onChange={(v) => up({ text_box: { ...layer.text_box, padding: v } })}
            min={0} max={200}
          />
        </Field>
      </Section>

      <Section title="Secondary Style">
        <p className="text-xs text-muted-foreground mb-1">Applied to *asterisk*-wrapped text (§6.6)</p>
        <Field label="Color">
          <ColorInput
            value={layer.secondary.color}
            onChange={(v) => up({ secondary: { ...layer.secondary, color: v } })}
          />
        </Field>
        <Field label="Font">
          <SelectInput
            value={(layer.secondary.font_family ?? "") as string}
            options={[
              { value: "", label: "Same as primary" },
              ...FONT_FAMILIES.map((f) => ({ value: f, label: f })),
            ]}
            onChange={(v) => up({ secondary: { ...layer.secondary, font_family: v || null } })}
          />
        </Field>
      </Section>

      {/* ── U7: GLYPH-HUGGING BACKGROUND ───────────────────────────── */}
      <Section title="Per-line Background">
        <p className="text-xs text-muted-foreground mb-1">Pill background wrapping each line (§6.5)</p>
        <Field label="Color">
          <ColorInput
            value={layer.background.color}
            onChange={(v) => up({ background: { ...layer.background, color: v } })}
          />
        </Field>
        {layer.background.color && (
          <>
            <div className="flex gap-1">
              <div className="flex-1"><Field label="Pad H"><NumInput value={layer.background.padding_h} onChange={(v) => up({ background: { ...layer.background, padding_h: v } })} min={0} max={80} /></Field></div>
              <div className="flex-1"><Field label="Pad V"><NumInput value={layer.background.padding_v} onChange={(v) => up({ background: { ...layer.background, padding_v: v } })} min={0} max={80} /></Field></div>
            </div>
            <div className="flex gap-1">
              <div className="flex-1"><Field label="Radius"><NumInput value={layer.background.radius ?? 0} onChange={(v) => up({ background: { ...layer.background, radius: v } })} min={0} max={100} /></Field></div>
              <div className="flex-1"><Field label="Shift"><NumInput value={layer.background.shift ?? 0} onChange={(v) => up({ background: { ...layer.background, shift: v } })} min={-40} max={40} /></Field></div>
            </div>
            <Field label="Border">
              <ColorInput
                value={layer.background.border}
                onChange={(v) => up({ background: { ...layer.background, border: v } })}
              />
            </Field>
            {layer.background.border && (
              <Field label="Border W">
                <NumInput
                  value={layer.background.border_width ?? 1}
                  onChange={(v) => up({ background: { ...layer.background, border_width: v } })}
                  min={0} max={10}
                />
              </Field>
            )}
          </>
        )}
      </Section>

      {/* Content textarea */}
      <Section title="Content">
        <textarea
          className="w-full text-xs border border-input rounded px-2 py-1.5 bg-background resize-none h-20"
          value={layer.text}
          placeholder="Enter text…  Wrap *words* for secondary style."
          onChange={(e) => up({ text: e.target.value })}
        />
        <p className="text-xs text-muted-foreground mt-1">Wrap text in *asterisks* for secondary style.</p>
      </Section>

      {/* Variable metadata — §3.7, drives N-Series auto-form */}
      <div className="px-0">
        <VarMetadataPanel layer={layer} />
      </div>
    </div>
  );
}
