# Proofing / Workflow / Client-Portal — Full Build Package (Audit Index)

This is the entry point for auditing the full build. It ties together every document,
states build order and dependencies, records what is already built and live, and flags
known hazards. An auditor should read THIS first, then the documents in the order below.

> Repo destination: `docs/proposals/AUDIT_INDEX.md`

---

## 0. What this build is

A content **proofing + approval + workflow** subsystem plus a **client portal** for the
Opollo platform — a "Gain-style front door over a PageProof-style engine." It generalises
an image-review approval feature (already built + live) into a proofing system across
content types, adds configurable workflows, and gives external clients self-service access
(approvals + social-connection reconnect) via magic links.

Strategy and rationale: see the Master Brief (doc M). This index is the build map.

---

## 1. Documents in this package

| # | Document | Role | Status |
|---|----------|------|--------|
| M | Master Brief (proofing/DAM/workflow) | Orientation + strategy + wireframes | Written |
| R1 | docs/recon/PROOFING_RECON.md | Codebase recon (proofing/approval/magic-link) | In repo — INCLUDE from repo |
| R2 | docs/recon/CONNECTIONS_CLIENT_ACCESS_RECON.md | Codebase recon (connections/client access) | In repo — INCLUDE from repo |
| B0 | Brief 0 — Proofing UX Contract | Product/UX decisions (non-technical) | Written |
| B1 | Brief 1 — Magic Link Infrastructure | Build brief | Written |
| B2 | Brief 2 — Core Proofing V1 | Build brief | Written |
| B3 | Brief 3 — Workflow Engine + Versioning | Build brief | Written |
| B4 | Brief 4 — Client Portal (Connections) | Build brief | Written |
| C | CLAUDE.md addition (durable principles) | Conventions update | PENDING — to be written against existing CLAUDE.md |

AUDITOR NOTE: R1 + R2 are authoritative ground truth — the briefs were written against
them. Do not audit the briefs without the recons; brief accuracy depends on them. They
live in the repo (terminal-written); include the actual files.

---

## 2. Read / audit order

1. **M** — understand the vision and why.
2. **R1, R2** — what the codebase actually is (corrects many reasonable assumptions).
3. **B0** — the product decisions every technical brief assumes.
4. **B1 → B2 → B3** — the proofing line, in dependency order.
5. **B4** — the client portal (parallel branch off B1).
6. **C** — the conventions update (pending).

---

## 3. Build order & dependency graph

```
B1 (Magic Link)  ─┬─→  B2 (Core Proofing V1)  ─→  B3 (Workflow Engine)
                  └─→  B4 (Client Portal)
B0 (UX Contract) — read by ALL technical briefs as the decision contract
```

- **B1 first** — everything depends on the magic-link service.
- After B1, two independent branches: proofing (B2→B3) and connections (B4). They do not
  depend on each other. **Do not run both branches in parallel against the build agent** —
  finish one, verify, then the other (both touch the magic-link service + shared surfaces).
- B3 depends on B2 (versioning chain). B4 depends only on B1.
- Each brief: build → verify live → update the NEXT brief with any drift the prior one
  reported, before running it. (This loop has already caught real mismatches.)

---

## 4. Already built & live (do NOT rebuild — extend)

Production as of SHA 11272bd8 (verify current):
- 3 fixed approval gates (copy_review / image_review / final_signoff), per-company,
  optional, pass-rules, timeout, auto_schedule. `company_workflow_gates` +
  `_gate_approvers`.
- Image-review gate intercepts approval → draft held in `pending_image_review` → approval
  request → on pass, schedule (V2). Reject → round (cap 3) → round-3 escalate-to-admin.
- Batch delete / reset / watch with full cascade.
- Approval backbone reused: `social_approval_requests` (+ `subject_type`/`subject_id`),
  `_recipients`, `_events`. `record_approval_decision` RPC.
- Escalation ladder (QStash day-3/7/14 + day-14 admin alert), reminder templates.
- Gate config UI (company page Workflow tab) + vertical workflow status drawer.
- Auto-schedule via V2 publish-due cron.

The build EXTENDS this. Briefs B1–B4 must reuse, not fork. (One engine, not two.)

---

## 5. Locked decisions (the spine — auditor should check briefs honour these)

Architecture: V2 pipeline (`social_post_drafts`), not V1 (retiring). Introduce real content
versioning (`content_group_id`/`version_number`/`supersedes_id`, immutable). Reuse approval
backbone, extend don't fork. Magic links = core infra, generic by `purpose`. Build on
existing stubs (`platform_session_grants`, OTP columns) not new tables.

UX (B0): one-time link + same-day session + self-serve re-request. Comments resolvable,
no threads, close on new version. New version re-enters at requesting step + skips prior
approvers. Gatekeeper sends back one step only. V1 surfaces = image + carousel (slide
pins); PDF/video/HTML deferred. Notification matrix per B0 §7. DAM deferred but interfaces
stable now.

