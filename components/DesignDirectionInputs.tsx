"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { MoodBoardStrip } from "@/components/MoodBoardStrip";
import { DesignUnderstandingPanel } from "@/components/DesignUnderstandingPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  INDUSTRY_PRESETS,
  industryPreset,
  type Industry,
} from "@/lib/design-discovery/industry-defaults";

// ---------------------------------------------------------------------------
// DesignDirectionInputs — Step 1 input surface.
//
// Operator provides any combination of:
//   - Reference URL (a site they like)
//   - Existing site URL ("this is our current site")
//   - Free text description
//   - Industry selector (loads sensible defaults)
//
// Screenshot upload is reserved in the design brief shape but the
// upload UI lands in a follow-up — see PR description.
//
// Live mood board updates as inputs arrive: industry preset is
// rendered immediately; URL extraction overlays its findings on top
// when a URL is present and the operator clicks "Extract design".
// The understanding panel shows what we've inferred + the confidence
// signal + a "Generate concepts" CTA. PR 5 wires the actual concept
// generation; for now Generate saves the brief and routes to the
// generating-state intermediate screen.
// ---------------------------------------------------------------------------

export interface DesignBriefDraft {
  industry: Industry;
  reference_url: string;
  existing_site_url: string;
  description: string;
  edited_understanding: string;
  extracted: ExtractedSnapshot | null;
}

export interface ExtractedSnapshot {
  swatches: string[];
  fonts: string[];
  layout_tags: string[];
  visual_tone_tags: string[];
  screenshot_url: string | null;
  source_url: string | null;
  fetched_at: string | null;
}

const INITIAL_DRAFT: DesignBriefDraft = {
  industry: "msp",
  reference_url: "",
  existing_site_url: "",
  description: "",
  edited_understanding: "",
  extracted: null,
};

