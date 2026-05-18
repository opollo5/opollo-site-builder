# Social-01 Brief

**Sponsor:** Steven Morey
**Audience:** Opollo directors (human) + Claude Code (build agent)
**Target install path:** `C:\Users\StevenMorey\dev\opollo-site-builder\docs\briefs\social-01\`

This is an autonomous brief. Drop the unzipped contents into the target path, then point Claude Code at `CLAUDE_CODE_INSTRUCTIONS.md`. It will read, decide, and build without asking for clarification.

---

## What's in here

Two parallel workstreams + supporting assets:

```
social-01/
├── CLAUDE_CODE_INSTRUCTIONS.md     ← Claude Code reads this first
├── DECISIONS_LOCKED.md             ← Every decision that was open is now closed
├── ARCHITECTURE_GUARDRAILS.md      ← How to structure code (abstraction rules, anti-patterns)
├── SERVICE_HEALTH.md               ← In-house monitoring system — wraps every external API call, notifies admins on failures
├── README.md                       ← This file (humans)
│
├── composer/                       ← Workstream 1: Social Composer rebuild (priority)
│   ├── COMPOSER_BUILD_BRIEF.md     ← Workstream entry point
│   ├── SPEC_v1.3.docx              ← Product spec (supersedes Spec 22)
│   ├── SCHEDULING_PROPOSAL.docx    ← Scheduling state machine + 4 tabs
│   ├── SCHEDULING_PROPOSAL.md      ← Same as docx, in markdown
│   ├── SCHEMA.md                   ← Database schema delta with column types
│   ├── API_CONTRACTS.md            ← Every endpoint with TypeScript interfaces
│   ├── COMPONENT_MAP.md            ← Wireframe class names → React component paths
│   ├── BUILD_ORDER.md              ← 9 PRs (A–I) in dependency order
│   ├── ACCEPTANCE.md               ← Self-verifiable checklist + DECISION_TRAIL
│   ├── ENV.md                      ← Env var documentation
│   └── .env.example                ← Env var template
│
├── framework/                      ← Workstream 2: Frontend Template Framework
│   ├── FRAMEWORK_BUILD_BRIEF.md    ← Workstream entry point
│   ├── PASS_1_FRAMEWORK.docx       ← Original 16-template proposal
│   ├── PASS_1_FRAMEWORK.md         ← Same in markdown
│   ├── TEMPLATES.md                ← All 16 templates' specs in one document
│   ├── TEMPLATE_DOD.md             ← Per-template + per-route Definition of Done checklist
│   └── WAVE_PLAN.md                ← 4-wave build order, route lists per template
│
├── wireframes/                     ← Visual reference (13 HTML files)
│   ├── 00-dashboard-empty-state.html
│   ├── 01-dashboard-populated.html
│   ├── 02-composer-idle.html       ... (11 more)
│   ├── tokens.css                  ← Design tokens (brand-pink, EmBauhausW00, etc.)
│   ├── styles.css                  ← Component CSS, BEM-ish naming
│   ├── sprite.js, interactions.js, build.js
│   └── README.md                   ← Wireframe-to-spec mapping
│
└── migrations/                     ← Database migrations (apply in order)
    ├── 0131_recurring_drafts.sql
    ├── 0132_planned_for_at.sql
    ├── 0133_published_metadata.sql
    ├── 0134_analytics_cache.sql
    └── 0135_cron_infrastructure.sql
```
│
├── wireframes/                     ← Visual reference (13 HTML files)
│   ├── 00-dashboard-empty-state.html
│   ├── 01-dashboard-populated.html
│   ├── 02-composer-idle.html       ... (11 more)
│   ├── tokens.css                  ← Design tokens (brand-pink, EmBauhausW00, etc.)
│   ├── styles.css                  ← Component CSS, BEM-ish naming
│   ├── sprite.js, interactions.js, build.js
│   └── README.md                   ← Wireframe-to-spec mapping
│
└── migrations/                     ← Database migrations (apply in order)
    ├── 0131_recurring_drafts.sql
    ├── 0132_planned_for_at.sql
    ├── 0133_published_metadata.sql
    └── 0134_analytics_cache.sql
```

---

## How to use (Steven)

### Step 1: Drop in the briefs folder

```powershell
# From C:\Users\StevenMorey\dev\opollo-site-builder
mkdir docs\briefs\social-01
# Unzip Opollo_Social_01_Brief.zip into docs\briefs\social-01\
# So you end up with docs\briefs\social-01\CLAUDE_CODE_INSTRUCTIONS.md (no nested folder)
```

### Step 2: Configure env vars

Open `composer/.env.example`. Every variable listed must be set in `.env.local` (for local dev) and in Vercel (for staging/prod) before Claude Code can run PR B's integration tests.

**Required (set all of these before kickoff):**

```
BUNDLE_SOCIAL_API_KEY=               # bundle.social dashboard
BUNDLE_SOCIAL_WEBHOOK_SECRET=        # bundle.social or self-generated hex
IDEOGRAM_API_KEY=                    # Ideogram dashboard
UPSTASH_REDIS_REST_URL=              # Upstash console
UPSTASH_REDIS_REST_TOKEN=            # Upstash console
SENDGRID_API_KEY=                    # SendGrid (existing Opollo key)
SENDGRID_FROM_EMAIL=noreply@opollo.com
ANTHROPIC_API_KEY=                   # existing Opollo key
GIPHY_API_KEY=                       # developers.giphy.com (free)
CRON_SECRET=                         # generate: openssl rand -hex 32
NEXT_PUBLIC_FEATURE_COMPOSER_V2="true"
NEXT_PUBLIC_SITE_URL="https://app.opollo.com"
SUPABASE_URL=                        # Supabase project settings
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=                        # Supabase Pooler URI
```

