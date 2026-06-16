# wdf-method Engine Hardening Design

**Date:** 2026-06-16
**Status:** Approved for implementation planning
**Scope:** Engine production hardening, with necessary refactoring allowed when it reduces inconsistency or unsafe execution paths.

## Overview

This design hardens wdf-method from a strong specification-driven workflow into a more reliable execution engine. The priority is to make runtime behavior match the documented workflow: split-file state, strict gates, Story Ready Gate enforcement, safe merge processing, recoverability, and executable tests.

The work intentionally focuses on engine correctness before adding new OpenSpec or Spec Kit workflow structures.

## Goals

- Remove path and state-source inconsistencies between `wdf-method`, `web-dev-flow`, `status/*.yaml`, and `sprint-status.yaml`.
- Ensure gate checks do not silently pass when unsupported or incomplete.
- Align SRG-01 through SRG-09 with README/SKILL/spec semantics.
- Harden merge queue execution against unsafe shell interpolation and partial merge state.
- Add first-pass recovery and status backup support.
- Make root-level tests cover the orchestrator engine, not only the installer CLI.
- Allow targeted refactoring when existing structure blocks a safe or coherent implementation.

## Non-Goals

- Do not introduce a full OpenSpec `changes/` lifecycle in this pass.
- Do not introduce the full Spec Kit `constitution/spec/plan/tasks` structure in this pass.
- Do not implement a real multi-session worker pool for Claude agents.
- Do not promise full AI-agent implementation E2E in CI.
- Do not auto-delete worktrees, reset branches, revert commits, or otherwise perform destructive recovery.
- Do not clean up the current unrelated `node_modules` working tree state.

## Design

### 1. State path and status consistency

The orchestrator should resolve status paths from configuration, not hard-coded directories. `status_dir`, `status_global_file`, phase files, story status files, and merge queue paths should come from `customize.toml` defaults and support `{project-root}` interpolation.

`status/*.yaml` remains the source of truth when present. `sprint-status.yaml` is a derived convenience index and can be rebuilt. The implementation may still write the derived index for compatibility, but it must not treat the derived index as more authoritative than split status files.

Every state write should create a backup copy before replacing the target file. Backups live under `status/backup/` and are used by recovery diagnostics.

Targeted refactor allowed: extract path resolution and state-file backup logic out of broad orchestrator methods if this avoids duplicated path handling.

### 2. Gate hardening

`GateEvaluator` should fail closed. Unsupported check types, unsupported operators, missing fields, and unimplemented dependency expressions must not pass silently.

Expected behavior:

| Case | Result |
|------|--------|
| Unknown check type | `fail` |
| Known type with unsupported operator | `fail` |
| Missing required field | `fail` |
| Explicitly delegated check | `skipped` only when another component records the authoritative result |
| Manual user confirmation in non-interactive engine path | `fail` unless auto-mode degradation is explicitly configured |

Targeted refactor allowed: introduce small helpers for field lookup and operator comparison so dependency and metadata checks share one implementation.

### 3. Story Ready Gate alignment

SRG checks should match the public contract:

| ID | Required behavior |
|----|-------------------|
| SRG-01 | `scope_write` is defined and non-empty |
| SRG-02 | `acceptance_check` is defined and non-empty |
| SRG-03 | Story file exists |
| SRG-04 | Paths are relative, do not traverse upward, and do not target forbidden locations |
| SRG-05 | No overlap with active story scopes |
| SRG-06 | Scope is within the frozen implementation boundary when one exists |
| SRG-07 | Parent directories exist when required |
| SRG-08 | Protected path intersections mark the story as serial-only or block unsafe parallel dispatch |
| SRG-09 | Acceptance commands pass command-safety validation |

Missing acceptance checks must fail. Protected path hits should affect scheduling semantics, not only add a human-readable reason.

Targeted refactor allowed: extract SRG checks into a dedicated `story-ready-gate` module if the current `StoryRunner` method becomes hard to test or maintain.

### 4. Merge queue safety

Merge queue execution must preserve atomicity and reduce command injection risk.

Required behavior:

1. Validate branch and story identifiers before using them in commands.
2. Avoid shell string interpolation for git commands where possible.
3. Validate integration commands against the same command-safety policy used by story acceptance checks.
4. Keep the atomic merge sequence:
   - merge with `--no-commit --no-ff`
   - run integration checks
   - commit if all checks pass
   - abort if any check fails
5. Fix hidden dependency detection so it compares actual changed files and both stories' scopes.
6. Avoid hard-coded `origin/master`; use the scope-freeze tag, configured base branch, or detected main branch.

Targeted refactor allowed: add a command runner abstraction if it makes validation and tests simpler.

### 5. Recovery and backups

Add a first-pass `recover` capability focused on safe diagnosis and non-destructive repair.

Recover should:

- Parse split status files independently.
- Rebuild a corrupted derived `sprint-status.yaml` from valid split files.
- Restore a corrupted split status file from the latest backup when safe.
- Report active worktrees and story branches.
- Render a recovery dashboard with actionable next steps.

Recover must not delete worktrees, reset branches, force checkout, clean files, or revert commits.

### 6. Test strategy

Root `npm test` should cover both the installer CLI and the orchestrator engine. The orchestrator should at least build during the root test flow.

Add or update tests for:

- Config-driven status path resolution.
- Gate failure on unsupported checks/operators.
- SRG-01 through SRG-09 pass/fail behavior.
- Merge queue abort on failed integration check.
- Hidden overlap detection.
- Backup creation before status writes.
- Recovery from corrupted derived `sprint-status.yaml`.

The first E2E fixture should prove engine behavior, not full AI coding. Full Claude-agent dispatch E2E remains a later production validation step.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Existing uncommitted workspace is large | Modify only targeted engine/test files and avoid formatting unrelated files |
| Gate hardening breaks existing permissive tests | Update tests to reflect fail-closed behavior |
| Recovery accidentally mutates user work | Keep recover non-destructive in this pass |
| Shell command changes introduce platform issues | Prefer Node APIs or argument-array process execution |
| Scope expands into method redesign | Defer OpenSpec/Spec Kit additions until engine hardening is passing |

## Acceptance Criteria

- Root `npm test` passes.
- Orchestrator build passes.
- GateEvaluator no longer silently passes unknown or unsupported checks.
- SRG-01 through SRG-09 have explicit tests.
- Missing `scope_write`, missing `acceptance_check`, and missing story files fail SRG.
- Protected path hits are visible to scheduling as serial-only or block parallel dispatch.
- Merge integration check failure aborts the merge and marks the queue item failed.
- Status writes create backups.
- Recover can rebuild a corrupted derived status index from split files.
- No destructive git operations are introduced.

## Deferred Work

- Full OpenSpec-style change proposal/spec-delta/archive lifecycle.
- Full Spec Kit constitution/spec/plan/tasks structure.
- Multi-session parallel worker orchestration.
- Full AI-agent implementation E2E in CI.
- Metrics, dashboards, and long-run 50-story benchmark.
