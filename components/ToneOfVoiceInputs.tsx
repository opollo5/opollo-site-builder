"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Sparkles, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AVOID_OPTIONS,
  PERSONALITY_OPTIONS,
  type AvoidOption,
  type PersonalityOption,
} from "@/lib/design-discovery/tone-mapping";

// ---------------------------------------------------------------------------
// ToneOfVoiceInputs — Step 2 input surface (PR 8).
//
// Captures:
//   - Existing content URL (we fetch homepage prose server-side)
//   - Sample copy paste
//   - Target audience (free text)
//   - Personality multi-select (positive markers)
//   - Never-sound-like multi-select (avoidance markers)
//   - Admired brand free text
//
// On Generate: posts to /setup/extract-tone, gets tone_of_voice JSON +
// 3 samples back. Operator edits each sample inline (plain textarea
// per the spec — no rich text). Approve persists; Skip flips
// tone_of_voice_status to 'skipped' via the existing skip endpoint.
// ---------------------------------------------------------------------------

interface ToneOfVoice {
  formality_level: number;
  sentence_length: "short" | "medium" | "long";
  jargon_usage: "embraced" | "neutral" | "avoided";
  personality_markers: string[];
  avoid_markers: string[];
  target_audience: string;
  style_guide: string;
}

interface ToneSample {
  kind: "hero" | "service" | "blog";
  text: string;
}

const SAMPLE_LABELS: Record<ToneSample["kind"], string> = {
  hero: "Homepage hero",
  service: "Service description",
  blog: "Blog post opening",
};

const REGEN_CAP = 10;

interface DraftInputs {
  existing_content_url: string;
  sample_copy: string;
  target_audience: string;
  personality: PersonalityOption[];
  avoid: AvoidOption[];
  admired_brand: string;
}

const INITIAL_INPUTS: DraftInputs = {
  existing_content_url: "",
  sample_copy: "",
  target_audience: "",
  personality: [],
  avoid: [],
  admired_brand: "",
};

interface Props {
  siteId: string;
  industry: string;
  initialTone: ToneOfVoice | null;
  initialSamples: ToneSample[];
}

