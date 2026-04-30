"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, ChevronRight, Loader2, Palette, Volume2 } from "lucide-react";
import { toast } from "sonner";

import { ApprovedDesignReadout } from "@/components/ConceptRefinementView";
import {
  DesignDirectionInputs,
  type DesignBriefDraft,
  type ExtractedSnapshot,
} from "@/components/DesignDirectionInputs";
import { Button } from "@/components/ui/button";
import type { Industry } from "@/lib/design-discovery/industry-defaults";
import type { SetupStatus, SetupStep, SetupStepStatus } from "@/lib/site-setup";

// ---------------------------------------------------------------------------
// SetupWizard — DESIGN-DISCOVERY shell.
//
// Renders the active step (1, 2, or 3) and the progress strip at the top.
// Steps 1 and 2 are placeholders for now — PRs 4–9 swap the inner
// content for the real input surface, concept review, refinement and
// approval flow. Step 3 is fully wired here: it summarises whatever
// state the two status columns + design_tokens / tone_of_voice JSON
// are in.
//
// All step writes for the placeholders go through one API endpoint
// (POST /api/admin/sites/:id/setup/skip with { step }). The Approve
// path lands with each step's real content.
// ---------------------------------------------------------------------------

interface Props {
  siteId: string;
  step: SetupStep;
  status: SetupStatus;
}

const STEPS: Array<{ n: SetupStep; label: string; icon: typeof Palette }> = [
  { n: 1, label: "Design direction", icon: Palette },
  { n: 2, label: "Tone of voice", icon: Volume2 },
  { n: 3, label: "Done", icon: Check },
];

function statusLabel(s: SetupStepStatus): string {
  switch (s) {
    case "approved":
      return "Complete";
    case "skipped":
      return "Skipped — using defaults";
    case "in_progress":
      return "In progress";
    case "pending":
      return "Not started";
  }
}

export function SetupWizard({ siteId, step, status }: Props) {
  return (
    <div className="space-y-6" data-testid="setup-wizard">
      <ProgressStrip step={step} status={status} siteId={siteId} />
      {step === 1 && <Step1 siteId={siteId} status={status} />}
      {step === 2 && <Step2 siteId={siteId} status={status} />}
      {step === 3 && <Step3 siteId={siteId} status={status} />}
    </div>
  );
}

