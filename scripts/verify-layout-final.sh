#!/usr/bin/env bash
# verify-layout-final.sh — runs the layout audit and asserts all counts are 0.
# Exit 0 = layout refactor complete; exit 1 = violations remain.
set -euo pipefail

AFTER_FILE="LAYOUT_AUDIT_AFTER.md"
bash scripts/layout-audit.sh "$AFTER_FILE"

echo ""
echo "--- Checking for remaining violations ---"

FAIL=0

check_section() {
  local name="$1"
  local count
  count=$(grep -A4 "^## $name" "$AFTER_FILE" | grep "Match count:" | grep -oE '[0-9]+')
  if [ -z "$count" ]; then
    echo "WARN: section '$name' not found in $AFTER_FILE"
    return
  fi
  if [ "$count" -gt 0 ]; then
    echo "FAIL: $name — $count match(es) remain"
    FAIL=1
  else
    echo "OK:   $name — clean"
  fi
}

check_section "Bug A: per-page max-w containers"
check_section "Bug B: bare H1s (raw text-size, not PageHeader.Title)"
check_section "Bug D: hex colours in JSX"
check_section "Bug G: NavShellClient prop usage"

# Bugs C/E/F were already 0 at BEFORE baseline; verify they stay clean.
check_section "Bug C: breadcrumb in mt-5 wrapper (below H1)"
check_section "Bug E: rounded-full inline buttons (likely raw <button>)"
check_section "Bug F: per-page header.mb-8 blocks"

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "verify-layout-final: all checks pass ✓"
  exit 0
else
  echo "verify-layout-final: failures above — refactor is NOT complete"
  exit 1
fi
