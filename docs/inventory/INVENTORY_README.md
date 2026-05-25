# Opollo Site Builder Feature Inventory

**Phase 1** (this document + all documents in this directory): skeleton populated by Claude Code from codebase analysis. Props, validations, routes, state machines, API endpoints, and role gates are extracted from source — not invented.

**Phase 2** (Steven): fill in every `EXPECTED BEHAVIOUR` section with the actual rules that should be enforced. These are the acceptance criteria for Phase 3.

**Phase 3** (Claude Code): convert the filled inventory into UAT specs that enforce the rules. Each `[ ]` checkbox in an `EXPECTED BEHAVIOUR` section becomes one or more test assertions.

---

## Status

| Document | Items | Description | Steven checkboxes | Done |
|---|---|---|---|---|
| [routes-and-pages.md](routes-and-pages.md) | 103 routes | All pages + auth gates, search params, loading states, user actions | 155 checkboxes | 0 filled |
| [state-machines.md](state-machines.md) | 12 entities | All stateful DB entities + valid transitions + UI surfaces | 46 checkboxes | 0 filled |
| [api-endpoints.md](api-endpoints.md) | ~158 endpoints | All API routes + auth requirements + risk classification | 131 checkboxes | 0 filled |
| [components-catalog.md](components-catalog.md) | ~35 components | All major UI components + props + variants + testids | 64 checkboxes | 0 filled |
| [forms-and-validation.md](forms-and-validation.md) | ~15 forms | All forms + current validation rules + error states | 45 checkboxes | 0 filled |
| [roles-and-permissions.md](roles-and-permissions.md) | 7 roles | 3 operator + 4 platform roles + all action gates | 23 checkboxes | 0 filled |
| [discovered-issues.md](discovered-issues.md) | 5 issues | Bugs / inconsistencies found during inventory analysis | — | Triage needed |

**Total checkboxes: 464 across all documents.**

---

## How to use this inventory

### For Steven (Phase 2)

Each document has `EXPECTED BEHAVIOUR (Steven to fill)` sections with `[ ]` checkboxes. Fill these in with the rules you want enforced.

**What to write:**
- `[x]` — the item is correct as described; no clarification needed
- `[ ] Answer: yes/no — [explanation]` — replace the question with the actual rule
- `[ ] N/A — [reason]` — the question does not apply

**Example:**
```markdown
**EXPECTED BEHAVIOUR (Steven to fill):**
- [x] Closing a dirty composer always shows UnsavedChangesDialog — Answer: yes, for any content change including scheduling mode changes
- [ ] ~~Should Escape always close?~~ Answer: yes, unless a sub-dialog is open (it closes sub-dialog first)
```

**Priority order for filling in (suggested):**
1. `roles-and-permissions.md` — fills in fastest; gates the most other tests
2. `forms-and-validation.md` — 15 forms; directly drives regression tests
3. `state-machines.md` — 12 entities; the core business logic
4. `components-catalog.md` — 35 components; UI fidelity specs
5. `routes-and-pages.md` — 103 routes; auth and navigation specs
6. `api-endpoints.md` — 158 endpoints; integration test specs

### For Phase 3 spec generation

Once a document has checkboxes filled, run:

```
/inventory-to-specs [document-name]
```

Claude Code will convert each answered `[ ]` into a test assertion in the appropriate layer (unit / integration / component / E2E / smoke).

**Conversion rules:**
- Role / permission question → integration test using `seedTwoCompanies()` + RLS assertion
- Form validation question → unit test against the Zod schema
- UI behaviour question → component test or E2E spec
- Route auth question → E2E spec with fixture sessions
- State transition question → integration test against the real DB

---

## Document structure conventions

Every section in every document follows this template:

```markdown
## EntityName

**File:** `path/to/file.ts`
**Status:** Active | ⚠️ NO CALLSITES FOUND | Deprecated

[Body: props / fields / routes / states extracted from source]

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Question 1?
- [ ] Question 2?
```

The `⚠️ NO CALLSITES FOUND` status means the component or route exists in source but no imports or usages were found during inventory — it may be dead code or only used dynamically.

---

## Coverage notes

### What is covered

- All pages in `app/(platform)/` and `app/api/`
- All stateful DB entities from the V1 (social_post_masters) and V2 (social_post_drafts) systems
- All significant UI components under `components/`
- All forms with explicit field lists
- Both role systems (operator: opollo_users; platform: platform_company_users)

### What is NOT covered in Phase 1

**Optimiser module (deep):**
- `/optimiser/*` routes are listed in `routes-and-pages.md` but the internal state machines (opt_proposals, OPT workflow states) are not fully enumerated in `state-machines.md`. The CAP (Content Automation Platform) state machine is included but the Optimiser proposal state machine is only partially covered.

**CAP deep detail:**
- `cap_campaigns`, `cap_campaign_posts`, `cap_subscriptions` state machines have skeletal entries in `state-machines.md` but the full transition graphs (especially the publish-attempt retry logic) are not documented.

**Brief generation pipeline:**
- `/api/cron/process-brief-runner`, `/api/cron/process-batch` are in `api-endpoints.md` but the internal job-state transitions of `generation_jobs` are skeletal.

**Component test coverage:**
- Most components listed in `components-catalog.md` have no corresponding component-layer test. This is flagged as debt in `docs/test-coverage-roadmap.md`.

**Webhook receivers:**
- `/api/webhooks/bundlesocial` and `/api/webhooks/qstash/social-publish` are in `api-endpoints.md` but their internal message schema and retry logic are not documented here.

---

## Known discovered issues

See [discovered-issues.md](discovered-issues.md) for 5 issues found during Phase 1 inventory analysis:

1. **Issue 1** — Published posts may open in an editable composer (confirmed bug, current branch scope)
2. **Issue 2** — Two parallel state machines: `SocialPostState` vs `DraftState` (documented technical debt)
3. **Issue 3** — `pending_identity` connection status added via `ALTER TYPE` in migration 0122 (may be missing from old type checks)
4. **Issue 4** — Composer edit-mode behaviour for `published`/`failed` states is unverified (open question, current branch scope)
5. **Issue 5** — `ApproveSchema` does not include `changes_requested` but the UI offers it as a decision (potential API contract gap)

None of these are blocking for Phase 2 filling. They are triage items.

---

## File index

```
docs/inventory/
├── INVENTORY_README.md       ← this file (index + how-to)
├── routes-and-pages.md       ← 103 routes
├── state-machines.md         ← 12 stateful entities
├── api-endpoints.md          ← ~158 API endpoints
├── components-catalog.md     ← ~35 components (Phase 1 — this batch)
├── forms-and-validation.md   ← ~15 forms        (Phase 1 — this batch)
├── roles-and-permissions.md  ← 7 roles           (Phase 1 — this batch)
└── discovered-issues.md      ← 5 issues          (Phase 1 — this batch)
```
