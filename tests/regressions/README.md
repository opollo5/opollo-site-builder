# tests/regressions/

Permanent regression tests pinned to specific production incidents.

**Rule** — recorded in `CLAUDE.md`: every production bug that takes more
than one fix-PR to resolve gets a regression test in this directory
*before the final fix merges*. Tests stay forever.

Each file:

1. Carries a comment block at the top linking the original incident
   (PR, doc, decision date).
2. Asserts a single, narrowly-scoped invariant the bug violated.
3. Runs in the unit config (`vitest.unit.config.ts`) — no Supabase,
   no I/O. Mock everything.
4. Stays small enough that a future agent reading it sees, at a
   glance, what regression they would reintroduce by deleting it.

**Test naming**: `<bug-slug>.test.ts`. The slug should map to a phrase
an agent might search for if they hit the bug fresh.

**Running**: `npm run test:regressions` (alias for the unit config
filtered to this directory).
