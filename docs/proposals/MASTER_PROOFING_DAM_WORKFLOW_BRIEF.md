# Master Brief — Content Proofing, DAM & Workflow Subsystem

> Status: LEAN MASTER DOC, updated with Gain.app / PageProof research findings. Captures
> what is built, what is now decided post-research, and the questions that remain open.
> Not a build brief — the single orientation document for this subsystem.
>
> **IMPLEMENTATION AUTHORITY: B0–B4 + the recon docs are the source of truth for building.
> This document is STRATEGIC CONTEXT ONLY.** Where this doc and a build brief differ, the
> brief wins. Specifically superseded here: reviewer identity (resolved in B0 — named
> reviewer + magic link + same-day session, no account), the state machine (B2/B3 define
> the real version-chain behaviour), and markup scope (B0 §6 — image + carousel only for
> V1). Do not build from this document's older phrasing on those points.
>
> Supersedes as the entry point: APPROVAL_WORKFLOW_ENGINE_PROPOSAL, _SPEC, and
> _FULL_BUILD_BRIEF (those remain valid for the parts already built; this doc frames the
> whole).
> Repo destination: `docs/proposals/MASTER_PROOFING_DAM_WORKFLOW_BRIEF.md`

---

## 1. What this subsystem is

A **content proofing + approval + workflow** capability for the Opollo platform. It
started as image-review approval but is now understood to be a general **proofing
system** — the review / approve / request-changes / revise loop — applied across **every
content type Opollo produces**: social posts, blog articles, landing pages, and anything
else in the content process.

It is a **major subsystem, not the platform backbone.** It is core infrastructure that
other parts (social publishing, content/blogs, CAP) consume, but it sits alongside the
platform's identity/company/auth core rather than being it.

The reference models are **Gain.app** and **PageProof** — full proofing platforms with
content review, multi-round approval, per-stakeholder workflows, and rich feedback/markup.
We have built one corner of this (image review). The research phase defines the rest.

---

## 2. Current state — what is BUILT and LIVE (as of prod 11272bd8)

This is real, deployed, and working. The research/redesign builds ON this, not instead of.

**Phase 1 (live):**
- 3 fixed gate types: `copy_review`, `image_review`, `final_signoff`. Per-company,
  independently optional. (`company_workflow_gates` + `company_workflow_gate_approvers`.)
- Pass-rules `all_must` / `any_one` per gate; `timeout_days`; `auto_schedule`.
- Image-review gate intercepts the approval path: gate enabled → draft held in
  `pending_image_review` and submitted to an approval request; gate disabled → straight
  to schedule (prior behaviour).
- Reject → rework → next round, capped at 3 rounds; round 3 reject → `escalated_to_admin`.
- Batch delete / `resetApprovalToFresh` / batch watch, with full cascade semantics
  (revoke tokens, cancel requests, preserve audit, cancel callbacks).
- Carousel review UI (real account avatars, fixed action bar, comment-required on reject).
- Reuses the existing social approval backbone (`social_approval_requests` + recipients +
  snapshots + events); `subject_type`/`subject_id` added so one approval system serves all.

**Phase 1 add-ons (live):**
- Workflow gate config UI (company page → Workflow tab).
- Vertical slide-out workflow status drawer (stages, status, responsible party; only
  enabled gates shown; image stage wired to real state, copy/final are placeholders).

**Phase 2 (live):**
- Auto-schedule on gate pass via the V2 publish-due cron (no variants row needed).
- Escalation ladder: QStash day-3/7/14 reminders + day-14 admin alert, idempotent, with
  cancelled-request no-op guards. Reminder templates incl. day-14 loss-aversion (warn-only).

**Locked decisions** (carry forward; full list in the _SPEC doc §2, L1–L18): client=company;
gates optional; reject=whole-post; 3-round cap; pass-rules; magic-link OR login approvers;
no default gate; auto-schedule default; escalation ladder; warn-only-never-delete;
admin-configured-at-onboarding; admin batch delete; round-3=escalate-to-admin; one engine
not two; transactional; idempotent; preserve audit; QStash-not-cron; extend-not-replace;
generic-to-content-type.

