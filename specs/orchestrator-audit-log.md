# Orchestrator Audit Log — 编排器决策记录 (V3.6)

**Version:** 1.0.0
**Applies to:** Phase 1-4 orchestrator decisions
**Location:** `status/orchestrator-audit.jsonl` (JSON Lines, append-only)

---

## Purpose

Record every orchestrator decision for post-mortem analysis. Answers:
- Why was a story dispatched/rejected?
- Why did a phase transition occur?
- What gate card results led to block/allow?
- Which agent returned what result?

---

## Log Format

Each line is a JSON object with these fields:

```json
{
  "ts": "2026-05-22T10:30:00Z",
  "phase": 4,
  "sub_phase": "4.4",
  "event": "dispatch_story",
  "story_id": "S-3.2",
  "agent_id": "a9f25bd0e65b77e34",
  "decision": "approve",
  "reason": "All SRG-01~09 checks passed",
  "data": {
    "slot_used": 2,
    "max_slots": 5,
    "worktree": ".claude/worktrees/story/S-3.2-be",
    "scope_write": ["src/modules/auth/", "src/middleware/auth.ts"]
  }
}
```

---

## Event Types

### Phase Events

| Event | Fields | Example Reason |
|-------|--------|----------------|
| `phase_enter` | phase, sub_phase, gate_results | "All G4 checks passed" |
| `phase_complete` | phase, duration_sec, artifacts | "All 14 sub-phases LOCKED" |
| `phase_skip` | phase, reason | "User skipped Phase 1" |
| `phase_blocked` | phase, blocked_by_cr | "CR-001 blocking Phase 3" |

### Gate Card Events

| Event | Fields | Example Reason |
|-------|--------|----------------|
| `gate_evaluated` | phase, check_id, result | "G4-03: pass — api-spec locked" |
| `gate_failed` | phase, check_id, expected, actual | "G4-01: expected LOCKED, got IN_PROGRESS" |

### Story Events

| Event | Fields | Example Reason |
|-------|--------|----------------|
| `dispatch_story` | story_id, agent_id, slot_used | "SRG-01~09 passed, slot 2/5" |
| `story_paused` | story_id, agent_id, last_substep | "Pause signal detected at 4d" |
| `story_completed` | story_id, status, duration_sec | "CODE_ACCEPTED after 18min" |
| `story_failed` | story_id, error, retry_count | "Test failure, retry 1/2" |
| `story_blocked` | story_id, blocked_by, reason | "SRG-05 scope overlap with S-3.1" |
| `story_skipped` | story_id, reason | "depends_on S-3.1 not MERGED" |

### Merge Queue Events

| Event | Fields | Example Reason |
|-------|--------|----------------|
| `enqueue_story` | story_id, merge_order, depends_on | "No dependencies, order=30" |
| `merge_attempt` | story_id, integration_checks | "npm run test + npm run build" |
| `merge_success` | story_id, commit_hash | "Merged to main" |
| `merge_failed` | story_id, reason, retry_count | "Integration check failed" |

### Acceptance Events

| Event | Fields | Example Reason |
|-------|--------|----------------|
| `acceptance_started` | tier, story_id | "CODE ACCEPTANCE for S-3.2" |
| `acceptance_passed` | tier, story_id, results | "CA-01~05 all pass" |
| `acceptance_failed` | tier, story_id, failed_check | "CA-02: coverage 72% < 80%" |

### State Transition Events

| Event | Fields | Example Reason |
|-------|--------|----------------|
| `state_change` | phase, from_state, to_state | "LOCKED → UNLOCK_RESOLVE (CR filed)" |

---

## File Operations

```bash
# Write (append-only)
echo '{"ts":"...","event":"dispatch_story",...}' >> status/orchestrator-audit.jsonl

# Read last N entries
tail -n 50 status/orchestrator-audit.jsonl | python3 -m json.tool

# Filter by event type
grep 'dispatch_story' status/orchestrator-audit.jsonl | python3 -m json.tool

# Filter by story
grep 'S-3.2' status/orchestrator-audit.jsonl | python3 -m json.tool
```

---

## Retention

- Log file is append-only and never truncated during a project lifecycle
- On project archive: compress to `status/orchestrator-audit.jsonl.gz`
- Max file size: 50MB (rotate by compressing when exceeded)

---

## Schema Validation

Each log entry MUST contain:
- `ts` (string, ISO 8601 timestamp)
- `event` (string, from event type enum)
- `decision` (string: "approve" | "reject" | "block" | "skip")

Optional fields:
- `phase`, `sub_phase` (integer, string)
- `story_id` (string)
- `agent_id` (string)
- `reason` (string)
- `data` (object, event-specific)
