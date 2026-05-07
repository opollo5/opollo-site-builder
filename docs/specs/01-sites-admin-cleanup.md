# Spec 01 — Sites admin page cleanup

**Owner:** Steven
**Audience:** Claude Code
**Mode:** Autonomous build. Do not stop to ask questions. Every decision is locked in this spec. The only acceptable reasons to pause are: (a) a required environment variable or credential is genuinely missing from the deployment, or (b) you discover a contradiction between this spec and `docs/ARCHITECTURE.md` that would cause real harm if ignored. Cosmetic ambiguity, naming preferences, ordering of details, "should I add X" — all decided here.

**Estimated PRs:** 1
**Blocks:** UAT readiness
**Depends on:** Nothing

---

## 0. Read this first

Read `docs/ARCHITECTURE.md` sections 3 (auth), 6 (data layer), 13 (frontend conventions), and 18 (refactor boundaries) before writing code.

Background facts that drove the design (do not re-litigate):

- `pending_pairing` is just the default value of the `site_status` enum. It means "no WP credentials saved yet" — nothing more. There is no pairing protocol; the WP-plugin pairing flow was abandoned in migration `0014_drop_dead_schema.sql` ("dead; product moved past").
- The transition `pending_pairing → active` fires only inside `lib/sites.ts:576-582` when `updateSiteCredentials()` saves valid credentials. There is no webhook, no cron, no health-check.
- "Clone DS (soon)" exists once in the entire repo, in `components/SiteActionsMenu.tsx:119-126`, as a disabled button. No controller, no plan doc. Orphaned UI.
- `sites.company_id` is real (migration `0104`), nullable FK to `platform_companies`, resolved in `lib/sites.ts:219-233`.

This spec does not add Refresh / Re-pair / View Log actions — they would have nothing to operate on.

---

## 1. Status label rename

In `components/ui/status-pill.tsx` STATUS_MAP, change the display label for `pending_pairing` from `"Pending Pairing"` to `"Not Connected"`.

Database enum value stays `pending_pairing`. Do not migrate the enum.

After the change, run `grep -ri "pending pairing"` across the entire repo. For every hit outside `status-pill.tsx`, replace the hardcoded string with the centralized status-pill rendering. Include the list of files modified in the PR description.

---

## 2. Inline "Connect →" link on Not Connected rows

In `components/SitesTable.tsx`, when a row's `status === 'pending_pairing'`, render a small text link inside the Status cell, immediately after the status pill, with label `"Connect →"`.

Link target: `/admin/sites/[id]/edit?focus=credentials`. The edit page must read this query param and, on mount:

1. If the credentials section is inside an accordion or collapsible: open it programmatically.
2. Wait one animation frame (`requestAnimationFrame`) for layout to settle.
3. Scroll the credentials section into view (`scrollIntoView({ behavior: 'smooth', block: 'start' })`).
4. Move keyboard focus to the first credential input field (the WP username field) — accessibility requirement; keyboard users get the same affordance as mouse users.

If the credentials section does not currently have an anchor, a section wrapper, or a stable id: add `id="credentials-section"` to its outermost wrapping element. Use that as the scroll target. Implement the param read + focus behavior in a `useEffect` reading `searchParams.get('focus')` on mount.

Style: same `text-sm` (15px) as the existing helper text. Blue link color matching existing link style elsewhere in the table. Underline on hover.

For all other statuses, render the status pill alone.

---

## 3. Dropdown menu in `components/SiteActionsMenu.tsx`

Final menu items, top to bottom:

1. **Edit**
2. **Test Connection**
3. *(divider)*
4. **Archive**
5. **Delete**

Remove the "Clone DS (soon)" disabled button entirely. Delete the JSX block at lines 119-126. No comment placeholder.

### 3.1 Test Connection

New menu item. Calls `POST /api/sites/[id]/test-connection`.

If a route at that exact path does not already exist, create it. The handler reads the site's encrypted credentials via existing `lib/sites.ts` helpers, runs the same WP REST connectivity test that the edit page's "Test connection" button currently runs.

**Locate the existing test-connection logic and extract it to `lib/sites.ts` as a single shared function `testSiteConnection(siteId): Promise<{ ok: boolean, errorCode?: string }>`.** Both the route handler AND the edit page client component MUST consume this exact same function. The shared helper owns:

- HTTP timeout (set to 8s, matching the existing fetch pattern)
- Retry logic (none — single attempt)
- WP REST URL normalization (trailing slash handling, `/wp-json/` path detection)
- Credential decryption via existing `lib/encryption.ts` per ARCH §8
- Error categorization mapping HTTP/WP REST errors to `error-translations.ts` codes

Callers (the route, the edit page) do NO additional normalization, retry, or timeout wrapping. They invoke the helper and surface the result. This prevents subtle divergence between surfaces.

Returns `{ ok: boolean, errorCode?: string }`.

UI behavior:

- Disabled with spinner while running.
- On `ok: true`: toast success with copy `"Connection healthy"` via `useToast()`.
- On `ok: false`: toast with the user-facing message from `lib/error-translations.ts` for the returned error code. If the error code is unknown to error-translations, add a fallback entry: `"Could not reach WordPress. Check the site URL and credentials."`.
- No confirm modal.
- Available regardless of `status`.

