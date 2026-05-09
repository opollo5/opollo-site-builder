# Incident — `<integration>` — `<YYYY-MM-DDThhmm>`

> Auto-generated. Edit only the **Findings** and **Resolution** sections.
> Keep everything above them as raw evidence.

---

## Identity

- **Branch**: `<branch name>`
- **Triggering deploy SHA**: `<sha>`
- **Production HEAD at incident time**: `<sha>`
- **Mismatched?**: `<yes / no>` *(yes = the deployed bundle did not match source — same failure mode as the bundle.social May 2026 outage)*
- **Reporter**: `<user / monitor name>`
- **Severity**: `<P0 / P1 / P2>`
- **Detected by**: `<smoke / drift / user / log alert>`

## Live diagnostic protocol — six-step evidence

Per `CLAUDE.md`, all six must be captured before claiming "third-party
issue". An empty step here is a finding in itself.

1. **Probe output** — `scripts/probes/<integration>.ts`:

   ```
   <paste markdown probe output>
   ```

2. **Deployed bundle ↔ source check** — output of `vercel inspect <deploy-url>`
   plus `git log <sha>` confirming the commit content:

   ```
   <paste>
   ```

3. **Contract test result against the live deployed environment** —
   `npm run test:contract` run with `PROBE_BASE_URL=<production>`:

   ```
   <paste>
   ```

4. **Network trace** — full headers, status codes, response bodies:

   ```
   <paste curl -v / Playwright trace export>
   ```

5. **Decoded tokens** — for any JWT / signed payload in the response:

   ```
   <jwt.io decode or scripts/decode-jwt.ts output>
   ```

6. **Summary of expected vs actual** — what we sent, what we got back,
   what should have happened:

   ```
   sent:    <payload>
   got:     <response>
   expected:<expected response>
   diff:    <delta>
   ```

## Findings

`<one paragraph: root cause, by what mechanism>`

## Resolution

- **Fix PR**: `#<n>`
- **Pinned regression test**: `tests/regressions/<slug>.test.ts`
- **CLAUDE.md / RUNBOOK update**: `<link>` *(load-bearing per CLAUDE.md)*
- **Time to detection**: `<minutes>`
- **Time to resolution**: `<hours>`

## Ready-to-paste prompt for Claude Code on the hotfix branch

```
You are working on hotfix/<slug>-<timestamp>. The full incident
evidence is at docs/incidents/<this file>. Read that file first,
then read tests/regressions/<slug>.test.ts (which currently fails
red), then write the minimal fix to make it green. Open a PR
back into main, attach the incident doc link in the PR body,
and follow the standard auto-merge rules in CLAUDE.md.
```
