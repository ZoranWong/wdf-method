# Merge Queue — File-Based Design (V3.6)

**Version:** 3.6.0
**Principle:** One file per story in queue. Lock ONLY during creation for sequential numbering.

## Directory Structure

```
_bmad-output/web-dev-flow/
└── merge-queue/
    ├── queue.yaml              # Queue metadata: next_seq, total_items, config
    ├── .lock                   # Short-lived lock (only during item creation)
    └── items/
        ├── 0010-S-3.1-be.yaml  # merge_order=10
        ├── 0020-S-4.1-be.yaml  # merge_order=20
        ├── 0030-S-1.1-fe.yaml  # merge_order=30
        └── 0040-S-2.1-fe.yaml  # merge_order=40
```

## queue.yaml

```yaml
# Queue metadata — updated without locking (single writer: Orchestrator)
merge_queue:
  next_merge_order: 50          # Next available sequence number (10, 20, 30...)
  total_enqueued: 4
  total_merged: 0
  total_failed: 0
```

## Per-Item File Format

`items/{merge_order:04d}-{story_id_slug}-{track}.yaml`:

```yaml
# items/0010-S-3.1-be.yaml
queue_item:
  queue_item_id: "QUEUE-0010-S-3.1-be"
  story_id: "S-3.1"
  track: "backend"
  branch: "story/S-3.1-be"
  merge_order: 10
  depends_on: []
  integration_checks:
    - "npm run test"
    - "npm run build"
    - "npm run type-check"
  merge_status: "queued"         # queued | waiting_dependency | merging | merged | failed
  enqueued_at: "2026-05-21T14:00:00Z"
  merged_at: null
  merge_commit: null
  merge_failed_reason: null
```

## Lock Protocol

### On Enqueue (LOCK REQUIRED — ~100ms)

```
1. Acquire lock:
   mkdir merge-queue/.lock 2>/dev/null || exit 1
   # Atomic: only one process succeeds

2. Read queue.yaml → get next_merge_order (e.g., 50)

3. Determine merge_order for new item:
   - If no deps: use next_merge_order
   - If has deps: use max(dep.merge_order) + 10

4. Create empty item file:
   touch merge-queue/items/{merge_order:04d}-{story_id_slug}-{track}.yaml

5. Release lock:
   rmdir merge-queue/.lock

6. Write item content (NO LOCK):
   cat > merge-queue/items/{merge_order:04d}-{story_id_slug}-{track}.yaml <<'EOF'
   ... full item content ...
   EOF

7. Update queue.yaml (NO LOCK, single writer):
   next_merge_order += 10
   total_enqueued += 1
```

### On Merge Complete (NO LOCK — ATOMIC PROTOCOL V3.6)

```
1. Read item file → verify all deps are merged
2. Begin atomic merge:
   a. git merge {branch} --no-commit --no-ff     # Merge without committing
   b. Run integration_checks (from item or customize.toml defaults)
   c. If ALL checks pass → git commit -m "Merge {story_id}: ..."
      Update item: merge_status = "merged", merged_at, merge_commit
   d. If ANY check fails → git merge --abort
      Update item: merge_status = "failed", merge_failed_reason = "check: {name}"
      Downstream items remain waiting_dependency
3. Update queue.yaml: total_merged += 1 (or total_failed += 1)
```

**Atomicity guarantee:** The merge either fully commits (all checks passed) or fully aborts (any check failed). No partial merge state on main branch. No file left in "both modified" conflict state.

### On Item Removal (NO LOCK)

```
1. Delete item file: rm merge-queue/items/{file}
2. Update queue.yaml: total_enqueued -= 1
```

## Lock Contention Analysis

| Operation | Lock Duration | Contention Risk |
|-----------|:---:|------|
| Enqueue (create item) | ~100ms | Near-zero — only touched at story CODE_ACCEPTED |
| Update item status | 0ms | None — per-item files, independent writes |
| Update queue.yaml | 0ms | None — single writer (Orchestrator serial merge) |
| Read queue | 0ms | None — filesystem read |

