# Button Consistency Migration — Open Questions

Questions that arose during execution not resolved by D1-D11. Each entry records the
question, reasoning, choice made, and which item it affects.

## Template

```
## OQ-N: <short title>
Item affected: Item X  
Question: <what the question is>  
Reasoning: <why D1-D11 didn't resolve it>  
Choice: <what was decided>  
```

---

## OQ-1: CalendarShell "helpful" variant is on Callout, not Button
Item affected: Item 1  
Question: D6 says `variant="helpful"` in CalendarShell.tsx:251 → replace with `"ghost"`. But the
element at that line is `<Callout variant="helpful">`, not `<Button>`. `Callout` has `"helpful"` as
a valid variant per its own CVA definition and its tests.  
Reasoning: D1-D11 assume the audit's identification of the component. The audit was wrong here.
Applying `variant="ghost"` to a Callout would either be silently ignored (Callout has no ghost
variant → CVA default) or produce incorrect styling. D6 intent was to fix a Button misuse.  
Choice: No code change for CalendarShell:251. The Callout usage is correct. Item 1 is a no-op.
This was the ONLY location reported for Item 1.
