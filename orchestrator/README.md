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
├── gate-evaluator.ts         Gate card evaluation engine
├── state-validator.ts        State consistency validation
├── merge-queue.ts            Dependency-ordered merge queue
├── contract-validator.ts     API spec ↔ implementation compliance check
├── page-parity-gate.ts       UX spec ↔ frontend page gap detection
├── worktree.ts               git worktree create/merge/cleanup
├── bmad-health-check.ts      BMAD skill availability verification
└── types.ts                  Shared TypeScript types
```

## CLI Commands

```bash
npm start status [project]      Show status dashboard
npm start run [project]         Execute workflow from current state
npm start run-track <b|f>       Run backend/frontend track
npm start merge-queue [project] Show merge queue
npm start validate-state        Validate state file consistency
npm start health                Check BMAD skill availability

# Development
npm run dev                      Run with tsx (hot reload)
npm run build                    TypeScript compile
npm test                         Run vitest test suite (includes E2E)
npm run test:watch               Re-run tests on file changes
```

## Tests

The test suite runs via [vitest](https://vitest.dev) and is invoked with
`npm test` from the `orchestrator/` directory. Configuration lives in
`vitest.config.ts` — tests are picked up from `src/**/*.test.ts`.

### Layout

```
orchestrator/src/orchestrator/*.test.ts   unit + integration tests
fixtures/todo-app/                        minimal project fixture for E2E tests
```

### E2E tests

`src/orchestrator/e2e.test.ts` exercises the full engine state flow against
the `fixtures/todo-app` project. Each test copies the fixture into a fresh
temp directory, initializes a git repo, and drives the orchestrator's state
APIs directly — no real agent dispatch is performed. Coverage:

- Status initialization with default phases
- Phase 1 to 4 FSM transitions (skip / freeze / lock)
- Story Ready Gate dependency tracking
- Gate Evaluator artifact_exists fail-closed -> pass cycle
- Merge queue enqueue + dependency-ordered reconciliation
- Atomic save (no `.tmp.*` leakage) + reload recovery
- Split-file status mode + unified yaml fallback
- Change Request blocking + resolution flow

Run a single E2E test:

```bash
cd orchestrator
npm test -- e2e
```

Run with verbose output:

```bash
npx vitest run --reporter=verbose
```

## Key Design Decisions

1. **Minimal TOML parser**: No external TOML dependency — built-in parser handles customize.toml sections, arrays, strings, booleans
2. **Split-file state**: writes to `status/` directory per the V3.6 spec
3. **Agent dispatch**: calls Claude Code `Agent({ isolation: "worktree" })` for story execution
4. **Signal-based communication**: reads/writes `/tmp/web-dev-flow/signals/` for pause/resume
5. **Simple-git**: for worktree management, merge operations, scope verification

## Requirements

- Node.js 18+
- Git 2.0+ (worktree support)
- Claude Code (Agent tool for sub-agent dispatch)