Workflow: round-3 = escalate to admin. all_must/any_one pass rules → evolve to role model
(reviewer/mandatory/gatekeeper/approver). Lossless gate→step migration bridge.

---

## 5a. Hard constraint — NO new external dependencies (applies to ALL briefs)

This build adds ZERO new external services, APIs, SaaS products, or paid subscriptions. It
reuses ONLY the existing stack the platform already runs: Supabase (DB/auth/storage),
Vercel (host), QStash/Upstash (delayed jobs), SendGrid (email via `dispatch()`), and
bundle.social (social OAuth/publishing). A builder must NOT introduce any new dependency —
no new email provider, queue, auth service, storage, analytics, or third-party API. If a
brief seems to require something outside the existing stack, STOP and flag it — do not add
it. Everything in B1–B4 is achievable on the current stack (verified per brief: B1 token
primitive+SendGrid+Supabase; B2 approval backbone+SendGrid+Supabase+V2 cron; B3 pure
Postgres+existing patterns; B4 existing bundle.social OAuth+QStash+SendGrid+
`platform_session_grants`).

---

## 6. Known hazards (auditor + builder must respect)

1. **Company-context / access hierarchy (security boundary).** Opollo users = global,
   can/must switch client context. Customers = single-company, self-sign-up, hard-walled
   from other companies (no switching). Every company-scoped action must resolve + enforce
   the correct company (admin acting on a client must be switched into that client's
   company context; a customer can never reach another company). Enforced via
   `is_company_member` / `is_opollo_staff` RLS helpers + `platform_company_users` roles.
2. **Unnormalized admin endpoints/URLs.** Admin routing is not fully normalized — actions
   can land in the wrong place / wrong company context. When building company-scoped
   features, verify the target company is resolved correctly, not ambient. (Remediation —
   admin routing + client-switching normalization — is its own backlog item.)
3. **Cross-tenant binding.** A LinkedIn OAuth cross-tenant leak was previously fixed via
   the `external_identity_hash` fingerprint. Any connection/OAuth work must honour it. B4
   in particular: a client must only ever touch their own company's connections.
4. **V1/V2 split.** Approvals historically wired to V1 master; new work targets V2 drafts.
   Don't anchor to V1.
5. **Schema stubs exist ahead of code.** `platform_session_grants`, OTP columns, the
   expiry index were all scaffolded but unused. Grep for an existing home before adding a
   migration.

---

## 7. Autonomous-build readiness (per external review)

The technical briefs (B1–B4) + UX contract (B0) scored 8.5/10 pre-B0; B0 closes the
product-decision gaps (magic-link lifecycle, comments, re-entry, gatekeeper, notifications,
review-surface scope) that an autonomous agent would otherwise invent. The recons (R1/R2)
ground the schema/route assumptions. Remaining auditor focus areas:
- Per-screen UI detail beyond the wireframes (B0 §9 + Master §7a point at wireframes; full
  empty-state/component specs are light — flag if the auditor wants more before build).
- The CLAUDE.md conventions update (C) is pending.
- DAM is deferred by design; B0 §8 requires stable asset-referencing interfaces now to
  avoid later migration.

---

## 9. Audit resolutions (round 1)

External audit raised these; resolved in this revision:
- B3 ↔ B0 conflict on version re-entry → B3 now deterministic per B0 §4 (re-enter at
  requesting step, skip prior approvers; configurable re-entry deferred). FIXED.
- B3 ↔ B0 conflict on gatekeeper send-back → B3 now one-step-only per B0 §5. FIXED.
- B3 role-interaction ambiguity → added role-behaviour matrix + resolved interactions. FIXED.
- B3 custom_count "count of whom" → defined as N of blocking participants only. FIXED.
- B4 portal recipient unspecified → `portal_contact_email` + fallback defined. FIXED.
- B4 notification cadence → locked at 7-day / 1-day / on-expiry. FIXED.
- B4 failure-state contract → added (expired/revoked/deleted/inactive/OAuth-fail/wrong-company). FIXED.
- Master brief stale assumptions → authority-pointer added (B0–B4 + recon are source of
  truth; master is strategic context only). FIXED.

Still open (not blocking the build line below, but flagged):
- DAM architecture/scope — the largest remaining strategic decision (Master §6 Q1). B0 §8
  requires stable asset-referencing interfaces NOW regardless. Auditor + Steven concur:
  proofing-core + connected-DAM, not fused. Decide before any DAM work begins.
- B3 dashboard detail (due dates / stuck / SLA / pending reviewers) — light; expand before
  building the dashboard portion of B3.
- B3 step-builder complexity — consider deferring custom_count/advanced thresholding to a
  "release 4" if real usage is mostly 3 fixed steps (strategic, not blocking).
- CLAUDE.md addition (doc C) — pending existing-file review.

---

## 10. What is NOT in this build (deferred by design)

DAM (asset library, reuse, search, delivery), advanced markup (DOM selectors, video
frame-level), SDK/webhooks, SSO/SCIM, AI content generation as a create-source, the client
onboarding wizard (own backlog brief — approvals is one step within it). Per Master Brief.
