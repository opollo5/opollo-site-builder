# Image-Gen Backlog

Explicitly deferred work for the image generation programme. Each entry has: **what**, **why deferred**, **trigger to pick it up**, **estimate**. Shipped items are deleted — ship-state lives in git log.

Sort order: strongest "pick up when" signal at the top.

---

## V1.5 Review Queue + Feedback-Driven Regeneration

**Status:** Backlog  
**Tags:** `image-gen`, `ux`, `pipeline`  
**Logged:** 2026-05-30  
**Estimate:** 3–4 weeks  
**Detailed brief:** [V1_5_REVIEW_QUEUE_FEEDBACK_REGEN_BACKLOG.md](V1_5_REVIEW_QUEUE_FEEDBACK_REGEN_BACKLOG.md)

**What:** Two-stage generation pipeline — preview → review → production. Includes a slideshow review UX for stepping through generated images before they hit the client, feedback-driven regeneration (reject an image, supply a note, trigger a new generation against that slot), and email notifications when a batch is ready for review and when it's been approved.

**Why deferred:** Building this before real client data exists risks designing the review flow around imagined friction. The v2 editor (DB-backed template editor) is in flight and materially changes the image surface — layering a review queue on top of the v1 sharp-based renderer would create throwaway work. Wait for the editor to ship and stabilise first.

**Trigger:** v2 editor shipped AND 2–3 months of production client data showing where the review/approval pain actually lives. Do NOT build in parallel with the v2 editor.

---

## V1.5 Batch UX — Loading State Improvement

**Status:** Backlog  
**Tags:** `image-gen`, `ux`  
**Logged:** 2026-05-30  
**Estimate:** S–M (approach-dependent — see below)  
**Detailed brief:** none (pick approach from client feedback, then spec)

**What:** Current batch UI shows spinning loaders for ~5 minutes during Ideogram generation with no incremental feedback. Three candidate approaches to evaluate once real client feedback arrives:

1. **Progressive reveal** — completed images appear as each job finishes; remaining slots stay as spinners.
2. **Email notification** — send "your batch is ready" email when all jobs complete; user can leave the page.
3. **Background + badge** — user navigates away; in-app notification badge increments when the batch finishes.

**Why deferred:** Not a launch blocker. The right approach depends on how clients actually use the batch flow (do they watch it? leave and come back? share the link?). Building the wrong one wastes a week. First-client usage data resolves this cheaply.

**Trigger:** First client complaint about the loading experience, OR the Review Queue work above gets scheduled first (that feature supersedes options 2 and 3 here by providing a richer notification + review surface).
