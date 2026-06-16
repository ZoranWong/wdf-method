# wdf-method Engine — 编排器执行引擎

**Version:** 3.6.0
**Source:** orchestrator/src/orchestrator/
**Build:** `npm run build` → dist/

## Architecture

```
orchestrator/src/orchestrator/
├── index.ts                  Entry point / CLI router
├── orchestrator.ts           Main orchestrator: phase FSM, agent dispatch
├── agent-dispatcher.ts       Sub-agent dispatch via Claude Code Agent()
├── story-runner.ts           Per-story TDD cycle execution
├── sprint-status.ts          Split-file status read/write
├── gate-evaluator.ts         Gate card evaluation engine (fail-closed)
├── state-validator.ts        State consistency validation
├── merge-queue.ts            Dependency-ordered merge queue
├── contract-validator.ts     API spec ↔ implementation compliance check
├── page-parity-gate.ts       UX spec ↔ frontend page gap detection
├── worktree.ts               git worktree create/merge/cleanup
├── bmad-health-check.ts      BMAD skill availability verification
├── types.ts                  Shared TypeScript types
│
├── Engine Hardening Modules (V3.6)
├── command-safety.ts         Shell injection prevention for commands/identifiers
├── status-paths.ts           Status directory path resolution helpers
├── status-backup.ts          Timestamped backup on every state write
├── story-ready-gate.ts       SRG: scope, command, and dependency validation
└── recovery.ts               Non-destructive state rebuild from split files
```

## CLI Commands

```bash
npm start status [project]      Show status dashboard
npm start run [project]         Execute workflow from current state
npm start run-track <b|f>       Run backend/frontend track
npm start merge-queue [project] Show merge queue
npm start validate-state        Validate state file consistency
npm start health                Check BMAD skill availability
npm start recover               Non-destructive recovery of corrupted state

# Development
npm run dev                      Run with tsx (hot reload)
npm run build                    TypeScript compile
npm test                         Run test suite
```

## Key Architecture Decisions

1. **Minimal TOML parser**: No external TOML dependency — built-in parser handles customize.toml sections, arrays, strings, booleans
2. **Split-file state**: writes to `_wdf_output/status/` directory per the V3.6 spec
3. **Agent dispatch**: calls Claude Code `Agent({ isolation: "worktree" })` for story execution
4. **Signal-based communication**: reads/writes `_wdf_output/signals/` for pause/resume
5. **Simple-git**: for worktree management, merge operations, scope verification

## Engine Hardening Features (V3.6)

1. **Fail-Closed Gate Evaluator**: Every check type has explicit behavior — unimplemented types do not silently pass
2. **Command Safety**: Shell injection prevention for branch names, story IDs, and acceptance commands
3. **Atomic Backups**: Timestamped backup of every status file before write
4. **Story Ready Gate**: Pre-execution validation for scope boundaries, path safety, command safety, and hidden overlaps
5. **Recovery Engine**: Rebuild sprint-status.yaml from split status files, restore from backup — never deletes anything

## Requirements

- Node.js 18+
- Git 2.0+ (worktree support)
- Claude Code (Agent tool for sub-agent dispatch)
