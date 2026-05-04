# Pattern — Page Document Generator (M16-5)

## When to use it

Adding a new LLM pass that produces a structured JSON document for a page slot in the M16 batch pipeline. The pattern covers: idempotent multi-pass generation, JSON parse failure retry, schema validation retry, self-critique + revise loop.

Don't use for: the original brief-runner HTML pass (M3–M15 path). That path writes `generated_html` directly and is unchanged by M16.

## What it does

Pass 2 of the M16 pipeline: one Haiku call per page slot, produces a `PageDocument` JSON object. On parse or schema failure: retry with the error appended (max 2 retries). Then one critique pass (Haiku) + one revise pass (Haiku) for copy quality.

```
leaseSlot
  → assemble payload (PAYLOAD_CAPS enforced)
  → Haiku call → JSON.parse
     ├─ parse fail → retry with error (max 2 total)
     └─ parse ok → schema validate
        ├─ schema fail → retry with errors (max 2 total)
        └─ schema ok → store pages.page_document, html_is_stale = true
             → critique pass (Haiku) → revise pass (Haiku) → store revised doc
```

## Key files

| File | Role |
|---|---|
| `lib/page-document-generator.ts` | Main generator: `generatePageDocument(siteId, slotId, briefId, pageOrdinal)`. Manages retry loop and critique/revise sub-loop. |
| `lib/types/page-document.ts` | `PageDocument` Zod schema + `PageSection`, `SectionProps`, `RouteRef`, `CtaRef` types. |
| `lib/models.ts` | `MODELS.HAIKU` — all three passes use Haiku. Never hardcode model strings. |
| `lib/generator-payload.ts` | `buildPageGeneratorPayload(siteId, slotId)` — assembles route plan, shared content, design context, image library context. Enforces `PAYLOAD_CAPS`. |
| `lib/prompts.ts` | `PAGE_DOCUMENT_SYSTEM_PROMPT`, `PAGE_DOCUMENT_CRITIQUE_PROMPT`. Versioned strings — do not inline in generator. |

## Idempotency contract

Every external Anthropic call uses an idempotency key derived deterministically from `(brief_id, page_ordinal, pass_kind, pass_number)`:

```typescript
const key = `pdgen-${briefId}-${pageOrdinal}-${passKind}-${attempt}`;
```

- `passKind`: `'generate'`, `'critique'`, `'revise'`
- `attempt`: `1`, `2`, `3` (never resets on reaper re-lease)

A reaped + re-leased slot reuses the same keys. Anthropic returns the cached response; no double-billing.

## Retry rules

| Failure type | Max retries | Terminal failure code |
|---|---|---|
| JSON.parse error | 2 (3 total calls) | `JSON_PARSE_FAILED` |
| Zod schema validation error | 2 (3 total calls) | `SCHEMA_VALIDATION_FAILED` |
| Anthropic API error (retryable) | 3 | `ANTHROPIC_RETRYABLE_ERROR` |
| Anthropic API error (non-retryable) | 0 | `ANTHROPIC_NON_RETRYABLE_ERROR` |

On terminal failure: `pages.status = 'failed'`, `pages.failure_code = <code>`. The slot is not retried again by the batch worker.

## Payload caps (enforced in `lib/generator-payload.ts`)

```typescript
export const PAYLOAD_CAPS = {
  MAX_CTAS:              20,
  MAX_ROUTES:            20,
  MAX_SHARED_ITEMS:      20,  // per content_type
  MAX_IMAGES:            15,
  MAX_BRAND_VOICE_CHARS: 500,
} as const;
```

Exceeding a cap truncates (sorted by priority/recency) and logs a `warn`. Never silently passed through.

## PageDocument schema

```typescript
type PageDocument = {
  page_type:  string;           // must be in component registry
  slug:       string;
  title:      string;
  sections:   PageSection[];
};

type PageSection = {
  id:          string;          // UUID, stable across revisions
  component:   string;          // e.g. "Hero", "Features"
  variant:     string;          // e.g. "centered", "grid-3"
  props:       SectionProps;    // typed per component — no hardcoded URLs
};
```

Validated by `lib/page-validator.ts` (zero LLM calls). Errors: `INVALID_COMPONENT_TYPE`, `BROKEN_ROUTE_REF`, `BROKEN_CTA_REF`, `HARDCODED_URL`.

## Critique/revise loop

After a valid `PageDocument` is stored, two additional Haiku calls run in sequence:

1. **Critique**: receives the full PageDocument + `PAGE_DOCUMENT_CRITIQUE_PROMPT`. Returns a JSON list of issues (empty list = pass).
2. **Revise**: receives the PageDocument + issues list. Returns a revised PageDocument.

The revised document overwrites `pages.page_document` and sets `html_is_stale = true` again so the render worker picks it up fresh.

Both calls use the same idempotency-key pattern (`passKind: 'critique'` / `'revise'`).

## Testing shape

- **Unit**: mock Anthropic to return invalid JSON twice then valid → assert 3 Haiku calls, page succeeds.
- **Unit**: mock Anthropic to return a PageDocument with a non-existent `ctaRef` → `page-validator.ts` returns `BROKEN_CTA_REF`.
- **Unit**: mock to exceed `MAX_CTAS` → assert truncation log + only 20 CTAs in assembled payload.
- **DB integration**: `generatePageDocument` against seeded slot → `pages.page_document` populated, `html_is_stale = true`.

All unit tests live in `lib/__tests__/page-document-generator.test.ts`. DB integration tests require the local Supabase stack (`supabase start`).

## Relationship to other patterns

- Follows [`background-worker-with-write-safety.md`](./background-worker-with-write-safety.md) for the lease/heartbeat/reaper contract.
- Follows [`new-batch-worker-stage.md`](./new-batch-worker-stage.md) for threading into `processSlotAnthropic`.
- Feeds into [`site-graph.md`](./site-graph.md) — the PageDocument this generates is validated by `lib/page-validator.ts` and rendered by `lib/page-renderer.ts`.
