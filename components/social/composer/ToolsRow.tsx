"use client";

import * as React from "react";
import { Sparkles, ImagePlus, Smile, Film, Tags, X as CloseIcon, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { logClientError } from "@/lib/errors/logClientError";

// ---------------------------------------------------------------------------
// ToolsRow — composer toolbar: AI assistant, Media, Emoji, GIF, Shorten URL,
// UTM tags.
//
// AI assistant → POST /api/platform/social/cap/assist
// GIF picker   → GIPHY Search API (client-side, NEXT_PUBLIC_GIPHY_API_KEY)
// Media        → calls onOpenMediaPicker (parent-owned file input via MediaTray)
// Emoji        → inline grid of common Unicode emoji
// Shorten URL  → inline UTM/shortener form
// UTM tags     → UTM parameter builder
// ---------------------------------------------------------------------------

export interface ToolsRowProps {
  companyId: string;
  onInsertText: (text: string) => void;
  onOpenMediaPicker: () => void;
  onAttachGif: (url: string) => void;
  className?: string;
}

type ActivePanel = "ai" | "emoji" | "gif" | "shorten" | "utm" | null;

// A small set of frequently-used emoji for the quick picker.
const QUICK_EMOJI = [
  "🎉", "🚀", "💡", "✅", "❤️", "👍", "🔥", "💪", "🌟", "🎯",
  "📈", "💼", "🤝", "🌐", "⚡", "🛠️", "📣", "🙌", "😊", "🏆",
  "📌", "🔔", "📱", "💬", "📧", "🗓️", "📊", "💰", "🎨", "🌍",
];

// ---------------------------------------------------------------------------
// AI assistant panel
// ---------------------------------------------------------------------------

type AiErrorState = {
  category: "rate_limit" | "timeout" | "content_rejected" | "network" | "overloaded" | "unknown";
  message: string;
  trace_id: string;
  retry_after?: number;
  can_retry: boolean;
};

// Haiku 4.5 pricing: $0.08 / MTok input, $0.40 / MTok output (micro-cents).
// Rough estimate: system ~250 tokens + prompt tokens → input; max_tokens=512 output.
function estimateCost(promptChars: number): string {
  const estimatedInputTokens = 250 + Math.ceil(promptChars / 4);
  const estimatedOutputTokens = 200;
  const inputCents = (estimatedInputTokens / 1_000_000) * 0.08;
  const outputCents = (estimatedOutputTokens / 1_000_000) * 0.40;
  const totalDollars = (inputCents + outputCents) / 100;
  return totalDollars < 0.001
    ? "< $0.001"
    : `$${totalDollars.toFixed(4)}`;
}

function TraceIdBadge({ traceId }: { traceId: string }) {
  const [copied, setCopied] = React.useState(false);

  function copy() {
    void navigator.clipboard.writeText(traceId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="mt-1 flex items-center gap-1.5">
      <span className="font-mono text-xs text-muted-foreground" data-testid="ai-trace-id">
        trace_id: {traceId}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy trace ID"
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        {copied ? <Check size={10} aria-hidden /> : <Copy size={10} aria-hidden />}
      </button>
    </div>
  );
}

function AiErrorDisplay({
  err,
  onRetry,
  onEdit,
  retryCount,
}: {
  err: AiErrorState;
  onRetry: () => void;
  onEdit: () => void;
  retryCount: number;
}) {
  const [countdown, setCountdown] = React.useState(err.retry_after ?? 0);

  React.useEffect(() => {
    if (!err.retry_after) return;
    setCountdown(err.retry_after);
    const id = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) { clearInterval(id); return 0; }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [err.retry_after, err.trace_id]);

  const retryLabel =
    err.category === "rate_limit" && countdown > 0
      ? `Retry in ${countdown}s`
      : err.category === "overloaded"
      ? `Attempt ${retryCount} of 3 · retrying…`
      : "Retry";

  const isRetryDisabled = err.category === "rate_limit" && countdown > 0;

  return (
    <div role="alert" aria-live="assertive" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs" data-testid="ai-error-display">
      <p className="font-medium text-destructive">{err.category === "rate_limit" ? "Anthropic API rate-limited" : err.category === "overloaded" ? "Anthropic model is busy" : err.category === "timeout" ? "Generation timed out" : err.category === "network" ? "Network error" : err.category === "content_rejected" ? "Content rejected" : "Generation failed"}</p>
      <p className="mt-1 text-muted-foreground">{err.message}</p>
      <div className="mt-2 flex gap-2">
        {err.can_retry && err.category !== "overloaded" && (
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetryDisabled}
            className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors"
          >
            {retryLabel}
          </button>
        )}
        {err.category === "content_rejected" && (
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted transition-colors"
          >
            Edit prompt
          </button>
        )}
        {err.category === "timeout" && (
          <span className="self-center text-xs text-muted-foreground">Shorten your prompt to speed up generation.</span>
        )}
        {err.category === "network" && (
          <span className="self-center text-xs text-muted-foreground">Check your connection.</span>
        )}
      </div>
      <TraceIdBadge traceId={err.trace_id} />
    </div>
  );
}

function AiPanel({
  companyId,
  onInsert,
  onClose,
}: {
  companyId: string;
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = React.useState("");
  const [tone, setTone] = React.useState<"professional" | "casual" | "playful">("professional");
  const [length, setLength] = React.useState<"short" | "medium" | "long">("medium");
  const [goal, setGoal] = React.useState<"educate" | "promote" | "announce" | "engage">("engage");
  const [loading, setLoading] = React.useState(false);
  const [retryCount, setRetryCount] = React.useState(0);
  const [result, setResult] = React.useState<string | null>(null);
  const [error, setError] = React.useState<AiErrorState | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  async function generate(attempt = 1): Promise<void> {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setRetryCount(attempt);

    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/platform/social/cap/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId, prompt: prompt.trim(), tone, length, goal }),
        signal: abortRef.current.signal,
      });

      type ApiError = { category: AiErrorState["category"]; message: string; trace_id: string; retry_after?: number; can_retry: boolean };
      const json = (await res.json()) as { ok: boolean; data?: { text: string }; error?: ApiError };

      if (json.ok && json.data) {
        setResult(json.data.text);
        setLoading(false);
        return;
      }

      const apiErr = json.error;
      if (!apiErr) {
        setError({ category: "unknown", message: "Generation failed.", trace_id: "unknown", can_retry: true });
        setLoading(false);
        return;
      }

      // Auto-retry for overloaded (529) with exponential backoff 1s→3s→9s, max 3 attempts.
      if (apiErr.category === "overloaded" && attempt < 3) {
        const delay = [1000, 3000, 9000][attempt - 1] ?? 9000;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        return generate(attempt + 1);
      }

      setError(apiErr);
      // Fire-and-forget log to client_errors.
      void logClientError({
        component: "ai-assistant",
        severity: apiErr.category === "rate_limit" ? "warning" : "error",
        message: apiErr.message,
        traceId: apiErr.trace_id,
        companyId,
        context: { category: apiErr.category, http_status: res.status, attempt },
      });
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") {
        setLoading(false);
        return;
      }
      const traceId = `ai-gen-${Math.random().toString(16).slice(2, 6)}-${Math.random().toString(16).slice(2, 6)}`;
      setError({ category: "network", message: "Network error. Please try again.", trace_id: traceId, can_retry: true });
      void logClientError({ component: "ai-assistant", severity: "error", message: "Network fetch failed", traceId: traceId, companyId });
    } finally {
      setLoading(false);
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setLoading(false);
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-4 shadow-md" data-testid="ai-panel">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">AI assistant</p>
        <button type="button" onClick={onClose} aria-label="Close AI panel" className="text-muted-foreground hover:text-foreground">
          <CloseIcon size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe your post…"
        rows={2}
        className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        data-testid="ai-prompt-input"
      />
      <div className="grid grid-cols-3 gap-2">
        <select
          value={goal}
          onChange={(e) => setGoal(e.target.value as typeof goal)}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          aria-label="Goal"
        >
          <option value="educate">Educate</option>
          <option value="promote">Promote</option>
          <option value="announce">Announce</option>
          <option value="engage">Engage</option>
        </select>
        <select
          value={tone}
          onChange={(e) => setTone(e.target.value as typeof tone)}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          aria-label="Tone"
        >
          <option value="professional">Professional</option>
          <option value="casual">Casual</option>
          <option value="playful">Playful</option>
        </select>
        <select
          value={length}
          onChange={(e) => setLength(e.target.value as typeof length)}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          aria-label="Length"
        >
          <option value="short">Short</option>
          <option value="medium">Medium</option>
          <option value="long">Long</option>
        </select>
      </div>
      {error && (
        <AiErrorDisplay
          err={error}
          retryCount={retryCount}
          onRetry={() => void generate()}
          onEdit={() => setError(null)}
        />
      )}
      {result && (
        <div className="space-y-2">
          <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm" data-testid="ai-result">{result}</p>
          <button
            type="button"
            onClick={() => { onInsert(result); onClose(); }}
            className="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Use this text
          </button>
        </div>
      )}
      {loading ? (
        <button
          type="button"
          onClick={cancel}
          className="w-full rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
          data-testid="ai-cancel-button"
        >
          Cancel
        </button>
      ) : (
        <div className="space-y-1">
          {prompt.trim() && (
            <p className="text-center text-xs text-muted-foreground" data-testid="ai-cost-estimate">
              Est. cost: {estimateCost(prompt.length)} · ~{250 + Math.ceil(prompt.length / 4) + 200} tokens
            </p>
          )}
          <button
            type="button"
            onClick={() => void generate()}
            disabled={!prompt.trim()}
            className="w-full rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50 transition-colors"
            data-testid="ai-generate-button"
          >
            Generate
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GIF picker panel
// ---------------------------------------------------------------------------

const GIF_CATEGORIES = [
  { id: "trending", label: "Trending" },
  { id: "reactions", label: "Reactions" },
  { id: "sports", label: "Sports" },
  { id: "memes", label: "Memes" },
  { id: "animation", label: "Animation" },
  { id: "tech", label: "Tech" },
  { id: "stickers", label: "Stickers" },
] as const;

interface GifResult {
  id: string;
  title: string;
  preview_url: string;
  animated_url: string;
  original_url: string;
}

function GifPanel({
  companyId,
  onAttach,
  onClose,
}: {
  companyId: string;
  onAttach: (storageUrl: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<string>("trending");
  const [results, setResults] = React.useState<GifResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [attaching, setAttaching] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  async function search(q: string, cat: string) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ company_id: companyId, category: cat, limit: "12" });
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/platform/social/gif-search?${params.toString()}`);
      const json = (await res.json()) as { ok: boolean; data?: { results: GifResult[] }; error?: { message: string } };
      if (json.ok && json.data) {
        setResults(json.data.results);
      } else {
        setError(json.error?.message ?? "GIF search unavailable.");
      }
    } catch {
      setError("GIF search failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Initial load
  React.useEffect(() => { void search("", category); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced query search (300 ms)
  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void search(query, category); }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, category]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSelect(gif: GifResult) {
    setAttaching(gif.id);
    try {
      const res = await fetch("/api/platform/social/gif-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId, giphy_url: gif.original_url }),
      });
      const json = (await res.json()) as { ok: boolean; data?: { asset: { source_url: string } }; error?: { message: string } };
      if (json.ok && json.data?.asset.source_url) {
        onAttach(json.data.asset.source_url);
        onClose();
      } else {
        setError(json.error?.message ?? "Failed to attach GIF.");
      }
    } catch {
      setError("Failed to attach GIF. Please try again.");
    } finally {
      setAttaching(null);
    }
  }

  return (
    <div className="w-80 space-y-3 rounded-xl border border-border bg-background p-4 shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">GIF picker</p>
        <button type="button" onClick={onClose} aria-label="Close GIF panel" className="text-muted-foreground hover:text-foreground">
          <CloseIcon size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="GIF categories">
        {GIF_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            role="tab"
            aria-selected={category === cat.id}
            onClick={() => setCategory(cat.id)}
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
              category === cat.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search GIPHY…"
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs"
        aria-label="Search GIFs"
      />

      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      {loading && <p className="text-xs text-muted-foreground">Loading…</p>}

      <div className="grid grid-cols-3 gap-1 max-h-52 overflow-y-auto" data-testid="gif-grid">
        {results.map((gif) => (
          <button
            key={gif.id}
            type="button"
            aria-label={gif.title || "GIF"}
            disabled={!!attaching}
            onClick={() => void handleSelect(gif)}
            className={cn(
              "overflow-hidden rounded transition-opacity",
              attaching === gif.id ? "opacity-40" : "hover:opacity-80",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={gif.preview_url}
              alt={gif.title}
              className="h-16 w-full object-cover"
              loading="lazy"
            />
          </button>
        ))}
      </div>

      {/* Attribution required by GIPHY terms */}
      <p className="text-center text-xs text-muted-foreground">Powered by GIPHY</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Emoji panel
// ---------------------------------------------------------------------------

function EmojiPanel({
  onInsert,
  onClose,
}: {
  onInsert: (emoji: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="w-56 rounded-xl border border-border bg-background p-3 shadow-md">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold">Emoji</p>
        <button type="button" onClick={onClose} aria-label="Close emoji panel" className="text-muted-foreground hover:text-foreground">
          <CloseIcon size={12} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <div className="grid grid-cols-6 gap-0.5">
        {QUICK_EMOJI.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={emoji}
            onClick={() => { onInsert(emoji); onClose(); }}
            className="flex h-8 w-8 items-center justify-center rounded text-base hover:bg-muted transition-colors"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UTM panel
// ---------------------------------------------------------------------------

function UtmPanel({
  onInsert,
  onClose,
}: {
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = React.useState("");
  const [source, setSource] = React.useState("");
  const [medium, setMedium] = React.useState("social");
  const [campaign, setCampaign] = React.useState("");

  function buildUrl() {
    if (!url.trim()) return;
    try {
      const u = new URL(url.trim());
      if (source) u.searchParams.set("utm_source", source);
      if (medium) u.searchParams.set("utm_medium", medium);
      if (campaign) u.searchParams.set("utm_campaign", campaign);
      onInsert(u.toString());
      onClose();
    } catch {
      // invalid URL
    }
  }

  return (
    <div className="w-72 space-y-3 rounded-xl border border-border bg-background p-4 shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">UTM tags</p>
        <button type="button" onClick={onClose} aria-label="Close UTM panel" className="text-muted-foreground hover:text-foreground">
          <CloseIcon size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      {[
        { label: "URL", value: url, set: setUrl, placeholder: "https://example.com/page" },
        { label: "Source", value: source, set: setSource, placeholder: "linkedin" },
        { label: "Medium", value: medium, set: setMedium, placeholder: "social" },
        { label: "Campaign", value: campaign, set: setCampaign, placeholder: "spring-promo" },
      ].map(({ label, value, set, placeholder }) => (
        <div key={label} className="space-y-1">
          <label className="text-xs text-muted-foreground">{label}</label>
          <input
            type="text"
            value={value}
            onChange={(e) => set(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs"
          />
        </div>
      ))}
      <button
        type="button"
        onClick={buildUrl}
        disabled={!url.trim()}
        className="w-full rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
      >
        Insert URL with UTM tags
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolsRow — main export
// ---------------------------------------------------------------------------

const TOOLS = [
  { id: "ai" as const,    label: "AI assistant", icon: <Sparkles  size={14} strokeWidth={1.75} aria-hidden /> },
  { id: "media" as const, label: "Media",         icon: <ImagePlus size={14} strokeWidth={1.75} aria-hidden /> },
  { id: "emoji" as const, label: "Emoji",         icon: <Smile     size={14} strokeWidth={1.75} aria-hidden /> },
  { id: "gif" as const,   label: "GIF",           icon: <Film      size={14} strokeWidth={1.75} aria-hidden /> },
  { id: "utm" as const,   label: "UTM tags",      icon: <Tags      size={14} strokeWidth={1.75} aria-hidden /> },
] as const;

export function ToolsRow({ companyId, onInsertText, onOpenMediaPicker, onAttachGif, className }: ToolsRowProps) {
  const [activePanel, setActivePanel] = React.useState<ActivePanel>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  function togglePanel(id: Exclude<ActivePanel, null>) {
    setActivePanel((prev) => (prev === id ? null : id));
  }

  // Esc closes the active panel.
  React.useEffect(() => {
    if (!activePanel) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setActivePanel(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activePanel]);

  // Click outside the ToolsRow container closes the active panel.
  React.useEffect(() => {
    if (!activePanel) return;
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setActivePanel(null);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [activePanel]);

  return (
    <div ref={containerRef} className={cn("space-y-2", className)}>
      <div className="flex flex-wrap gap-1" data-testid="composer-tools-toolbar">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            data-testid={`composer-tool-${tool.id}`}
            onClick={() => {
              if (tool.id === "media") {
                onOpenMediaPicker();
              } else {
                togglePanel(tool.id);
              }
            }}
            aria-pressed={activePanel === tool.id}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
              activePanel === tool.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:border-muted-foreground hover:text-foreground",
            )}
          >
            {tool.icon}
            {tool.label}
          </button>
        ))}
      </div>

      {activePanel === "ai" && (
        <div data-testid="composer-panel-ai">
          <AiPanel
            companyId={companyId}
            onInsert={onInsertText}
            onClose={() => setActivePanel(null)}
          />
        </div>
      )}
      {activePanel === "emoji" && (
        <div data-testid="composer-panel-emoji">
          <EmojiPanel
            onInsert={onInsertText}
            onClose={() => setActivePanel(null)}
          />
        </div>
      )}
      {activePanel === "gif" && (
        <div data-testid="composer-panel-gif">
          <GifPanel
            companyId={companyId}
            onAttach={onAttachGif}
            onClose={() => setActivePanel(null)}
          />
        </div>
      )}
      {activePanel === "utm" && (
        <div data-testid="composer-panel-utm">
          <UtmPanel
            onInsert={onInsertText}
            onClose={() => setActivePanel(null)}
          />
        </div>
      )}
    </div>
  );
}