---

## 3. Known gaps in the built system (must be resolved, research-informed)

These surfaced in testing and are real holes for a client-facing product:

1. **Magic links are not yet core infrastructure.** Raw tokens are stored hashed only, so
   reminders/notifications can't reconstruct a link for external approvers. External-client
   emails therefore can't fully send. → Needs a **platform magic-link service** (see §5).
2. **No notification when an approver is added.** Adding an approver silently creates a
   record; the person is never told. Should notify + confirm account on add.
3. **No day-0 invite when content enters a gate.** The "please review" email is not sent
   at gate entry. (Partially specced; blocked on the magic-link service for externals.)
4. **Add-approver UX trap.** Typed-but-not-added email is lost on Save (should auto-commit
   on Save).
5. **Copy-review and final-signoff gates are config + placeholder only** — not wired to a
   state machine yet (were Phase 3/4).
6. **No feedback/markup loop.** Current actions are approve / reject / request-changes
   (comment). There is NO rich per-content markup/annotation — the core of PageProof/Gain.

---

## 4. The strategic direction (now decided by the research)

The review process must be **built into the core, not piecemeal.** Every content type
flows through the same proofing/approval/feedback loop; building per-feature forces a
painful retrofit.

**The research conclusion that drives everything: a "Gain-like front door with a
PageProof-like engine behind it."**
- **Gain** = the frictionless client experience: email-first entry, one-time magic links,
  a single low-friction approval queue, batch approvals, clear states, view-only public
  preview separate from the authenticated approval path.
- **PageProof** = the engine that scales: structured content-item → version → workflow →
  step → role model, reviewer-role semantics (reviewer / mandatory / gatekeeper /
  approver), versioning discipline (revise = new version, never mutate the approved
  record), threshold logic, append-only audit, and integration/SDK extensibility.

This validates the foundation already built (the approval backbone, gates, magic-link
direction, audit preservation) and tells us how to evolve it. We do NOT rip out Phase
1–2; we grow it toward this hybrid.

**Three things this subsystem must become, beyond what's built:**
- **General proofing across content types** (social, blog, landing page, any future
  type) — not image-specific. The data model becomes content-item → version → polymorphic
  "review surface" (file / PDF / Office doc / text doc / URL proof / HTML-email proof /
  video / social preview).
- **A real feedback/revision loop** — the single most important missing piece. Adopt
  PageProof's pattern: reviewer requests changes → structured to-do list returns to the
  owner → assigned to an editor → **new version uploaded** (workflow can reuse, switch, or
  skip already-approved reviewers). Markup depth (pins, regions, frame-level, DOM
  selectors) scales by content type and by release.
- **DAM relationship (still open — see §6 Q1).** The research leans toward proofing as the
  core engine with DAM as a connected versioning/delivery layer (content-versions +
  integration delivery), rather than one fused system — but this is Steven's call to
  confirm.

**Reviewer role model (research-recommended, supersedes the flat approver list):** evolve
from "approvers with all_must/any_one" toward PageProof's roles — ordinary reviewer
(non-blocking), mandatory reviewer (blocks), gatekeeper (can halt + send back), approver
(final step), plus owner/editor. For simple clients "reviewer + approver" suffices; the
richer roles matter for regulated/multi-stakeholder work. Our existing all_must/any_one
maps onto the step-threshold concept.

**State machine (research-recommended, supersedes ad-hoc states):**
Draft → In review → Changes requested → In revision → Ready for next step → Approved →
Published/Delivered → Archived. (Gain's explicit states, which are cleaner than what we
have.)

---

## 5. The magic-link service (its own brief, pending)

Magic links are to be **core platform infrastructure**, not approval-only. Used for:
login, content approvals, reconnecting social connections, and approver/reviewer access.
A general service that issues, stores (re-sendable), validates, and revokes links for any
purpose. This unblocks gaps §3.1–3.3. **To be scoped as its own brief** (deferred this
session at Steven's direction — it's an auth surface, get it right). Likely a prerequisite
for completing the external-client proofing path.

