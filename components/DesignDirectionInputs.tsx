"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { ConceptReviewCards } from "@/components/ConceptReviewCards";
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
// signal + a "Generate concepts" CTA. The CTA persists the brief and
// fires three parallel Claude calls server-side; the resulting
// concepts surface in this component's state pending the rich review
// UI from PR 6.
// ---------------------------------------------------------------------------

export interface ConceptResult {
  direction: "minimal" | "dense" | "editorial";
  label: string;
  rationale: string;
  design_tokens: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
    font_heading: string;
    font_body: string;
    border_radius: string;
    spacing_unit: string;
  };
  homepage_html: string;
  inner_page_html: string;
  micro_ui: { button: string; card: string; input: string };
  normalization_warnings: string[];
}

export interface ConceptError {
  direction: "minimal" | "dense" | "editorial";
  label: string;
  message: string;
}

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
  const [concepts, setConcepts] = useState<ConceptResult[] | null>(null);
  const [conceptErrors, setConceptErrors] = useState<ConceptError[]>([]);
  const [generationFailed, setGenerationFailed] = useState<string | null>(null);

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
    setConcepts(null);
    setConceptErrors([]);
    setGenerationFailed(null);
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
    // Persist the brief first so the wizard's resume logic returns to
    // Step 1 with the operator's inputs intact even if the generation
    // call fails or the tab is closed.
    try {
      const saveRes = await fetch(`/api/admin/sites/${siteId}/setup/save-brief`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief, advance_status: true }),
      });
      const savePayload = (await saveRes.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: { message: string } }
        | null;
      if (!savePayload?.ok) {
        toast.error(
          savePayload?.ok === false ? savePayload.error.message : "Save failed.",
        );
        setGenerating(false);
        return;
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Network error during save.",
      );
      setGenerating(false);
      return;
    }
    // Now fire the actual concept generation. 3 parallel Anthropic
    // calls server-side; ~30s upper bound. The route returns ok=true
    // even when 1 of 3 fails (the concepts[] is partial); ok=false
    // when all 3 failed → render the retry banner.
    try {
      const res = await fetch(
        `/api/admin/sites/${siteId}/setup/generate-concepts`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ brief }),
        },
      );
      const payload = (await res.json().catch(() => null)) as
        | { ok: true; data: { concepts: ConceptResult[]; errors: ConceptError[] } }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (!payload?.ok) {
        setGenerationFailed(
          payload?.ok === false
            ? payload.error.message
            : "Concept generation failed. Please try again.",
        );
        setGenerating(false);
        return;
      }
      setConcepts(payload.data.concepts);
      setConceptErrors(payload.data.errors);
      router.refresh();
      setGenerating(false);
    } catch (err) {
      setGenerationFailed(
        err instanceof Error ? err.message : "Network error during generation.",
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
              Generating…
            </>
          ) : (
            <>
              <Sparkles aria-hidden className="h-4 w-4" />
              {concepts && concepts.length > 0 ? "Regenerate concepts" : "Generate concepts"}
            </>
          )}
        </Button>
      </div>

      {(generating || concepts || generationFailed) && (
        <ConceptResultsBlock
          generating={generating}
          concepts={concepts}
          conceptErrors={conceptErrors}
          generationFailed={generationFailed}
          referenceScreenshotUrl={view.screenshot_url}
        />
      )}
    </div>
  );
}

function ConceptResultsBlock({
  generating,
  concepts,
  conceptErrors,
  generationFailed,
  referenceScreenshotUrl,
}: {
  generating: boolean;
  concepts: ConceptResult[] | null;
  conceptErrors: ConceptError[];
  generationFailed: string | null;
  referenceScreenshotUrl: string | null;
}) {
  if (generationFailed) {
    return (
      <div
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        role="alert"
        data-testid="dd-generation-failed"
      >
        <p className="font-medium">Generation failed.</p>
        <p className="mt-1 text-xs">{generationFailed}</p>
        <p className="mt-2 text-xs">
          Click &quot;Generate concepts&quot; to try again.
        </p>
      </div>
    );
  }
  if (generating) {
    return (
      <div
        className="grid gap-3 md:grid-cols-3"
        data-testid="dd-concepts-loading"
      >
        {(["Minimal", "Conversion", "Editorial"] as const).map((label) => (
          <div
            key={label}
            className="animate-pulse rounded-md border bg-muted/30 p-4"
          >
            <div className="h-3 w-2/3 rounded bg-muted-foreground/30" />
            <div className="mt-2 h-2 w-full rounded bg-muted-foreground/20" />
            <div className="mt-1.5 h-2 w-5/6 rounded bg-muted-foreground/20" />
            <div className="mt-4 h-32 w-full rounded bg-muted-foreground/10" />
            <p className="mt-2 text-[10px] text-muted-foreground">
              Generating {label}…
            </p>
          </div>
        ))}
      </div>
    );
  }
  if (!concepts) return null;
  return (
    <div className="space-y-3" data-testid="dd-concepts-ready">
      <ConceptReviewCards
        concepts={concepts}
        errors={conceptErrors}
        referenceScreenshotUrl={referenceScreenshotUrl}
        onSelect={() => {
          // Refinement + approve flow lands in PR 7. For now we only
          // highlight the selected card client-side.
        }}
      />
    </div>
  );
}
