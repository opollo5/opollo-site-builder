# V1.5 Backlog — Image Generation Review Queue + Feedback-Driven Regeneration

**Status:** Backlog (not scheduled). Will be reconsidered after v2 editor ships and 2-3 months of real client usage.
**Owner:** Steven Morey
**Estimated effort:** 3-4 weeks focused build
**Priority signal:** Client feedback on v1 spinner UX + rejection patterns

---

## Problem statement

The current v1 image generation pipeline has three UX problems that compound:

1. **Slow feedback loop** — users wait ~5 minutes staring at spinning loaders while 5+ jobs run sequentially. Generation happens server-side; users have no choice but to wait or close the tab and forget.
2. **No quality gate before scaling** — every post generates all aspect ratios immediately. If the first image is wrong (off-brand, wrong vibe, bad headline rendering), the user has already paid for 3-5 ratios of a bad image.
3. **No iteration mechanism** — if a generated image is wrong, the only options are accept-it-anyway or discard-and-regenerate-from-scratch. No way to say "this is close but make the logo bigger" or "more corporate, less playful."

Combined effect: high cost-per-good-image, low user trust, poor first-run experience for new clients.

---

## Proposed solution

A two-stage pipeline with a human-in-the-loop review queue between stages.

### Stage 1 — Preview generation (cheap)
- Generate ONE image per post (the primary platform's aspect ratio, e.g. 1:1 for LinkedIn)
- Each preview costs ~6 cents instead of 30 cents (1 image vs 5)
- All previews fan out in parallel within Ideogram rate limits
- User notified by email when previews are ready

### Stage 2 — Review queue (slideshow UX)
- Full-screen review experience, one post at a time
- Each card shows:
  - The preview image
  - Post details (headline, body, target platforms, scheduled date)
  - Visual indicator of which aspect ratios will be generated on approval
- Three actions per card:
  - **Approve** — sends post to production stage (all remaining aspect ratios)
  - **Reject** — discards permanently, no further action
  - **Reject with feedback** — user describes what's wrong, post goes back through regeneration
- Keyboard shortcuts (A / R / F) for speed
- Queue counter visible: "12 images waiting for review"
- Can be paused and resumed; queue persists across sessions

### Stage 3 — Feedback-driven regeneration
- User-provided feedback (free text) is captured against the post
- System takes feedback + original prompt context and constructs a modified Ideogram prompt
  - Example: original "professional headshot of business meeting" + feedback "less corporate, more diverse, outdoor" → "diverse professionals in casual outdoor meeting setting"
  - Prompt rewriting probably uses Claude or GPT as an intermediary
- New preview generated and re-enters the review queue
- Post state tracks version count (preview v1, preview v2, etc.)
- After N rejections (e.g. 3), system flags for human escalation rather than infinite loop

### Stage 4 — Production generation (parallel)
- Approved posts dispatch all remaining aspect ratios in parallel batches
- Concurrent Ideogram requests within rate limits (5-10 concurrent based on tier)
- Each completed image streams into a "production batch" view
- Email + in-app notification when production batch completes
- Auto-attach to scheduled drafts happens after production completes (existing B4 logic)

---

## Architecture sketch (do not finalise until build phase)

**State machine for image_generation_jobs:**
```
PREVIEW_PENDING → PREVIEW_RUNNING → PREVIEW_COMPLETE
                                  ↓
                       PREVIEW_AWAITING_REVIEW
                                  ↓
        ┌─────────────────────────┼─────────────────────────┐
        ↓                         ↓                         ↓
   PREVIEW_REJECTED         PREVIEW_APPROVED        PREVIEW_FEEDBACK
   (terminal)                    ↓                         ↓
                          PRODUCTION_PENDING       (loop back to PREVIEW_PENDING
                                  ↓                with regen_count++)
                          PRODUCTION_RUNNING
                                  ↓
                         PRODUCTION_COMPLETE
                                  ↓
                              (terminal)
```

**Database changes (TBD at build time):**
- `image_generation_jobs.stage` enum: preview | production
- `image_generation_jobs.regen_count` int default 0
- New table `image_post_reviews`: post_id, reviewer_user_id, action (approve/reject/feedback), feedback_text, reviewed_at
- New table `email_notifications_queue` or extend existing notification infrastructure

**Email notifications:**
- Use existing email infrastructure (whatever Opollo uses for invitations/escalations)
- Templates: "Previews ready for review", "Production batch complete", "Regeneration ready"

**Rate limit handling:**
- Single client running preview + production simultaneously on different batches
- Need a global Redis-tracked concurrency cap per company
- Per-batch priority (older batches yield to newer interactive reviews)

---

## Why this is backlog, not v1

Three reasons:

1. **v1 must validate the core value prop first.** "Generate images from a spreadsheet" is the value. If that doesn't drive client signup, no amount of polished review UX matters. Ship v1 with the spinner, see if clients use it, then build the polish.

2. **The v2 editor reduces the need for this feature.** Better templates = fewer rejections = less need for the regen loop. We're not yet sure if rejection rates with good templates justify the build cost.

3. **Real client behaviour will reshape the design.** We're guessing at the slideshow UX, the feedback mechanism, the email cadence. 2-3 months of real usage will tell us what clients actually want, and the design will probably shift significantly.

---

## What we DON'T know yet (informs build)

- Actual rejection rate with v1 (basic editor) templates
- Actual rejection rate with v2 (polished editor) templates
- Whether clients prefer email notifications or in-app, or both
- Whether the slideshow UX or a grid UX better suits their workflow
- Whether feedback-driven regen is used often enough to justify the complexity
- Whether agencies want "review queue" per company or pooled across clients
- Whether there's appetite for auto-approve on second-attempt (i.e. trust the regen)

All of these get answered by running v1 + v2 with real clients for 2-3 months.

---

## Trigger to revisit this backlog item

This feature gets re-evaluated when ANY of these is true:

- 3+ clients ask for it explicitly
- Rejection rate on previews exceeds 30% (suggests regen loop has clear ROI)
- Client complaints about UX slowness exceed support capacity
- Competitor analysis shows it's becoming table stakes
- v2 editor is shipped and we have 2-3 months of real usage data

Until one of those triggers, this stays in backlog.

---

## Programme sequencing context (as of 2026-05-30)

1. **NOW** — v1 live demo running, basic pipeline working
2. **NEXT 1-2 days** — v1 cleanup, ship to one friendly client
3. **NEXT 10 weeks** — v2 editor build (Bannerbear-equivalent)
4. **AFTER v2** — re-evaluate this backlog with real client data
5. **THEN** — build review queue + feedback regen if signal supports it

Do not build this in parallel with v2 editor. Do not build this before v2 editor. Do not break the sequence.

---

## Related backlog items

- Email notification infrastructure audit — confirm what's reusable
- Ideogram rate limit tier review — check if current tier supports parallel preview+production
- "Smart brand" v2 vision (separate brief: `V2_SMART_BRAND_PRODUCT_BRIEF.md`) — adjacent but distinct
