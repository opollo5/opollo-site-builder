"use client";

import { Fragment } from "react";
import { usePlatform } from "@/lib/hooks/use-platform";
import { cn } from "@/lib/utils";

export type KbdModifier = "mod" | "shift" | "alt" | "ctrl" | "enter";

const MAC_GLYPHS: Record<KbdModifier, string> = {
  mod: "⌘",
  shift: "⇧",
  alt: "⌥",
  ctrl: "⌃",
  enter: "⏎",
};

const NON_MAC_LABELS: Record<KbdModifier, string> = {
  mod: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  ctrl: "Ctrl",
  enter: "Enter",
};

function isModifier(key: string): key is KbdModifier {
  return key in MAC_GLYPHS;
}

export interface KbdProps {
  keys: Array<KbdModifier | string>;
  className?: string;
}

export function Kbd({ keys, className }: KbdProps) {
  const { platform, hydrated } = usePlatform();
  // Render Ctrl-style labels until hydration completes — prevents a one-frame
  // ⌘ flash on Windows. Mac users still see ⌘ after hydration.
  const isMac = hydrated && platform === "mac";

  const ariaLabel = keys
    .map((k) => (isModifier(k) ? NON_MAC_LABELS[k] : k))
    .join(" ");

  return (
    <kbd
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded border bg-muted px-1.5 py-0.5 font-mono text-xs font-medium",
        className,
      )}
    >
      {keys.map((k, i) => {
        const display = isModifier(k)
          ? isMac
            ? MAC_GLYPHS[k]
            : NON_MAC_LABELS[k]
          : k;
        return (
          <Fragment key={i}>
            <span>{display}</span>
            {i < keys.length - 1 && !isMac ? (
              <span className="opacity-60">+</span>
            ) : null}
          </Fragment>
        );
      })}
    </kbd>
  );
}