export function DesignDirectionInputs({
  siteId,
  initial,
}: {
  siteId: string;
  initial?: Partial<DesignBriefDraft>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DesignBriefDraft>({
    ...INITIAL_DRAFT,
    ...initial,
  });
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const preset = useMemo(() => industryPreset(draft.industry), [draft.industry]);

  // The current "what we'll show in the mood board" view: industry
  // preset overlaid by anything we extracted from the URL.
  const view = useMemo(() => {
    const ex = draft.extracted;
    return {
      swatches:
        ex && ex.swatches.length > 0
          ? ex.swatches
          : Object.values(preset.swatches),
      fonts: ex && ex.fonts.length > 0
        ? ex.fonts
        : [preset.font_heading, preset.font_body].filter(
            (v, i, a) => a.indexOf(v) === i,
          ),
      layout_tags:
        ex && ex.layout_tags.length > 0 ? ex.layout_tags : preset.layout_tags,
      visual_tone_tags:
        ex && ex.visual_tone_tags.length > 0
          ? ex.visual_tone_tags
          : preset.visual_tone_tags,
      screenshot_url: ex?.screenshot_url ?? null,
      visual_tone: preset.visual_tone,
    };
  }, [draft.extracted, preset]);

  const hasAnyInput =
    draft.reference_url.trim().length > 0 ||
    draft.existing_site_url.trim().length > 0 ||
    draft.description.trim().length > 0 ||
    draft.industry !== INITIAL_DRAFT.industry;

  function setField<K extends keyof DesignBriefDraft>(
    key: K,
    value: DesignBriefDraft[K],
  ): void {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function runExtract(targetUrl: string) {
    setExtracting(true);
    setExtractError(null);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}/setup/extract-design`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true; data: ExtractedSnapshot }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (!payload?.ok) {
        setExtractError(
          payload?.ok === false
            ? payload.error.message
            : "Could not fetch that URL. Try pasting your copy directly instead.",
        );
        return;
      }
      setDraft((prev) => ({ ...prev, extracted: payload.data }));
    } catch (err) {
      setExtractError(
        err instanceof Error ? err.message : "Network error during extraction.",
      );
    } finally {
      setExtracting(false);
    }
  }

  async function onGenerate() {
    if (!hasAnyInput) {
      toast.error(
        "Add at least one input first — a URL, a description, or an industry choice.",
      );
      return;
    }
    setGenerating(true);
    try {
      const brief = {
        industry: draft.industry,
        reference_url: draft.reference_url.trim() || null,
        existing_site_url: draft.existing_site_url.trim() || null,
        description: draft.description.trim() || null,
        edited_understanding: draft.edited_understanding.trim() || null,
        screenshots: [],
        refinement_notes: [],
        extracted: draft.extracted,
      };
      const res = await fetch(`/api/admin/sites/${siteId}/setup/save-brief`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief, advance_status: true }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: { message: string } }
        | null;
      if (!payload?.ok) {
        toast.error(
          payload?.ok === false ? payload.error.message : "Save failed.",
        );
        setGenerating(false);
        return;
      }
      router.refresh();
      // Concept generation lands in the next change. For now we sit
      // on Step 1 with the brief saved + status='in_progress' so the
      // resume logic correctly returns the operator here.
      toast.success("Brief saved. Concept generation lands in the next change.");
      setGenerating(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Network error during save.",
      );
      setGenerating(false);
    }
  }

  const referenceUrlValid =
    draft.reference_url.trim().length === 0 ||
    /^https?:\/\/|^[a-z0-9-]+\./i.test(draft.reference_url.trim());

  return (
    <div className="space-y-6" data-testid="design-direction-inputs">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label
            htmlFor="dd-industry"
            className="block text-sm font-medium"
          >
            Industry
          </label>
          <select
            id="dd-industry"
            className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={draft.industry}
            onChange={(e) =>
              setField("industry", e.target.value as Industry)
            }
            data-testid="dd-industry"
          >
            {(Object.keys(INDUSTRY_PRESETS) as Industry[]).map((k) => (
              <option key={k} value={k}>
                {INDUSTRY_PRESETS[k].label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Pre-loads sensible defaults. Stronger signals (URL,
            description) override.
          </p>
        </div>
        <div>
          <label htmlFor="dd-existing-url" className="block text-sm font-medium">
            Your existing site URL{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </label>
          <Input
            id="dd-existing-url"
            type="url"
            inputMode="url"
            placeholder="https://yourcurrent-site.com"
            value={draft.existing_site_url}
            onChange={(e) => setField("existing_site_url", e.target.value)}
            data-testid="dd-existing-url"
            className="mt-1"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Establishes the brand baseline.
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="dd-reference-url" className="block text-sm font-medium">
          Reference URL{" "}
          <span className="font-normal text-muted-foreground">
            (optional — paste a site you like)
          </span>
        </label>
        <div className="mt-1 flex flex-col gap-2 md:flex-row">
          <Input
            id="dd-reference-url"
            type="url"
            inputMode="url"
            placeholder="https://example.com"
            value={draft.reference_url}
            onChange={(e) => setField("reference_url", e.target.value)}
            data-testid="dd-reference-url"
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              !draft.reference_url.trim() || !referenceUrlValid || extracting
            }
            onClick={() => void runExtract(draft.reference_url.trim())}
            data-testid="dd-extract"
          >
            {extracting ? (
              <>
                <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                Extracting…
              </>
            ) : (
              "Extract design"
            )}
          </Button>
        </div>
        {extractError && (
          <p
            className="mt-2 text-xs text-destructive"
            data-testid="dd-extract-error"
            role="alert"
          >
            {extractError}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="dd-description" className="block text-sm font-medium">
          Describe the look and feel{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea
          id="dd-description"
          placeholder="e.g. Premium, technical, lots of whitespace. Two-column hero. Subtle blue accents on a near-white background."
          value={draft.description}
          onChange={(e) => setField("description", e.target.value)}
          maxLength={4000}
          rows={4}
          data-testid="dd-description"
          className="mt-1"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Free text — describe the feeling, layout, density, anything that
          helps us understand what you want.
        </p>
      </div>

      <MoodBoardStrip view={view} />

      <DesignUnderstandingPanel
        view={view}
        editedUnderstanding={draft.edited_understanding}
        onEditUnderstanding={(v) => setField("edited_understanding", v)}
        confidence={(() => {
          const score =
            (draft.reference_url.trim() || draft.existing_site_url.trim()
              ? 1
              : 0) +
            (draft.description.trim() ? 1 : 0);
          if (score >= 2) return "high";
          if (score === 1) return "medium";
          return "low";
        })()}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="text-xs text-muted-foreground">
          Estimated cost: ~$0.24 — includes homepage + inner page for each of
          3 concept directions. This is a full design pass.
        </p>
        <Button
          type="button"
          onClick={() => void onGenerate()}
          disabled={generating || !hasAnyInput}
          data-testid="dd-generate"
        >
          {generating ? (
            <>
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              Saving brief…
            </>
          ) : (
            <>
              <Sparkles aria-hidden className="h-4 w-4" />
              Generate concepts
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
