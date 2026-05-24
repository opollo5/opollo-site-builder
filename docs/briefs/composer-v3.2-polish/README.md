# composer-v3.2-polish

UAT feedback from the v3-fixes round, packaged for autonomous Claude Code execution.

## What's in this folder

| File | Purpose |
|---|---|
| `00-MASTER_PROMPT.md` | Paste as initial message to a fresh Claude Code session |
| `calendar-chip-variants.svg` | Visual spec for item 19 — open in browser to view |

The master prompt references one additional file already in the repo: `docs/briefs/composer-v3-fixes/semrush-calendar.png` (your existing Semrush calendar screenshot — Claude Code uses it for layout context on PR-D2).

## How to use

1. Upload this folder to `C:\Users\StevenMorey\dev\opollo-site-builder\docs\briefs\composer-v3.2-polish\`.
2. Commit + push so the files are available in the working tree.
3. Open a fresh Claude Code session in the repo (not a continuation of the previous one — clean context).
4. Paste the contents of `00-MASTER_PROMPT.md` as the first message.
5. Let it run. Expected output: 3 PRs across ~5 hours autonomous work.

## What you'll get

- **PR-D1** (`polish/composer-affordances`) — tooltips, dialog rewrite, header back/close, profile chip overlay sizes, cursor fixes
- **PR-D2** (`feat/composer-calendar-unified`) — single MonthCalendar shared between page + composer pane, content-type chip indicators, edit-mode cell highlight, schedule revalidation
- **PR-D3** (`feat/composer-edit-mode-parity`) — click-routes-by-status, edit-mode header, Convert-to-draft tab, OG metadata rehydrate

## What you'll need to do during the session

Nothing routine. Escalation only:

- Missing env var
- Schema change required (shouldn't happen this round)
- bundle.social API change
- New npm dependency request
- 5h budget exhausted

Otherwise Claude Code runs end-to-end.

## After it ships

Claude Code writes `RETROSPECTIVE.md` to this folder covering all 3 PRs. Skim it for any deviations from the brief and any new backlog items discovered during the work.
