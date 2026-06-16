# Status Directory — Split File Design (V3.6)

**Version:** 3.6.0
**Principle:** Every writer has its own file. No two processes ever write to the same file simultaneously.
**Derived Index:** sprint-status.yaml is rebuilt from status/ files — never directly written.

## Directory Structure

```
_wdf_output/
├── sprint-status.yaml              # DERIVED index (rebuilt from status/ — read-only)

└── status/
    ├── global.yaml                 # global_state (Orchestrator writes, project lifetime)
    │
    ├── phase-01.yaml               # Phase 1 state (Orchestrator writes during Phase 1)
    ├── phase-02.yaml               # Phase 2 state (Orchestrator writes during Phase 2)
    ├── phase-03.yaml               # Phase 3 state (Orchestrator writes during Phase 3)
    ├── phase-04-be.yaml            # Phase 4 BE track state (BE orchestrator writes)
    ├── phase-04-fe.yaml            # Phase 4 FE track state (FE orchestrator writes)
    │
    ├── merge-queue/                # Per-item files (see specs/merge-queue.md)
    │   ├── queue.yaml
    │   ├── .lock
    │   └── items/...
    │
    ├── change-requests.yaml        # CR list (Orchestrator writes, any phase)
    │
    └── stories/                    # Per-story status (Story Agent writes in its own worktree)
        ├── S-3.1-status.yaml       # Written by Agent S-3.1 in worktree
        ├── S-3.2-status.yaml       # Written by Agent S-3.2 in worktree
        └── S-4.1-status.yaml       # Written by Agent S-4.1 in worktree
```

## Write Permission Matrix (Absolute — No Conflicts)

| File | Writer | When | Concurrent? |
|------|--------|------|:---:|
| `status/global.yaml` | Main Orchestrator | Init, triage change | No (sequential phases) |
| `status/phase-01.yaml` | Main Orchestrator | Phase 1 sub-phase completion | No |
| `status/phase-02.yaml` | Main Orchestrator | Phase 2 sub-phase completion | No |
| `status/phase-03.yaml` | Main Orchestrator | Phase 3 sub-phase completion | No |
| `status/phase-04-be.yaml` | BE Orchestrator | BE track progress | **Parallel with phase-04-fe.yaml** |
| `status/phase-04-fe.yaml` | FE Orchestrator | FE track progress | **Parallel with phase-04-be.yaml** |
| `status/change-requests.yaml` | Main Orchestrator | CR create/resolve | No |
| `status/merge-queue/items/*.yaml` | Main Orchestrator | Enqueue (lock), status update (no lock) | Creation: locked; Update: serial |
| `status/stories/S-*-status.yaml` | **Story Agent** | In story worktree during development | Parallel (each agent writes its own file) |
| `sprint-status.yaml` | **NONE** (auto-generated) | Rebuilt from status/ on demand | N/A |

## Per-Phase File Format

### status/global.yaml
```yaml
global_state:
  project: "my-app"
  workflow_version: "3.6.0"
  created_at: "2026-05-21T10:00:00Z"
  updated_at: "2026-05-21T14:00:00Z"
  dev_mode: "separated"
  task_triage_mode: "parallel"
  code_standards_source: ["AGENTS.md", "tsconfig.json"]
  overall_status: "implementation"
  current_phase: 4
  requirements_frozen_at: "2026-05-21T11:00:00Z"
  development_order_frozen_at: "2026-05-21T12:00:00Z"
  implementation_boundary: {...}
```

### status/phase-04-be.yaml (BE track — writeable by BE orchestrator ONLY)
```yaml
phase_4_be:
  status: "IN_PROGRESS"
  substates:
    phase_4_2: { status: "LOCKED" }
    phase_4_3: { status: "LOCKED" }
    phase_4_4:
      status: "IN_PROGRESS"
      stories:
        - { id: "S-3.1", status: "CODE_ACCEPTED" }
        - { id: "S-3.2", status: "IN_PROGRESS" }
        - { id: "S-4.1", status: "NOT_STARTED" }
    phase_4_5: { status: "NOT_STARTED" }
    phase_4_6: { status: "NOT_STARTED" }
```

### status/phase-04-fe.yaml (FE track — writeable by FE orchestrator ONLY)
```yaml
phase_4_fe:
  status: "IN_PROGRESS"
  substates:
    phase_4_7: { status: "LOCKED" }
    phase_4_8: { status: "LOCKED" }
    phase_4_9: { status: "LOCKED" }
    phase_4_10:
      status: "IN_PROGRESS"
      stories:
        - { id: "S-1.1", status: "CODE_ACCEPTED" }
        - { id: "S-2.1", status: "IN_PROGRESS" }
    phase_4_11: { status: "NOT_STARTED" }
    phase_4_12: { status: "NOT_STARTED" }
```

## sprint-status.yaml Rebuild

```bash
# Rebuild from status/ files (always consistent, never corrupted)
rebuild_sprint_status() {
  cat > sprint-status.yaml <<'EOF'
# AUTO-GENERATED — DO NOT EDIT
# Rebuilt from status/ files at {timestamp}
EOF
  
  # Concatenate all status files
  cat status/global.yaml >> sprint-status.yaml
  cat status/phase-01.yaml >> sprint-status.yaml
  cat status/phase-02.yaml >> sprint-status.yaml
  cat status/phase-03.yaml >> sprint-status.yaml
  cat status/phase-04-be.yaml >> sprint-status.yaml
  cat status/phase-04-fe.yaml >> sprint-status.yaml
  
  # Aggregate story statuses
  echo "stories:" >> sprint-status.yaml
  for f in status/stories/*-status.yaml; do
    story_id=$(basename "$f" -status.yaml)
    status=$(grep "status:" "$f" | head -1 | awk '{print $2}')
    echo "  ${story_id}: { status: \"${status}\" }" >> sprint-status.yaml
  done
}
```

**If sprint-status.yaml is corrupted:** Delete it, run rebuild. Zero data loss.

## Recovery

| Scenario | Recovery |
|----------|---------|
| `phase-04-be.yaml` corrupted | Read story status from `status/stories/*-status.yaml`, rebuild |
| `global.yaml` corrupted | Read version/date from any phase file, ask user for project name |
| All `status/` files lost | Read story files from git, read phase status from git tags/commits |
| `.lock` directory stuck | Remove after 60s timeout (stale lock) |
