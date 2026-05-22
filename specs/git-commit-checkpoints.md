# Git Commit Checkpoint Specification

**Version:** 1.0.0
**Applies to:** Phase 4 (Implementation) — all AUTO-CONTINUE sub-workflows (4.4, 4.10)
**Purpose:** Define mandatory git commit checkpoints that every story agent must follow during implementation.

## Principles

1. **Every commit is a recovery point** — If a story agent crashes after any checkpoint, the next session can resume from that commit.
2. **Commit messages are structured** — They include story ID, status, and key metrics for traceability.
3. **Minimum 3 commits per story** — Implementation → Tests → CODE_ACCEPTED.
4. **Scope-isolated** — Each commit only includes files within the story's `scope_write`.

## Checkpoint Commit Table

| # | Checkpoint | Trigger | Commit Type | Files Included |
|---|------------|---------|-------------|----------------|
| 1 | Implementation Complete | Step 4c (BE) / 4c (FE) — all code written, all UI states handled | `feat` | Source files only (validators, services, controllers, routes, page components) |
| 2 | Tests Passing | Step 4d (BE) / 4e+4f (FE) — all unit + integration tests pass | `test` | Source + test files |
| 3 | CODE_ACCEPTED | Step 4i2 (BE) / 4j (FE) — all CA checks pass, handoff docs generated | `accept` | All changed files (source, test, docs) |

### Commit Message Format

All commits MUST follow this format:

```
{type}({story_id}): {short_description}

{optional_body}

Status: {IMPLEMENTED|TESTED|CODE_ACCEPTED}
```

#### Checkpoint 1 — Implementation (`feat`)

```
feat(S-3.2): implement Auth Endpoints

Scope: src/modules/auth/, src/middleware/auth.ts
Endpoints: POST /api/auth/login, POST /api/auth/register, POST /api/auth/refresh
Status: IMPLEMENTED
```

**Checkpoint 1 Pre-Commit Scope Audit (V3.6):** Before the Checkpoint 1 commit, verify EVERY staged file is within scope_write. This closes the 4c→4i2 blind spot where uncommitted dirty files escape CA-05 detection.

```bash
# Pre-commit scope audit — runs at EVERY checkpoint (1, 2, and 3)
SCOPE_FILES=$(git diff --cached --name-only scope-freeze/pre-implementation..HEAD)
VIOLATIONS=0
for f in $SCOPE_FILES; do
  matched=0
  for p in ${scope_write}; do
    [[ $f = "$p" || $f = "$p"/* ]] && { matched=1; break; }
  done
  [ $matched = 0 ] && { echo "VIOLATION: $f"; VIOLATIONS=$((VIOLATIONS+1)); }
done
[ $VIOLATIONS = 0 ] || { echo "SCOPE AUDIT FAILED — $VIOLATIONS file(s) outside scope_write"; exit 1; }
```

#### Checkpoint 2 — Tests (`test`)

```
test(S-3.2): tests passing for Auth Endpoints

Coverage: 87.5%
Tests: 8 unit, 4 integration
Status: TESTED
```

#### Checkpoint 3 — CODE_ACCEPTED (`accept`)

```
accept(S-3.2): CODE_ACCEPTED — Auth Endpoints

Review: PASSED
Coverage: 87.5%
Type check: PASSED
Lint: PASSED
Scope audit: 0 violations
Handoff docs: _story-output/S-3.2/{self-check.md, handoff.md}
Status: CODE_ACCEPTED → queued for merge
```

## Enforcement

- **SCOPE ISOLATION**: Before each commit, verify `git diff --cached --name-only` is within `scope_write`:
  ```bash
  set -euo pipefail
  SCOPE_FILES=$(git diff --cached --name-only)
  for f in $SCOPE_FILES; do
    matched=0
    for p in ${scope_write}; do
      # 目录边界匹配：精确匹配 或 路径前缀+目录分隔符
      [[ $f = "$p" || $f = "$p"/* ]] && { matched=1; break; }
    done
    if [ $matched = 0 ]; then
      echo "ERROR: $f is outside scope_write"
    fi
  done
  ```
  Note: `${scope_write}` is a scalar (space-separated paths), not a bash array. All scripts across the workflow use this unified format.

- **MINIMUM COUNT**: If fewer than 3 commits exist on the story branch before merge, the orchestrator must add a merge-preparation commit with full status.

## Recovery

If a story agent crashes:
1. Orchestrator reads the last commit message on the story branch
2. The `Status:` line tells the orchestrator where to resume:
   - `IMPLEMENTED` → resume from test writing
   - `TESTED` → resume from CODE ACCEPTANCE checks
   - `CODE_ACCEPTED` → should not happen (story already done)
