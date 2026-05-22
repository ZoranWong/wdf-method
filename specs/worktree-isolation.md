# Worktree Isolation + Git Branch Control

**Version:** 3.2.0
**Applies to:** Phase 4 (Implementation)
**Reference:** One Story = One Agent = One Worktree = One Clean Context

## Core Design: Per-Story Worktree

```
/workspace/                                          # Main worktree
├── main 分支
├── sprint-status.yaml                               # Orchestrator writes only
├── _bmad-output/web-dev-flow/
│   └── stories/
│       ├── S-3.1-status.yaml                        # Per-story status (agent writes)
│       └── S-3.2-status.yaml
└── src/                                             # Baseline code (read-only to agents)

.claude/worktrees/story/S-3.1-be/                    # Story S-3.1 worktree
├── story/S-3.1-be 分支（从 main 创建）
├── 该 story 的代码变更（scope_write 范围内）
└── _bmad-output/web-dev-flow/stories/S-3.1-status.yaml  ← agent 在此写入

.claude/worktrees/story/S-1.1-fe/                    # Story S-1.1 worktree (parallel)
├── story/S-1.1-fe 分支
└── ...
```

## Git Control Flow

### Phase 4.1 — Sprint Planning: Create Baseline

```bash
# 1. Scope freeze baseline tag
git tag -a scope-freeze/pre-implementation -m "Scope freeze before Phase 4"

# 2. Initialize story status entries in sprint-status.yaml
#    All stories: NOT_STARTED
```

### Phase 4.4 / 4.10 — Per-Story Git Workflow

```bash
# ═══════ Story Start (Defensive) ═══════

# 0. Pre-flight checks
# Verify scope freeze tag exists
git rev-parse scope-freeze/pre-implementation >/dev/null 2>&1 || {
  echo "ERROR: scope-freeze/pre-implementation tag not found. Run Phase 4.1 first."
  exit 1
}

# Clean up stale worktree/branch from previous failed run
WORKTREE_DIR=".claude/worktrees/story/{story_id}-{track}"
BRANCH_NAME="story/{story_id}-{track}"

if [ -d "$WORKTREE_DIR" ]; then
  echo "Cleaning up stale worktree: $WORKTREE_DIR"
  git worktree remove "$WORKTREE_DIR" --force 2>/dev/null || true
fi

if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  echo "Removing stale branch: $BRANCH_NAME"
  git branch -D "$BRANCH_NAME" 2>/dev/null || true
fi

# 1. Create story branch + worktree
git worktree add -b "$BRANCH_NAME" "$WORKTREE_DIR" main

cd .claude/worktrees/story/{story_id}-{track}

# Initialize per-story status
cat > _bmad-output/web-dev-flow/stories/{story_id}-status.yaml <<EOF
story_id: "{story_id}"
title: "{title}"
track: "{track}"
status: "NOT_STARTED"
started_at: "{ISO_TIMESTAMP}"
EOF

# ═══════ Story Implementation ═══════
# 4a-4b: Story Ready Gate → status: IN_PROGRESS

# 4c: Implementation → Checkpoint Commit 1
git add {scope_write files}
git commit -m "feat({story_id}): implement {story_title} — IMPLEMENTED

Scope: {scope_write}
Status: IMPLEMENTED"

# 4d-4e: Tests + Validation → Checkpoint Commit 2
git add .
git commit -m "test({story_id}): tests passing for {story_title} — TESTED

Tests: {N} pass, 0 fail
Coverage: {percent}%
Status: TESTED"

# 4f-4h: Handoff + CODE ACCEPTANCE → Checkpoint Commit 3
git add _bmad-output/
git commit -m "accept({story_id}): CODE_ACCEPTED — {story_title}

Review: PASSED
Coverage: {percent}%
Type check: PASSED
Lint: PASSED
Scope audit: 0 violations
Status: CODE_ACCEPTED → queued for merge"

# ═══════ Story Merge (Atomic — V3.6) ═══════
# Orchestrator merges (sequential, one at a time)
# Uses --no-commit + integration check gate → commit OR abort
# This prevents partial merge state on main branch

cd /workspace

# Enqueue: add per-item file to merge-queue with short lock
MERGE_ORDER=$(grep "next_merge_order" merge-queue/queue.yaml | awk '{print $2}')
mkdir merge-queue/.lock 2>/dev/null  # ~100ms lock
touch "merge-queue/items/$(printf '%04d' $MERGE_ORDER)-{story_id_slug}-{track}.yaml"
rmdir merge-queue/.lock               # release lock

# Write item content (NO LOCK — this file is ours)
cat > "merge-queue/items/$(printf '%04d' $MERGE_ORDER)-{story_id_slug}-{track}.yaml" <<EOF
queue_item:
  queue_item_id: "QUEUE-$(printf '%04d' $MERGE_ORDER)-{story_id_slug}-{track}"
  story_id: "{story_id}"
  track: "{track}"
  branch: "story/{story_id}-{track}"
  merge_order: $MERGE_ORDER
  depends_on: [{dep_story_ids}]
  integration_checks: ["npm run test", "npm run build"]
  merge_status: "queued"
EOF

# Update queue metadata (NO LOCK — single writer)
# Increment next_merge_order += 10 in merge-queue/queue.yaml

# Phase 4.13 processes merge-queue/items/ in dependency order
# ═══════ ATOMIC MERGE PROTOCOL (V3.6) ═══════
# Step 1: Merge without committing
git merge story/{story_id}-{track} --no-commit --no-ff

# Step 2: Run integration checks BEFORE committing
# (from item.integration_checks or customize.toml defaults)
for check in ${integration_checks}; do
  if ! eval "$check"; then
    echo "INTEGRATION CHECK FAILED: $check"
    # Step 3a: Abort — no partial merge state on main
    git merge --abort
    # Mark item as failed
    # merge_status: "failed", merge_failed_reason: "integration check: $check"
    exit 1
  fi
done

# Step 3b: All checks passed — commit the merge
git commit -m "Merge {story_id}: {story_title} — MERGED

Scope: {scope_write}
Tests: {N} pass, 0 fail, coverage {percent}%
Review: PASSED
Scope audit: 0 violations
Integration checks: all passed
Merge gate: MG-01~MG-09 all passed"

# Update item: merge_status = "merged"
# Cleanup
git worktree remove .claude/worktrees/story/{story_id}-{track} --force
git branch -d story/{story_id}-{track}
```