On success, write `last_connection_test_at = now()` to the sites row (see §6).

### 3.2 Delete

New menu item. Hard delete. Hidden for `admin` and `user` roles — only `super_admin` sees it. Use the existing role check helper in `lib/admin-gate.ts` (find by greping for `super_admin` in that file).

UI behavior:

- Opens `ConfirmActionModal` (the same component Archive uses).
- Title: `"Delete site permanently?"`.
- Body: `"Permanently delete {site_name}? This removes the site, all its briefs, posts, and credentials. This cannot be undone."`.
- Confirm button label: `"Delete permanently"`. Red/destructive styling consistent with existing destructive actions.
- Cancel returns to the site list with no change.

Route: `DELETE /api/sites/[id]/purge`. New file. Distinct from the existing `DELETE /api/sites/[id]` (the archive route — leave it alone).

Route gating: use `requireAdminForApi({ requireSuperAdmin: true })` or whichever helper in `lib/admin-api-gate.ts` enforces super_admin. Locate by reading `lib/admin-api-gate.ts`.

Route behavior, in order:

1. Open a transaction via `lib/db-direct.ts:requireDbConfig()` per ARCH §12.
2. Build the **full recursive dependency graph** of rows linked to the target site. Direct dependencies are tables with FKs referencing `sites.id`. Indirect dependencies are tables with FKs referencing rows in those tables, transitively. Walk the graph until no new tables are added. The walk uses `information_schema.referential_constraints` joined to `information_schema.key_column_usage` to enumerate FKs at runtime. Log the resolved table list with depth in dependency order. If the direct list is empty, abort with 500 — something's wrong with DB metadata.
3. Find the existing audit log table by greping for inserts to tables matching `audit_log`, `admin_audit`, `audit_events`, or similar. Insert one audit row recording: actor user id, action `'site_purged'`, target site id, target site name, timestamp. **The audit insert lives inside the same transaction intentionally** — if the delete fails and rolls back, the audit row also rolls back. This is desired: an audit record of an attempted-but-failed purge would imply the row is gone when it isn't. Failed purge attempts are server-logged via the structured logger (not audit-logged).
4. Delete dependent rows in reverse dependency order — deepest leaves first, walking back up. For each table, log the row count before delete and the count deleted. Manual cascade in code regardless of whether `ON DELETE CASCADE` is set on individual FKs (avoids assuming schema state).
5. Commit. Return 200.

On failure of any step: rollback, return 500 with the user-facing message `"Could not delete site. Contact engineering."`. The server-side log MUST include: the failing table name, the failing FK constraint name, and the dependency depth at which it failed. This is the diagnostic that saves hours when an indirect dependency surfaces.

Tests:

- `lib/__tests__/sites-purge.test.ts` — vitest covering the recursive cascade walk against a seeded site with one brief, one post, one credential row, and at least one indirect dependency (e.g., a `brief_pages` row referencing `briefs`, where `briefs` references `sites`)
- `lib/__tests__/sites-purge-permissions.test.ts` — vitest covering: admin role gets 403, user role gets 403, super_admin gets 200
- `e2e/sites-admin-delete.spec.ts` — Playwright happy path: super_admin user → row dropdown → Delete → confirm → row gone from list
- `e2e/sites-admin-table.spec.ts` — Playwright covering: sort param toggle (asc → desc → cleared), Connect link visible only on `pending_pairing` rows, filter chip preserves sort param, sort header preserves filter param, sort param survives filter chip change

---

## 4. Sort order

Default sort in `components/SitesTable.tsx`:

1. `status` ascending — but **not** lexical. Define an explicit ordering map:

   ```ts
   const STATUS_SORT_ORDER: Record<SiteStatus, number> = {
     active: 0,
     pending_pairing: 1,
     paused: 2,
     removed: 3,
   };
   ```

   Sort by `STATUS_SORT_ORDER[row.status]`. Adding a new status enum value in the future requires a corresponding entry here — make this an audit:static check if the codebase pattern supports it; otherwise lock with a TS exhaustiveness check on the `Record<SiteStatus, number>` type.
2. `last_connection_test_at` descending within each status group, nulls last
3. `name` ascending as tiebreaker

Sortable columns by header click: `name`, `company_name`, `wp_url`, `status`, `last_connection_test_at`. URL search params drive sort state: `?sort=name&dir=asc`. Server-side sort.

Click a header once: sort by that column ascending. Click again: descending. Click a third time: revert to default (clear sort params). Filter chip changes (§5) preserve sort params. Sort header changes preserve filter params. The two are orthogonal in URL state.

Show the existing chevron icon (Lucide, 20px floor) next to the active sort column indicating direction.

---

## 5. Filter chip row

Above the table, render chips in this order: **All · Active · Not Connected · Paused · Archived**.

URL search param: `?status=active`, `?status=pending_pairing`, `?status=paused`, `?status=removed`. No param means All.

Default behavior (no param): show rows where `status != 'removed'`. Active and Not Connected rows visible; Archived rows hidden.

