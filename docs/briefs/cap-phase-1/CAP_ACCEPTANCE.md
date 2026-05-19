# CAP Phase 1 — Manual Smoke Acceptance

Run this checklist against **https://app.opollo.com** after PR #933 deploys.
All steps require a user with `is_cap_operator = true` on `platform_users`.

---

## Prerequisites

Set `is_cap_operator = true` for your admin user:

```sql
UPDATE platform_users SET is_cap_operator = true WHERE email = 'hi@opollo.com';
```

---

## 1 — Subscription + Voice Profile Setup

- [ ] Navigate to **Admin → Companies → [a test company] → CAP**
- [ ] "Enable CAP subscription" form is visible
- [ ] Create a subscription: tier = `starter`, status = `active`, monthly cap = `$20`
- [ ] Subscription panel shows with status badge = **Active**
- [ ] Amber warning callout "Monthly objective template not set" is visible above Voice Profiles
- [ ] **Default monthly objective template** textarea is visible below subscription details
- [ ] Enter an objective (e.g. "Drive LinkedIn engagement for our MSP team targeting SMB IT managers.") and click **Save template**
- [ ] Amber warning callout disappears after saving
- [ ] "Add voice profile" form is visible
- [ ] Create a voice profile: name = `Test Profile`, tone = `Professional & Friendly`, industry = `IT Services`, target audience = `SMB owners`
- [ ] Profile appears in the list; shows as default

---

## 2 — Campaign Generation

- [ ] Navigate to **Admin → Companies → [company] → CAP → Campaigns**
- [ ] "Generate this month's campaign" button is visible (or a campaign already exists for current month)
- [ ] Click generate — button shows loading state, then campaign appears in list with status = **Generating**
- [ ] After 20–60 seconds, refresh — campaign status changes to **Review** (or **Failed** if image provider returns error, which is acceptable)
- [ ] Click into the campaign — 4 arc posts are shown (awareness / education / offer / proof)
- [ ] Each post has generated text content and hashtags

---

## 3 — Post Review Actions

- [ ] **Approve** a post — status badge updates to **Approved**
- [ ] **Reject** a post — rejection reason field appears; submit — status updates to **Rejected**
- [ ] **Regenerate** a post — triggers re-generation; post content updates on next refresh
- [ ] **Push to Composer** on an approved post — confirm "Pushed" status; navigate to Social → Posts and verify a draft exists

---

## 4 — Analytics

- [ ] Navigate to **Admin → Companies → [company] → CAP → Analytics**
- [ ] Stats cards render: Spend (last 30 days), Total generation runs, Avg cost per campaign
- [ ] Cost cap bar shows usage percentage
- [ ] Campaign status breakdown grid is visible

---

## 5 — API Gate (Auth)

- [ ] Log out or use a non-`is_cap_operator` account
- [ ] `POST /api/platform/cap/campaigns/[any-id]/generate` → expect **403**
- [ ] `GET /api/platform/cap/subscriptions` → expect **403**

---

## 6 — Cron Endpoints (Health Check)

```bash
# Requires CRON_SECRET env var
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://app.opollo.com/api/cron/cap-generation-runs-cleanup
# Expected: { "ok": true, "data": { "deletedRows": 0, ... } }
```

---

## Known Acceptable Failures

- Image generation may fail if Ideogram API key returns an error — text content still saves; `cap_generation_runs` records the failure. Campaign still advances to `review`.
- First run of `cap-monthly-generation` cron returns `campaignsCreated: 0` if campaigns were already upserted manually via the UI.