## Write Permissions

| File | Main Worktree | Story Worktree |
|------|:---:|:---:|
| `sprint-status.yaml` | **WRITE** (merge only) | Read-only |
| `stories/{story_id}-status.yaml` | Read-only (post-merge) | **WRITE** (agent) |
| `src/` (story's scope) | Read-only | **WRITE** |
| `src/` (other story's scope) | Read-only | Read-only |

**Each file has exactly one writer. No parallel write conflicts.**

## Cross-Story Dependency Detection

```
1. FE Story S-2.1 depends on BE Story S-3.2
2. Orchestrator checks sprint-status.yaml before dispatching S-2.1:
   → S-3.2.status != "CODE_ACCEPTED" AND != "MERGED"
3. S-2.1 marked BLOCKED_BY_DEPENDENCY → skipped
4. After S-3.2 completes → S-2.1 unblocked → dispatched
```

## Rollback Strategy

### Story Revert
```bash
# Revert a merged story
git revert -m 1 <merge-commit-hash>

# Update sprint-status: story.status = REVERTED
```

### Impact Analysis on Revert
1. Check all stories whose `depends_on` includes the reverted story
2. Mark them BLOCKED_BY_DEPENDENCY
3. Re-run cross-story validation

## Commit Convention

Minimum 3 commits per story:
```
1. feat({story_id}): {title} — IMPLEMENTED
2. test({story_id}): {title} — TESTED
3. accept({story_id}): {story_title} — CODE_ACCEPTED
```

Merge commit:
```
Merge {story_id}: {title} — MERGED

Scope: {scope_write}
Tests: {N} pass, 0 fail, coverage {percent}%
Review: PASSED
Scope audit: 0 violations
Merge gate: MG-01✓ MG-02✓ MG-03✓ MG-04✓ MG-05✓ MG-06✓ MG-07✓ MG-08✓ MG-09✓
```

## CA-05 Scope Audit (Fixed — No Subshell Bug)

```bash
# Uses for-loop (no subshell) to avoid variable scoping issues
# Pre-check: scope_write must be defined and non-empty
if [ -z "${scope_write}" ]; then
  echo "ERROR: scope_write is empty — cannot verify scope boundary"
  exit 1
fi
SCOPE_FILES=$(git diff --name-only scope-freeze/pre-implementation..HEAD)
VIOLATIONS=0
for f in $SCOPE_FILES; do
  matched=0
  for p in ${scope_write}; do
    # 目录边界匹配：精确匹配 或 路径前缀+目录分隔符
    # 注意: "$p"/* 中的 "/" 是字面量，确保 src/auth 不会匹配 src/foobar.ts
    # bash [[ ]] 中 * 是 glob 模式，但 / 必须是字面匹配
    [[ $f = "$p" || $f = "$p"/* ]] && { matched=1; break; }
  done
  if [ $matched = 0 ]; then
    echo "VIOLATION: $f"
    VIOLATIONS=$((VIOLATIONS+1))
  fi
done
[ $VIOLATIONS = 0 ]
```
