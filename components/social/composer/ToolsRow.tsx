"use client";

import * as React from "react";
import { Sparkles, ImagePlus, Smile, Film, Tags, X as CloseIcon } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function generate() {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/platform/social/cap/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId, prompt: prompt.trim(), tone, length }),
      });
      const json = (await res.json()) as { ok: boolean; data?: { text: string }; error?: { message: string } };
      if (json.ok && json.data) {
        setResult(json.data.text);
      } else {
        setError(json.error?.message ?? "Generation failed.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-4 shadow-md">
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
      />
      <div className="flex gap-2">
        <select
          value={tone}
          onChange={(e) => setTone(e.target.value as typeof tone)}
          className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          aria-label="Tone"
        >
          <option value="professional">Professional</option>
          <option value="casual">Casual</option>
          <option value="playful">Playful</option>
        </select>
        <select
          value={length}
          onChange={(e) => setLength(e.target.value as typeof length)}
          className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          aria-label="Length"
        >
          <option value="short">Short</option>
          <option value="medium">Medium</option>
          <option value="long">Long</option>
        </select>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {result && (
        <div className="space-y-2">
          <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{result}</p>
          <button
            type="button"
            onClick={() => { onInsert(result); onClose(); }}
            className="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Use this text
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => void generate()}
        disabled={loading || !prompt.trim()}
        className="w-full rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50 transition-colors"
      >
        {loading ? "Generating…" : "Generate"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GIF picker panel
// ---------------------------------------------------------------------------

interface GiphyResult {
  id: string;
  images: { fixed_width: { url: string }; fixed_width_still: { url: string }; original: { url: string } };
  title: string;
}

function GifPanel({
  onInsert,
  onClose,
}: {
  onInsert: (url: string) => void;
  onClose: () => void;
}) {
  const apiKey = process.env.NEXT_PUBLIC_GIPHY_API_KEY ?? "";
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<GiphyResult[]>([]);
  const [loading, setLoading] = React.useState(false);

  async function search(q: string) {
    if (!apiKey) return;
    setLoading(true);
    try {
      const endpoint = q.trim()
        ? `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(q)}&limit=12&rating=g`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(apiKey)}&limit=12&rating=g`;
      const res = await fetch(endpoint);
      const json = (await res.json()) as { data: GiphyResult[] };
      setResults(json.data ?? []);
    } catch {
      // silently fail — GIF picker is optional
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { void search(""); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!apiKey) {
    return (
      <div className="rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">
        NEXT_PUBLIC_GIPHY_API_KEY is not set.
        <button type="button" onClick={onClose} className="ml-2 text-xs underline">Close</button>
      </div>
    );
  }

  return (
    <div className="w-72 space-y-3 rounded-xl border border-border bg-background p-4 shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">GIF picker</p>
        <button type="button" onClick={onClose} aria-label="Close GIF panel" className="text-muted-foreground hover:text-foreground">
          <CloseIcon size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void search(query); }}
        placeholder="Search GIPHY…"
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs"
      />
      {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
      <div className="grid grid-cols-3 gap-1 max-h-48 overflow-y-auto">
        {results.map((gif) => (
          <button
            key={gif.id}
            type="button"
            aria-label={gif.title}
            onClick={() => { onInsert(gif.images.original.url); onClose(); }}
            className="overflow-hidden rounded"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={gif.images.fixed_width_still.url}
              alt={gif.title}
              className="h-16 w-full object-cover hover:opacity-80 transition-opacity"
            />
          </button>
        ))}
      </div>
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

export function ToolsRow({ companyId, onInsertText, onOpenMediaPicker, className }: ToolsRowProps) {
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
            onInsert={onInsertText}
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
