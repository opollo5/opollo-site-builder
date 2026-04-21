# Pattern — Quality gate runner

## When to use it

Validating a generated artifact against a fixed set of correctness rules before it commits downstream state. The canonical instance is M3-5: LLM-generated HTML is checked against 8 rules (5 shipped, 3 deferred) before the WP publish step fires.

Use whenever:

- You have N independent pass/fail checks.
- Failures on any one should short-circuit the rest (no point running the meta-description check if the wrapper is wrong).
- Failures must be attributable ("which gate, why") for debugging and for the operator to trust the system.
- The caller wants a single `GateResult` per artifact, not to orchestrate N checks.

Don't use for: schema validation (Zod at the boundary handles that), single-check validation (just call the helper directly), rules that mutate the artifact (gates are read-only verdicts).

## Required files

| File | Role |
| --- | --- |
| `lib/<subject>-gates.ts` | The runner + gates. One module per subject; M3 has `lib/quality-gates.ts`. |
| `lib/__tests__/<subject>-gates.test.ts` | Per-gate pass/fail tests + runner short-circuit behaviour. |
| Event-type constant in `lib/tool-schemas.ts` | `gate_failed` event shape so reconciliation can read gate outcomes from the log. |

## Scaffolding

### Types

Model on `lib/quality-gates.ts`:

```ts
export type GateName =
  | "wrapper"
  | "scope_prefix"
  | "html_basics"
  | "slug_kebab"
  | "meta_description";

export type GatePass = { kind: "pass"; gate: GateName };
export type GateFail = {
  kind: "fail";
  gate: GateName;
  reason: string;
  details?: Record<string, unknown>;
};
export type GateSkip = { kind: "skipped"; gate: GateName; reason: string };

export type GateResult = GatePass | GateFail | GateSkip;
```

`skipped` is explicit, not absent. A deferred gate (because the upstream registry isn't wired yet) returns `skipped` with the reason — the operator sees "gate ran, wasn't applicable" not "gate silently absent."

### Individual gates

One function per gate. Pure. No I/O except in the input arg. Signature:

```ts
export function gate<Name>(
  subject: <Artifact>,
  context: <Context>,
): GateResult { ... }
```

For M3 gates, `subject` is the generated HTML + slug + meta, `context` is the site prefix + design-system version.

Each gate returns exactly one `GateResult`. No throwing — callers orchestrate via `kind` discriminant.

### Runner

```ts
export function runGates(
  gates: readonly ((subject: <Artifact>, ctx: <Context>) => GateResult)[],
  subject: <Artifact>,
  ctx: <Context>,
): { passed: boolean; results: GateResult[] } {
  const results: GateResult[] = [];
  for (const gate of gates) {
    const r = gate(subject, ctx);
    results.push(r);
    if (r.kind === "fail") {
      return { passed: false, results };
    }
  }
  return { passed: true, results };
}
```

**Short-circuits on first failure.** No point running downstream gates when the artifact is already dead. Test: `runGates` called with three gates where the middle one fails → result length is 2 (the passing one + the failing one), third gate never invoked.

### Wiring into the worker

The runner lives in the worker's validation stage. See [`new-batch-worker-stage.md`](./new-batch-worker-stage.md) for the state-transition context:

```ts
// state: generating → validating → (succeeded | failed)
const { passed, results } = runGates(ALL_GATES, html, { prefix, dsVersion });
await logEvent(slotId, "gate_run_completed", { results });

if (!passed) {
  const firstFail = results.find((r) => r.kind === "fail")!;
  await logEvent(slotId, "gate_failed", {
    gate: firstFail.gate,
    reason: firstFail.reason,
  });
  await transitionState(slotId, "failed", {
    failure_code: "GATE_FAILED",
    failure_detail: firstFail.gate,
  });
  return;
}
await transitionState(slotId, "publishing");
```

## Required tests

Per gate:

1. **Happy path** — a canonical valid input returns `{ kind: "pass" }`.
2. **Each documented failure mode** — one test per reason the gate can fire. If the gate checks "exactly one `h1`", that's two tests (zero, two-or-more); the pass case covers exactly-one.
3. **Edge cases** — empty input, malformed input (if the gate receives raw content).

Per runner:

4. **All gates pass** — `passed: true`, `results.length === N`.
5. **First gate fails** — `passed: false`, `results.length === 1`, subsequent gates not called.
6. **Middle gate fails** — `passed: false`, `results.length === K+1` where K is the count of passing gates before the failure.
7. **Ordering stability** — `runGates` runs in declared order; changing order affects which gate attribution is surfaced first. Lock the order in a test so refactors don't silently change error UX.

Copy the shape from `lib/__tests__/quality-gates.test.ts`.

## Standard PR structure

Follow [`ship-sub-slice.md`](./ship-sub-slice.md). Title shape: `feat(<milestone>): <subject> quality gates (<N shipped, M deferred>)`.

The description explicitly lists every gate shipping now, every gate deferred, and the reason. Example from M3-5:

> Shipping: wrapper, scope_prefix, html_basics, slug_kebab, meta_description.
> Deferred to M3-5b: allowed_components, no_freeform_html, word_count. Reasons: registry dependency (first two), schema column missing (third).

Operator trust depends on knowing what's enforced vs what's pending.

## Known pitfalls

- **Runner that doesn't short-circuit.** Collecting all failures sounds helpful but clutters the UX: the operator sees "5 failures" when gate 1 caused cascading failures in 2–5. First-fail + fix-and-retry is clearer.
- **Gates with I/O.** A gate that hits the DB or the LLM is not a gate, it's a workflow step. Keep gates pure — pass them the data they need via the `context` arg, don't let them fetch.
- **Over-generous `skipped` returns.** A gate returning `skipped` for a case that should be `fail` silently green-lights bad artifacts. Only `skipped` when the gate genuinely doesn't apply (feature flag off, prerequisite column empty).
- **Hard-coded gate list in the runner.** Externalise the list (`const ALL_GATES = [gateWrapper, gateScopePrefix, ...]`) so tests can run with subsets. M3-5 deferred 3 gates by removing them from the list, not by disabling the code.
- **Failures missing `details`.** A gate that fails with "html_basics: img missing alt" is less useful than "html_basics: img at offset 1423 missing alt, src=<trimmed>". Include enough detail in the event log to triage without rerunning.
- **Gate result logged only to stdout.** Gate results belong in the append-only event log (`generation_events` in M3). Stdout gets trimmed; the event log doesn't.
- **Test that asserts gate N runs after gate M but doesn't pin the order in production code.** The runner uses an array; the array is the source of truth. Lock it in a test as described above.

## Pointers

- Canonical instance: `lib/quality-gates.ts` + `lib/__tests__/quality-gates.test.ts`.
- Related: [`new-batch-worker-stage.md`](./new-batch-worker-stage.md), [`background-worker-with-write-safety.md`](./background-worker-with-write-safety.md).
