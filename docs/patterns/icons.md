# Icons — convention

Linearicons icon font, served from `public/fonts/linearicons/` and wrapped
by the `<NavIcon>` component. Replaced the previous `lucide-react`
convention in the two-level-nav workstream — identifier table at the
bottom of this doc captures the intent map for known icon usages.

## How to render an icon

Always import `NavIcon` and pass the icon name as a string. The
underlying CSS class (`icon-{name}`) is injected automatically.

```tsx
import { NavIcon } from "@/components/ui/nav-icon";

<NavIcon name="check" size={16} className="text-success" />
```

The `name` is the Linearicons identifier without the `icon-` prefix.
Browse `assets/Linearicons/demo.html` for the full library of 1097
glyphs, or grep `assets/Linearicons/style.css` for `^\.icon-`.

## Size convention

The source SVGs are 20×20, so font sizes that are multiples of 20 render
crispest. Pick the size that matches the surrounding text rhythm.

| Use case | `size` prop | Notes |
|---|---|---|
| Inline next to body text (`text-sm`) | `16` | 16px — the default for in-flow icons. |
| Inside a status pill (`text-xs`) | `12` | 12px — matches pill text size. |
| Inside an icon-button (h-11 w-11 tap target) | `20` | 20px — visible without overpowering the button. |
| Empty-state badge (40×40 circle) | `20` | 20px — already centered in a rounded badge. |
| Primary nav rail | `20` | 20px — standard nav rail size. |

`NavIcon` always renders with `aria-hidden="true"`. For icon-only
buttons, set `aria-label` on the button itself, not the icon.

```tsx
<button aria-label="Close" className="h-11 w-11 …">
  <NavIcon name="cross" size={20} />
</button>
```

## Color

Icon glyphs inherit text color via `currentColor`. Apply color through
the parent element (or `className` on `NavIcon`) so hover state flips
both the icon and any sibling text in lockstep.

```tsx
<button className="text-muted-foreground hover:text-foreground">
  <NavIcon name="paperclip" size={20} />
</button>
```

## Canonical icon → intent map

| Intent | Linearicons name | Notes |
|---|---|---|
| Close / dismiss / remove | `cross` | |
| Info / detail expand | `question-circle` | (Linearicons lacks a plain info; question-circle is the closest neutral) |
| Warn / quality flag / error inline | `warning` | |
| Success / done | `check`, `checkmark-circle` | use `check` for inline ticks, `checkmark-circle` for status |
| Chevron down (dropdown closed) | `chevron-down` | |
| Chevron up (dropdown open) | `chevron-up` | |
| Chevron left/right | `chevron-left` / `chevron-right` | |
| Combobox indicator | `chevrons-expand-vertical` | |
| Back / forward | `arrow-left` / `arrow-right` | |
| Add / new | `plus` | |
| Attach file | `paperclip` | |
| Search | `magnifier` | |
| Settings / config | `cog` | |
| Edit / pencil | `pencil` | |
| Delete | `trash` | |
| Refresh / reload / loading spinner | `sync` | apply `animate-spin` className for spinner |
| Save | `floppy-disk` | |
| Reset / undo | `undo` | |
| Calendar / scheduled | `calendar-full` | |
| Clock / time | `clock` | |
| List / ordered list | `list` / `list2` | |
| Quote / blockquote | `quote-open` | |
| Bold / italic | `bold` / `italic` | |
| Sparkle / AI accent | `magic-wand` | |
| Globe / sites | `earth` | |
| Building / company / apartment | `apartment` | |
| Users / team | `users` | |
| Share | `share2` | |
| File | `file-empty` | (Linearicons lacks `file-text`; `file-empty` is the closest semantic) |
| Image / picture | `picture` | |
| Upload / cloud-upload / download | `upload` / `cloud-upload` / `download` | |
| Link | `link2` | |
| Send / paper plane | `paper-plane` | |
| Sign out / exit | `exit` | |
| Workflow / batches / tree | `tree` | |
| Stack / layers | `layers` | |
| Layout / template / grid | `grid` | |
| Trending / chart / growth | `chart-growth`, `chart-bars` | |
| Desktop / mobile | `desktop` / `smartphone` | |
| Brand / palette | `palette` | |
| Volume / audio | `volume` | |
| Frame expand / contract (fullscreen toggle) | `frame-expand` / `frame-contract` | |
| Hamburger / menu | `menu` | |
| Key / security | `key` | |
| Shield / admin | `shield-check` | |
| Pencil-ruler / design system | `pencil-ruler` | |
| Envelope / mail | `envelope` | |
| History / audit log | `history` | |

When you reach for an icon not in this list, add a row here as part of
the same PR — keeps the convention discoverable.

## Don't use icons for

- **Decoration alone.** Every icon should clarify intent or save
  text-label real estate. Icons used as visual punctuation churn the
  surface without payoff.
- **Status pills.** `StatusPill` carries label + tone. Adding an icon
  inside the pill crowds it; if the pill needs more weight, use
  `density="loose"` instead.
- **Replacing arrows in microcopy.** Phrases like "Open run surface →"
  read better with the literal arrow character than with an inline
  `<NavIcon>`. The arrow IS the rhythm of the sentence; a glyph swap
  breaks it.

## Adding a new icon

1. Check `assets/Linearicons/demo.html` for an existing glyph that fits.
2. Use `<NavIcon name="..." />` — never import icons from another
   library.
3. If a needed icon doesn't exist in Linearicons, import
   `assets/Linearicons/Linearicons.icomoon.json` into
   <https://icomoon.io/app>, add the icon, re-export, and replace the
   font files at `assets/Linearicons/fonts/` and the CSS at
   `assets/Linearicons/style.css`. Re-run the publish step (copy fonts
   to `public/fonts/linearicons/`, fix the URL paths in the copied CSS).
