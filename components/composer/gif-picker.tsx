"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { NavIcon } from "@/components/ui/nav-icon";
import type { MediaRef } from "@/lib/platform/social/drafts";

// ---------------------------------------------------------------------------
// GifPickerPanel — Tenor-powered GIF search for the composer tools row.
//
// Calls Tenor v2 /search from the browser using the public demo key
// (NEXT_PUBLIC_TENOR_API_KEY env var → fallback to Tenor demo key).
// ---------------------------------------------------------------------------

const TENOR_KEY =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_TENOR_API_KEY) ||
  "AIPAVJSPKPG4";

interface TenorResult {
  id: string;
  title: string;
  media_formats: {
    tinygif?: { url: string; dims: [number, number] };
    gif?: { url: string; dims: [number, number] };
  };
}

interface GifPickerPanelProps {
  onSelect: (ref: MediaRef) => void;
  onClose: () => void;
}

export function GifPickerPanel({ onSelect, onClose }: GifPickerPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TenorResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    setError(null);
    try {
      const url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${TENOR_KEY}&limit=12&media_filter=tinygif,gif`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Tenor request failed");
      const data = await res.json() as { results: TenorResult[] };
      setResults(data.results ?? []);
    } catch {
      setError("Could not load GIFs. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void search(q), 400);
  }, [search]);

  // Load trending on open.
  useEffect(() => {
    void search("trending");
  }, [search]);

  function handleSelect(result: TenorResult) {
    const fmt = result.media_formats.tinygif ?? result.media_formats.gif;
    if (!fmt) return;
    const [width, height] = fmt.dims;
    onSelect({
      type: "tenor_gif",
      url: fmt.url,
      alt_text: result.title || "GIF",
      width,
      height,
      source_metadata: { tenor_id: result.id },
    });
    onClose();
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-white/10 bg-popover p-3 shadow-xl"
      data-testid="gif-picker-panel"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">GIF Search</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close GIF picker"
          className="rounded p-0.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
        >
          <NavIcon name="cross" size={12} />
        </button>
      </div>

      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={handleChange}
        placeholder="Search GIFs…"
        aria-label="Search GIFs"
        className="w-full rounded border border-white/10 bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-pk"
      />

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {loading && (
        <div className="flex justify-center py-4">
          <span className="animate-spin text-muted-foreground">
            <NavIcon name="sync" size={16} />
          </span>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="grid grid-cols-3 gap-1 max-h-48 overflow-y-auto">
          {results.map((r) => {
            const fmt = r.media_formats.tinygif ?? r.media_formats.gif;
            if (!fmt) return null;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => handleSelect(r)}
                aria-label={r.title || "GIF"}
                className="overflow-hidden rounded hover:ring-2 hover:ring-pk"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fmt.url}
                  alt={r.title || "GIF"}
                  className="h-16 w-full object-cover"
                  loading="lazy"
                />
              </button>
            );
          })}
        </div>
      )}

      {!loading && !error && results.length === 0 && query.trim() && (
        <p className="py-4 text-center text-xs text-muted-foreground">No results for &ldquo;{query}&rdquo;</p>
      )}
    </div>
  );
}
