# Claude Code Skills

External skills installed into `.claude/skills/` for use by Claude Code in this project. See the [Agent Skills Open Standard](https://github.com/anthropics/skills) for the SKILL.md format.

## Installed skills

| Skill | Source | Relevance | Trust |
|---|---|---|---|
| `supabase` | [supabase/agent-skills](https://github.com/supabase/agent-skills) (`skills/supabase`) | High — primary data layer (Auth, RLS, migrations, MCP, CLI). Covers the security traps `CLAUDE.md` cares about: `user_metadata` in auth claims, view security, UPDATE-needs-SELECT-policy, storage upsert grants. | High — official Supabase, MIT license |
| `supabase-postgres-best-practices` | [supabase/agent-skills](https://github.com/supabase/agent-skills) (`skills/supabase-postgres-best-practices`) | High — directly supports the `EXPLAIN ANALYZE for hot-path queries` rule in `CLAUDE.md`. 30+ rules across query, conn, security, schema, lock, data, monitor, advanced. | High — official Supabase, MIT license |

## Install scope and what was deliberately excluded

Only the two skill subtrees were copied. The following from the source repo were intentionally **not** installed:

- `.mcp.json` at the repo root — would auto-register the Supabase docs MCP server (`https://mcp.supabase.com/mcp?features=docs`). Adopt separately if/when we want it.
- `package.json`, `pnpm-lock.yaml`, `test/`, `vitest.config.ts` — build/test scaffolding for the upstream skills repo, not needed here.
- `.github/`, release-please config — upstream CI.

## Security scan summary (2026-04-26)

Pattern scan across all 38 installed `.md` files:

- `eval(`, `exec(`, `child_process`, `spawn(`, `subprocess`, `os.system`: **0 matches**
- `fetch(`, `XMLHttpRequest`, `fs.unlink`/`rm`/`writeFileSync`: **0 matches**
- `--no-verify`, `chmod +x`, `sudo`: **0 matches**
- `curl`/`wget`: **1 match** — an illustrative troubleshooting one-liner in `supabase/SKILL.md` ("check if the MCP server is reachable"). Not auto-executed.

External URLs referenced are all under `supabase.com`, `github.com/supabase`, `postgresql.org`, `mcp.supabase.com`. No third-party trackers, shorteners, or unknown hosts.

These skills do not perform outbound network calls automatically — they are markdown guidance read by the agent. If an agent chooses to run a documented `curl` or `gh` command from the skill, that's a normal tool invocation subject to existing permission prompts.

## Trust scoring

- **High**: official organization repo, permissive license, source verifiable on GitHub.
- **Moderate**: community-authored, popular, but not vendor-blessed.
- **Low**: unknown author or unverifiable provenance — do not install.

## Re-running the security scan

```bash
# From repo root
grep -rnE '\beval\s*\(|\bexec\s*\(|child_process|spawn\s*\(|subprocess|os\.system|require\([^)]*http|fetch\s*\(|XMLHttpRequest|fs\.(unlink|rm|rmSync|writeFileSync)|--no-verify|chmod\s+\+x|sudo\s' .claude/skills/
grep -rnE 'curl\s|wget\s' .claude/skills/
grep -rohE 'https?://[a-zA-Z0-9./?=_%:-]+' .claude/skills/ | sort -u
```

## Updating

These are pinned by virtue of being copied (no auto-update). To refresh:

```bash
git clone --depth 1 https://github.com/supabase/agent-skills.git /tmp/agent-skills-src
rm -rf .claude/skills/supabase .claude/skills/supabase-postgres-best-practices
cp -r /tmp/agent-skills-src/skills/supabase .claude/skills/supabase
cp -r /tmp/agent-skills-src/skills/supabase-postgres-best-practices .claude/skills/supabase-postgres-best-practices
```

Re-run the security scan above before relying on the refreshed copy.

## Considered and skipped (2026-04-26)

| Source | Reason skipped |
|---|---|
| `WordPress/wordpress` | Mirror of WP core source; no `skills/` directory or SKILL.md files exist. |
| `stripe/stripe` | Repo does not exist. Stripe publishes language SDKs (`stripe-node`, `stripe-go`, etc.) but no agent-skills repo found. Codebase has no Stripe dependency. |
| `better-auth/better-auth` | Auth library, not a skills repo. Codebase uses Supabase Auth, so not relevant. |
| `obra/superpowers` | Community skills (TDD, debugging, plans, etc.). Overlaps with existing `docs/patterns/` and `docs/RULES.md`. Re-evaluate post-revenue. |
