import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// NavIcon — Linearicons web-font wrapper.
//
// Linearicons are loaded as an icon font (see app/layout.tsx + public/fonts/
// linearicons/linearicons.css). Each glyph is rendered via a CSS class of
// the form `icon-{name}` on a styled `<i>` element. Font sizes that are
// multiples of 20px render crispest given the source SVGs are 20×20.
//
// `name` is the Linearicons identifier WITHOUT the `icon-` prefix —
// e.g. <NavIcon name="calendar-full" />. Browse `assets/Linearicons/demo.html`
// for the full list of 1097 available icon names.
// ---------------------------------------------------------------------------

interface NavIconProps {
  name: string;
  size?: number;
  className?: string;
}

export function NavIcon({ name, size = 20, className }: NavIconProps) {
  return (
    <i
      className={cn(`icon-${name}`, className)}
      style={{ fontSize: `${size}px` }}
      aria-hidden="true"
    />
  );
}
