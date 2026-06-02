# Build Brief 0 — Proofing UX Contract

THE PRODUCT CONTRACT. Non-technical. This document makes every product/UX decision the
three technical briefs (1 Magic Link, 2 Core Proofing, 3 Workflow Engine) assume but do
not state. Builders MUST follow these decisions exactly — they are not free to invent
reviewer UX, comment behaviour, workflow re-entry, magic-link lifecycle, or notification
rules. Where a builder finds a case not covered here, STOP and ask, do not invent.

Read this BEFORE briefs 1–3. Decisions here override any conflicting assumption in those.

---

## 1. Magic-link lifecycle (was the largest gap)

- **One-time link.** A magic link admits the reviewer ONCE.
- **Opening the link creates a short same-day session.** So a reviewer who opens on phone
  then moves to desktop the same day can return WITHOUT a new link, for the life of the
  session (same-day). The DECISION is what's recorded, not "consumed on first glance" —
  the session lets them keep working that day.
- **After the session expires, the reviewer self-serves a fresh link** by entering their
  email on a re-request page (Gain model). A new one-time link is issued.
- **The operator can also resend** a reviewer a fresh link.
- Token itself remains one-time + hashed (per recon); "re-request" = issue a NEW link via
  the magic-link service `regenerate`/`issue` (Brief 1), never resurrect the old token.
- Security requirements (make explicit in Brief 1): rate-limit link issuance + re-request
  (per email + per IP), audit every issue/consume/regenerate as events, no enumerable
  sequential ids (UUID + hash only), and on email change the old links revoke.

## 2. Reviewer session

- Session is **short and same-day** (e.g. expires end of day or a few hours — builder
  picks a sane default, ≤24h). It exists only to avoid re-requesting a link mid-task.
- No persistent account is required for external reviewers (token + session identity).
- Returning a different day = re-request a link (§1).

## 3. Comment model (V1 — deliberately simple)

- Comments can be **resolved** (mark done). NO threading/replies in V1.
- Comment types V1: general comment + simple region pin on an image (and per-slide pin on
  a carousel — see §6).
- Comment REQUIRED on "request changes" (already L17). Optional on approve.
- **On a new version, all open comments CLOSE.** They are not carried forward; they remain
  visible in the prior version's history (immutable record) but the new version starts
  clean. (Builder: mark them closed/superseded, do not delete — audit preserved.)

## 4. Workflow re-entry on a new version (was "huge")

Workflow example: Internal → Legal → Client.
- A reviewer requests a change at their step → new version is created.
- **The new version re-enters at the step that requested the change** (Legal requests →
  new version re-enters at Legal), NOT from step 1.
- **Reviewers who already approved the prior version are SKIPPED** on the new version
  (Internal approved v1 → not re-asked). So the flow becomes Legal → Client.
- This combination is deliberate and must be implemented together.

## 5. Gatekeeper send-back (was "dangerous if imprecise")

- A gatekeeper can send the proof back **ONE step only** — to the immediately prior step.
- A gatekeeper CANNOT send back to an arbitrary earlier step, and CANNOT bypass mandatory
  reviewers.
- Send-back reopens that one prior step; normal sequencing resumes from there.

## 6. Review surface scope (V1)

- V1 supports **images (single) and carousels** as review surfaces.
- On a carousel, a reviewer can **pin comments to a specific slide** (pins are
  slide-scoped).
- **NOT in V1:** PDF, video (frame-level), HTML/website preview, DOM-selector markup.
  These are explicitly deferred — a builder must NOT attempt them. If content of an
  unsupported type reaches a proof, show "preview not supported in this version," not a
  broken viewer.

## 7. Notification matrix (was missing — now explicit)

Recipient rules per event. "Everyone on the proof" = all reviewers/approvers + owner.

| Event | Notified |
|-------|----------|
| Proof created / reviewer invited | The invited reviewer(s) (day-0 invite) |
| Comment added | Owner + everyone on the proof |
| Reviewer approves (a step) | Everyone on the proof |
| Changes requested | Everyone on the proof |
| New version created | Everyone on the proof (re-review notice to the re-entry step) |
| Final approval reached | Owner + all approvers across the whole workflow |
| Reminder ladder (day 3/7/14) | The pending reviewer(s) (Phase 2) |
| Day-14 escalation | Opollo admin (dark-client alert) |

Channels: email + in-app (existing dispatch() + notification system). Event-driven (emit
structured event → channel adapters), per the master brief.

## 8. DAM boundary (deferred, but interfaces defined now)

DAM is NOT built in V1. BUT, to avoid a painful migration later (reviewer's warning), the
build must define stable interfaces now:
- Asset URLs/refs go through a stable accessor, not hard-coded storage paths, so a future
  DAM layer can swap the source without touching proofing.
- Version asset references attach to the content version (the `content_group_id` chain),
  so assets are already version-addressable when DAM arrives.
- No asset library / reuse / search UI in V1 — just the stable referencing.

## 9. Screens (the UI layer the reviewer flagged as under-specified)

Builders MUST build to these, not invent. Wireframes in master brief §7a + this session.

1. **Client review queue** (Gain front door): simple list of items awaiting THIS
   reviewer's decision; item opens the review screen; batch-approve allowed. Client's
   whole world — no projects/workspaces/workflow internals exposed.
2. **Review screen**: content (image/carousel) + simple markup (pin/region/comment),
   resolvable comments, decision controls (Approve / Request changes [comment required]).
   Fixed always-visible action bar (PageProof-style). Round/version indicator.
3. **Operator proof setup** (Brief 3): workflow steps + roles + thresholds + per-approver
   access (login/magic-link). Release-3 depth.
4. **Operator proof dashboard** (Brief 3): proofs by state/step, role-aware.
5. **Version comparison** (Brief 3): side-by-side of two versions in a content_group.
6. **Re-request link page** (§1): enter email → fresh link.
7. **Workflow status drawer** (BUILT): vertical, per-stage status + responsible party.

## 10. What a builder must NOT invent

If any of these is unclear in a brief, STOP and ask — do not guess: link/session timing
beyond §1–2; comment richness beyond §3; re-entry rules beyond §4; gatekeeper scope beyond
§5; review surface types beyond §6; notification recipients beyond §7; any DAM behaviour;
any screen layout not in §9.

---

## Decision log (locked this session)
One-time link + same-day session + self-serve re-request (Gain-style). Comments
resolvable, no threads, close on new version. Re-enter at requesting step, skip prior
approvers. Gatekeeper sends back one step only. V1 surfaces = image + carousel (slide
pins). Notifications mostly "everyone on the proof"; final = owner + all approvers. DAM
deferred but interfaces stable now.
