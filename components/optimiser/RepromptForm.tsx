"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// §9.8.7 reprompt UI split: controlled vs. free.
// Both modes serialise to a single string the existing pre_build_reprompt
// field on opt_proposals consumes. Phase 1.5 brief construction parses
// the structured shape back out for the Site Builder brief.

const PRESERVE_OPTIONS = [
  { id: "h1", label: "H1" },
  { id: "hero_copy", label: "Hero copy" },
  { id: "form_structure", label: "Form structure" },
  { id: "primary_cta_verb", label: "Primary CTA verb" },
  { id: "testimonials", label: "Testimonials" },
  { id: "trust_signals", label: "Trust signals" },
  { id: "faq", label: "FAQ section" },
  { id: "footer_cta", label: "Footer CTA" },
] as const;

export type RepromptValue = string;

export function RepromptForm({
  value,
  onChange,
}: {
  value: RepromptValue;
  onChange: (value: RepromptValue) => void;
}) {
  const [mode, setMode] = useState<"controlled" | "free">("controlled");
  const [keep, setKeep] = useState<Record<string, boolean>>({});
  const [changeOnly, setChangeOnly] = useState("");
  const [free, setFree] = useState(value);

  // Whenever the controlled inputs change, serialise into the reprompt
  // string the parent state consumes.
  const controlledSerialised = useMemo(() => {
    const keepLabels = PRESERVE_OPTIONS.filter((o) => keep[o.id]).map(
      (o) => o.label,
    );
    const parts: string[] = [];
    if (keepLabels.length > 0) {
      parts.push(`Preserve: ${keepLabels.join(", ")}.`);
    }
    if (changeOnly.trim()) {
      parts.push(`Change only: ${changeOnly.trim()}.`);
    }
    return parts.join(" ");
  }, [keep, changeOnly]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => {
            setMode("controlled");
            onChange(controlledSerialised);
          }}
          className={`rounded-md px-3 py-1.5 ${
            mode === "controlled"
              ? "bg-primary text-primary-foreground"
              : "border border-border hover:bg-muted"
          }`}
        >
          Controlled
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("free");
            onChange(free);
          }}
          className={`rounded-md px-3 py-1.5 ${
            mode === "free"
              ? "bg-primary text-primary-foreground"
              : "border border-border hover:bg-muted"
          }`}
        >
          Free reprompt
        </button>
        <span className="ml-2 text-xs text-muted-foreground">
          {mode === "controlled"
            ? "Pick what to preserve and what to change. Recommended."
            : "Freeform — lower precision, useful when the structured form doesn't fit."}
        </span>
      </div>

      {mode === "controlled" ? (
        <div className="space-y-3 rounded-md border border-border bg-card p-4">
          <fieldset>
            <legend className="text-sm font-medium">Preserve</legend>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PRESERVE_OPTIONS.map((opt) => (
                <label
                  key={opt.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(keep[opt.id])}
                    onChange={(e) => {
                      const next = { ...keep, [opt.id]: e.target.checked };
                      setKeep(next);
                      onChange(serialise(next, changeOnly));
                    }}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="block text-sm font-medium">Change only</label>
            <Input
              value={changeOnly}
              onChange={(e) => {
                setChangeOnly(e.target.value);
                onChange(serialise(keep, e.target.value));
              }}
              placeholder="e.g. CTA verb to 'Get a Quote'; trust signal placement"
              className="mt-1"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Generated brief:{" "}
            <code className="font-mono">
              {controlledSerialised || "(nothing yet)"}
            </code>
          </p>
        </div>
      ) : (
        <div className="space-y-2 rounded-md border border-border bg-card p-4">
          <Textarea
            value={free}
            onChange={(e) => {
              setFree(e.target.value);
              onChange(e.target.value);
            }}
            rows={3}
            placeholder="Augment the brief: 'keep the existing testimonial component' / 'use the centred hero variant' / etc."
          />
          <p className="text-xs text-muted-foreground">
            Both modes route through the Site Builder generation engine —
            never direct edits.
          </p>
        </div>
      )}
    </div>
  );
}

function serialise(
  keep: Record<string, boolean>,
  changeOnly: string,
): string {
  const keepLabels = PRESERVE_OPTIONS.filter((o) => keep[o.id]).map(
    (o) => o.label,
  );
  const parts: string[] = [];
  if (keepLabels.length > 0) {
    parts.push(`Preserve: ${keepLabels.join(", ")}.`);
  }
  if (changeOnly.trim()) {
    parts.push(`Change only: ${changeOnly.trim()}.`);
  }
  return parts.join(" ");
}

/** Convenience export for callers that want to render the trigger
 * button independently of the form. Phase 1.5 may use this to embed
 * the form inline in a sheet/dialog. */
export function RepromptToggleButton(props: {
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={props.active ? "default" : "outline"}
      size="sm"
      onClick={props.onClick}
    >
      Reprompt
    </Button>
  );
}
