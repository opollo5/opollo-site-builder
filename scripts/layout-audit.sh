#!/usr/bin/env bash
set -euo pipefail

OUTPUT_FILE="${1:-LAYOUT_AUDIT_BEFORE.md}"
SHA=$(git rev-parse HEAD)

{
  echo "# Layout Audit"
  echo ""
  echo "- Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- Repo SHA: $SHA"
  echo "- Output file: $OUTPUT_FILE"
  echo ""
} > "$OUTPUT_FILE"

# grep_rn: portable ripgrep-compatible search using grep -rEn
# Usage: grep_rn PATTERN DIR [DIR...]
grep_rn() {
  local pattern="$1"; shift
  grep -rEn --include="*.tsx" --include="*.ts" --include="*.css" \
    "$pattern" "$@" 2>/dev/null || true
}

audit_section() {
  local name="$1"
  local pattern="$2"
  local scope="${3:-app/ components/}"

  echo "## $name" >> "$OUTPUT_FILE"
  local matches
  # shellcheck disable=SC2086
  matches=$(grep_rn "$pattern" $scope)
  local count
  if [ -z "$matches" ]; then
    count=0
  else
    count=$(echo "$matches" | grep -c .)
  fi
  local hash
  hash=$(echo -n "$matches" | sha256sum | cut -c1-16)

  echo "" >> "$OUTPUT_FILE"
  echo "- Pattern: \`$pattern\`" >> "$OUTPUT_FILE"
  echo "- Scope: \`$scope\`" >> "$OUTPUT_FILE"
  echo "- Match count: $count" >> "$OUTPUT_FILE"
  echo "- Match hash: \`$hash\`" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"
  echo '```' >> "$OUTPUT_FILE"
  if [ "$count" -gt 0 ]; then
    echo "$matches" | head -25 >> "$OUTPUT_FILE"
    if [ "$count" -gt 25 ]; then
      echo "... (+$((count - 25)) more)" >> "$OUTPUT_FILE"
    fi
  else
    echo "(none)" >> "$OUTPUT_FILE"
  fi
  echo '```' >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"
}

audit_section "Bug A: per-page max-w containers" 'mx-auto.*max-w-(5xl|6xl|7xl)' 'app/'
audit_section "Bug B: bare H1s (raw text-size, not PageHeader.Title)" '<h1[^>]*className="text-(2xl|xl|3xl|4xl|5xl)' 'app/ components/'
audit_section "Bug C: breadcrumb in mt-5 wrapper (below H1)" '"mt-5"' 'app/'
# Bug D excludes components/composer/live-preview-card.tsx — social platform brand hex (LinkedIn, Facebook, Google)
audit_section "Bug D: hex colours in JSX" '(bg|text|border|fill|stroke)-\[#[0-9a-fA-F]' 'app/ components/nav/ components/ui/ components/social/ components/optimiser/ components/admin/'
audit_section "Bug E: rounded-full inline buttons (likely raw <button>)" '<button[^>]*className="[^"]*rounded-' 'app/'
audit_section "Bug F: per-page header.mb-8 blocks" '<header className="mb-8"' 'app/'
audit_section "Bug G: NavShellClient prop usage" 'contentMaxWidth|contentPadding' 'app/ components/'
# Bug H: <H1> typography component used as page heading instead of PageHeader.Title
audit_section "Bug H: typography H1 component used instead of PageHeader.Title" '<H1[\s>]' 'app/ components/'
# Bug I: <PageShell> inside NavShell creates double max-w-7xl container
audit_section "Bug I: PageShell double container (PageShell inside NavShell)" '<PageShell' 'app/'

echo "## Summary" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "Re-run \`bash scripts/layout-audit.sh <filename>\` to regenerate." >> "$OUTPUT_FILE"
echo "Hashes are SHA-256 of full match output, first 16 chars." >> "$OUTPUT_FILE"
echo "Any reviewer can independently verify by re-running the script at the same commit." >> "$OUTPUT_FILE"

echo "Audit written to $OUTPUT_FILE"
