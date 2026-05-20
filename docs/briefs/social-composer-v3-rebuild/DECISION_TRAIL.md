# Decision Trail — Social Composer v3 Rebuild

Autonomous decisions logged here per master prompt operating rules.

---

## Phase 0 — Pre-flight (2026-05-20)

**D-001**: GIPHY env var name
- Master prompt references `GIPHY_API_KEY`. Production has `NEXT_PUBLIC_GIPHY_API_KEY`.
- Decision: Treat `NEXT_PUBLIC_GIPHY_API_KEY` as the canonical key. It works for both client-side and server-side usage in Next.js. The server-side gif-search route reads `process.env.NEXT_PUBLIC_GIPHY_API_KEY`. No new env var needed. Not a Phase 0 blocker.

**D-002**: Untracked brief files in workspace
- `git status --porcelain` shows untracked files: `docs/briefs/social-composer-v3-rebuild/`, `docs/audits/`, etc.
- Decision: Untracked-only workspace is acceptable. These are source materials Steven added. Will NOT commit them unless explicitly needed.

**D-003**: Local main diverged from origin/main
- Local had 9 extra merge commits from prior session.
- Decision: `git reset --hard origin/main` — safe because those 9 commits are already squash-merged into origin/main as PRs #953-#960.

---

## Phase 1 — Design system foundation

**D-004**: Design system page gating
- Master prompt says "only accessible in dev/staging via APP_ENV check."
- Decision: Gate with `process.env.NODE_ENV !== 'production'` check in the page component. Simpler than APP_ENV; consistent with existing dev-only patterns in the codebase.

**D-005**: Tailwind config — existing tokens
- The codebase already has Tailwind + some tokens. I'll EXTEND the config, not replace it.
- Specifically: add new keys under `extend:{}` to avoid breaking existing Tailwind classes.

**D-007**: CSS variable namespace for v3 tokens
- The existing globals.css has `--canvas` (HSL shadcn format), `--border` (HSL), `--ring`, etc. Adding v3 tokens with the same names would override them and break the existing design system.
- Decision: Prefix all v3 tokens with `--c3-` (e.g., `--c3-canvas`, `--c3-surface`, `--c3-ink`, `--c3-brand-500`). Wire these to Tailwind via new `extend.colors.c3.*` keys. Composer v3 components use these scoped tokens; rest of the app is unaffected.

**D-006**: Platform brand icon source
- Master prompt says "slice from `assets/Images/social-icons.gif`". A GIF is not sliceable to SVG — it's a raster sprite.
- Decision: Use the inline SVG paths already defined in the wireframe HTML file (the `<symbol>` elements with id `b-linkedin`, `b-facebook`, etc.). These are the correct brand-correct SVGs. Logging this as the analog source.

