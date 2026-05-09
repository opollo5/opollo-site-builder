# Governance

Operational rules of the road that don't fit in CLAUDE.md (which has
to stay under ~450 lines for the 10-minute-read target).

| File | Scope |
|---|---|
| [MERGE_RULES.md](MERGE_RULES.md) | Auto-merge mechanics, sub-slice autonomy, auto-continue chain, self-audit detail |
| [PARALLELISM.md](PARALLELISM.md) | Multi-session coordination + bootstrap prompt for second tab |
| [DX_HYGIENE.md](DX_HYGIENE.md) | Pre-commit hooks, commitlint, supply-chain scans (CodeQL, Dependabot, gitleaks, npm audit) |
| [RELEASE_HYGIENE.md](RELEASE_HYGIENE.md) | release-please workflow, changelog mapping |

`CLAUDE.md` keeps the load-bearing summaries (the merge decision tree,
parallelism overview, etc.). When a CLAUDE.md section says "full version
at docs/governance/<X>.md", this directory is where it lands.