---

## 6. Settled by the research vs still open

**SETTLED (lock these):**
- **Hybrid model** — Gain front door + PageProof engine (§4).
- **Roles** — evolve to reviewer / mandatory / gatekeeper / approver / owner / editor (§4).
- **State machine** — adopt the Gain-derived states (§4).
- **Magic links** — core infrastructure, one-time + expiry + re-requestable, named-reviewer
  identity-bound; public share defaults to view-only (§5).
- **Revision loop** — to-do list → editor → new version; never mutate the approved record.
- **Content-type generality** — content-item → version → polymorphic review surface.
- **Q3 (was open): fixed gates vs configurable workflow** — RESOLVED toward configurable
  workflow steps + roles. BUT phased: the 3 built gates are a valid foundation; the
  configurable engine is a later release (see roadmap). Don't rebuild yet.

**STILL OPEN (Steven's call):**
- **Q1 — DAM relationship.** Research leans "proofing core + DAM as connected versioning/
  delivery layer" rather than one fused engine, but not mandated. CONFIRM.
- **Q2 — Markup depth & sequencing.** The to-do/new-version loop is settled as the
  mechanism; what's open is HOW MUCH markup richness (simple region pins → DOM selectors →
  frame-level video) and in which release. Different content types need different markup.
- **Q4 — DAM scope.** Versioning, asset states, reuse across posts, library/search UI,
  retention — how much, how soon.
- **Q5 — Workflow config home.** Confirmed: onboarding wizard first (backlogged, own
  brief), editable on company page, viewable during production.
- **Q6 — External reviewer identity.** Research recommends Gain-style named invitation +
  auto-created lightweight account + magic link (attributable, low-friction). Confirm this
  over magic-link-only.

---

## 6a. Research-recommended phased roadmap (maps onto our build)

- **Foundation** (≈ what we have + the immediate fixes): workspaces/projects, content
  items + versions, named external reviewer invitations, one-time magic links, client
  approval queue, comments/annotations, core states, email/in-app notifications. → We're
  here. Gaps §3 finish this.
- **Workflow & governance**: workflow templates, mandatory/gatekeeper/approver roles,
  thresholds, due dates, reminders, bulk approvals, version comparison, exportable audit,
  role-aware dashboards. → This is the evolution of our gate model.
- **Advanced proofing & enterprise**: website/HTML-email proofs, video time-coded
  feedback, editor assignment, lock/unlock, private/invisible comments, DAM delivery,
  webhooks, SDK/API, SSO/SCIM, branding. → Long-horizon; differentiates from a basic
  review app.

Notification architecture (research-recommended): event-driven, not page-driven. Every
workflow event emits a structured event → channel adapters (in-app, email, push, Slack,
Teams, webhooks). Our QStash + dispatch() foundation already fits this shape.

---

## 7. Build status & what NOT to do next

- Do NOT build Phase 3/4 (copy gate, final gate, orchestrator) or the in-flight fixes
  (add-button, approver-notify) until this subsystem is re-framed by the research — they
  should be built into the core proofing model, not bolted onto the image-specific path.
- The built Phase 1–2 system stays live; it works for the image-review case and is the
  foundation.
- Next concrete step: Steven's Gain.app / PageProof research → resolve §6 questions →
  expand this master brief into the full subsystem architecture → then resume building
  (magic-link service likely first, as the unlock).

---

## 7a. UI/UX — key screens (full-vision wireframes)

