#!/usr/bin/env bash
# scripts/cleanup-scratch.sh — remove leftover wdf-*-test-* scratch directories
# Idempotent: safe to run repeatedly. Reports what was removed.
#
# Context: performance.test.ts historically created scratch dirs in CWD instead
# of os.tmpdir(); that bug is fixed, but old residues remain. This script
# clears them once and is safe to re-run as a CI safety net.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATTERNS=("wdf-atomic-test-*" "wdf-doctor-test-*" "wdf-perf-test-*" ".wdf-doctor-test-*")

removed=0
for pattern in "${PATTERNS[@]}"; do
  while IFS= read -r -d '' dir; do
    rm -rf "$dir"
    removed=$((removed + 1))
  done < <(find "$ROOT" -maxdepth 4 -type d -name "$pattern" -print0 2>/dev/null)
done

if [ "$removed" -eq 0 ]; then
  echo "[cleanup-scratch] No scratch directories found. Clean."
else
  echo "[cleanup-scratch] Removed $removed scratch directories."
fi