**Optional but strongly recommended:**
```
SLACK_WEBHOOK_URL_OPS=               # failsafe alert channel when SendGrid fails
```

**Not needed (architectural change):** `SERVICE_HEALTH_ADMIN_EMAILS` — admin recipients are discovered at runtime by querying `company_users WHERE role = 'platform_admin'`. Self-managing via the existing role system.

**Domain prerequisites before PR E:**
- SendGrid Domain Authentication for `opollo.com` (Settings → Sender Authentication; adds 3 CNAMEs to DNS)
- `app.opollo.com` configured in Vercel + DNS (CNAME `app` → `cname.vercel-dns.com`)
- Supabase Auth → URL Configuration → Site URL `https://app.opollo.com` + Redirect Allowlist `/auth/callback`
- bundle.social webhook URL → `https://app.opollo.com/api/webhooks/bundle-social`

### Step 3: Run Claude Code

In Claude Code (from `C:\Users\StevenMorey\dev\opollo-site-builder`):

```
Read docs/briefs/social-01/CLAUDE_CODE_INSTRUCTIONS.md and begin work on the composer workstream. Build PR A first, run its verification gate, then move to PR B. Follow the build order strictly. Do not ask me clarifying questions — every decision is in DECISIONS_LOCKED.md.
```

It will pick up from there.

### Step 4: Review at PR gates

Claude Code will pause and surface for human review at:
- After PR A merges (schema is in production — verify in Supabase before continuing)
- After PR E merges (approval flow is live — Steven smoke-tests with a real magic link)
- After PR H merges (composite gate — Steven runs the 10-step manual smoke in `composer/ACCEPTANCE.md`)

Between those gates, Claude Code self-verifies via the gates listed in `composer/BUILD_ORDER.md` and continues autonomously.

---

## What's locked vs what Steven can still override

**Locked (in `DECISIONS_LOCKED.md`):**
- All 5 scheduling open questions (recurring count, approval batching, reject-reason, PTO escalation, past-dated CSV)
- All 11 framework D-decisions (Linearicons, width modes, PageShell adoption, footer-actions, max-w-4xl, modal sizing, SectionHeader, Pagination, EmptyState, Callout, width=none migrations)
- All 5 §8 supplementary questions (T-DETAIL-EDITOR routing, shared bases, PageShell migration order)
- All 14 composer architectural decisions (n8n, PAL, Supabase, bundle.social, Ideogram, SendGrid, Upstash, etc.)
- Spec 22 reconciliation overrides (per-platform variants IN V1, publish-regularly IN V1, bulk CSV IN V1)

**Override mechanism:** Edit `DECISIONS_LOCKED.md` directly, add a line at the top: `OVERRIDE <date>: <change>`. Commit and push. Claude Code re-reads on every work session.

---

## Honest timeline

**Composer workstream:** 8 PRs, ~4 weeks of focused autonomous Claude Code time. Real elapsed wall-clock time depends on how often you flip flags and review — realistic 5–8 weeks.

**Framework workstream:** 4 waves, ~2 weeks each = ~8 weeks. Can start during composer Wave 4 (after PR F) or after composer ships entirely.

Both workstreams together: 12–16 weeks of work, assuming no major external blockers (bundle.social API changes, Supabase rate-limit issues, etc.).

This is grounded in the fact that 7 of 9 infrastructure components (Supabase, bundle.social, Ideogram, SendGrid, QStash, Redis, Anthropic) already exist in the Opollo stack. The new build is product logic + UI + glue, not infrastructure.

---

## What would break this brief

1. **Spec 22 has shipped V1 since this brief was written.** Reconcile by checking `docs/specs/22-social-composer.md` for the current state; if V1 already merged something this brief assumes is absent, the brief's PR A/B may need a delta migration. Claude Code is instructed to handle this case in `CLAUDE_CODE_INSTRUCTIONS.md` §"When you genuinely cannot proceed."
2. **Migration numbers collide.** If migrations 0131–0134 are already in the repo for unrelated changes, Claude Code is instructed to renumber while preserving order. The migration *content* is correct; the *number* is opportunistic.
3. **bundle.social removes the publish API.** Out of our control. The brief assumes their current API surface; if they break it, the publishing layer needs rework.
4. **Steven changes the brand colours or fonts.** Update `tokens.css` and `app/globals.css`; everything else inherits.

If anything else breaks the brief, that's a brief defect — Claude Code will document it in `DECISION_TRAIL` and proceed with the corrected interpretation. Steven reviews `DECISION_TRAIL` at each gate.

---

## Open questions Steven might still get

None. The brief is autonomous. If Claude Code surfaces a clarification request before any of the three review gates above, that's a defect in this brief and Steven should add a line to `DECISIONS_LOCKED.md` to close it, then tell Claude Code "continue per the override."

---

## Contact

Brief author: Claude (Anthropic).
Brief sponsor: Steven Morey (Opollo).
Brief target: Claude Code (anthropic.com/claude-code).
