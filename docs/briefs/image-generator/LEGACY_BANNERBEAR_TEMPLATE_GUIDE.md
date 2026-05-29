# Bannerbear Template Build Guide [SUPERSEDED]

> **Superseded by addendum. The Bannerbear path is abandoned; templates live in the database
> via slice A-NEW. This file is retained for historical reference only.**
> See `MASS_IMAGE_GEN_BUILD_BRIEF_v3_ADDENDUM.md` for the current compositing spec.

---

# Original content (historical reference)

**Owner:** Steven (or Caleb, if he can spare the time)
**Time budget:** Half a day for first-time Bannerbear users, ~2 hours if you know the editor
**Outcome:** **Five** templates + five UIDs + five env vars in Vercel production
**Blocks:** Slices A4 (mood board compositing) and A5 (CAP composited posts) cannot start until this is done

**v2 update:** Original guide specified four templates. v2 of the build brief added a fifth (`mass_gen_landscape_43` at 1440×1080) for Google Business Profile, which uses native 4:3 ratio. Build five templates total.

---

## 0. What this is and isn't

This is a build guide, not a design spec. It tells you what fields and layout zones each template must contain so the engineering code can populate them. The visual design — typography choices, exact margins, the look of the overlay band — is your call.

The contract Claude Code's compositing layer expects is fixed. Anything inside that contract is up to you.

---

## 1. The contract every template must satisfy

The Bannerbear adapter at `lib/image/compositing/bannerbear.ts` sends a `modifications` array with these named layers. Your templates **must use exactly these layer names** or the compositing call fails silently.

| Layer name | Type | What it is | Source |
|---|---|---|---|
| `background_image` | Image | The AI-generated Ideogram background, fills the full frame | Signed Supabase URL |
| `headline` | Text | The text overlay on the image | From the post / mood board input |
| `logo` | Image | The brand's logo, anchored bottom-right by default | Brand profile `logo_icon_url` or `logo_primary_url` |

That's it. Three layers per template, named exactly as above. Get the naming wrong and the modifications array won't find them.

---

## 2. The four templates

Each is a separate template in Bannerbear. Each has its own UID. Create them in this order — the square is the most common, do it first and refine it before duplicating.

### Template 1: `mass_gen_square` — 1080 × 1080

**Used by:** LinkedIn feed, Instagram feed, Facebook feed, GBP
**Why first:** highest-volume output. Get this one right and the others are size variants.

**Layout zones:**

```
┌────────────────────────────────┐
│                                │
│                                │
│      background_image          │  ← fills the entire 1080 × 1080
│      (full frame, behind       │
│       everything else)         │
│                                │
│                                │
│                                │
├────────────────────────────────┤
│   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   │  ← Semi-transparent overlay band
│   ▓▓▓ headline (white text) ▓  │     covering bottom 40% of frame
│   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   │
│                       ┌──┐     │
│                       │L │     │  ← logo, bottom-right with margin
└───────────────────────┴──┴─────┘
```

**Specs:**
- Frame: 1080 × 1080
- `background_image`: 0,0 → 1080,1080. Bring to back.
- Overlay rectangle (not a Bannerbear "layer" you name — just a styling element on the canvas): 0,600 → 1080,1080, semi-transparent dark (try `rgba(26, 35, 50, 0.75)`)
- `headline`: positioned inside the overlay band. Suggested zone: 60,650 → 1020,1000. White text, bold, font size auto-scales to fit. Max characters before truncation: 80.
- `logo`: positioned bottom-right. Suggested zone: 920,920 → 1020,1020 (a 100×100 box with ~60px from right and bottom edges). Logo scales to fit inside that box, maintaining aspect ratio.

**Tips:**
- The overlay band stops the headline being unreadable on busy AI backgrounds. Don't skip it.
- Test the template with a busy Ideogram background AND a clean one — the design needs to work for both.
- The logo should be visible but not dominant. 8-10% of frame width is the sweet spot.

### Template 2: `mass_gen_portrait` — 1080 × 1350

**Used by:** Instagram feed (portrait)
**Build approach:** Duplicate template 1 in Bannerbear, change canvas size, adjust positions

**Specs:**
- Frame: 1080 × 1350
- `background_image`: 0,0 → 1080,1350
- Overlay band: 0,810 → 1080,1350 (bottom 40%)
- `headline`: 60,860 → 1020,1270
- `logo`: 920,1190 → 1020,1290

### Template 3: `mass_gen_landscape` — 1920 × 1080

**Used by:** LinkedIn landscape, X / Twitter (link card)
**Build approach:** Duplicate template 1, change to landscape, rethink the overlay shape

**Specs:**
- Frame: 1920 × 1080
- `background_image`: 0,0 → 1920,1080
- Overlay band: Two options worth testing visually:
  - **Option A (bottom band):** 0,650 → 1920,1080. Same as square but proportionally.
  - **Option B (left third):** 0,0 → 700,1080, full-height vertical band. Often reads better in landscape.
- `headline`: positioned in the overlay
- `logo`: bottom-right, suggested zone 1740,920 → 1860,1020

**Test both and pick whichever reads better with real content.**

### Template 4: `mass_gen_story` — 1080 × 1920

**Used by:** Instagram Story, Facebook Story
**Build approach:** Duplicate template 1, swap to vertical, expand vertical real estate

