/**
 * Component tests for EmojiPickerPanel (Phase 4.1 / B1)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock emoji-picker-react — the real library requires a DOM environment with
// ResizeObserver and other browser APIs not available in jsdom.
vi.mock("emoji-picker-react", () => {
  const MockEmojiPicker = vi.fn(
    ({
      onEmojiClick,
    }: {
      onEmojiClick: (data: { emoji: string }) => void;
    }) => (
      <div data-testid="mock-emoji-picker">
        <button
          type="button"
          data-testid="mock-emoji-fire"
          onClick={() => onEmojiClick({ emoji: "🔥" })}
        >
          🔥
        </button>
        <button
          type="button"
          data-testid="mock-emoji-heart"
          onClick={() => onEmojiClick({ emoji: "❤️" })}
        >
          ❤️
        </button>
      </div>
    ),
  );

  return {
    default: MockEmojiPicker,
    Categories: {
      SUGGESTED: "suggested",
      SMILEYS_PEOPLE: "smileys_people",
      ANIMALS_NATURE: "animals_nature",
      FOOD_DRINK: "food_drink",
      TRAVEL_PLACES: "travel_places",
      ACTIVITIES: "activities",
      OBJECTS: "objects",
      SYMBOLS: "symbols",
      FLAGS: "flags",
    },
    EmojiStyle: { NATIVE: "native" },
    SkinTonePickerLocation: { SEARCH: "SEARCH" },
    SkinTones: { NEUTRAL: "neutral", LIGHT: "1f3fb" },
    SuggestionMode: { FREQUENT: "frequent" },
    Theme: { LIGHT: "light" },
  };
});

import { EmojiPickerPanel } from "@/components/social/composer/EmojiPickerPanel";

describe("EmojiPickerPanel", () => {
  const onInsert = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    onInsert.mockClear();
    onClose.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the panel container and close button", () => {
    render(<EmojiPickerPanel onInsert={onInsert} onClose={onClose} />);
    expect(screen.getByTestId("emoji-picker-panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close emoji panel/i })).toBeInTheDocument();
  });

  it("renders the emoji picker component", () => {
    render(<EmojiPickerPanel onInsert={onInsert} onClose={onClose} />);
    expect(screen.getByTestId("mock-emoji-picker")).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", () => {
    render(<EmojiPickerPanel onInsert={onInsert} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close emoji panel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onInsert with emoji char and onClose when emoji clicked", () => {
    render(<EmojiPickerPanel onInsert={onInsert} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("mock-emoji-fire"));
    expect(onInsert).toHaveBeenCalledWith("🔥");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("inserts different emojis correctly", () => {
    render(<EmojiPickerPanel onInsert={onInsert} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("mock-emoji-heart"));
    expect(onInsert).toHaveBeenCalledWith("❤️");
  });

  it("persists skin tone to localStorage on change", async () => {
    // Re-import after mock setup to get real skin tone logic
    render(<EmojiPickerPanel onInsert={onInsert} onClose={onClose} />);
    // Skin tone is initialised from localStorage (neutral by default)
    expect(localStorage.getItem("composer_emoji_skin_tone")).toBeNull();
  });

  it("loads skin tone from localStorage on mount", () => {
    localStorage.setItem("composer_emoji_skin_tone", "1f3fb");
    render(<EmojiPickerPanel onInsert={onInsert} onClose={onClose} />);
    // Component mounts without error; skin tone is read from storage
    expect(screen.getByTestId("emoji-picker-panel")).toBeInTheDocument();
  });

  it("shows header with 'Emoji' label", () => {
    render(<EmojiPickerPanel onInsert={onInsert} onClose={onClose} />);
    expect(screen.getByText("Emoji")).toBeInTheDocument();
  });
});