export function ToneOfVoiceInputs({
  siteId,
  industry,
  initialTone,
  initialSamples,
}: Props) {
  const router = useRouter();
  const [inputs, setInputs] = useState<DraftInputs>(INITIAL_INPUTS);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [tone, setTone] = useState<ToneOfVoice | null>(initialTone);
  const [samples, setSamples] = useState<ToneSample[]>(
    initialSamples.length > 0 ? initialSamples : [],
  );
  const [regenAttempts, setRegenAttempts] = useState(0);
  const [regenFeedback, setRegenFeedback] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);

  function setField<K extends keyof DraftInputs>(key: K, value: DraftInputs[K]) {
    setInputs((p) => ({ ...p, [key]: value }));
  }

  function toggleMulti<T>(list: T[], value: T): T[] {
    if (list.includes(value)) return list.filter((v) => v !== value);
    return [...list, value];
  }

  const hasInputs =
    Boolean(inputs.existing_content_url.trim()) ||
    Boolean(inputs.sample_copy.trim()) ||
    Boolean(inputs.target_audience.trim()) ||
    inputs.personality.length > 0 ||
    inputs.avoid.length > 0 ||
    Boolean(inputs.admired_brand.trim());

  async function onExtract() {
    if (!hasInputs) {
      toast.error("Add at least one input — a URL, sample copy, or guided answer.");
      return;
    }
    setExtracting(true);
    setExtractError(null);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}/setup/extract-tone`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          industry,
          existing_content_url: inputs.existing_content_url.trim() || null,
          sample_copy: inputs.sample_copy.trim() || null,
          target_audience: inputs.target_audience.trim() || null,
          personality: inputs.personality,
          avoid: inputs.avoid,
          admired_brand: inputs.admired_brand.trim() || null,
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true; data: { tone_of_voice: ToneOfVoice; samples: ToneSample[] } }
        | { ok: false; error: { message: string } }
        | null;
      if (!payload?.ok) {
        setExtractError(
          payload?.ok === false ? payload.error.message : "Tone extraction failed.",
        );
        setExtracting(false);
        return;
      }
      setTone(payload.data.tone_of_voice);
      setSamples(payload.data.samples);
      setRegenAttempts(0);
      setExtracting(false);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Network error.");
      setExtracting(false);
    }
  }

  async function onRegenerate() {
    if (!tone) return;
    if (regenAttempts >= REGEN_CAP) {
      toast.error("Regeneration cap reached.");
      return;
    }
    setRegenerating(true);
    try {
      const res = await fetch(
        `/api/admin/sites/${siteId}/setup/regenerate-tone-samples`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            tone_of_voice: tone,
            feedback: regenFeedback.trim() || null,
            attempt: regenAttempts + 1,
          }),
        },
      );
      const payload = (await res.json().catch(() => null)) as
        | { ok: true; data: { samples: ToneSample[] } }
        | { ok: false; error: { message: string } }
        | null;
      if (!payload?.ok) {
        toast.error(
          payload?.ok === false ? payload.error.message : "Regeneration failed.",
        );
        setRegenerating(false);
        return;
      }
      setSamples(payload.data.samples);
      setRegenAttempts((p) => p + 1);
      setRegenFeedback("");
      setRegenerating(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error.");
      setRegenerating(false);
    }
  }

  async function onApprove() {
    if (!tone) return;
    setApproving(true);
    setApproveError(null);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}/setup/approve-tone`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tone_of_voice: tone,
          approved_samples: samples,
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: { message: string } }
        | null;
      if (!payload?.ok) {
        setApproveError(
          payload?.ok === false ? payload.error.message : "Approval failed.",
        );
        setApproving(false);
        return;
      }
      toast.success("Tone of voice approved.");
      router.push(`/admin/sites/${siteId}/setup?step=3`);
      router.refresh();
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : "Network error.");
      setApproving(false);
    }
  }

  async function onSkip() {
    setSkipping(true);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}/setup/skip`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: 2 }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: { message: string } }
        | null;
      if (!payload?.ok) {
        toast.error(
          payload?.ok === false ? payload.error.message : "Skip failed.",
        );
        setSkipping(false);
        return;
      }
      router.push(`/admin/sites/${siteId}/setup?step=3`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error.");
      setSkipping(false);
    }
  }

  function setSampleText(idx: number, text: string) {
    setSamples((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, text } : s)),
    );
  }

  return (
    <div className="space-y-5" data-testid="tone-of-voice-inputs">
      {/* Inputs */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="tov-url" className="block text-sm font-medium">
            Existing content URL{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Input
            id="tov-url"
            type="url"
            placeholder="https://existing-site.com"
            value={inputs.existing_content_url}
            onChange={(e) => setField("existing_content_url", e.target.value)}
            className="mt-1"
            data-testid="tov-url"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            We fetch the homepage prose and infer tone from it.
          </p>
        </div>
        <div>
          <label htmlFor="tov-audience" className="block text-sm font-medium">
            Who is your target client?{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Input
            id="tov-audience"
            placeholder="MSP business owners running 25–200-staff IT operations"
            value={inputs.target_audience}
            onChange={(e) => setField("target_audience", e.target.value)}
            className="mt-1"
            data-testid="tov-audience"
          />
        </div>
      </div>

      <div>
        <label htmlFor="tov-sample" className="block text-sm font-medium">
          Sample copy{" "}
          <span className="font-normal text-muted-foreground">
            (optional — paste 2–3 paragraphs that sound like you)
          </span>
        </label>
        <Textarea
          id="tov-sample"
          rows={4}
          maxLength={5000}
          value={inputs.sample_copy}
          onChange={(e) => setField("sample_copy", e.target.value)}
          className="mt-1"
          data-testid="tov-sample"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="block text-sm font-medium">Personality</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pick everything that fits — these become positive voice rules.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PERSONALITY_OPTIONS.map((opt) => {
              const on = inputs.personality.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() =>
                    setField("personality", toggleMulti(inputs.personality, opt))
                  }
                  className={[
                    "rounded-full border px-2.5 py-0.5 text-xs transition-smooth",
                    on
                      ? "border-foreground bg-foreground text-background"
                      : "border-muted bg-muted/30 text-muted-foreground hover:bg-muted/50",
                  ].join(" ")}
                  aria-pressed={on}
                  data-testid={`tov-personality-${opt}`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <p className="block text-sm font-medium">Never sound like</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pick anti-patterns — these become avoidance rules.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {AVOID_OPTIONS.map((opt) => {
              const on = inputs.avoid.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() =>
                    setField("avoid", toggleMulti(inputs.avoid, opt))
                  }
                  className={[
                    "rounded-full border px-2.5 py-0.5 text-xs transition-smooth",
                    on
                      ? "border-destructive bg-destructive text-background"
                      : "border-muted bg-muted/30 text-muted-foreground hover:bg-muted/50",
                  ].join(" ")}
                  aria-pressed={on}
                  data-testid={`tov-avoid-${opt}`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div>
        <label htmlFor="tov-admired" className="block text-sm font-medium">
          A brand whose communication style you admire{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Input
          id="tov-admired"
          placeholder="e.g. Stripe, Linear, Basecamp"
          value={inputs.admired_brand}
          onChange={(e) => setField("admired_brand", e.target.value)}
          className="mt-1"
          data-testid="tov-admired"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="text-xs text-muted-foreground">
          Estimated cost: ~$0.02 — extracts tone JSON + three preview
          samples in a single call.
        </p>
        <Button
          type="button"
          onClick={() => void onExtract()}
          disabled={extracting || !hasInputs}
          data-testid="tov-extract"
        >
          {extracting ? (
            <>
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              Extracting…
            </>
          ) : (
            <>
              <Sparkles aria-hidden className="h-4 w-4" />
              {tone ? "Re-extract tone" : "Extract tone of voice"}
            </>
          )}
        </Button>
      </div>

      {extractError && (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
          role="alert"
          data-testid="tov-extract-error"
        >
          {extractError}
        </div>
      )}

      {tone && (
        <ToneSummary tone={tone} />
      )}

      {samples.length > 0 && (
        <SamplesEditor
          samples={samples}
          onChange={setSampleText}
          regenFeedback={regenFeedback}
          onRegenFeedbackChange={setRegenFeedback}
          regenAttempts={regenAttempts}
          regenerating={regenerating}
          onRegenerate={onRegenerate}
        />
      )}

      {approveError && (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
          role="alert"
        >
          {approveError}
        </div>
      )}

      {tone && samples.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void onSkip()}
            disabled={skipping || approving}
            data-testid="tov-skip"
          >
            {skipping ? "Skipping…" : "Skip for now"}
          </Button>
          <Button
            type="button"
            onClick={() => void onApprove()}
            disabled={approving || regenerating}
            data-testid="tov-approve"
          >
            {approving ? (
              <>
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                Approving…
              </>
            ) : (
              <>
                <Check aria-hidden className="h-4 w-4" />
                Approve tone of voice
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function ToneSummary({ tone }: { tone: ToneOfVoice }) {
  return (
    <div
      className="rounded-md border bg-muted/20 p-3 text-xs"
      data-testid="tov-summary"
    >
      <p className="font-medium">Tone profile</p>
      <dl className="mt-2 grid gap-1 md:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Formality</dt>
          <dd>
            {tone.formality_level} / 5
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Sentence length</dt>
          <dd>{tone.sentence_length}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Jargon</dt>
          <dd>{tone.jargon_usage}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Audience</dt>
          <dd>{tone.target_audience}</dd>
        </div>
      </dl>
      <details className="mt-3">
        <summary className="cursor-pointer text-muted-foreground">
          Style guide ({tone.style_guide.length} chars)
        </summary>
        <pre className="mt-2 whitespace-pre-wrap rounded bg-background p-2 text-[11px] text-foreground">
          {tone.style_guide}
        </pre>
      </details>
    </div>
  );
}

function SamplesEditor({
  samples,
  onChange,
  regenFeedback,
  onRegenFeedbackChange,
  regenAttempts,
  regenerating,
  onRegenerate,
}: {
  samples: ToneSample[];
  onChange: (idx: number, text: string) => void;
  regenFeedback: string;
  onRegenFeedbackChange: (v: string) => void;
  regenAttempts: number;
  regenerating: boolean;
  onRegenerate: () => Promise<void>;
}) {
  const atCap = regenAttempts >= REGEN_CAP;
  return (
    <div className="space-y-3" data-testid="tov-samples">
      <p className="text-sm font-medium">Sample text — edit if needed</p>
      <div className="grid gap-3 md:grid-cols-3">
        {samples.map((s, i) => (
          <div
            key={s.kind}
            className="rounded-md border bg-card p-3"
            data-testid={`tov-sample-${s.kind}`}
          >
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">
              {SAMPLE_LABELS[s.kind]}
            </p>
            <Textarea
              rows={s.kind === "hero" ? 3 : 5}
              value={s.text}
              onChange={(e) => onChange(i, e.target.value)}
              maxLength={800}
              className="mt-1 text-xs"
            />
          </div>
        ))}
      </div>
      <div className="rounded-md border bg-muted/20 p-3">
        <label
          htmlFor="tov-regen-feedback"
          className="text-xs font-medium"
        >
          Regenerate samples
        </label>
        <Textarea
          id="tov-regen-feedback"
          rows={2}
          maxLength={1000}
          placeholder="Optional: e.g. punchier hero, drop the second sentence."
          value={regenFeedback}
          onChange={(e) => onRegenFeedbackChange(e.target.value)}
          disabled={regenerating || atCap}
          className="mt-1 text-xs"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span data-testid="tov-regen-counter">
            {regenAttempts}/{REGEN_CAP} regenerations used
            {atCap && (
              <span className="ml-2 text-destructive">— cap reached</span>
            )}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void onRegenerate()}
            disabled={regenerating || atCap}
            data-testid="tov-regenerate"
          >
            {regenerating ? "Regenerating…" : "Regenerate samples"}
          </Button>
        </div>
      </div>
    </div>
  );
}
