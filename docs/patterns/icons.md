# Icons — convention

Lucide icons via `lucide-react` (installed in A-7). Replaces text glyphs
(`×`, `▼`, `→`, `⚠`, `ⓘ`) with crisp SVGs that scale, theme via
`currentColor`, and tree-shake per icon.

## Import directly

No wrapper component. Each consumer imports the specific icon by name:

```tsx
import { X, ChevronDown, Plus, Info, TriangleAlert } from "lucide-react";
```

Tree-shaking is per-named-export — unused icons drop out at build time.
A wrapper would prevent that without buying anything beyond a fixed
sizing convention (which we get from the size table below).

## Size convention

| Use case | Size class | Notes |
|---|---|---|
| Inline next to body text (`text-sm`) | `h-4 w-4` | 16px — the default. Aligns visually with x-height. |
| Inside a status pill (`text-xs`) | `h-3 w-3` | 12px — matches pill text size. |
| Inside an icon-button (h-11 w-11 tap target) | `h-5 w-5` | 20px — visible without overpowering the button. |
| Inside an H1 / H2 / loose density | `h-5 w-5` | 20px — matches heading weight. |

Always pair with `aria-hidden` when the icon is decorative (sits next
to text that already conveys meaning):

```tsx
<X aria-hidden className="h-4 w-4" />
```

For icon-only buttons, omit `aria-hidden` and add an `aria-label` to
the button:

```tsx
<button aria-label="Close" className="h-11 w-11 …">
  <X className="h-5 w-5" />
</button>
```

## Color

Lucide SVGs use `stroke="currentColor"`. Don't set `text-emerald-500`
on the icon directly; set the color on the parent button/badge. This
keeps the icon in lockstep with the text it accompanies (hover state
flips both at once).

## Canonical icon → intent map

| Intent | Icon |
|---|---|
| Close / dismiss / remove | `X` |
| Info / detail expand | `Info` |
| Warn / quality flag | `TriangleAlert` |
| Error / hard stop | `OctagonX` |
| Success / done | `Check` |
| Chevron down (dropdown closed) | `ChevronDown` |
| Chevron up (dropdown open) | `ChevronUp` |
| Chevron right (drilldown) | `ChevronRight` |
| Back / previous | `ArrowLeft` |
| Forward / next | `ArrowRight` |
| Add / new | `Plus` |
| Attach file | `Paperclip` |
| Search | `Search` |
| Settings / config | `Settings` |
| External link | `ExternalLink` |
| Copy to clipboard | `Copy` |
| Edit / pencil | `Pencil` |
| Delete | `Trash2` |
| Refresh / reload | `RefreshCw` |
| Loading spinner | `Loader2` (apply `animate-spin`) |
| Play / start run | `Play` |
| Pause | `Pause` |
| Calendar / scheduled | `Calendar` |

When you reach for an icon not in this list, add a row here as part
of the same PR — keeps the convention discoverable.

## Don't use icons for

- **Decoration alone.** Every icon should clarify intent or save
  text-label real estate. Icons used as visual punctuation churn the
  surface without payoff.
- **Status pills.** StatusPill (A-4) carries label + tone. Adding an
  icon inside the pill crowds it; if the pill needs more weight, use
  `density="loose"` instead.
- **Replacing arrows in microcopy.** Phrases like "Open run surface →"
  read better with the literal arrow character than with `<ArrowRight>`
  inline. The arrow IS the rhythm of the sentence; an SVG breaks it.