function ProgressStrip({
  step,
  status,
  siteId,
}: {
  step: SetupStep;
  status: SetupStatus;
  siteId: string;
}) {
  // A step is "complete" if its status column is approved or skipped.
  // Step 3 is "complete" when both prior steps are complete.
  const stepComplete = (n: SetupStep): boolean => {
    if (n === 1) {
      return (
        status.design_direction_status === "approved" ||
        status.design_direction_status === "skipped"
      );
    }
    if (n === 2) {
      return (
        status.tone_of_voice_status === "approved" ||
        status.tone_of_voice_status === "skipped"
      );
    }
    return stepComplete(1) && stepComplete(2);
  };

  return (
    <ol className="flex items-center gap-1 text-sm" aria-label="Setup progress">
      {STEPS.map((s, i) => {
        const active = s.n === step;
        const done = stepComplete(s.n);
        const Icon = done ? Check : s.icon;
        return (
          <li
            key={s.n}
            className="flex items-center gap-1"
            data-testid={`setup-progress-step-${s.n}`}
            data-active={active ? "true" : "false"}
            data-complete={done ? "true" : "false"}
          >
            <Link
              href={`/admin/sites/${siteId}/setup?step=${s.n}`}
              className={[
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1 transition-smooth",
                active
                  ? "border-foreground bg-foreground text-background"
                  : done
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-muted bg-muted/30 text-muted-foreground",
                "hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              ].join(" ")}
            >
              <Icon aria-hidden className="h-3.5 w-3.5" />
              <span className="font-medium">{s.label}</span>
            </Link>
            {i < STEPS.length - 1 && (
              <ChevronRight
                aria-hidden
                className="h-4 w-4 shrink-0 text-muted-foreground"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StepFrame({
  title,
  intro,
  body,
  footer,
  testid,
}: {
  title: string;
  intro: React.ReactNode;
  body: React.ReactNode;
  footer: React.ReactNode;
  testid: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-6" data-testid={testid}>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{intro}</p>
      <div className="mt-4">{body}</div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        {footer}
      </div>
    </section>
  );
}

function SkipButton({
  siteId,
  step,
  label,
  testid,
}: {
  siteId: string;
  step: 1 | 2;
  label: string;
  testid: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onSkip() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}/setup/skip`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: { message: string } }
        | null;
      if (!payload?.ok) {
        toast.error(
          payload?.ok === false ? payload.error.message : "Skip failed.",
        );
        setBusy(false);
        return;
      }
      const nextStep = step === 1 ? 2 : 3;
      router.push(`/admin/sites/${siteId}/setup?step=${nextStep}`);
      router.refresh();
    } catch (err) {
      toast.error(`Skip failed: ${err instanceof Error ? err.message : "unknown"}`);
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => void onSkip()}
      disabled={busy}
      data-testid={testid}
    >
      {busy ? (
        <>
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
          Skipping…
        </>
      ) : (
        label
      )}
    </Button>
  );
}

function Step1({ siteId, status }: { siteId: string; status: SetupStatus }) {
  const initial = briefToInitialDraft(status.design_brief);
  const approved = status.design_direction_status === "approved";
  return (
    <StepFrame
      testid="setup-step-1"
      title="Design direction"
      intro={
        <>
          What should this site look like? Provide a reference URL, an
          existing site, or a written description and we&apos;ll work from
          there. Status:{" "}
          <span className="font-medium text-foreground">
            {statusLabel(status.design_direction_status)}
          </span>
          .
        </>
      }
      body={
        approved ? (
          <ApprovedDesignReadout
            siteId={siteId}
            homepageHtml={status.homepage_concept_html}
            innerPageHtml={status.inner_page_concept_html}
            tokens={status.design_tokens}
          />
        ) : (
          <DesignDirectionInputs siteId={siteId} initial={initial} />
        )
      }
      footer={
        approved ? (
          <>
            <Link
              href={`/admin/sites/${siteId}`}
              className="text-sm text-muted-foreground transition-smooth hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
            >
              ← Back to site
            </Link>
            <Button asChild data-testid="setup-step-1-continue">
              <Link href={`/admin/sites/${siteId}/setup?step=2`}>
                Continue → Tone of voice
              </Link>
            </Button>
          </>
        ) : (
          <>
            <Link
              href={`/admin/sites/${siteId}`}
              className="text-sm text-muted-foreground transition-smooth hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
            >
              ← Back to site
            </Link>
            <div className="flex items-center gap-2">
              <SkipButton
                siteId={siteId}
                step={1}
                label="Skip for now"
                testid="setup-step-1-skip"
              />
            </div>
          </>
        )
      }
    />
  );
}

function briefToInitialDraft(
  brief: Record<string, unknown> | null,
): Partial<DesignBriefDraft> | undefined {
  if (!brief) return undefined;
  const get = <T,>(k: string, validate: (v: unknown) => v is T): T | undefined => {
    const v = brief[k];
    return validate(v) ? v : undefined;
  };
  const isString = (v: unknown): v is string => typeof v === "string";
  const isIndustry = (v: unknown): v is Industry =>
    typeof v === "string" &&
    ["msp", "it_services", "cybersecurity", "general_b2b", "other"].includes(v);
  const extractedRaw = brief.extracted;
  let extracted: ExtractedSnapshot | null = null;
  if (extractedRaw && typeof extractedRaw === "object") {
    const e = extractedRaw as Record<string, unknown>;
    extracted = {
      swatches: Array.isArray(e.swatches) ? (e.swatches as string[]) : [],
      fonts: Array.isArray(e.fonts) ? (e.fonts as string[]) : [],
      layout_tags: Array.isArray(e.layout_tags) ? (e.layout_tags as string[]) : [],
      visual_tone_tags: Array.isArray(e.visual_tone_tags)
        ? (e.visual_tone_tags as string[])
        : [],
      screenshot_url: typeof e.screenshot_url === "string" ? e.screenshot_url : null,
      source_url: typeof e.source_url === "string" ? e.source_url : null,
      fetched_at: typeof e.fetched_at === "string" ? e.fetched_at : null,
    };
  }
  return {
    industry: get("industry", isIndustry) ?? "msp",
    reference_url: get("reference_url", isString) ?? "",
    existing_site_url: get("existing_site_url", isString) ?? "",
    description: get("description", isString) ?? "",
    edited_understanding: get("edited_understanding", isString) ?? "",
    extracted,
  };
}

function Step2({ siteId, status }: { siteId: string; status: SetupStatus }) {
  return (
    <StepFrame
      testid="setup-step-2"
      title="Tone of voice"
      intro={
        <>
          How should the site talk to clients? Paste sample copy, share a
          reference URL, or answer the guided questions and we&apos;ll
          extract a tone profile that feeds every page and post we
          generate.
        </>
      }
      body={
        <div className="rounded-md border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
          <p>
            Status:{" "}
            <span className="font-medium text-foreground">
              {statusLabel(status.tone_of_voice_status)}
            </span>
          </p>
          <p className="mt-2">
            The tone capture and sample preview land in a follow-up
            change. Skip for now to land at Done with generic MSP defaults
            applied to your generation prompts.
          </p>
        </div>
      }
      footer={
        <>
          <Link
            href={`/admin/sites/${siteId}/setup?step=1`}
            className="text-sm text-muted-foreground transition-smooth hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
          >
            ← Back
          </Link>
          <div className="flex items-center gap-2">
            <SkipButton
              siteId={siteId}
              step={2}
              label="Skip for now"
              testid="setup-step-2-skip"
            />
          </div>
        </>
      }
    />
  );
}

function Step3({ siteId, status }: { siteId: string; status: SetupStatus }) {
  const designApproved = status.design_direction_status === "approved";
  const designSkipped = status.design_direction_status === "skipped";
  const toneApproved = status.tone_of_voice_status === "approved";
  const toneSkipped = status.tone_of_voice_status === "skipped";
  const bothSkipped = designSkipped && toneSkipped;

  return (
    <StepFrame
      testid="setup-step-3"
      title="Setup complete"
      intro={
        bothSkipped ? (
          <>
            You&apos;re using default styles. Set these up any time from
            Site Settings.
          </>
        ) : (
          <>Here&apos;s what we&apos;ll use for every page we generate.</>
        )
      }
      body={
        <div className="grid gap-4 md:grid-cols-2">
          <SummaryCard
            heading="Design direction"
            href={`/admin/sites/${siteId}/setup?step=1`}
            state={status.design_direction_status}
            details={
              designApproved ? (
                <DesignDirectionDetails tokens={status.design_tokens} />
              ) : designSkipped ? (
                <p className="text-xs text-muted-foreground">
                  Using defaults.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Not yet set.</p>
              )
            }
          />
          <SummaryCard
            heading="Tone of voice"
            href={`/admin/sites/${siteId}/setup?step=2`}
            state={status.tone_of_voice_status}
            details={
              toneApproved ? (
                <ToneOfVoiceDetails tone={status.tone_of_voice} />
              ) : toneSkipped ? (
                <p className="text-xs text-muted-foreground">
                  Using defaults.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Not yet set.</p>
              )
            }
          />
        </div>
      }
      footer={
        <>
          <Link
            href={`/admin/sites/${siteId}/setup?step=2`}
            className="text-sm text-muted-foreground transition-smooth hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
          >
            ← Back
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild data-testid="setup-step-3-finish">
              <Link href={`/admin/sites/${siteId}`}>
                Start generating content
              </Link>
            </Button>
          </div>
        </>
      }
    />
  );
}

function SummaryCard({
  heading,
  href,
  state,
  details,
}: {
  heading: string;
  href: string;
  state: SetupStepStatus;
  details: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{heading}</h3>
        <span className="text-xs text-muted-foreground">
          {statusLabel(state)}
        </span>
      </div>
      <div className="mt-3">{details}</div>
      <Link
        href={href}
        className="mt-4 inline-block text-xs text-muted-foreground transition-smooth hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
      >
        Go back and edit →
      </Link>
    </div>
  );
}

function DesignDirectionDetails({
  tokens,
}: {
  tokens: Record<string, unknown> | null;
}) {
  if (!tokens) {
    return (
      <p className="text-xs text-muted-foreground">
        Approved direction has no captured tokens yet.
      </p>
    );
  }
  const swatchOrder = ["primary", "secondary", "accent", "background", "text"];
  const swatches = swatchOrder
    .map((k) => ({ k, v: tokens[k] }))
    .filter(
      (s): s is { k: string; v: string } =>
        typeof s.v === "string" && s.v.length > 0,
    );
  const fontHeading =
    typeof tokens.font_heading === "string" ? tokens.font_heading : null;
  const fontBody =
    typeof tokens.font_body === "string" ? tokens.font_body : null;
  return (
    <div className="space-y-2 text-xs">
      {swatches.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {swatches.map((s) => (
            <span
              key={s.k}
              className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5"
              title={`${s.k}: ${s.v}`}
            >
              <span
                className="inline-block h-3 w-3 rounded-sm border"
                style={{ background: s.v }}
                aria-hidden
              />
              <span className="font-mono text-[10px] uppercase">{s.k}</span>
            </span>
          ))}
        </div>
      )}
      {(fontHeading || fontBody) && (
        <p className="text-muted-foreground">
          {fontHeading && (
            <>
              Heading: <span className="text-foreground">{fontHeading}</span>
            </>
          )}
          {fontHeading && fontBody && " · "}
          {fontBody && (
            <>
              Body: <span className="text-foreground">{fontBody}</span>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function ToneOfVoiceDetails({
  tone,
}: {
  tone: Record<string, unknown> | null;
}) {
  if (!tone) {
    return (
      <p className="text-xs text-muted-foreground">
        Approved tone has no captured profile yet.
      </p>
    );
  }
  const styleGuide =
    typeof tone.style_guide === "string" ? tone.style_guide : null;
  const samples = Array.isArray(tone.approved_samples)
    ? tone.approved_samples
    : [];
  const firstSample = samples.find(
    (s): s is { kind?: string; text: string } =>
      typeof s === "object" &&
      s !== null &&
      "text" in s &&
      typeof (s as { text: unknown }).text === "string",
  );
  return (
    <div className="space-y-2 text-xs">
      {styleGuide && (
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Style: </span>
          {styleGuide.length > 160 ? `${styleGuide.slice(0, 160)}…` : styleGuide}
        </p>
      )}
      {firstSample && (
        <blockquote className="rounded-md border-l-2 border-foreground/30 bg-background px-3 py-2 italic">
          &ldquo;
          {firstSample.text.length > 200
            ? `${firstSample.text.slice(0, 200)}…`
            : firstSample.text}
          &rdquo;
        </blockquote>
      )}
    </div>
  );
}
