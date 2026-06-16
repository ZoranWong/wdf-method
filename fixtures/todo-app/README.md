# Todo App — E2E Test Fixture

Minimal project fixture used by the orchestrator's E2E test suite (`orchestrator/src/orchestrator/e2e.test.ts`).

## Structure

```
fixtures/todo-app/
├── customize.toml          minimal workflow config
├── src/
│   ├── api/                backend scope_write target
│   └── web/                frontend scope_write target
└── stories/
    ├── S-1.1.md            backend story (todo CRUD API)
    └── S-1.2.md            frontend story (todo list UI, depends on S-1.1)
```

The fixture is intentionally minimal — it exists so the engine has real
on-disk paths to evaluate during gate checks, scope validation, and merge
queue ordering. Tests copy this fixture into a temporary directory before
exercising orchestrator code.

## Usage

The fixture is consumed by `vitest`. See `orchestrator/README.md` for the
test-running instructions.
