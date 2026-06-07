# Diagnose by Working Analog

Moved from `CLAUDE.md` to keep that file under 450 lines. Every rule here has
the same force as if it were in CLAUDE.md — the pointer in §"Diagnose by working
analog" is load-bearing.

---

**Before designing a fix for any bug, find where the same shape already works
correctly in the codebase.** If a working analog exists, the fix is to make the
broken surface match the working one — not to invent a new code path. This rule
prevents the failure mode where a surface diagnosis ("env var unavailable in
browser", "field not populated", "helper returns null") is treated as a complete
diagnosis and drives a fix design that ignores existing convention.

The diagnostic question that completes a surface symptom is always:
**"where else in this codebase does this already work, and what does that code do
differently?"** Skipping that question is the bug.

## Required steps before writing any fix code

For any bug fix beyond a single-line patch:

1. **Identify the failing call site.** Read the actual file. Quote the lines that
   produce the broken output. State whether it's a server component, client
   component, route handler, worker, etc.
2. **Search for working analogs.** Grep the codebase for: the same helper, the
   same external resource (Cloudflare ID, DB column, SDK call, env var), the same
   data shape, the same render target. Expand to sibling routes (`[id]/page.tsx`
   next to a list `page.tsx`), parent layouts, shared components, and modules in
   the same domain. The `Explore` agents do not surface analogs by default — you
   must ask explicitly.
3. **Diff working vs broken.** Read both. Identify what differs: server-component
   vs client-component, helper used, env-var access pattern, prop pass-through,
   render position, ordering of effects, type of the field read.
4. **The fix is the diff.** Make the broken site match the working one,
   mechanically. Do NOT invent a new prop, helper, env-var-naming convention, or
   layering pattern if the working analog handles the case.

## When a new pattern is justified

Only when:

- No working analog exists in the codebase, AND
- The working analog (if any) is itself flagged for replacement (look for a
  `docs/patterns/`-tracked deprecation note or an open refactor issue).

Otherwise, "this is the first place we've done X" is a flag to slow down, not a
licence to invent. If a new pattern is genuinely warranted, state the reason
explicitly in the PR description so the next agent finds it as an analog.

## Report-back template — required in every bug-fix PR description

```
**Working analog**: <file>:<line-range> — <one-sentence description of how it works>
**Diff**: <what the broken site does differently>
**Fix**: <how the broken site is being made to match>
```

If no analog exists, replace with:

```
**Working analog**: none found. Searched: <list of greps and files inspected>
**New pattern justification**: <reason this is the first / why existing patterns don't apply>
```

A bug-fix PR without one of these two blocks is not ready to merge. The
§"Pre-PR checklist" in `CLAUDE.md` enforces this as a checkbox.
