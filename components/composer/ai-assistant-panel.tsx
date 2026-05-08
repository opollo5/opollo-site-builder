"use client";

import { useState } from "react";

import { NavIcon } from "@/components/ui/nav-icon";

// ---------------------------------------------------------------------------
// Spec 22 PR 4 — AiAssistantPanel.
//
// Inline expansion below the tools row. User enters a prompt, selects tone +
// length, clicks Generate. Calls /api/platform/social/cap/assist (30/hour
// per company, no DB records created). Generated text shown with
// Replace / Append / Regenerate actions; ai_metadata passed in callbacks.
// ---------------------------------------------------------------------------

type Tone = "professional" | "casual" | "playful";
type Length = "short" | "medium" | "long";

const LENGTH_LABEL: Record<Length, string> = {
  short: "Short",
  medium: "Medium",
  long: "Long",
};

export type AiMeta = { prompt: string; tone: string; generated_at: string };

type PanelStatus = "idle" | "loading" | "done" | "error" | "rate_limited";

interface AiAssistantPanelProps {
  companyId: string;
  correlationId: string;
  onReplace: (text: string, meta: AiMeta) => void;
  onAppend: (text: string, meta: AiMeta) => void;
  onClose: () => void;
}

export function AiAssistantPanel({
  companyId,
  correlationId,
  onReplace,
  onAppend,
  onClose,
}: AiAssistantPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [tone, setTone] = useState<Tone>("professional");
  const [length, setLength] = useState<Length>("medium");
  const [status, setStatus] = useState<PanelStatus>("idle");
  const [generatedText, setGeneratedText] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setStatus("loading");
    setGeneratedText(null);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/platform/social/cap/assist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-correlation-id": correlationId,
        },
        body: JSON.stringify({
          company_id: companyId,
          prompt: prompt.trim(),
          tone,
          length,
        }),
      });

      if (res.status === 429) {
        setStatus("rate_limited");
        return;
      }

      const result = (await res.json()) as {
        ok: boolean;
        data?: { text: string };
        error?: { message?: string };
      };

      if (!result.ok) {
        setStatus("error");
        setErrorMessage(result.error?.message ?? "Generation failed. Please try again.");
        return;
      }

      const text = result.data?.text ?? "";
      if (!text) {
        setStatus("error");
        setErrorMessage("No content was generated. Please try again.");
        return;
      }

      setGeneratedText(text);
      setStatus("done");
    } catch {
      setStatus("error");
      setErrorMessage("Network error. Please try again.");
    }
  }

  const canGenerate = !!prompt.trim() && status !== "loading" && status !== "rate_limited";
  const meta = (): AiMeta => ({ prompt, tone, generated_at: new Date().toISOString() });

  return (
    <div className="rounded-lg border border-pk/30 bg-pk/5 p-4">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <NavIcon name="magic-wand" size={14} className="text-pk" />
          AI Assistant
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI assistant"
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <NavIcon name="cross" size={14} />
        </button>
      </div>

      {/* Prompt textarea */}
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Write a post about…"
        rows={2}
        maxLength={500}
        disabled={status === "loading"}
        aria-label="Describe what you want the post to say"
        className="mb-3 w-full resize-none rounded border border-white/10 bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-pk/50 disabled:opacity-60"
      />

      {/* Tone + Length + Generate button */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Tone</span>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value as Tone)}
            disabled={status === "loading"}
            aria-label="Tone"
            className="rounded border border-white/10 bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-pk/50 disabled:opacity-60"
          >
            <option value="professional">Professional</option>
            <option value="casual">Casual</option>
            <option value="playful">Playful</option>
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Length</span>
          <select
            value={length}
            onChange={(e) => setLength(e.target.value as Length)}
            disabled={status === "loading"}
            aria-label="Length"
            className="rounded border border-white/10 bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-pk/50 disabled:opacity-60"
          >
            {(["short", "medium", "long"] as Length[]).map((l) => (
              <option key={l} value={l}>
                {LENGTH_LABEL[l]}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto">
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={!canGenerate}
            title={status === "rate_limited" ? "Out of AI credits — resets in 1 hour" : undefined}
            aria-label={status === "rate_limited" ? "Out of AI credits" : "Generate text"}
            className="flex items-center gap-1.5 rounded bg-pk px-3 py-1.5 text-xs font-medium text-white hover:bg-pk/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "loading" ? (
              <>
                <span className="inline-flex animate-spin">
                  <NavIcon name="sync" size={12} />
                </span>
                Generating…
              </>
            ) : status === "rate_limited" ? (
              <>
                <NavIcon name="magic-wand" size={12} />
                Out of AI credits
              </>
            ) : (
              <>
                <NavIcon name="magic-wand" size={12} />
                Generate
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error state */}
      {status === "error" && errorMessage && (
        <p className="mt-3 text-xs text-destructive">{errorMessage}</p>
      )}

      {/* Rate-limited hint */}
      {status === "rate_limited" && (
        <p className="mt-3 text-xs text-muted-foreground">
          AI generation limit reached. Credits reset every hour.
        </p>
      )}

      {/* Generated result */}
      {status === "done" && generatedText && (
        <div className="mt-3 space-y-2">
          <p className="whitespace-pre-wrap rounded border border-white/10 bg-background p-3 text-sm leading-relaxed">
            {generatedText}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { onReplace(generatedText, meta()); onClose(); }}
              className="rounded border border-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/10"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={() => { onAppend(generatedText, meta()); onClose(); }}
              className="rounded border border-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/10"
            >
              Append
            </button>
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={!prompt.trim()}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              Regenerate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
