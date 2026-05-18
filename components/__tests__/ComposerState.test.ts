import { describe, expect, test } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useComposerState } from "@/hooks/use-composer-state";

describe("useComposerState", () => {
  test("starts closed with empty draft", () => {
    const { result } = renderHook(() => useComposerState());
    expect(result.current.composerState.open).toBe(false);
    expect(result.current.composerState.dirty).toBe(false);
    expect(result.current.composerState.draft.content).toBe("");
  });

  test("openComposer sets open=true and dirty=false", () => {
    const { result } = renderHook(() => useComposerState());
    act(() => result.current.openComposer());
    expect(result.current.composerState.open).toBe(true);
    expect(result.current.composerState.dirty).toBe(false);
  });

  test("openComposer accepts initialDraft and prefilledDate", () => {
    const { result } = renderHook(() => useComposerState());
    const draft = {
      content: "Hello",
      media_urls: [],
      target_profile_ids: ["p1"],
      platform_variants: {},
      approval_required: false,
    };
    const date = new Date("2026-05-21");
    act(() => result.current.openComposer({ initialDraft: draft, prefilledDate: date }));
    expect(result.current.composerState.draft.content).toBe("Hello");
    expect(result.current.composerState.prefilledDate?.toISOString()).toBe(date.toISOString());
  });

  test("updateDraft sets dirty=true and merges patch", () => {
    const { result } = renderHook(() => useComposerState());
    act(() => result.current.openComposer());
    act(() => result.current.updateDraft({ content: "Updated" }));
    expect(result.current.composerState.dirty).toBe(true);
    expect(result.current.composerState.draft.content).toBe("Updated");
  });

  test("discardChanges resets to closed + clean", () => {
    const { result } = renderHook(() => useComposerState());
    act(() => result.current.openComposer());
    act(() => result.current.updateDraft({ content: "x" }));
    act(() => result.current.discardChanges());
    expect(result.current.composerState.open).toBe(false);
    expect(result.current.composerState.dirty).toBe(false);
    expect(result.current.composerState.draft.content).toBe("");
  });

  test("closing with dirty draft sets pendingClose instead of closing", () => {
    const { result } = renderHook(() => useComposerState());
    act(() => result.current.openComposer());
    act(() => result.current.updateDraft({ content: "dirty" }));
    act(() => result.current.setComposerState({ open: false }));
    expect(result.current.composerState.open).toBe(true);
    expect(result.current.composerState.pendingClose).toBe(true);
  });

  test("cancelClose clears pendingClose without closing", () => {
    const { result } = renderHook(() => useComposerState());
    act(() => result.current.openComposer());
    act(() => result.current.updateDraft({ content: "dirty" }));
    act(() => result.current.setComposerState({ open: false }));
    act(() => result.current.cancelClose());
    expect(result.current.composerState.pendingClose).toBe(false);
    expect(result.current.composerState.open).toBe(true);
  });

  test("closing without dirty draft closes immediately", () => {
    const { result } = renderHook(() => useComposerState());
    act(() => result.current.openComposer());
    act(() => result.current.setComposerState({ open: false }));
    expect(result.current.composerState.open).toBe(false);
    expect(result.current.composerState.pendingClose).toBe(false);
  });
});
