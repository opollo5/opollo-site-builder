"use client";

import { useRef, useState } from "react";

import { NavIcon } from "@/components/ui/nav-icon";

// ---------------------------------------------------------------------------
// Spec 22 PR 2 — ToolsRow.
//
// Emoji | GIF (stub) | UTM (stub) | Add tag (stub) | AI Assistant (stub → PR 4)
//
// Emoji: a small popover with 24 common emojis that appends to the textarea
// value. GIF / UTM / Add tag / AI Assistant show "coming in a future update"
// tooltips; the AI Assistant button slot is wired in PR 4.
// ---------------------------------------------------------------------------

const COMMON_EMOJIS = [
  "😊", "🎉", "🔥", "👍", "❤️", "🚀", "✨", "💡",
  "📢", "🎯", "💪", "🙌", "⭐", "🤝", "📈", "💬",
  "🌟", "👏", "🎁", "🏆", "💼", "📌", "🔗", "✅",
];

interface ToolsRowProps {
  onEmojiInsert: (emoji: string) => void;
  onAIAssistant?: () => void;
  disabled?: boolean;
}

export function ToolsRow({ onEmojiInsert, onAIAssistant, disabled }: ToolsRowProps) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex items-center gap-0.5">
      {/* Emoji picker */}
      <div className="relative" ref={emojiRef}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setEmojiOpen((v) => !v)}
          aria-label="Insert emoji"
          title="Emoji"
          className="rounded p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-40"
        >
          <NavIcon name="smile" size={16} />
        </button>

        {emojiOpen && (
          <div className="absolute bottom-full left-0 z-20 mb-1 grid w-52 grid-cols-8 gap-0.5 rounded-md border border-white/10 bg-popover p-2 shadow-lg">
            {COMMON_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onEmojiInsert(emoji);
                  setEmojiOpen(false);
                }}
                className="rounded p-1 text-base hover:bg-white/10"
                aria-label={`Insert ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* GIF stub */}
      <button
        type="button"
        disabled
        title="GIF picker — coming soon"
        aria-label="GIF"
        className="rounded px-2 py-1.5 text-xs font-medium text-muted-foreground/50"
      >
        GIF
      </button>

      {/* UTM stub */}
      <button
        type="button"
        disabled
        title="UTM tags — coming soon"
        aria-label="UTM tags"
        className="rounded p-1.5 text-muted-foreground/50"
      >
        <NavIcon name="link" size={16} />
      </button>

      {/* Add tag stub */}
      <button
        type="button"
        disabled
        title="Add tag — coming soon"
        aria-label="Add tag"
        className="rounded p-1.5 text-muted-foreground/50"
      >
        <NavIcon name="tag" size={16} />
      </button>

      <div className="ml-auto">
        {/* AI Assistant — placeholder; PR 4 wires the inline expansion */}
        <button
          type="button"
          disabled={disabled || !onAIAssistant}
          onClick={onAIAssistant}
          title={onAIAssistant ? "AI Assistant" : "AI Assistant — coming soon"}
          aria-label="AI Assistant"
          className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-muted-foreground/60 hover:bg-white/10 hover:text-foreground disabled:cursor-default disabled:opacity-40"
        >
          <NavIcon name="magic-wand" size={14} />
          AI
        </button>
      </div>
    </div>
  );
}
