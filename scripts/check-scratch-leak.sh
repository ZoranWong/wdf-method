#!/usr/bin/env bash
# scripts/check-scratch-leak.sh — fail if any wdf-*-test-* scratch dir exists
# in the repo root. Intended to run AFTER vitest in CI to catch tests that
# leak files into CWD instead of using os.tmpdir().
#
# Exit codes:
#   0 — clean
#   1 — leak detected

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATTERNS=("wdf-atomic-test-*" "wdf-doctor-test-*" "wdf-perf-test-*" ".wdf-doctor-test-*")

found=0
for pattern in "${PATTERNS[@]}"; do
  while IFS= read -r -d '' dir; do
    if [ "$found" -eq 0 ]; then
      echo "[check-scratch-leak] FAIL — scratch directories leaked:" >&2
    fi
    echo "  $dir" >&2
    found=$((found + 1))
  done < <(find "$ROOT" -maxdepth 4 -type d -name "$pattern" -print0 2>/dev/null)
done

if [ "$found" -gt 0 ]; then
  echo "" >&2
  echo "A test created files in CWD instead of os.tmpdir(). Fix the offending test." >&2
  echo "Run scripts/cleanup-scratch.sh to clear, then re-run tests." >&2
  exit 1
fi

echo "[check-scratch-leak] OK — no scratch leaks."
exit 0