Active chip styling: filled background (use the existing pink `#FF03A5` brand color from tokens.css if available, otherwise the existing primary button background), white text. Inactive chips: bordered, muted text.

Server-side filter (read in the page component, pass to query). Do not fetch all and filter client-side.

---

## 6. New column: `sites.last_connection_test_at`

Migration: append-only, next sequential number. Locate the highest existing migration under `supabase/migrations/`, increment by 1. File name: `0NNN_sites_last_connection_test_at.sql`.

```sql
ALTER TABLE sites ADD COLUMN last_connection_test_at timestamptz;

COMMENT ON COLUMN sites.last_connection_test_at IS
  'Set to now() each time POST /api/sites/[id]/test-connection returns ok=true.';
```

No backfill. Existing rows have null (correct: "never tested").

In the test-connection route handler (§3.1), after a successful test:

```ts
await supabase
  .from('sites')
  .update({ last_connection_test_at: new Date().toISOString() })
  .eq('id', siteId);
```

In `components/SitesTable.tsx`, render the value as relative time using whatever date library the codebase already uses (locate by greping imports for `date-fns` or `dayjs` or `luxon`). Display format: `"Tested 2h ago"`. Tooltip shows the full ISO timestamp. Null renders as `"Never tested"` in muted text.

This column **replaces** the current "Updated" column. Drop "Updated" from the table.

---

## 7. Files touched

Required edits or additions:

- `components/ui/status-pill.tsx` — STATUS_MAP label rename
- `components/SiteActionsMenu.tsx` — remove Clone DS, add Test Connection, add Delete with super_admin gate, add divider
- `components/SitesTable.tsx` — Connect link, sort, filter, last_connection_test_at column, drop Updated column
- `app/admin/sites/page.tsx` — read sort + filter search params, pass to query
- `app/admin/sites/[id]/edit/page.tsx` (or client component) — read `?focus=credentials` and scroll to credentials section
- `app/api/sites/[id]/test-connection/route.ts` — new or extracted route
- `app/api/sites/[id]/purge/route.ts` — new route, super_admin only
- `lib/sites.ts` — add `purgeSite()`; extract `testSiteConnection()` if currently inline
- `lib/error-translations.ts` — add fallback entry for unknown WP REST errors during connection test
- `supabase/migrations/0NNN_sites_last_connection_test_at.sql` — new migration

Tests:

- `lib/__tests__/sites-purge.test.ts` — recursive cascade walk
- `lib/__tests__/sites-purge-permissions.test.ts` — role-gate matrix
- `e2e/sites-admin-delete.spec.ts` — Playwright Delete happy path
- `e2e/sites-admin-table.spec.ts` — Playwright sort/filter/Connect-link interactions
- Update any existing tests that reference "Pending Pairing" to "Not Connected"

---

## 8. Out of scope

- No Refresh / Re-pair / View Log actions
- No pairing event log table
- No company column changes
- No bulk multi-select actions
- No changes to the New Site button or create flow
- No duplicate-URL guard
- No changes to `/admin/sites/[id]/edit` beyond §2 (credentials anchor + `?focus=credentials` handling)

---

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Hard Delete cascade misses a table | §3.2 step 2 queries `information_schema` at runtime; logged before deletion |
| Audit log table name varies from assumed | §3.2 step 3 says find by grep before writing |
| Test-connection helper extraction breaks edit page | Both surfaces consume the extracted function; vitest test isolates correctness |
| Status label rename misses a hardcoded string | grep across full repo per §1 |
| Sort/filter URL params collide with existing | Audit current search params before adding; new params namespaced under `sort`, `dir`, `status` |
| Migration column name conflicts | grep `last_connection_test_at` before migration |

---

## 10. Sections of `docs/ARCHITECTURE.md` updated after this lands

- §20 Quick-reference table — add row for test-connection and purge routes
- §6.3 Soft delete — add one-line note that super_admin purge is the explicit exception, cross-reference this spec

---

## 11. Acceptance criteria

- [ ] All "Pending Pairing" labels in the operator UI read "Not Connected"
- [ ] No remaining hardcoded "Pending Pairing" strings in the repo
- [ ] Rows with `status='pending_pairing'` show a "Connect →" link in the Status cell
- [ ] Edit page scrolls to credentials when `?focus=credentials` is present
- [ ] Dropdown menu order: Edit, Test Connection, divider, Archive, Delete
- [ ] Test Connection runs and toasts success/failure with translated copy
- [ ] On success, `last_connection_test_at` updates
- [ ] Delete hidden for non-super_admin
- [ ] Delete confirms, audits, cascades, removes the row
- [ ] Clone DS button gone, no references remain
- [ ] `last_connection_test_at` column exists and displays
- [ ] "Updated" column removed
- [ ] Sort works on listed columns via URL params
- [ ] Filter chips work via URL params, server-side
- [ ] Default order: status asc → last_connection_test_at desc nulls last → name asc
- [ ] Default filter hides archived rows
- [ ] Playwright Delete spec passes
- [ ] Vitest cascade test passes
- [ ] `npm run audit:static` passes
- [ ] Existing known-passing tests still pass
