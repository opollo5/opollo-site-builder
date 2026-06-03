// lib/feedback/capture/selector.ts — stable CSS selector resolution.
//
// Priority (highest to lowest):
//   1. [data-testid] on the element or nearest ancestor (survives refactors)
//   2. Stable id attribute
//   3. Short tag:nth-of-type chain (capped at 4 levels)
//
// Used by ElementPicker.tsx (client) and by the server when normalising
// an inbound selector for storage.

export function resolveSelector(element: Element): string {
  // 1. [data-testid] — walk up to find the nearest one.
  let cursor: Element | null = element;
  while (cursor && cursor !== document.body) {
    const tid = cursor.getAttribute("data-testid");
    if (tid) return `[data-testid="${CSS.escape(tid)}"]`;
    cursor = cursor.parentElement;
  }

  // 2. Stable id on the element itself.
  if (element.id) return `#${CSS.escape(element.id)}`;

  // 3. Short structural chain — cap at 4 levels.
  const parts: string[] = [];
  let el: Element | null = element;
  for (let depth = 0; depth < 4; depth++) {
    if (!el || el === document.documentElement) break;
    const tag: string = el.tagName.toLowerCase();
    const parentEl: Element | null = el.parentElement;
    if (!parentEl) {
      parts.unshift(tag);
      break;
    }
    const elTag: string = el.tagName;
    const siblings: Element[] = Array.from(parentEl.children).filter(
      (c: Element) => c.tagName === elTag,
    );
    if (siblings.length > 1) {
      const idx: number = siblings.indexOf(el) + 1;
      parts.unshift(`${tag}:nth-of-type(${idx})`);
    } else {
      parts.unshift(tag);
    }
    el = parentEl;
  }
  return parts.join(" > ");
}

// Derive a human-readable label for an element.
export function elementLabel(element: Element): string {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel.slice(0, 80);

  const textContent = element.textContent?.trim().slice(0, 80);
  if (textContent) return textContent;

  return element.tagName.toLowerCase();
}
