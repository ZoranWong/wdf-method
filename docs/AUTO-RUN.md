# Auto-Run Main Loop

CHG-2026-006 introduces a hands-free execution loop that chains all four
phases (Analysis → Planning → Solutioning → Implementation) without
interactive prompts. The orchestrator evaluates gate cards, starts phases,
and auto-advances through sub-phases — stopping only on gate failure, pause
signal, or completion.

## Quick start

```bash
# One-command snapshot (wdf-build wraps auto-loop + all phases):
wdf build

# Or invoke the orchestrator directly:
wdf orchestrator auto-run           # non-verbose: JSON status lines
wdf orchestrator auto-run --verbose # phase-by-phase progress
wdf orchestrator auto-run --max-iter 20  # cap risk of runaway
```

## How it works

```
┌─────────────────────────────────────────────────┐
│ runAutoLoop(opts)                                │
│                                                  │
│  for phase in [1..4]:                            │
│    ├─ Check pause signal (SIGINT / agent pause)  │
│    ├─ evaluatePhaseGate(phase)                   │
│    ├─ if gate_fail and halt_on_gate_failure: break│
│    ├─ startPhase(phase)  — sub-phases sequential │
│    ├─ if phase == 4: executeImplementationPhase() │
│    ├─ Check pause signal                         │
│    └─ iteration++  (respect maxIterations)       │
│                                                  │
│  return { all_phases_complete, timeline, paused } │
└─────────────────────────────────────────────────┘
```

## Options

| Option | Default | Description |
|---|---|---|
| `maxIterations` | 50 | Safety cap — stop after N phase iterations |
| `startPhase` | auto-detect | First phase to run (detects first non-LOCKED) |
| `endPhase` | 4 | Last phase to run |
| `verbose` | false | Print per-phase progress to console |
| `logFn` | `console.log` | Custom logger (useful in tests) |

## Auto-detection and resume

`runAutoLoop` is designed to be safely re-entrant:

- On first run, it auto-detects the current phase from `sprint-status.yaml`
  (the first `NOT_STARTED` or `IN_PROGRESS` phase).
- After a pause or crash, running `runAutoLoop` again picks up where it left
  off — phases already `LOCKED` are skipped.
- Phases marked `IN_PROGRESS` are re-started (idempotent).

## Pause and resume

The loop polls the agent signal system between phases:

1. **SIGINT (Ctrl+C):** The orchestrator catches SIGINT once, sets an
   in-memory `paused` flag, and cleanly returns a result with
   `paused: true`. The state files are NOT corrupted — the current
   phase is saved before SIGINT is honoured.
2. **Agent pause file:** Any agent can write a pause signal to
   `~/.wdf-method/signals/`. The loop checks for this before each phase
   and after each sub-phase.
3. **Resume:** `wdf resume` clears the pause signal; re-running
   `auto-run` continues from the last non-LOCKED phase.

## Gate failure behaviour

Controlled by `customize.toml`:

```toml
[auto_run]
halt_on_gate_failure = true        # stop on any gate failure (default)
halt_on_acceptance_failure = true  # stop if acceptance checks fail
```

When a gate fails and `halt_on_gate_failure` is true:
- The current phase records `status: 'gate_failed'` in the timeline.
- The loop exits without executing the phase.
- The `result.all_phases_complete` flag is false.
- Remaining phases are untouched.

When `halt_on_gate_failure` is false, the loop logs a warning and
continues. This is useful for exploratory runs but NOT recommended for
production pipelines.

## Max iterations safety net

The `maxIterations` parameter guards against infinite loops caused by
a phase that never reaches `LOCKED`. Each phase attempt counts as one
iteration; if the limit is reached, the loop exits with a non-complete
result. The default is 50 (generous for normal projects).

## Programmatic API

```ts
import { PhaseOrchestrator, type AutoLoopResult } from './orchestrator.js';

const orch = new PhaseOrchestrator(projectRoot);
await orch.initialize();

const result = await orch.runAutoLoop({
  startPhase: 1,
  endPhase: 4,
  maxIterations: 50,
  verbose: true,
  logFn: (msg) => logger.info(msg),
});

if (result.all_phases_complete) {
  console.log('Pipeline finished');
} else if (result.paused) {
  console.log(`Paused before phase: ${result.pause_reason}. Resume with wdf resume.`);
} else {
  console.error(`Stopped at iteration ${result.iterations}`);
  for (const entry of result.timeline) {
    console.log(`  Phase ${entry.phase}: ${entry.status}${entry.error ? ' — ' + entry.error : ''}`);
  }
}
```

## Timeline inspection

`AutoLoopResult.timeline` is a PhaseLoopEntry[] record of every phase
attempted. Each entry contains:

| Field | Description |
|---|---|
| `phase` | Phase number (1-4) |
| `status` | `started`, `locked`, `skipped`, `executed`, `gate_failed`, or `error` |
| `at` | ISO 8601 timestamp |
| `halted` | True if the loop stopped at this phase |
| `gate_failures` | List of failed gate check IDs |
| `error` | Error message (when status is `error`) |

## Compatibility

- **Step audit:** The existing audit log (JSONL at `_bmad-output/web-dev-flow/audit/`)
  records every gate check and phase transition; auto-run adds no extra
  audit overhead beyond what `startPhase` / `evaluatePhaseGate` already emit.
- **Scope lock:** The V3.6 scope-lock mechanism operates at the story dispatch
  level, not at the phase level, so auto-run inherits scope-lock protection
  without any wiring change.
- **Story runner:** For Phase 4, auto-run delegates to the existing
  `executeImplementationPhase()` which respects concurrency, merge queue,
  and signal-based pause detection.

## Related

- `orchestrator/src/orchestrator/orchestrator.ts` — `runAutoLoop()` implementation
- `orchestrator/src/orchestrator/auto-loop.test.ts` — 6 tests covering
  complete, gate-fail, max-iter, bounds, and auto-detect
- `customize.toml` `[auto_run]` section — configuration reference
- `commands/wdf-build.md` — end-to-end pipeline command
- `docs/plans/2026-06-17-standardization-automation-roadmap.md#opt-05`