These depict the FULL PageProof-depth vision (Steven's direction). Build order is still
staged by the three briefs (§7b) — the workflow-engine screens below are release 3, not
V1. Wireframes were rendered in the design session; reproduce their structure.

**Screen 1 — Operator proof dashboard** (PageProof-style control centre):
Inbox / Outbox / Sent / Approved / Everything tabs, search + filter, per-proof tiles
showing a decision-summary pill (approved / changes / pending counts + current workflow
step). New proof starts via a file-dropper (upload / cloud / URL / email depending on
type).

**Screen 2 — Operator proof setup + workflow** (rendered): sequential workflow steps,
each with a reviewer role (reviewer / mandatory / gatekeeper / approver), per-step
threshold (any_one / all_must), blocking vs non-blocking, and per-approver access
(login vs magic-link). Proof name, version, due date, reminders, message, checklist.
"Add step" + "Send proof". → This is release 3 (workflow engine); V1 uses the simpler
3-gate config already built.

**Screen 3 — Client reviewer proofing screen** (rendered): the content with red-pen
markup tools (pin / box / freehand / highlight), numbered pins tied to a comment thread,
decision-summary pill, and decision controls — Approve / Approve with changes / Send
to-do list. The to-do list is the revision trigger: structured changes return to the
owner → assigned to editor → new version. → Markup DEPTH is staged (V1 = simple comments/
region pins; richer markup — DOM selectors, video frame-level — is later, see §6 Q2).

**Screen 4 — Client approval queue** (Gain-style front door, V1-critical): the
low-friction landing after the magic-link. A simple list/queue of items awaiting this
client's decision, batch-approve supported, item detail opens the reviewer screen
(Screen 3). This is the screen that must stay SIMPLE — it's the client's whole world.

**Screen 5 — Workflow status drawer** (BUILT, live): vertical slide-out, stages stacked,
per-stage status + responsible party. Already in production; evolves to reflect the
richer role/step model as the engine grows.

UX principle (from research): keep the CLIENT world small (Screen 4 + Screen 3 only);
the OPERATOR world is broader (dashboard, setup, versions, audit). Don't make clients
learn workspaces/projects before they can review.

---

## 7b. The three build briefs (recommended next, in order)

Per external review — turn this orientation doc into three sequential build briefs;
defer DAM and advanced markup until after V1:

1. **Magic Link Infrastructure Brief** — the unlock. Core service: issue / store
   (re-sendable) / validate / revoke, one-time + expiry, for login + approvals +
   reconnect + reviewer access. Closes gaps §3.1–3.3. Build FIRST.
2. **Core Proofing V1 Brief** — the simple journey: create proof → invite client →
   magic link → review (simple comments / region pins) → approve / request changes →
   revise → new version → approve. Gain-style queue + reviewer screen. Named reviewers,
   core states, email/in-app notifications. KEEP SIMPLE.
3. **Workflow Engine + Versioning Brief** — the PageProof depth: workflow templates,
   mandatory / gatekeeper / approver roles, thresholds, step transitions, skipping,
   reassignment, version comparison, audit export, role-aware dashboards. Supersedes the
   3 fixed gates (with a migration bridge from gates → steps).

DEFER until after V1: DAM (§6 Q1/Q4), advanced markup (DOM selectors, video frame-level),
SDK/webhooks, SSO/SCIM.

Each brief must add what this doc deliberately doesn't: exact schema (fields, relations,
constraints, indexes, migrations, backward-compat), the gate→step migration bridge, the
notification trigger matrix (events × recipients × channels × resend × failure), and
per-screen component/empty-state/permission detail.

---

## 8. Document map (for whoever picks this up)

- THIS DOC — master orientation, current state, open questions.
- `APPROVAL_WORKFLOW_ENGINE_SPEC.md` — detailed spec of the approval engine as built/
  designed (locked decisions L1–L18, state machine, batch-deletion §6.1, email §7.1).
- `APPROVAL_WORKFLOW_FULL_BUILD_BRIEF.md` — the phased build brief (Phases 1–2 done,
  3–4 pending and now subject to the research re-frame).
- Onboarding wizard — backlogged, own brief (approvals is one step within it).
- Magic-link service — to be scoped as build brief 1 (§7b).
- Core Proofing V1 — build brief 2 (§7b).
- Workflow Engine + Versioning — build brief 3 (§7b).