**Key insight:** Lock is only held for `mkdir` + `touch`, never for file content writing.
This means the critical section is ~100ms max — even with 5 concurrent stories completing,
only one can enqueue at a time, and the wait is negligible.

## Hidden Dependency Detection (V3.6)

Before merging a story, the orchestrator detects **hidden file overlap** — files modified by
both the current story and any other queued (not-yet-merged) story that are NOT in either
story's `scope_write`. These are shared utility files or infrastructure files that stories
depend on implicitly.

### Detection Protocol

```bash
# For each queued story about to merge:
CURRENT_BRANCH="story/{story_id}-{track}"
CURRENT_FILES=$(git diff --name-only scope-freeze/pre-implementation..$CURRENT_BRANCH)

# Check against ALL other queued branches
for other_item in merge-queue/items/*.yaml; do
  OTHER_STATUS=$(grep "merge_status:" "$other_item" | awk '{print $2}')
  [ "$OTHER_STATUS" = "merged" ] || [ "$OTHER_STATUS" = "failed" ] && continue
  
  OTHER_BRANCH=$(grep "branch:" "$other_item" | awk '{print $2}')
  OTHER_FILES=$(git diff --name-only scope-freeze/pre-implementation..$OTHER_BRANCH)
  
  # Find files modified by BOTH branches
  OVERLAP=$(comm -12 <(echo "$CURRENT_FILES" | sort) <(echo "$OTHER_FILES" | sort))
  
  if [ -n "$OVERLAP" ]; then
    # Check if any overlap file is NOT in either story's scope_write
    for f in $OVERLAP; do
      IN_CURRENT_SCOPE=0
      IN_OTHER_SCOPE=0
      for p in ${current_scope_write}; do
        [[ $f = "$p" || $f = "$p"/* ]] && IN_CURRENT_SCOPE=1
      done
      for p in ${other_scope_write}; do
        [[ $f = "$p" || $f = "$p"/* ]] && IN_OTHER_SCOPE=1
      done
      
      if [ $IN_CURRENT_SCOPE = 0 ] && [ $IN_OTHER_SCOPE = 0 ]; then
        echo "HIDDEN DEPENDENCY: $f modified by both $CURRENT_BRANCH and $OTHER_BRANCH"
        echo "  NOT in either story's scope_write — possible merge conflict"
        # Action: flag for review, do NOT block merge (file-level git merge handles it)
        # Record in merge-queue item: hidden_overlaps: [{file, other_story, other_branch}]
      fi
    done
  fi
done
```

### What Happens When Detected

| Scenario | Action |
|----------|--------|
| Overlap file IS in both scope_writes | SRG-05 should have caught this — blocked at dispatch time |
| Overlap file NOT in either scope_write | **Hidden dependency detected** — log warning, proceed with merge (git handles file-level merge) |
| Overlap file IS in one scope_write but NOT the other | **Scope expansion needed** — file CR for the story whose scope doesn't include it |

Hidden overlaps are logged to the merge-queue item as `hidden_overlaps` for post-merge review.
They do NOT block the merge because git's file-level merge algorithm handles them correctly
in most cases. The detection is for audit trail and post-merge code review targeting.

## Processing Order

When Phase 4.13 processes the queue:

```bash
# Sort by merge_order ASC
for item_file in $(ls merge-queue/items/ | sort); do
  # Read item
  item=$(cat "merge-queue/items/$item_file")
  
  # Check status
  status=$(echo "$item" | grep "merge_status:" | cut -d'"' -f2)
  
  case "$status" in
    "merged"|"failed")
      continue  # Skip already processed
      ;;
    "waiting_dependency")
      # Re-check deps → promote to "queued" if met
      ;;
    "queued")
      # Execute merge
      ;;
  esac
done
```

## Recovery

- `.lock` directory exists → previous crash during enqueue
  - If item file exists and is non-empty → remove .lock, continue
  - If item file is empty or missing → remove .lock + empty file, retry enqueue
- `queue.yaml` corrupted → rebuild from items/ directory (count files, find max merge_order)
