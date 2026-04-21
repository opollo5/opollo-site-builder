# Prompt Versioning

Spec for how system prompts, tool schemas, and evaluation suites are organised in `lib/prompts/`. Target layout once we start routing chat traffic through versioned prompts and measuring with Langfuse.

Current state: prompts live in `docs/SYSTEM_PROMPT_v1.md` and `docs/TOOL_SCHEMAS_v1.md`, loaded at runtime from the `outputFileTracingIncludes` bundle. This file is the migration target — not a rewrite instruction. The cutover PR will be its own sub-slice.

---

## Layout

```
lib/prompts/
  index.ts                      -- resolves version → prompt bundle
  v1/
    system.md                   -- verbatim copy of docs/SYSTEM_PROMPT_v1.md
    tool-schemas.ts             -- typed tool schema exports
    metadata.json               -- { version: "v1", released_at, model, notes }
  v2/
    system.md
    tool-schemas.ts
    metadata.json
  __evals__/
    fixtures/
      generate-landing-page.json
      edit-hero.json
    runner.ts                   -- offline harness (npm run evals)
    harness.test.ts             -- vitest integration suite
```

- Each prompt version is immutable once shipped. v1 is frozen; v2 is additive.
- `metadata.json` records the release date, target Anthropic model, and release notes. Langfuse pulls from here when we log LLM generations.
- `lib/prompts/index.ts` exposes `resolvePrompt(version?: string)` — reads `OPOLLO_PROMPT_VERSION` env, falls back to latest shipped version. Chat route calls this.

---

## Choosing a version at runtime

`OPOLLO_PROMPT_VERSION` env var controls the active prompt:

- Unset → latest shipped version (`v2` once v2 lands).
- `v1` → force legacy behaviour.
- Per-site override → `sites.prompt_version` column (future, not shipped), falls through to env when NULL.

The chat route logs `prompt_version` on every event for Langfuse correlation.

---

## Evaluation suite

Every prompt version ships with a fixture set and a runner:

1. **Fixtures** — JSON files under `__evals__/fixtures/` describing { input, expected behavior, assertions }. One fixture per canonical task (generate landing page, edit hero, delete page, WP publish).
2. **Runner** — `npm run evals` invokes `runner.ts`. It:
   - Loads each fixture.
   - Calls Anthropic with the versioned prompt + tool schemas.
   - Records the transcript + tool calls to a local report.
   - Optionally ships to Langfuse when `LANGFUSE_SECRET_KEY` is set.
3. **Assertions** — hand-written predicates per fixture (e.g. "must call create_page with slug matching /^[a-z-]+$/"). Not full LLM-as-judge yet; that's a later slice.

Running evals is **manual** — not gated on CI. They hit live Anthropic and cost money. CI runs the `harness.test.ts` integration file, which stubs Anthropic and asserts the runner logic without billable calls.

---

## Prompt injection defense

Layered controls:

1. **Tool schemas validate structure.** Zod-parsed inputs; the model can't smuggle a payload through a loosely-typed field.
2. **Operator-supplied inputs are quoted, not injected.** When the user types into the chat box, the message goes into a `<user_message>…</user_message>` tag in the system prompt. The model treats anything inside that tag as untrusted content.
3. **WP-fetched content is similarly tagged.** Adoption paths that GET-first and feed existing HTML back to the model wrap it in `<wp_existing_content>…</wp_existing_content>`.
4. **Tool-call results get a tag too** — `<tool_result name="..." id="...">...</tool_result>`. The model can't write a fake tool_result to steer itself.
5. **Refusal policy** in the system prompt: if a user message asks the model to ignore instructions or dump the prompt, the model declines and logs the attempt. Logged via `generation_events` with type `prompt_injection_attempt`.

Adding a new input surface means adding the tag + documenting it here.

---

## Per-tenant cost budgets

Target shape (future, not shipped):

```sql
CREATE TABLE tenant_cost_budgets (
  site_id uuid REFERENCES sites(id) PRIMARY KEY,
  monthly_budget_cents integer NOT NULL,
  current_month_cents  integer NOT NULL DEFAULT 0,
  last_reset_at        timestamptz NOT NULL DEFAULT now()
);
```

- Each Anthropic call increments `current_month_cents` (atomic add, no read-modify-write).
- Batch creation fails with `BUDGET_EXCEEDED` if the projected cost plus `current_month_cents` exceeds `monthly_budget_cents`.
- Background job resets `current_month_cents` on the 1st.
- Billed via the event log, never a direct write to the budget — keeps the cost-truth-source singular.

Implementation lives with the M4 milestone (cost-control surface). Until then, the global budget is the Anthropic project cap in the dashboard.

---

## Langfuse integration

`LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` env vars activate the transport. When both are present:

- Every Anthropic call is wrapped in a Langfuse trace with `prompt_version`, `site_id`, `user_id`, `request_id` (pulled from `lib/request-context`).
- Tool calls appear as child spans.
- `generation_events.anthropic_response_received` carries the Langfuse trace ID for cross-linking.

When the env vars are missing, calls run normally with zero Langfuse overhead — no retries, no errors. Strict additive.
