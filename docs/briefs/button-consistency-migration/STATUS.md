# Button Consistency Migration — Status

## Status: 2026-05-23T00:00:00Z

**Items complete:** 0 of 12  
**Currently working on:** Setup — branch + infrastructure  
**Time elapsed:** 0 hours  
**Blockers:** none  
**Decisions made off-prompt:** none  
**Files touched so far:** 0  
**e2e status:** not started  
**Pixel-diff status:** not started  
**Next milestone:** Pilot Item 10 (admin/users Audit log link → Button outline)

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
