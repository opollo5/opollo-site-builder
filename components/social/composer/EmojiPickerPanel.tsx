"use client";

import * as React from "react";
import EmojiPicker, {
  Categories,
  type CategoryConfig,
  EmojiClickData,
  EmojiStyle,
  SkinTonePickerLocation,
  SkinTones,
  SuggestionMode,
  Theme,
} from "emoji-picker-react";
import { X } from "lucide-react";

// ---------------------------------------------------------------------------
// EmojiPickerPanel — full emoji picker backed by emoji-picker-react v4.
//
// Phase 4.1 / B1: 9 categories, search, skin tone, frequently-used row.
// Skin tone preference is persisted in localStorage.
// Frequently-used tracking is handled internally by the library.
// ---------------------------------------------------------------------------

const STORAGE_KEY_SKIN = "composer_emoji_skin_tone";

const CATEGORIES: CategoryConfig[] = [
  { category: Categories.SUGGESTED, name: "Frequently used" },
  { category: Categories.SMILEYS_PEOPLE, name: "Smileys & People" },
  { category: Categories.ANIMALS_NATURE, name: "Animals & Nature" },
  { category: Categories.FOOD_DRINK, name: "Food & Drink" },
  { category: Categories.TRAVEL_PLACES, name: "Travel & Places" },
  { category: Categories.ACTIVITIES, name: "Activities" },
  { category: Categories.OBJECTS, name: "Objects" },
  { category: Categories.SYMBOLS, name: "Symbols" },
  { category: Categories.FLAGS, name: "Flags" },
];

function loadSkinTone(): SkinTones {
  if (typeof window === "undefined") return SkinTones.NEUTRAL;
  const saved = window.localStorage.getItem(STORAGE_KEY_SKIN);
  if (saved && Object.values(SkinTones).includes(saved as SkinTones)) {
    return saved as SkinTones;
  }
  return SkinTones.NEUTRAL;
}

function saveSkinTone(tone: SkinTones) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY_SKIN, tone);
  }
}

export function EmojiPickerPanel({
  onInsert,
  onClose,
}: {
  onInsert: (emoji: string) => void;
  onClose: () => void;
}) {
  const [skinTone, setSkinTone] = React.useState<SkinTones>(SkinTones.NEUTRAL);

  React.useEffect(() => {
    setSkinTone(loadSkinTone());
  }, []);

  const handleEmojiClick = React.useCallback(
    (data: EmojiClickData) => {
      onInsert(data.emoji);
      onClose();
    },
    [onInsert, onClose],
  );

  const handleSkinToneChange = React.useCallback((tone: SkinTones) => {
    setSkinTone(tone);
    saveSkinTone(tone);
  }, []);

  return (
    <div
      className="rounded-xl border border-border bg-background shadow-md overflow-hidden"
      data-testid="emoji-picker-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <p className="text-xs font-semibold text-foreground">Emoji</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close emoji panel"
          className="text-muted-foreground hover:text-foreground transition-colors"
          data-testid="emoji-picker-close"
        >
          <X size={12} strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      {/* Picker */}
      <EmojiPicker
        onEmojiClick={handleEmojiClick}
        onSkinToneChange={handleSkinToneChange}
        defaultSkinTone={skinTone}
        theme={Theme.LIGHT}
        emojiStyle={EmojiStyle.NATIVE}
        categories={CATEGORIES}
        suggestedEmojisMode={SuggestionMode.FREQUENT}
        skinTonePickerLocation={SkinTonePickerLocation.SEARCH}
        autoFocusSearch
        lazyLoadEmojis
        previewConfig={{ showPreview: false, defaultEmoji: "1f60a", defaultCaption: "" }}
        height={340}
        width={300}
        data-testid="emoji-picker"
      />
    </div>
  );
}