**Specs:**
- Frame: 1080 × 1920
- `background_image`: 0,0 → 1080,1920
- Overlay band: 0,1150 → 1080,1920 (bottom 40%)
- `headline`: 60,1230 → 1020,1700. **Top zone** of the story is reserved (Instagram's UI overlay covers top 20%). **Bottom zone** is also reserved (caption + actions overlay covers bottom 15%). Keep the headline in the safe middle-bottom band.
- `logo`: 920,1760 → 1020,1860

### Template 5: `mass_gen_landscape_43` — 1440 × 1080

**Used by:** Google Business Profile (GBP)
**Why it exists:** GBP's recommended aspect ratio is 4:3. Generating at 16:9 or 1:1 and cropping introduces a quality hit. Ideogram v3 supports 4:3 natively, so generate at the right ratio.
**Build approach:** Duplicate template 1, change canvas to 1440 × 1080, adjust positions

**Specs:**
- Frame: 1440 × 1080
- `background_image`: 0,0 → 1440,1080
- Overlay band: 0,650 → 1440,1080 (bottom ~40%)
- `headline`: 60,700 → 1380,1000
- `logo`: 1280,920 → 1380,1020

---

## 3. Brand-aware fields you don't need to specify in Bannerbear

The compositing code reads these from the brand profile at composite time and passes them in. You don't need to hard-code them in the template:

- Headline text content
- Logo image URL
- Overlay band colour (will be derived from brand `primary_colour` with auto-transparency)
- Font family (will be set from brand `heading_font` if available, falls back to template default)

Set template defaults for these (so the template renders nicely in Bannerbear's preview), but expect them to be overridden every time the code calls the API.

---

## 4. After templates are built

1. **Capture the UIDs.** Each template has a unique ID visible in Bannerbear's dashboard. Looks like `aBcDeFgH12345`. Write down all four.

2. **Test each template in the Bannerbear API console.** Bannerbear has a built-in tester — paste a sample modifications array (Claude Code can give you one) and confirm the template renders correctly.

3. **Add to Vercel production env.** Settings → Environment Variables → Production:

   ```
   BANNERBEAR_API_KEY=<your project API key from Bannerbear>
   BANNERBEAR_TEMPLATE_1080x1080=<square UID>
   BANNERBEAR_TEMPLATE_1080x1350=<portrait UID>
   BANNERBEAR_TEMPLATE_1920x1080=<landscape UID>
   BANNERBEAR_TEMPLATE_1440x1080=<GBP 4:3 landscape UID>
   BANNERBEAR_TEMPLATE_1080x1920=<story UID>
   COMPOSITING_PROVIDER=bannerbear
   IMAGE_FEATURE_MOOD_BOARD=true
   ```

4. **Redeploy production** (Vercel will offer to do this when you add env vars).

5. **Tell Claude Code:** "D1 complete. Bannerbear templates created, env vars set in production. Proceed to slice A4 after A3 merges."

---

## 5. Quality checklist before declaring done

Test each template with these scenarios — if any fail, iterate before locking in:

- [ ] **Busy background:** Generate an Ideogram image with lots of detail (a city skyline, a crowd). Composite with template. Headline must remain readable.
- [ ] **Clean background:** Generate a minimal Ideogram image (gradient, single object). Composite with template. Headline should still feel grounded, not floating.
- [ ] **Long headline:** Test with 80 characters of headline text. Text must not overflow or get awkwardly cut.
- [ ] **Short headline:** Test with 10 characters. Text shouldn't look lost.
- [ ] **Tall logo:** Test with a tall thin logo (portrait orientation). Must scale into the 100×100 zone without distortion.
- [ ] **Wide logo:** Test with a wide short logo (landscape orientation). Same.
- [ ] **Dark background under overlay:** The semi-transparent band should still allow the AI image to show through faintly.
- [ ] **Real client brand:** Try the template with Vincovi's or another real client's logo + colour. Does it look "Vincovi enough" or generic-template enough that no one would notice it's templated?

The last check is the most important. If every client's output looks identical except the logo swap, you have a templating problem — the design isn't doing enough work with the brand inputs.

---

## 6. Common mistakes that bite people

- **Naming the layers anything other than `background_image`, `headline`, `logo`.** The code looks for exact names. Get this wrong and compositing silently fails.
- **Not testing with portrait + landscape logos.** Most brand logos are landscape; some are tall (icon-only marks). The logo zone needs to gracefully handle both.
- **Hard-coding the brand colour in the template.** Bannerbear lets you set template defaults; don't make them brand-specific or the colour-override won't work cleanly.
- **Forgetting the headline text needs to fit at different lengths.** Bannerbear has auto-fit options for text fields — enable them.
- **Sizing the logo too big.** 8-10% of frame width is the upper bound. Larger and it competes with the headline.
- **Skipping the overlay band.** Tempting because it looks cleaner without — but real AI backgrounds are visually busy and headlines disappear into them without contrast help.

---

## 7. What to flag back to Steven

If you hit any of these while building:
- Bannerbear doesn't support a layout you want → tell us, we may need to rethink the composition
- A template renders fine in the editor but oddly via the API → screenshot + we'll debug
- The overlay band looks bad with real brand colours → this is the most likely iteration point; expect one round of adjustment after seeing real outputs

Send the four UIDs over Slack when done. That's the signal Claude Code can proceed to A4.
