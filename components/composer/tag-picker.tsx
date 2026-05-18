"use client";

import { useEffect, useRef, useState } from "react";

import { NavIcon } from "@/components/ui/nav-icon";

// ---------------------------------------------------------------------------
// TagPickerPanel — hashtag typeahead inline panel for the composer.
//
// Renders below the tools row. The user types a tag (without #); pressing
// Enter or clicking a suggestion fires onInsert("#tag"). Suggestions are
// from a small built-in list + any tags already typed in the draft text.
// ---------------------------------------------------------------------------

const SUGGESTED_TAGS = [
  "marketing", "socialmedia", "content", "digitalmarketing",
  "business", "brand", "entrepreneur", "startup", "growth",
  "tips", "news", "announcement", "linkedin", "twitter",
];

interface TagPickerPanelProps {
  draftText?: string;
  onInsert: (tag: string) => void;
  onClose: () => void;
}

export function TagPickerPanel({ draftText, onInsert, onClose }: TagPickerPanelProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Extract existing tags from draft text so user can quickly re-use them.
  const existingTags = draftText
    ? [...new Set([...draftText.matchAll(/#(\w+)/g)].map((m) => m[1]))]
    : [];

  const allSuggestions = [
    ...new Set([...existingTags, ...SUGGESTED_TAGS]),
  ];

  const filtered = query.trim()
    ? allSuggestions.filter((t) => t.toLowerCase().includes(query.toLowerCase()))
    : allSuggestions.slice(0, 12);

  function handleInsert(tag: string) {
    onInsert(`#${tag}`);
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && query.trim()) {
      handleInsert(query.trim().replace(/^#/, ""));
    }
    if (e.key === "Escape") onClose();
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-white/10 bg-popover p-3 shadow-xl"
      data-testid="tag-picker-panel"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Add hashtag</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close tag picker"
          className="rounded p-0.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
        >
          <NavIcon name="cross" size={12} />
        </button>
      </div>

      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value.replace(/^#/, ""))}
        onKeyDown={handleKeyDown}
        placeholder="Type a tag… (press Enter to insert)"
        aria-label="Type a hashtag"
        className="w-full rounded border border-white/10 bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-pk"
      />

      {filtered.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {filtered.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => handleInsert(tag)}
              className="rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-muted-foreground hover:border-pk hover:text-foreground"
            >
              #{tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
