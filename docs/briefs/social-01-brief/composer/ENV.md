# Environment Variables

Companion documentation for `.env.example`. Every variable, where to get it, what it's used for.

---

## Required for build to succeed

These must be set before PR B (API surface) ships. Without them, integration tests fail.

| Variable | Source | Used by |
|---|---|---|
| `BUNDLE_SOCIAL_API_KEY` | bundle.social dashboard | `lib/social/publishing/bundle-social-client.ts`. Publish + analytics calls. |
| `BUNDLE_SOCIAL_WEBHOOK_SECRET` | bundle.social dashboard (if signing supported) or self-generated random hex | `app/api/webhooks/bundle-social/route.ts`. HMAC-SHA256 signature verification. |
| `IDEOGRAM_API_KEY` | Ideogram dashboard | Composer image-generation tool + CAP. |
| `UPSTASH_REDIS_REST_URL` | Upstash console → Redis | Hot analytics cache. |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash console → Redis | Same. |
| `SENDGRID_API_KEY` | SendGrid dashboard → Settings → API Keys | Approval emails + service-health alerts. |
| `SENDGRID_FROM_EMAIL` | Configurable | `noreply@opollo.com`. Must be a verified sender in SendGrid (Domain Authentication for opollo.com required). |
| `ANTHROPIC_API_KEY` | Anthropic console | Composer AI assistant + CAP. |
| `GIPHY_API_KEY` | https://developers.giphy.com (free tier) | GIF picker. |
| `CRON_SECRET` | Generate via `openssl rand -hex 32` | Auth for Vercel Cron → cron endpoint handshake. Without this, your cron routes (publish-due, health-check, etc.) are publicly accessible. **Critical.** |
| `NEXT_PUBLIC_FEATURE_COMPOSER_V2` | Configurable | `"true"` to enable composer V2. |
| `NEXT_PUBLIC_SITE_URL` | Configurable | `https://app.opollo.com` |
| `SUPABASE_URL` | Supabase project settings → API | Existing Opollo stack. |
| `SUPABASE_ANON_KEY` | Supabase project settings → API | Existing. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings → API | Existing. Used by service-role code paths (cron handlers, webhook receivers). |
| `DATABASE_URL` | Supabase project settings → Database → Connection String (Pooler URI) | Direct DB access for migrations + raw queries. |

---

## Optional but recommended

| Variable | Source | Used by |
|---|---|---|
| `SLACK_WEBHOOK_URL_OPS` | Slack → Incoming Webhooks | Second channel for critical service-health events. Strongly recommended — when SendGrid is the failing service, email can't notify, so Slack is the failsafe. If unset, the system runs SendGrid-only and any SendGrid outage will only surface via Sentry + the admin dashboard. |
| `FEATURE_UNIFIED_SHELL` | Configurable | Framework workstream D-3. Default OFF until PageShell migration ships. |

---

## NOT required (architectural change)

| Variable | Why not needed |
|---|---|
| `SERVICE_HEALTH_ADMIN_EMAILS` | Admin notification recipients are now discovered at runtime by querying `company_users WHERE role = 'platform_admin'`. Self-managing: admins manage themselves via the existing role system; no env var to keep in sync. See `SERVICE_HEALTH.md` §5. |
| `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | Scheduled-publish queue moved to Vercel Cron + Postgres polling. See `SERVICE_HEALTH.md` and `BUILD_ORDER.md` PR B. |

---

## Domain & email prerequisites (do these before PR E)

PR E enables real email delivery (approval notifications). For emails to actually deliver (not land in spam):

1. **SendGrid Domain Authentication for `opollo.com`.** SendGrid dashboard → Settings → Sender Authentication → Authenticate Your Domain. Add the three CNAMEs SendGrid generates to DNS at your registrar (em1234.opollo.com, s1._domainkey.opollo.com, s2._domainkey.opollo.com).
2. **`SENDGRID_FROM_EMAIL=noreply@opollo.com`** verified as a single sender in SendGrid OR auto-verified once Domain Authentication completes.
3. **DMARC/SPF policy.** Lower priority but worth adding: `v=spf1 include:sendgrid.net ~all` as a TXT record on `opollo.com`, and a basic DMARC record `v=DMARC1; p=none; rua=mailto:steven@opollo.com`.

Without these, service-health alert emails and approval emails will land in Gmail's Spam folder for the first weeks of operation.

---

## Vercel cron configuration

`vercel.json` at repo root must include:

```json
{
  "crons": [
    { "path": "/api/internal/cron/publish-due",       "schedule": "* * * * *"  },
    { "path": "/api/internal/cron/heartbeat-check",   "schedule": "*/5 * * * *" },
    { "path": "/api/internal/cron/health-check",      "schedule": "*/5 * * * *" },
    { "path": "/api/internal/cron/cleanup-cache",     "schedule": "0 3 * * *"  },
    { "path": "/api/internal/cron/escalate-approvals", "schedule": "0 */6 * * *" },
    { "path": "/api/internal/cron/health-digest",     "schedule": "0 23 * * *" }
  ]
}
```

The `health-digest` schedule `0 23 * * *` UTC = 10am AEDT / 9am AEST. Adjust if you want a different delivery time.

Every cron endpoint verifies the `Authorization: Bearer ${CRON_SECRET}` header (Vercel auto-injects this from your env var). Endpoint returns 401 to requests without it.

---

## Verification

After setting env vars in `.env.local`:

```bash
node -e "
['BUNDLE_SOCIAL_API_KEY','BUNDLE_SOCIAL_WEBHOOK_SECRET','IDEOGRAM_API_KEY','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','SENDGRID_API_KEY','SENDGRID_FROM_EMAIL','ANTHROPIC_API_KEY','GIPHY_API_KEY','CRON_SECRET','NEXT_PUBLIC_FEATURE_COMPOSER_V2','NEXT_PUBLIC_SITE_URL','SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','DATABASE_URL']
  .filter(k => !process.env[k])
  .forEach(k => console.log('MISSING:', k));
"
```

Expected output: nothing (no missing vars). If `SLACK_WEBHOOK_URL_OPS` is also missing, that's fine — it's optional.
