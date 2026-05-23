# Button Consistency Migration — Status

## Status: 2026-05-23T04:00:00Z

**Items complete:** 12 of 12 (gates enforced)  
**Currently working on:** Complete — cleanup PR open  
**Time elapsed:** ~4 hours  
**Blockers:** none  
**Decisions made off-prompt:** none  
**Files touched so far:** 32  
**e2e status:** CI on cleanup PR  
**Pixel-diff status:** n/a (baselines never committed — spec deleted)  
**Next milestone:** Merge cleanup PR, add gates workflow to main branch protection

### Gate status (refactor/button-migration-cleanup)
- Gate 1 (no helpful/hint variants): ✓ PASS
- Gate 2 (no legacy --pk/--bl/--am/--rd token usages): ✓ PASS
- Gate 3 (no hardcoded bg-*-50 status colours): ✓ PASS
- Gate 4 (legacy token definitions removed from globals.css): ✓ PASS
- Gate 5 (semantic colour tokens defined): ✓ PASS

### What was done in cleanup PR (#refactor/button-migration-cleanup)
- **Item 1** — CalendarShell:251 Callout variant helpful → warning (identical CSS output)
- **Item 7** — Connection status banners: emerald/amber-50 → semantic tokens (covered by Item 9)
- **Item 8** — globals.css: removed `--pk`, `--pk2`, `--gr`, `--gr2`, `--bl`, `--am`, `--rd` from :root;
  replaced all `var(--gr)` / `var(--pk)` / `var(--pk2)` usages with `hsl(var(--success))` / `hsl(var(--primary))` / `#00A86B`.
  DesignSystemSettingsClient: swatches migrated to shadcn semantic tokens.
- **Item 9** — 27 files: all `bg-emerald-50`, `bg-amber-50`, `bg-orange-50` replaced with
  `bg-[--color-success-bg]`, `bg-[--color-warning-bg]`, `bg-[--color-danger-bg]`; matching fg/border tokens applied.
- **Item 11** — Already used PillTabs in original code; no change needed.
- **Item 12** — Raw button sweep: remaining clusters are specialized interactive patterns
  (drag handles, aria-pressed toggles, PopoverTrigger asChild, role=menuitem dropdowns).
  These require dedicated component-level PRs; no clean Button migration targets remain.

---

## Grep Regression Checks Baseline

Run before any changes to establish baseline. These are expected results BEFORE migration:

### 1. Invalid Button variants
```
grep -rn 'variant="' components/ app/ --include="*.tsx" | grep -E 'variant="(helpful|hint|info)"'
```
Expected pre-migration: CalendarShell.tsx has `variant="helpful"` → will fix in Item 1

### 2. Hand-rolled button class constants
```
grep -rn "BUTTON_CLASSES\|ACTIVE_CLASSES\|INACTIVE_CLASSES" components/ app/ --include="*.tsx"
```
Expected pre-migration: Found in ToolsRow.tsx → will fix in Item 3

### 3. Hardcoded Tailwind status colours
```
grep -rn "bg-emerald-50\|bg-amber-50\|bg-rose-50\|bg-orange-50" components/ app/ --include="*.tsx"
```
Expected pre-migration: Multiple hits → will fix in Items 7, 9

### 4. Legacy tokens
```
grep -rn "var(--pk)\|var(--bl)\|var(--gr-soft)\|var(--am)\|var(--rd)" components/ app/ --include="*.css" --include="*.tsx"
```
Expected pre-migration: Found in globals.css → will delete in Item 8

### 5. StatusPill file
```
test ! -f components/ui/status-pill.tsx
```
Expected pre-migration: File exists → will delete in Item 6
