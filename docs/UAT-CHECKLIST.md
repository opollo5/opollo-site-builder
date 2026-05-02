# UAT Checklist — Unified

**Built against:** `main` @ `1f1984a` (post DESIGN-SYSTEM-OVERHAUL PRs #360–#369).
**Supersedes:** the M12/M13/auth slice of `UAT.md` from PR #165. `UAT.md` §1 (env-var pre-flight), §2 (smoke tests), §4 (rollback plan) and §6 (execution notes) still apply verbatim — re-read those, then run this.
**Audience:** Steven (primary tester) + a second operator if Scenario E (user management) is being run.
**Coverage:** AUTH-FOUNDATION (P1–P4), DESIGN-DISCOVERY (DD-1 through DD-12 + followups), DESIGN-SYSTEM-OVERHAUL (PRs #360–#369), M12 (brief-driven page generation), M13 (blog post pipeline).
**Estimated wall-clock:** 4–6 hours for the full pass on a single test site, plus ~30 min cleanup.

## How to read this document

- Every numbered row is a checkbox the operator runs.
- **URL** rows show the path to navigate to (relative to your staging origin, e.g. `https://staging.opollo.com`).
- **Expected** rows describe the success state.
- **Fail →** rows name the runbook entry or the BACKLOG-worthy signal.
- A `(skip if …)` qualifier means the row is conditional; record the reason in the matching sign-off row.

If a row fails, halt the section, capture the `x-request-id` from response headers, match to the runbook, and stop. Do not continue UAT into a section whose prerequisites are broken.

---

## §0 — Pre-UAT (run once at the start)

`UAT.md` §1.1–§1.5 is the authoritative pre-UAT. Re-run those before continuing here. Then add the rows below for the new workstreams' env vars + DB state.

### 0.1 New env vars (production scope)

| Var | Required value | Source |
|---|---|---|
| `FEATURE_DESIGN_SYSTEM_V2` | `true` | DESIGN-SYSTEM v2 path |
| `DESIGN_CONTEXT_ENABLED` | `true` for full DESIGN-DISCOVERY context injection (default OFF if unset) | DD-10 |
| `AUTH_2FA_ENABLED` | `true` to exercise §1.2 — leave unset to skip 2FA scenarios | P4.1 (`lib/2fa/flag.ts`) |
| `SENDGRID_API_KEY` / `SENDGRID_FROM_EMAIL` / `SENDGRID_FROM_NAME` | all set | P1 — invite emails, 2FA approval emails |

- [ ] **0.1.1** All four `SENDGRID_*` rows set in Vercel production scope.
- [ ] **0.1.2** `FEATURE_DESIGN_SYSTEM_V2=true` confirmed.
- [ ] **0.1.3** `DESIGN_CONTEXT_ENABLED` value recorded: `_____` (true / false / unset).
- [ ] **0.1.4** `AUTH_2FA_ENABLED` value recorded: `_____`. If unset/false, mark §1.2 as N/A.

### 0.2 DB state for new workstreams

Run via Supabase Studio SQL editor on staging:

```sql
-- Site-mode column populated for at least one test site
SELECT id, name, site_mode FROM sites WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5;

-- super_admin tier exists (P3.1 — role rename + super_admin tier)
SELECT id, email, role FROM opollo_users WHERE role = 'super_admin';
-- Expected: at least one row (your account).

-- Invites table from P3.2
SELECT to_regclass('public.invites');
-- Expected: 'invites'.

-- 2FA tables from P4.1
SELECT to_regclass('public.login_challenges'), to_regclass('public.trusted_devices');
-- Expected: both non-null.

-- Audit log table from P3.1 (created in migration 0063_auth_foundation_roles_and_invites.sql).
-- Note: actual table name is `user_audit_log`, NOT `audit_log` — consumed at app/admin/users/audit/page.tsx:37.
SELECT to_regclass('public.user_audit_log');
-- Expected: 'user_audit_log'.

-- DESIGN-DISCOVERY columns from migration 0060/0066
SELECT column_name FROM information_schema.columns
WHERE table_name = 'sites'
  AND column_name IN (
    'design_brief','design_direction_status','homepage_concept_html',
    'inner_page_concept_html','tone_applied_homepage_html','design_tokens',
    'tone_of_voice','tone_of_voice_status','regeneration_counts',
    'site_mode','extracted_design','extracted_css_classes'
  )
ORDER BY column_name;
-- Expected: all 12 rows.
```

- [ ] **0.2.1** super_admin row exists on the test account.
- [ ] **0.2.2** All four AUTH-FOUNDATION tables exist: `invites`, `login_challenges`, `trusted_devices`, `user_audit_log`.
- [ ] **0.2.3** All 12 DESIGN-DISCOVERY + site_mode columns present on `sites`.

---

## §1 — AUTH-FOUNDATION (P1–P4)

### 1.1 Sign-in baseline + invite + role gating (P3-1, P3-2, P3-3)

The custom invite flow replaces Supabase's built-in `inviteUserByEmail`. Invite emails go through SendGrid (`lib/email/templates/base.ts`); accept-invite is gated on a server-side token redemption.

- [ ] **1.1.1** **URL:** `/admin/users` while signed in as super_admin.
  **Expected:** users list renders; "Invite user" button visible; **"View audit log" link visible** (super_admin-only — see `app/admin/users/page.tsx:20–22`).
  **Fail →** if not super_admin, `requiredRoles` returns 403 redirect to `/`. Confirm role on `opollo_users.role` for your row.

- [ ] **1.1.2** Click "Invite user" → modal opens with email + role dropdown.
  **Expected:** role dropdown shows `admin` and `user` for super_admin. (Per `app/admin/users/page.tsx:20–21`, `super_admin → admin/user`.)
  **Fail →** missing roles or super_admin in dropdown means the dropdown isn't filtering correctly; treat as BACKLOG.

- [ ] **1.1.3** Submit invite to a fresh test email (e.g. `you+uat-invite@gmail.com`).
  **Expected:** modal closes, "Pending invite" banner appears with the email + role + "Resend" + "Cancel" actions.
  **Fail →** raw error envelope means SendGrid call failed. Check `email_log` for the failure row, runbook §`Email send failure`.

- [ ] **1.1.4** Open the invite email → click "Accept invite" → land on `/auth/accept-invite?token=…`.
  **Expected:** sets-password form with the invite's email pre-filled (read-only).
  **Fail →** if "Invite expired or already used" on first click, runbook §`Invite token redemption`. Check `invites.consumed_at` for the row.

- [ ] **1.1.5** Set a password.
  **Expected (when `AUTH_2FA_ENABLED=true`):** redirect to `/login` then immediately to `/login/check-email?challenge=…` — the accept-invite flow signs the user out post-redemption (`app/api/auth/accept-invite/route.ts:16-17`) so the next login goes through the standard 2FA email gate. After approving the email, land on `/admin/sites`.
  **Expected (when `AUTH_2FA_ENABLED` unset/false):** sign in immediately and land on `/admin/sites`.
  **Fail →** if redirected to `/login` and stuck there with no challenge query, the redemption hop didn't establish a session correctly — runbook §`PKCE callback`.

- [ ] **1.1.6** From the invited admin account: navigate to `/admin/users`.
  **Expected:** users list renders WITHOUT the "View audit log" link (super_admin-gated).
  **Fail →** if audit log link is visible, role gate is broken. **Halt UAT.**

- [ ] **1.1.7** From the invited admin account: navigate to `/admin/users/audit`.
  **Expected:** redirect to `/` (insufficientRoleRedirectTo).
  **Fail →** if the audit log renders for non-super_admin, **halt UAT** — sensitive surface unguarded.

- [ ] **1.1.8** From the super_admin account: navigate to `/admin/users/audit`.
  **Expected:** invite/role-change events for the test invite are listed (P3-3 audit log viewer).
  **Fail →** missing events means the atomic-audit write didn't fire (P3-2). Check `audit_log` table directly.

### 1.2 Email-2FA approval flow (P4) — skip if `AUTH_2FA_ENABLED` ≠ `true`

The 2FA flow intercepts a fresh sign-in (or sign-in from an unrecognized device), emails a one-time approval link, and polls until the link is clicked. Approving from the email tab returns the user to their original tab via the `complete-login` polling shell. Lost-tab fallback offers "Complete sign-in here" which mints a Supabase magic link on the device that clicked the email.

- [ ] **1.2.1** Sign out completely; clear cookies; sign in with the invited account from a fresh browser (no `device_id` cookie yet).
  **URL:** `/login` → submit credentials.
  **Expected:** redirect to `/login/check-email?challenge=…` showing "Approval email sent" with a polling spinner.
  **Fail →** instant sign-in (no email gate) = 2FA is not active. Check `AUTH_2FA_ENABLED` is set on Vercel and the deploy has picked it up.

- [ ] **1.2.2** Open the approval email → click "Approve sign-in" → land on `/auth/approve?token=…`.
  **Expected:** "Sign-in approved." with "Return to your original tab" copy. The original tab's spinner finishes, sign-in completes, redirect to `/admin/sites`.
  **Fail →** "Already used" on first click means the original tab raced the email click — restart the flow.
  **Fail →** "Expired" / "Invalid" means token validation failed — runbook §`2FA token mismatch`. Check `login_challenges.token_hash` SHA-256 match.

- [ ] **1.2.3** Lost-tab path: repeat 1.2.1, then close the original tab BEFORE clicking the approval email.
  Click the email link → on `/auth/approve` page, click **"Complete sign-in here"**.
  **Expected:** a Supabase magic-link redirect lands the device that clicked the email signed in at `/admin/sites`. (See `app/auth/approve/page.tsx:31–34`.)
  **Fail →** if the magic-link callback fails, runbook §`Magic-link mint failure`.

- [ ] **1.2.4** **URL:** `/account/devices` after a successful 2FA sign-in.
  **Expected:** at least one trusted_devices row listed with the current device flagged "this device". Each row shows the user agent, last-used timestamp, and a "Sign out this device" button.
  **Fail →** empty list = `device_id` cookie isn't being set on the approval path; runbook §`2FA device cookie`.

- [ ] **1.2.5** Click "Sign out all other devices" (visible only when ≥2 devices listed).
  **Expected:** all other devices revoked; the current device persists. Refresh confirms.
  **Fail →** revocation fails silently → check `trusted_devices.revoked_at` directly.

- [ ] **1.2.6** Sign out, then sign in again from the SAME device.
  **Expected:** **no** approval email this time — the trusted_devices cookie skips the challenge. Lands directly at `/admin/sites`.
  **Fail →** if the email gate fires again on a trusted device, the device-id cookie isn't being read on login. Check `lib/2fa/cookies.ts`.

### 1.3 Test-connection on site add (P2-1, P2-2)

The site-add form gates "Save" on a successful WP REST capability check.

- [ ] **1.3.1** **URL:** `/admin/sites/new`.
  **Expected:** form with WP URL + app-username + app-password + name + "Test connection" button. Save button disabled until test passes.
  **Fail →** if Save is enabled before testing, the gate is broken (P2-2 regression).

- [ ] **1.3.2** Provide deliberately wrong app-password → click "Test connection".
  **Expected:** translated error banner names the failure (e.g. "Login can't reach WP REST" or "App password rejected"). Save remains disabled.
  **Fail →** raw 401 envelope = `lib/error-translations.ts` not wired into this surface.

- [ ] **1.3.3** Correct the password → "Test connection" again.
  **Expected:** green "Connection verified" with the detected user role displayed (e.g. `administrator`, `editor`). Save button becomes enabled.
  **Fail →** if the response shows `INSUFFICIENT_ROLE` (or similar) for an account that does have publish capability, the capability gate is mis-firing — runbook §`auth-capability-missing`.
  **Note:** the P2-1 capability check runs server-side (`publish_posts === true` OR role ∈ {administrator, editor}; see `lib/site-test-connection.ts:116–128`) but the response surfaces only `{display_name, username, roles}` — the capability map itself is consumed and discarded. A green "Connection verified" with a detected role IS evidence the capability gate fired and passed; a future enhancement could surface the full capability map for surfaces where the role alone is ambiguous (e.g. custom roles granted `publish_posts` directly).

- [ ] **1.3.4** Click Save → site created, redirected to onboarding (per DD-11 / PR #334).
  **Expected:** lands at `/admin/sites/[id]/onboarding`, NOT directly at the site detail page.
  **Fail →** lands at `/admin/sites/[id]` straight away = DESIGN-DISCOVERY redirect didn't fire. Check `lib/sites/createSite.ts`.

### 1.4 Credential rotation on site edit (P2-3, P2-4)

- [ ] **1.4.1** **URL:** `/admin/sites/[id]/edit` for an existing site.
  **Expected:** WP credentials section with "Rotate app password" action. Per P2-4, credentials seeded before the rotation gate are flagged "Re-test required".
  **Fail →** missing rotation control on a P2-era site = migration didn't backfill the flag. Check `site_credentials.requires_retest`.

- [ ] **1.4.2** Click "Rotate" → enter new app password → click "Test connection" → click "Save".
  **Expected:** old credential is replaced; encrypted ciphertext changes (verify via service-role SELECT on `site_credentials.ciphertext` byte length / md5 changes). The "Re-test required" badge clears.
  **Fail →** save without test-pass means the gate is broken (P2-3 regression).

### 1.5 Sign-off — AUTH-FOUNDATION

- [ ] §1.1 invite + role gating passed.
- [ ] §1.2 2FA approval + trusted devices passed (or N/A — `AUTH_2FA_ENABLED` not set).
- [ ] §1.3 test-connection gate works on site add.
- [ ] §1.4 credential rotation works on site edit.
- [ ] No raw error codes leaked in any of §1's surfaces.

---

## §2 — DESIGN-DISCOVERY (3-step setup wizard)

The setup wizard at `/admin/sites/[id]/setup` gates: **Step 1** design direction (mood board → 3 concepts → refinement → approval), **Step 2** tone of voice (sample copy → tone JSON → live application to homepage hero), **Step 3** done summary. Step is persisted in `?step=1|2|3`; missing param computes resume step from `design_direction_status` + `tone_of_voice_status`.

A new site lands here automatically (DD-11 / PR #334). An older site can be deep-linked.

### 2.1 Step 1 — design direction

- [ ] **2.1.1** **URL:** `/admin/sites/[id]/setup?step=1` for a freshly-created site (status pending/pending).
  **Expected:** form with: "Reference URLs" (one per line), "Reference screenshots" (drag-drop, DD-followup-1 / PR #351), "Description", "Industry" select, "Refinement notes" textarea. Submit-to-generate-concepts button at the bottom.
  **Fail →** missing screenshot upload = DD-followup-1 not deployed.

- [ ] **2.1.2** Fill the form with at least one reference URL + a description + an industry → submit.
  **Expected:** loading screen with "Understanding your inputs" + "Generating 3 concepts in parallel" copy. Within ~60–90s the screen advances to the three-up review surface (DD-6 / PR #327).
  **Fail →** if generation hangs >120s, the parallel-3 concept generator (DD-5) is not converging. Check Anthropic logs + `regeneration_counts.concept_refinements`.

- [ ] **2.1.3** Three-up surface: each concept shows an iframe preview + a tagline summary + "Approve" button.
  **Expected:** iframes load without console errors; concept HTML is plausibly distinct between the three (not three copies).
  **Fail →** identical concepts = normalization stripped distinguishing detail. Treat as BACKLOG.

- [ ] **2.1.4** Click "Refine" on one concept → enter refinement notes → submit.
  **Expected:** that concept regenerates with notes incorporated; `regeneration_counts.concept_refinements` increments by 1; cap is 10/loop (DD-followup-3 / PR #353).
  **Fail →** if refinement fires more than 10 times without a server reject, server-side cap missing.

- [ ] **2.1.5** Approve a concept.
  **Expected:** redirect to `?step=2`. `sites.design_direction_status='approved'`, `homepage_concept_html` populated, `inner_page_concept_html` populated, `design_tokens` JSONB has the 9 documented keys (primary, secondary, accent, background, text, font_heading, font_body, border_radius, spacing_unit — per CLAUDE.md §Q8 audit table).
  **Fail →** missing keys in `design_tokens` = extraction is incomplete; runbook §`token extraction gap`.

### 2.2 Step 2 — tone of voice

- [ ] **2.2.1** **URL:** `/admin/sites/[id]/setup?step=2` after step 1 approval.
  **Expected:** form with "Sample copy" textarea + guided questions (DD-8 / PR #331). Generate-tone button.
  **Fail →** if the form doesn't load, check `tone_of_voice_status`.

- [ ] **2.2.2** Paste 200–400 words of sample copy → answer guided questions → submit.
  **Expected:** tone JSON renders alongside an "Approved samples" list with regenerate-individual-sample buttons. Live tone preview applies the new tone to the approved homepage hero / first CTA / first service card (DD-9 / PR #332).
  **Fail →** missing live preview = DD-9 didn't deploy; check `tone_applied_homepage_html`.

- [ ] **2.2.3** Click "Regenerate sample" on one of the samples.
  **Expected:** that sample regenerates with the same tone JSON; `regeneration_counts.tone_samples` increments by 1; cap is 10/loop.
  **Fail →** uncapped regeneration = server-side cap missing (DD-followup-3 regression).

- [ ] **2.2.4** Approve the tone.
  **Expected:** `tone_of_voice_status='approved'`, `tone_of_voice` JSONB populated with all documented keys (per CLAUDE.md §Q8: formality_level, sentence_length, jargon_usage, personality_markers, avoid_markers, target_audience, style_guide, approved_samples). Redirect to `?step=3`.

### 2.3 Step 3 — done

- [ ] **2.3.1** **URL:** `/admin/sites/[id]/setup?step=3` after step 2 approval.
  **Expected:** summary card showing approved direction (preview thumbnail) + tone (formality summary) + "Start generating content" CTA linking to the brief upload surface.
  **Fail →** missing CTA or wrong link = DD-3 done-screen regression.

### 2.4 Setup banner + redirect-on-create

- [ ] **2.4.1** Visit `/admin/sites/[id]` for a site whose setup is incomplete.
  **Expected:** "Setup reminder" banner (DD-12 / PR #335) prompting "Complete design setup" → links to `/admin/sites/[id]/setup`.
  **Fail →** banner missing = DD-12 didn't deploy.

- [ ] **2.4.2** Visit `/admin/sites/[id]` for a site whose setup is complete.
  **Expected:** banner gone; design summary card shown with thumbnail + tone summary.
  **Fail →** banner persists = `design_direction_status` / `tone_of_voice_status` not being read.

### 2.5 Resume + skip behavior

- [ ] **2.5.1** Visit `/admin/sites/[id]/setup` (no `?step` param) for a partially-completed setup (Step 1 approved, Step 2 pending).
  **Expected:** redirect to `?step=2`.
  **Fail →** lands on Step 1 = `computeResumeStep` regression.

### 2.6 Sign-off — DESIGN-DISCOVERY

- [ ] All three wizard steps complete cleanly.
- [ ] `design_tokens` + `tone_of_voice` JSONB columns populated and operator-readable.
- [ ] Server-side regeneration caps verified (DD-followup-3).
- [ ] Setup reminder banner toggles based on completion state.

---

## §3 — DESIGN-SYSTEM-OVERHAUL (site_mode end-to-end)

Site mode is a binary fork added in PR #360: `copy_existing` (pull design from an existing live site) vs `new_design` (run DESIGN-DISCOVERY). Set on the new `/admin/sites/[id]/onboarding` screen (PR #361). Routes the operator to either the legacy DESIGN-DISCOVERY wizard (§2) or the copy-existing extraction wizard (PR #362).

### 3.1 Mode selection — onboarding screen

- [ ] **3.1.1** **URL:** `/admin/sites/[id]/onboarding` for a site with `site_mode IS NULL`.
  **Expected:** two-card chooser: "Copy from an existing site" + "Design new from scratch". Each card has a description; submit picks one.
  **Fail →** if `site_mode` is already set, the page redirects to the matching downstream surface (per `app/admin/sites/[id]/onboarding/page.tsx:57–60`). That's correct behavior — confirm by reading `sites.site_mode`.

- [ ] **3.1.2** Pick "Design new from scratch" → confirm.
  **Expected:** `sites.site_mode='new_design'`; redirect to `/admin/sites/[id]/setup` (DESIGN-DISCOVERY wizard).
  **Fail →** wrong redirect target = onboarding submit handler missing the mode-routing step.

- [ ] **3.1.3** Pick "Copy from an existing site" on a separate test site → confirm.
  **Expected:** `sites.site_mode='copy_existing'`; redirect to `/admin/sites/[id]/setup/extract`.

- [ ] **3.1.4** Re-visit `/admin/sites/[id]/onboarding` for an already-onboarded site.
  **Expected:** auto-redirect to the matching downstream surface; the mode-selection cards do NOT re-render. (Per `app/admin/sites/[id]/onboarding/page.tsx:57–60`.)
  **Fail →** if cards re-render on an already-set site, mode is reading null incorrectly.

### 3.2 copy_existing extraction wizard (PR #362)

- [ ] **3.2.1** **URL:** `/admin/sites/[id]/setup/extract` for a `copy_existing` site.
  **Expected:** "Run extraction" CTA + the site's WP URL displayed. No mode-mismatch error.
  **Fail →** mode-mismatch redirect = `site_mode` not set; restart from §3.1.

- [ ] **3.2.2** Click "Run extraction" → wait.
  **Expected:** spinner + status updates (e.g. "Fetching homepage", "Identifying components", "Extracting CSS classes"). Eventually a review screen renders with the extracted profile (palette + typography + spacing summary + a list of CSS classes / utility patterns).
  **Fail →** raw HTTP error = WP unreachable or unauthorized; runbook §`rest-disabled` / §`auth-capability-missing`.
  **Fail →** empty extraction = source site doesn't expose enough structure; record the site as a known limitation, not a UAT failure.

- [ ] **3.2.3** Confirm the extraction.
  **Expected:** `sites.extracted_design` JSONB + `sites.extracted_css_classes` JSONB populated. Redirect to `/admin/sites/[id]` site detail.
  **Fail →** missing columns = migration `0060` (or equivalent) didn't ship; check `information_schema.columns`.

- [ ] **3.2.4** Re-run extraction on the same site (re-extract).
  **Expected:** previous extraction is replaced; UI confirms re-run completed; `extracted_design` reflects the latest run.
  **Fail →** silent non-overwrite = re-extract isn't a true write path.

### 3.3 Mode-aware appearance panel (PR #363)

The Appearance panel renders one of three states depending on `site_mode` (per `app/admin/sites/[id]/appearance/page.tsx:17–32`).

- [ ] **3.3.1** **URL:** `/admin/sites/[id]/appearance` for a site with `site_mode IS NULL`.
  **Expected:** empty state with "Complete site setup first" + link to `/admin/sites/[id]/onboarding`. **No** Kadence preflight call. **No** raw `context_build_failed` text (CLAUDE.md §Q2 audit fix).
  **Fail →** preflight call fired or raw audit-log code visible = the empty-state guard is bypassed.

- [ ] **3.3.2** **URL:** `/admin/sites/[id]/appearance` for a `copy_existing` site.
  **Expected:** **ExtractedProfilePanel** renders: read-only summary of `extracted_design` + `extracted_css_classes` + a "Re-extract" link. **No Kadence section.**
  **Fail →** Kadence section visible = mode gate broken.

- [ ] **3.3.3** **URL:** `/admin/sites/[id]/appearance` for a `new_design` site.
  **Expected:** **AppearancePanelClient** with the existing M13-5 Kadence preflight → sync → rollback state machine.
  **Fail →** if it renders the ExtractedProfilePanel for a new_design site, mode read is inverted.

### 3.4 Mode-aware design system landing (PR #364)

- [ ] **3.4.1** **URL:** `/admin/sites/[id]/design-system` for a `copy_existing` site.
  **Expected:** copy-existing-aware landing. The four-tabs (Versions/Components/Templates/Preview — flagged NOT load-bearing per CLAUDE.md §Q1) are hidden behind an "Advanced" disclosure.
  **Fail →** raw four-tabs UI as the entry point = PR 9 / PR #364 regression.

- [ ] **3.4.2** Same URL for a `new_design` site.
  **Expected:** mode-aware design summary (PR #367 — site detail card) reflects DESIGN-DISCOVERY's approved direction + tone. "Advanced" disclosure still hides the raw editor.

### 3.5 Mode-aware brief runner generation (PR #365)

This is the integration point — the brief runner reads `sites.site_mode` at every page tick and routes the design context payload accordingly (per `lib/brief-runner.ts:560–622, 1627–1715, 2107–2291`).

- [ ] **3.5.1** With `DESIGN_CONTEXT_ENABLED=true` and `site_mode='new_design'`, run a 1-page brief (§4 covers the procedure).
  **Expected:** the system prompt assembled for that page references `design_tokens` + `homepage_concept_html` (DESIGN-DISCOVERY artifacts). Verify by checking the Langfuse trace's user-turn payload for tags like `<design_tokens>` and `<concept_html>`.
  **Fail →** payload uses `extracted_design` instead = mode dispatch inverted.

- [ ] **3.5.2** With `DESIGN_CONTEXT_ENABLED=true` and `site_mode='copy_existing'`, run a 1-page brief.
  **Expected:** the system prompt references `extracted_design` + `extracted_css_classes` and **does not** reference `design_tokens` / `homepage_concept_html`.

- [ ] **3.5.3** With `DESIGN_CONTEXT_ENABLED=false` (or unset), run a 1-page brief on either mode.
  **Expected:** legacy generation path; no design context prefix injected. Page completes without regression.
  **Fail →** generation throws = the flag-off path has a hard dependency that wasn't defaulted.

- [ ] **3.5.4** With `site_mode IS NULL` and `DESIGN_CONTEXT_ENABLED=true`, run a 1-page brief.
  **Expected:** falls back to legacy path; no design context prefix; no error. (Mode-null is the safe default — no regression on un-onboarded sites.)
  **Fail →** generation throws or asserts on missing mode = the null-fallback is broken.

### 3.6 Per-site image library context (PR #366)

- [ ] **3.6.1** Upload 2–3 images to the site's image library at `/admin/sites/[id]/images` (or wherever the per-site image surface lives).
  **Expected:** images appear in the library with operator-meaningful captions.
  **Fail →** Cloudflare upload failure = `CLOUDFLARE_IMAGES_HASH` likely unset; runbook §1.1 footgun row.

- [ ] **3.6.2** Run a brief whose pages plausibly need imagery (e.g. service descriptions).
  **Expected:** the page's generation references the uploaded images by their captions. Verify in the Langfuse trace's user-turn payload: an `<image_library>` tag is present and lists the captions.
  **Fail →** missing image_library tag = PR #366 didn't deploy or the per-site lookup is broken.

### 3.7 Mode-aware design system card on site detail (PR #367)

- [ ] **3.7.1** **URL:** `/admin/sites/[id]` for a `new_design` site post-DESIGN-DISCOVERY.
  **Expected:** design system card showing palette swatches + tone summary + "View design system" CTA.
  **Fail →** empty card or raw column dump = PR #367 regression.

- [ ] **3.7.2** Same URL for a `copy_existing` site post-extraction.
  **Expected:** card shows the extracted palette + a "View extracted profile" CTA linking to `/appearance`.

### 3.8 Sign-off — DESIGN-SYSTEM-OVERHAUL

- [ ] Mode selection routes correctly to either `/setup` (new_design) or `/setup/extract` (copy_existing).
- [ ] Appearance panel renders the right state for all three (`null`, `copy_existing`, `new_design`).
- [ ] Brief runner injects the correct design context payload per mode (verified via Langfuse trace).
- [ ] `DESIGN_CONTEXT_ENABLED=false` and `site_mode IS NULL` paths regress nothing.
- [ ] Per-site image library context appears in generation prompts.

---

## §4 — M12 (brief-driven page generation)

UAT.md §2.1 (Smoke 1) is the baseline procedure. This section adds the mode-aware verifications and the cost-control / quality-flag rows that landed in M12-4.

Use a `new_design` site whose DESIGN-DISCOVERY is approved (so the design context payload is exercised). For mode-coverage, repeat 4.1–4.5 once on a `copy_existing` site (smoke only — full content validation is on `new_design`).

### 4.1 Upload + parse + commit (M12-1, M12-2)

- [ ] **4.1.1** **URL:** `/admin/sites/[id]` → scroll to the **Briefs** section → click "Upload brief".
  (Note: there is no `/admin/sites/[id]/briefs` index route — the briefs list + upload button live on the site detail page directly. See `app/admin/sites/[id]/page.tsx:302-306`.)
  **Expected:** modal with file-upload + paste-text composer, `content_type` selector (page / post), draft persistence (refresh the page mid-typing — your input survives). Brief size cap rejects >45k-word docs with `BRIEF_TOO_LARGE` (per m12-parent §Whole-document context).

- [ ] **4.1.2** Upload a 3-page markdown brief with `content_type=page`. Provide brand voice + design direction in the form (M12-2 first-class fields).
  **Expected:** parse runs (structural-first, falls back to Claude inference). Redirect to `/admin/sites/[id]/briefs/[brief_id]/review`.
  **Fail →** raw 4xx = parse rejected. Try a smaller brief; if still failing, runbook §`BRIEF_PARSE_FAILED`.

- [ ] **4.1.3** **URL:** `/admin/sites/[id]/briefs/[brief_id]/review`.
  **Expected:** parsed page list with per-row title + mode badge (`full_text` ≥400 words / `short_brief` <400 words). Re-order, edit titles, flip modes, add/remove pages all work without page reload.

- [ ] **4.1.4** Click "Commit". Pre-flight cost estimate modal appears (M12-4 risk 15).
  **Expected:** modal shows `estimated_cents`, `remaining_budget_cents`, and the model tier (`text_model` / `visual_model`). If `estimate > 0.5 × remaining`, modal requires explicit "Confirm anyway" before submit (`CONFIRMATION_REQUIRED` envelope).
  **Fail →** auto-commit without confirmation on a high-estimate brief = M12-4 risk-15 regression.

### 4.2 Run + review + approve / cancel / revise (M12-3, M12-5)

- [ ] **4.2.1** Click "Start run". Status pill flips to `queued` then `running` after the next `/api/cron/process-brief-runner` tick (max 60s).
  **Fail →** stuck `queued` >2 min = cron not firing; UAT.md §1.4 cron probe.

- [ ] **4.2.2** Page 1 reaches `awaiting_review`. Anchor cycle should run 2–3 extra revision passes; verify in the run surface that the "Pass log" column shows >3 passes for page 1 (vs ≤3 for pages 2..N).
  **Fail →** anchor cycle skipped on page 1 → check `MODE_CONFIGS.page.anchorExtraCycles` is non-zero.

- [ ] **4.2.3** Run surface shows: draft HTML preview, screenshot (if M12-4 visual review fired), critique log, three buttons (Approve / Revise with note / Cancel).
  **Expected:** all three actions work; "Revise with note" prompts for note text and re-fires the runner with the note appended to the next pass.

- [ ] **4.2.4** Approve page 1. Page 2 starts on the next cron tick.
  **Expected:** `site_conventions` JSONB on the brief row is populated after page 1's anchor cycle (M12-2 / M12-3 anchor protocol). Verify via `SELECT site_conventions FROM site_briefs WHERE id = '[brief_id]'`.
  **Fail →** empty `site_conventions` after page 1 approval = anchor freeze didn't fire; runbook §`anchor freeze`.

- [ ] **4.2.5** Cancel mid-run on page 3.
  **Expected:** runner halts; pages 1+2 stay `approved`; page 3 transitions to `cancelled`. No destructive cleanup.
  **Fail →** approved pages get rolled back = cancel-is-non-destructive contract broken.

- [ ] **4.2.6** Re-run the same brief.
  **Expected:** new `brief_runs` row with the partial-unique index rejecting concurrent attempts (M12-3 risk 5). One-active-run-per-brief invariant holds.

- [ ] **4.2.7** Two-tab race: open `/run` in two tabs; click Approve in one then Approve in the other.
  **Expected:** second approval returns `VERSION_CONFLICT` envelope rendered as a UI banner asking the operator to refresh.
  **Fail →** silent double-approve = `version_lock` not enforced on the approve route.

### 4.3 Cost ceiling + model tier (M12-4)

- [ ] **4.3.1** Configure a per-page ceiling on the test tenant (e.g. 80c via `tenant_cost_budgets.per_page_ceiling_cents_override`).
  **Expected:** the run continues to honor the existing reserveBudget cap AND the new per-page ceiling.

- [ ] **4.3.2** Run a brief with deliberately-large pages on Opus visual tier so the ceiling fires.
  **Expected:** affected page transitions to `awaiting_review` with `quality_flag = 'cost_ceiling'`. Run surface renders the flag as an operator-readable badge (NOT raw enum value).

- [ ] **4.3.3** Set `briefs.text_model = 'not-a-model'` directly via SQL on a queued brief, then start it.
  **Expected:** runner fails the page with `INVALID_MODEL` and zero Anthropic billing rows. (M12-4 risk 14 model-allowlist.)

- [ ] **4.3.4** Visual iterations should cap at 2 per page. Synthesise a brief that always returns severity-high critiques (or trust the existing unit test asserting this).
  **Expected:** page commits at iteration 2 with `quality_flag = 'capped_with_issues'`; iteration 3 never fires.

### 4.4 Visual review pass (M12-4)

- [ ] **4.4.1** Inspect a completed page's `brief_pages.critique_log` JSONB.
  **Expected:** at least one visual critique entry with the four severity dimensions (layout / hierarchy / contrast / density). No screenshot bytes in the log (retention contract — screenshots are tmpdir-only).

- [ ] **4.4.2** Spot-check Supabase Storage for `site-briefs/[site_id]/[brief_id]/screenshots/` — should not exist.
  **Fail →** screenshot files in Storage = M12-4 retention contract regression.

- [ ] **4.4.3** Run cost rollup verification: `SELECT page_cost_cents FROM brief_pages WHERE brief_id = X` summed should equal `brief_runs.run_cost_cents`.

### 4.5 Publish via M7

- [ ] **4.5.1** Navigate to `/admin/sites/[id]/pages` after approval.
  **Expected:** approved pages listed with `generated_html` populated, `wp_page_id IS NULL` until publish.

- [ ] **4.5.2** Publish a page.
  **Expected:** `wp_page_id` populates, page renders on the live WP. Iframe preview matches.

### 4.6 Sign-off — M12

- [ ] All of UAT.md Smoke 1 + scenarios B + G pass.
- [ ] Anchor cycle visibly runs on page 1 (>3 passes).
- [ ] Per-page cost ceiling + model allowlist + visual cap each fire on synthetic triggers.
- [ ] Two-tab approve race surfaces VERSION_CONFLICT, not silent double-approve.

---

## §5 — M13 (blog post pipeline)

UAT.md §2.2 (Smoke 2) + §2.3 (Smoke 3) are the baseline procedures.

### 5.1 Post-mode brief (M13-1, M13-3)

- [ ] **5.1.1** Upload a brief with `content_type=post`. Note: post mode disables anchor cycle (`MODE_CONFIGS.post.anchorExtraCycles=0`) — page 1 should NOT show the +2/+3 extra passes that page mode does.

- [ ] **5.1.2** Approve the page.
  **Expected:** brief→post bridge fires automatically. New row in `posts` with the bridged title, `content_type='post'`, `status='draft'`, `generated_html` populated.
  **Fail →** no post row = bridge didn't fire; runbook §`orphan-post-row`. Look for a `slug_already_in_use` soft-fail.

### 5.2 Posts admin surface (M13-4)

- [ ] **5.2.1** **URL:** `/admin/sites/[id]/posts`.
  **Expected:** list view with status filter + `q` over title/slug + paged. `deleted_at IS NULL` is the default predicate.

- [ ] **5.2.2** **URL:** `/admin/sites/[id]/posts/[post_id]`.
  **Expected:** detail view with iframe preview + critique log + screenshot + actions (Approve / Revise / Cancel / Publish / Unpublish).

- [ ] **5.2.3** Click "Publish" → confirm modal names the exact WP URL + the destructive consequence.
  **Expected:** modal copy is operator-meaningful, not raw error codes (PR #369 / error-fallback primitive). Confirm publishes; `wp_post_id` populates; status flips to `published`.

- [ ] **5.2.4** Open the post on WP directly. Verify slug, excerpt, featured image (if applicable).

- [ ] **5.2.5** Click "Unpublish" → confirm modal names "WordPress keeps it in Trash" copy.
  **Expected:** unpublish succeeds; `posts.status='draft'`, `wp_post_id=null`. The same `posts.id` is reused.

- [ ] **5.2.6** Re-publish the same row.
  **Expected:** new `wp_post_id`; the same `posts.id`. WP shows the post again.

### 5.3 Preflight + SEO plugin detection (M13-2)

- [ ] **5.3.1** **URL:** the `/preflight` action that fires before publish.
  **Expected:** capabilities probe returns `edit_posts: true`, `upload_files: true`. SEO plugin fingerprinted (`yoast` / `rankmath` / `seopress` / `none`).
  **Fail →** missing capability → translated blocker before the confirm button. Runbook §`auth-capability-missing`.

- [ ] **5.3.2** Pick a post brief that declares an SEO meta field; publish on a site without the SEO plugin.
  **Expected:** publish blocked at preflight with a translated message; operator can either install the plugin or remove the SEO field from the brief.

- [ ] **5.3.3** Pick a post brief that declares a category. Publish.
  **Expected:** category resolved against existing terms; if the term doesn't exist, operator confirms creation in a dialog (M13-2 risk: no silent term creation).

### 5.4 Kadence palette sync (M13-5) — only on Kadence-bearing `new_design` sites

UAT.md §2.3 (Smoke 3) procedure. Re-run with the mode-aware appearance-panel guard from §3.3 in mind: this section only applies if `site_mode='new_design'` AND Kadence is detected.

- [ ] **5.4.1** Ensure Kadence is manually installed + activated on the test WP. Confirm via `/admin/sites/[id]/appearance` preflight phase = `ready`.

- [ ] **5.4.2** Modify the active design system palette → confirm a diff appears on `/appearance`.

- [ ] **5.4.3** Click "Sync Now" → SyncConfirmModal names the WP URL + listing the changing slots → confirm.
  **Expected:** "Palette synced" success state. WP Customizer → Kadence Global Colors reflects the new palette.

- [ ] **5.4.4** Click "Roll back" → RollbackConfirmModal → confirm.
  **Expected:** WP Customizer reverts to the prior palette.

- [ ] **5.4.5** Verify `appearance_events` audit-log entries: `globals_dry_run` → `globals_confirmed` → `globals_completed` → `rollback_requested` → `rollback_completed`.

### 5.5 Sign-off — M13

- [ ] All of UAT.md Smoke 2 + Smoke 3 + Scenario C pass.
- [ ] Post mode disables anchor cycles (verify in pass log).
- [ ] Bridge writes a posts row on approve; round-trip publish/unpublish reuses `posts.id`.
- [ ] SEO plugin detection blocks publish when a brief-declared field can't land.
- [ ] Kadence palette sync + rollback complete a full audit-log sequence.

---

## §6 — Cross-cutting integration (mode × DESIGN_CONTEXT × M12/M13)

These are the rows that catch regressions where one workstream silently breaks another.

- [ ] **6.1** With `DESIGN_CONTEXT_ENABLED=true` + `site_mode='new_design'` + DESIGN-DISCOVERY approved: a 1-page brief generates HTML that visibly applies the approved palette + tone (eyeball check the iframe preview).

- [ ] **6.2** With `DESIGN_CONTEXT_ENABLED=true` + `site_mode='copy_existing'` + extraction confirmed: a 1-page brief generates HTML that visibly applies the extracted palette + classes.

- [ ] **6.3** With `DESIGN_CONTEXT_ENABLED=false` (flag flipped off mid-test): a 1-page brief generates without the design context prefix; output is plausible (legacy fallback works).

- [ ] **6.4** With `site_mode IS NULL` + `DESIGN_CONTEXT_ENABLED=true`: brief runs without throwing; uses legacy generation (no design context prefix).

- [ ] **6.5** Mode change after generation: change `site_mode` from `new_design` to `copy_existing` on a site with already-generated pages. Re-run a brief.
  **Expected:** new pages use the new mode's design context. Already-generated pages are unchanged. No retroactive regeneration.

- [ ] **6.6** Two-tab race across workstreams: tab A on `/setup?step=2`, tab B on `/onboarding`. Approve tone in A while changing mode in B.
  **Expected:** `VERSION_CONFLICT` surfaces in B (mode change loses the optimistic-concurrency race). No DB corruption.

---

## §7 — Sign-off

UAT passes when every checkbox above is ticked or explicitly marked N/A with a recorded reason.

| Section | Sign-off date | Tester | Notes |
|---|---|---|---|
| §0 Pre-UAT | | | |
| §1 AUTH-FOUNDATION | | | |
| §2 DESIGN-DISCOVERY | | | |
| §3 DESIGN-SYSTEM-OVERHAUL | | | |
| §4 M12 | | | |
| §5 M13 | | | |
| §6 Cross-cutting | | | |

Final operator sign-off: **__________________ (Steven)** on `__________` (date).

If any single checkbox cannot be ticked: do NOT hand the tool to a paying operator. Loop back to a fix-pass + re-run the affected section.

---

## §8 — Out of scope for this UAT

Per `UAT.md` §7 plus the explicit deferrals from each workstream's parent plan:

- **Performance / load testing.** Lighthouse CI on `/login` only. Defer to a perf-focused milestone.
- **Multi-tenancy stress.** Single-tenant by design.
- **Cloudflare → S3 migration.** Audit Option A: fix in place.
- **Kadence typography + spacing sync.** Per M13-5 rescope: free tier exposes only palette via REST. Typography + spacing remain operator-Customizer-owned.
- **Theme install via REST.** Per M13-5c rescope: WP `/wp/v2/themes` is read-only. Operator installs Kadence manually.
- **2FA over SMS / TOTP.** P4 ships email-only. SMS / TOTP is BACKLOG.
- **PDF / .docx brief upload.** M12-6 stretch deferred to BACKLOG.
- **Multi-language briefs.** Single-language by design.

If any of these surface as UAT-blocking during execution: escalate; do not freelance.
