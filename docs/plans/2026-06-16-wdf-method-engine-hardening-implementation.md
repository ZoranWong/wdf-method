# wdf-method Engine Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the wdf-method execution engine so runtime behavior matches the documented workflow for state, gates, story readiness, merge safety, recovery, and tests.

**Architecture:** Keep the current orchestrator package but allow focused refactors where they make hardening testable. Add small modules for shared command safety, status path/backup handling, SRG evaluation, and recovery instead of expanding already large orchestration methods.

**Tech Stack:** TypeScript, Node.js >=18, Vitest, js-yaml, simple-git, existing root CLI test harness.

---

## Ground Rules

- Do not touch `node_modules/` or unrelated modified documentation files.
- Do not run destructive git commands.
- Do not auto-delete worktrees, branches, or user files in recovery logic.
- Prefer tests before implementation.
- Keep changes focused on `orchestrator/`, root test scripts, and narrowly necessary CLI wiring.
- If existing code structure makes a safe fix awkward, refactor into a small module rather than patching around it.

## Task 1: Add orchestrator test/build to root test flow

**Files:**
- Modify: `package.json:10-14`
- Modify if needed: `vitest.config.mjs`
- Verify: `orchestrator/package.json:10-19`

**Step 1: Update root scripts**

Change root scripts to keep CLI tests and add orchestrator validation:

```json
{
  "scripts": {
    "test": "vitest run && npm --prefix orchestrator run build && npm --prefix orchestrator run test",
    "test:cli": "vitest run",
    "test:orchestrator": "npm --prefix orchestrator run build && npm --prefix orchestrator run test",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

**Step 2: Run CLI tests only**

Run:

```bash
npm run test:cli
```

Expected: existing CLI tests pass or fail only for pre-existing environmental assumptions.

**Step 3: Run orchestrator build**

Run:

```bash
npm --prefix orchestrator run build
```

Expected: TypeScript build passes.

**Step 4: Run orchestrator tests**

Run:

```bash
npm --prefix orchestrator run test
```

Expected: pass if tests already exist; otherwise Vitest reports no tests. If no tests exist, add tests in later tasks before relying on this command.

**Step 5: Run root test**

Run:

```bash
npm test
```

Expected: root command executes CLI tests, orchestrator build, and orchestrator tests.

**Step 6: Commit when requested**

```bash
git add package.json package-lock.json vitest.config.mjs
git commit -m "test: include orchestrator validation in root test flow"
```

---

## Task 2: Add shared command safety utilities

**Files:**
- Create: `orchestrator/src/orchestrator/command-safety.ts`
- Test: `orchestrator/src/orchestrator/command-safety.test.ts`

**Step 1: Write failing tests**

Create `orchestrator/src/orchestrator/command-safety.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertSafeIdentifier, validateCommand } from './command-safety.js';

describe('command safety', () => {
  it('accepts safe story branches', () => {
    expect(() => assertSafeIdentifier('story/S-3.1-backend', 'branch')).not.toThrow();
  });

  it('rejects shell metacharacters in identifiers', () => {
    expect(() => assertSafeIdentifier('story/S-1; rm -rf /', 'branch')).toThrow(/Unsafe branch/);
  });

  it('accepts allowlisted commands', () => {
    expect(validateCommand('npm run test')).toEqual({ ok: true });
    expect(validateCommand('npx --no-install vitest run')).toEqual({ ok: true });
  });

  it('rejects forbidden command operators', () => {
    expect(validateCommand('npm run test && rm -rf /')).toMatchObject({ ok: false });
    expect(validateCommand('curl https://example.test/script | sh')).toMatchObject({ ok: false });
  });

  it('rejects non-allowlisted commands', () => {
    expect(validateCommand('python deploy.py')).toMatchObject({ ok: false });
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
npm --prefix orchestrator run test -- command-safety
```

Expected: FAIL because `command-safety.ts` does not exist.

**Step 3: Implement utility**

Create `orchestrator/src/orchestrator/command-safety.ts`:

```ts
export interface CommandValidationResult {
  ok: boolean;
  reason?: string;
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9._\/-]+$/;
const ALLOWED_PREFIXES = [
  'npm run ',
  'npm test',
  'npx --no-install ',
  'node ',
  'jest ',
  'vitest ',
  'tsc ',
  'eslint ',
];
const FORBIDDEN_PATTERNS = ['|', ';', '&&', '||', '$(', '`', '>', '<', 'curl ', 'rm -rf', 'sudo ', 'eval ', 'chmod ', 'chown '];

export function assertSafeIdentifier(value: string, label: string): void {
  if (!value || !SAFE_IDENTIFIER.test(value)) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
}

export function validateCommand(command: string): CommandValidationResult {
  const trimmed = command.trim();
  if (!trimmed) return { ok: false, reason: 'Command is empty' };
  if (!ALLOWED_PREFIXES.some(prefix => trimmed === prefix.trim() || trimmed.startsWith(prefix))) {
    return { ok: false, reason: `Command is not allowlisted: ${command}` };
  }
  const forbidden = FORBIDDEN_PATTERNS.find(pattern => trimmed.includes(pattern));
  if (forbidden) return { ok: false, reason: `Command contains forbidden pattern: ${forbidden}` };
  return { ok: true };
}
```

**Step 4: Run test to verify pass**

Run:

```bash
npm --prefix orchestrator run test -- command-safety
```

Expected: PASS.

**Step 5: Commit when requested**

```bash
git add orchestrator/src/orchestrator/command-safety.ts orchestrator/src/orchestrator/command-safety.test.ts
git commit -m "fix: add shared command safety validation"
```

---

## Task 3: Add config-driven path resolution and backup support

**Files:**
- Create: `orchestrator/src/orchestrator/status-paths.ts`
- Create: `orchestrator/src/orchestrator/status-backup.ts`
- Modify: `orchestrator/src/orchestrator/orchestrator.ts:99-125`
- Modify: `orchestrator/src/orchestrator/sprint-status.ts:1-153`
- Test: `orchestrator/src/orchestrator/status-paths.test.ts`
- Test: `orchestrator/src/orchestrator/status-backup.test.ts`

**Step 1: Write path resolution tests**

Create `orchestrator/src/orchestrator/status-paths.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveWorkflowPath, resolveStatusDir } from './status-paths.js';

describe('status path resolution', () => {
  it('resolves project-root template variables', () => {
    expect(resolveWorkflowPath('/repo', '{project-root}/_bmad-output/wdf-method/status'))
      .toBe('/repo/_bmad-output/wdf-method/status');
  });

  it('uses configured status_dir before defaults', () => {
    expect(resolveStatusDir('/repo', { workflow: { status_dir: '{project-root}/custom/status' } }))
      .toBe('/repo/custom/status');
  });

  it('defaults to wdf-method status path', () => {
    expect(resolveStatusDir('/repo', {})).toBe('/repo/_bmad-output/wdf-method/status');
  });
});
```

**Step 2: Write backup tests**

Create `orchestrator/src/orchestrator/status-backup.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { backupFileBeforeWrite } from './status-backup.js';

describe('status backup', () => {
  it('creates backup before overwriting existing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wdf-backup-'));
    const statusDir = join(dir, 'status');
    const file = join(statusDir, 'global.yaml');
    require('fs').mkdirSync(statusDir, { recursive: true });
    writeFileSync(file, 'old: true\n');

    const backup = backupFileBeforeWrite(file, statusDir);

    expect(backup).toBeTruthy();
    expect(existsSync(backup!)).toBe(true);
    expect(readFileSync(backup!, 'utf8')).toBe('old: true\n');
    expect(readdirSync(join(statusDir, 'backup')).length).toBe(1);
  });

  it('does nothing for missing files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wdf-backup-'));
    expect(backupFileBeforeWrite(join(dir, 'missing.yaml'), dir)).toBeNull();
  });
});
```

**Step 3: Run tests to verify failure**

Run:

```bash
npm --prefix orchestrator run test -- status-paths status-backup
```

Expected: FAIL because modules do not exist.

**Step 4: Implement status path resolver**

Create `orchestrator/src/orchestrator/status-paths.ts`:

```ts
import { join, resolve } from 'path';

export function resolveWorkflowPath(projectRoot: string, value: string | undefined, fallback?: string): string {
  const raw = value ?? fallback;
  if (!raw) throw new Error('No workflow path configured');
  return resolve(raw.replace('{project-root}', projectRoot));
}

export function resolveStatusDir(projectRoot: string, config: Record<string, any>): string {
  return resolveWorkflowPath(
    projectRoot,
    config.workflow?.status_dir,
    join(projectRoot, '_bmad-output', 'wdf-method', 'status')
  );
}
```

**Step 5: Implement backup helper**

Create `orchestrator/src/orchestrator/status-backup.ts`:

```ts
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { basename, join } from 'path';

export function backupFileBeforeWrite(filePath: string, statusDir: string): string | null {
  if (!existsSync(filePath)) return null;
  const backupDir = join(statusDir, 'backup');
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backupDir, `${stamp}-${basename(filePath)}`);
  copyFileSync(filePath, backupPath);
  return backupPath;
}
```

**Step 6: Wire path resolver into orchestrator**

In `orchestrator/src/orchestrator/orchestrator.ts`, load config before resolving status paths and replace the hard-coded path:

```ts
async initialize(): Promise<void> {
  this.loadConfig();
  const trackingPath = this.resolveConfigPath('sprint_tracking');
  const statusDir = resolveStatusDir(this.projectRoot, this.config as Record<string, any>);
  if (existsSync(statusDir)) {
    this.state = await SprintStatusManager.loadFromStatusDir(statusDir, trackingPath);
  } else {
    this.state = await SprintStatusManager.load(trackingPath);
  }
  // remaining manager setup...
}
```

Import `resolveStatusDir`.

**Step 7: Add backup calls before atomic writes**

In `sprint-status.ts`, import `backupFileBeforeWrite`. Update `atomicWrite` to accept optional `statusDir`:

```ts
function atomicWrite(filePath: string, content: string, statusDir?: string): void {
  if (statusDir) backupFileBeforeWrite(filePath, statusDir);
  // existing temp write + rename
}
```

Pass `this.statusDir ?? dirname(this.filePath)` from save calls.

**Step 8: Run tests**

Run:

```bash
npm --prefix orchestrator run test -- status-paths status-backup
npm --prefix orchestrator run build
```

Expected: PASS.

**Step 9: Commit when requested**

```bash
git add orchestrator/src/orchestrator/status-paths.ts orchestrator/src/orchestrator/status-backup.ts orchestrator/src/orchestrator/status-paths.test.ts orchestrator/src/orchestrator/status-backup.test.ts orchestrator/src/orchestrator/orchestrator.ts orchestrator/src/orchestrator/sprint-status.ts
git commit -m "fix: resolve status paths from config and backup state writes"
```

---

## Task 4: Make GateEvaluator fail closed

**Files:**
- Modify: `orchestrator/src/orchestrator/gate-evaluator.ts:34-208`
- Test: `orchestrator/src/orchestrator/gate-evaluator.test.ts`

**Step 1: Write failing tests**

Create or update `orchestrator/src/orchestrator/gate-evaluator.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { GateEvaluator } from './gate-evaluator.js';
import { SprintStatusManager } from './sprint-status.js';

async function state() {
  return SprintStatusManager.load(join(mkdtempSync(join(tmpdir(), 'wdf-state-')), 'sprint-status.yaml'));
}

describe('GateEvaluator fail-closed behavior', () => {
  it('fails unknown check types', async () => {
    const evaluator = new GateEvaluator(process.cwd());
    const result = await evaluator.evaluate({ phase: 1, checks: [{ id: 'X', type: 'unknown' as any, description: 'x' }], all_pass: false }, await state());
    expect(result.all_pass).toBe(false);
    expect(result.results[0]).toMatchObject({ id: 'X', status: 'fail' });
  });

  it('fails unsupported dependency expressions', async () => {
    const evaluator = new GateEvaluator(process.cwd());
    const result = await evaluator.evaluate({ phase: 2, checks: [{ id: 'D', type: 'dependency_status', field: 'unknown.field', expected: 'LOCKED', description: 'x' }], all_pass: false }, await state());
    expect(result.results[0].status).toBe('fail');
  });

  it('fails manual confirmation in engine path', async () => {
    const evaluator = new GateEvaluator(process.cwd());
    const result = await evaluator.evaluate({ phase: 1, checks: [{ id: 'U', type: 'user_confirmation', description: 'confirm' }], all_pass: false }, await state());
    expect(result.results[0].status).toBe('fail');
  });

  it('evaluates artifact metadata fields', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wdf-artifact-'));
    writeFileSync(join(dir, 'prd.md'), '---\nstatus: approved\n---\nbody');
    const evaluator = new GateEvaluator(dir);
    const result = await evaluator.evaluate({ phase: 2, checks: [{ id: 'M', type: 'artifact_metadata', source: 'prd.md', target: 'status', expected: 'approved', description: 'status' }], all_pass: false }, await state());
    expect(result.all_pass).toBe(true);
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
npm --prefix orchestrator run test -- gate-evaluator
```

Expected: FAIL because current implementation passes unsupported cases.

**Step 3: Implement fail-closed behavior**

Update `gate-evaluator.ts`:

- `user_confirmation` returns fail unless an explicit option such as `options?.autoMode === true && check.auto_mode` is supported. If adding `autoMode` is too broad, fail by default in this pass.
- `field_exists` checks the requested field in state or fails if unsupported.
- `dependency_status` handles known fields via generic field lookup; unsupported fields fail.
- `custom_check` returns skipped only if the check has an explicit `delegated_to` field; otherwise fail.
- Default unknown type already fails; keep it.

**Step 4: Run test to verify pass**

Run:

```bash
npm --prefix orchestrator run test -- gate-evaluator
npm --prefix orchestrator run build
```

Expected: PASS.

**Step 5: Commit when requested**

```bash
git add orchestrator/src/orchestrator/gate-evaluator.ts orchestrator/src/orchestrator/gate-evaluator.test.ts
git commit -m "fix: make gate evaluation fail closed"
```

---

## Task 5: Extract and harden Story Ready Gate

**Files:**
- Create: `orchestrator/src/orchestrator/story-ready-gate.ts`
- Modify: `orchestrator/src/orchestrator/story-runner.ts:103-350`
- Test: `orchestrator/src/orchestrator/story-ready-gate.test.ts`

**Step 1: Write failing SRG tests**

Create `orchestrator/src/orchestrator/story-ready-gate.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { evaluateStoryReadyGate } from './story-ready-gate.js';

const baseStory: any = {
  story_id: 'S-1.1',
  title: 'Test Story',
  track: 'backend',
  scope_write: ['src/auth'],
  acceptance_check: ['npm run test'],
  depends_on: [],
};

function projectWithStory() {
  const root = mkdtempSync(join(tmpdir(), 'wdf-srg-'));
  mkdirSync(join(root, 'stories'), { recursive: true });
  mkdirSync(join(root, 'src', 'auth'), { recursive: true });
  writeFileSync(join(root, 'stories', 'S-1.1.md'), '# Story');
  return root;
}

describe('Story Ready Gate', () => {
  it('passes a valid story', () => {
    const root = projectWithStory();
    const result = evaluateStoryReadyGate(baseStory, {
      projectRoot: root,
      storiesDir: join(root, 'stories'),
      activeStories: [],
      protectedPaths: ['schema/migration'],
    });
    expect(result.all_pass).toBe(true);
    expect(result.serial_only).toBe(false);
  });

  it('fails missing scope_write as SRG-01', () => {
    const root = projectWithStory();
    const result = evaluateStoryReadyGate({ ...baseStory, scope_write: [] }, { projectRoot: root, storiesDir: join(root, 'stories'), activeStories: [], protectedPaths: [] });
    expect(result.results).toContainEqual(expect.objectContaining({ id: 'SRG-01', status: 'fail' }));
  });

  it('fails missing acceptance_check as SRG-02', () => {
    const root = projectWithStory();
    const result = evaluateStoryReadyGate({ ...baseStory, acceptance_check: [] }, { projectRoot: root, storiesDir: join(root, 'stories'), activeStories: [], protectedPaths: [] });
    expect(result.results).toContainEqual(expect.objectContaining({ id: 'SRG-02', status: 'fail' }));
  });

  it('fails missing story file as SRG-03', () => {
    const root = mkdtempSync(join(tmpdir(), 'wdf-srg-'));
    mkdirSync(join(root, 'stories'), { recursive: true });
    mkdirSync(join(root, 'src', 'auth'), { recursive: true });
    const result = evaluateStoryReadyGate(baseStory, { projectRoot: root, storiesDir: join(root, 'stories'), activeStories: [], protectedPaths: [] });
    expect(result.results).toContainEqual(expect.objectContaining({ id: 'SRG-03', status: 'fail' }));
  });

  it('marks protected paths as serial-only', () => {
    const root = projectWithStory();
    mkdirSync(join(root, 'schema', 'migration'), { recursive: true });
    const result = evaluateStoryReadyGate({ ...baseStory, scope_write: ['schema/migration'] }, { projectRoot: root, storiesDir: join(root, 'stories'), activeStories: [], protectedPaths: ['schema/migration'] });
    expect(result.all_pass).toBe(true);
    expect(result.serial_only).toBe(true);
  });

  it('fails unsafe acceptance commands as SRG-09', () => {
    const root = projectWithStory();
    const result = evaluateStoryReadyGate({ ...baseStory, acceptance_check: ['npm run test && rm -rf /'] }, { projectRoot: root, storiesDir: join(root, 'stories'), activeStories: [], protectedPaths: [] });
    expect(result.results).toContainEqual(expect.objectContaining({ id: 'SRG-09', status: 'fail' }));
  });
});
```

**Step 2: Run tests to verify failure**

Run:

```bash
npm --prefix orchestrator run test -- story-ready-gate
```

Expected: FAIL because module does not exist.

**Step 3: Implement `story-ready-gate.ts`**

Create `orchestrator/src/orchestrator/story-ready-gate.ts` using `validateCommand` from Task 2. Return:

```ts
export interface StoryReadyGateResult {
  all_pass: boolean;
  serial_only: boolean;
  results: Array<{ id: string; status: 'pass' | 'fail'; reason?: string }>;
}
```

Implement SRG-01 through SRG-09 exactly as listed in the design doc.

**Step 4: Wire into StoryRunner**

Replace `runStoryReadyGate`, `runBaseSRGChecks`, `addSRG04_PathSafety`, `addSRG08_ProtectedPaths`, `addSRG09_CommandSafety`, and `findScopeOverlap` with a call to `evaluateStoryReadyGate`.

In `tryRunStory`, when `serial_only` is true, update the story status metadata so scheduling can see it:

```ts
const gateResult = evaluateStoryReadyGate(story, { ... });
if (gateResult.serial_only) {
  (story as any).serial_only = true;
}
```

If there is already a scheduling model for serial stories, use that instead of ad-hoc metadata.

**Step 5: Run tests and build**

Run:

```bash
npm --prefix orchestrator run test -- story-ready-gate
npm --prefix orchestrator run build
```

Expected: PASS.

**Step 6: Commit when requested**

```bash
git add orchestrator/src/orchestrator/story-ready-gate.ts orchestrator/src/orchestrator/story-ready-gate.test.ts orchestrator/src/orchestrator/story-runner.ts
git commit -m "fix: align story ready gate with SRG contract"
```

---

## Task 6: Harden merge queue command execution and hidden overlap detection

**Files:**
- Modify: `orchestrator/src/orchestrator/merge-queue.ts:80-198`
- Test: `orchestrator/src/orchestrator/merge-queue.test.ts`
- Reuse: `orchestrator/src/orchestrator/command-safety.ts`

**Step 1: Write merge safety tests**

Create or update `orchestrator/src/orchestrator/merge-queue.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateMergeQueueItem } from './merge-queue.js';

describe('merge queue safety', () => {
  it('rejects unsafe branch names', () => {
    expect(() => validateMergeQueueItem({ branch: 'story/S-1;rm -rf /', story_id: 'S-1', queue_item_id: 'QUEUE-1', integration_checks: ['npm run test'] } as any)).toThrow(/Unsafe branch/);
  });

  it('rejects unsafe integration checks', () => {
    expect(() => validateMergeQueueItem({ branch: 'story/S-1', story_id: 'S-1', queue_item_id: 'QUEUE-1', integration_checks: ['npm run test && rm -rf /'] } as any)).toThrow(/Unsafe integration check/);
  });
});
```

Add a separate unit test for hidden overlap if the function can be extracted:

```ts
import { detectHiddenOverlapsFromFileLists } from './merge-queue.js';

it('detects overlap outside both story scopes', () => {
  expect(detectHiddenOverlapsFromFileLists(
    ['src/a.ts', 'src/shared/util.ts'],
    ['src/b.ts', 'src/shared/util.ts'],
    ['src/a.ts'],
    ['src/b.ts']
  )).toEqual(['src/shared/util.ts']);
});
```

**Step 2: Run tests to verify failure**

Run:

```bash
npm --prefix orchestrator run test -- merge-queue
```

Expected: FAIL because exported helpers do not exist.

**Step 3: Implement validation helpers**

In `merge-queue.ts`, export:

```ts
export function validateMergeQueueItem(item: MergeQueueItem): void {
  assertSafeIdentifier(item.branch, 'branch');
  assertSafeIdentifier(item.story_id, 'story_id');
  assertSafeIdentifier(item.queue_item_id, 'queue_item_id');
  for (const check of item.integration_checks ?? []) {
    const result = validateCommand(check);
    if (!result.ok) throw new Error(`Unsafe integration check: ${result.reason}`);
  }
}
```

**Step 4: Replace unsafe git command execution**

Use `spawnSync` with argument arrays for git commands:

```ts
spawnSync('git', ['merge', item.branch, '--no-commit', '--no-ff'], { cwd: this.projectRoot, encoding: 'utf8' });
spawnSync('git', ['merge', '--abort'], { cwd: this.projectRoot, encoding: 'utf8' });
spawnSync('git', ['commit', '-m', msg], { cwd: this.projectRoot, encoding: 'utf8' });
```

Only run integration checks after `validateCommand(check)` passes. If keeping shell execution for `npm run ...`, document it as intentionally allowlisted and fail closed on validation.

**Step 5: Fix hidden overlap detection**

Export a pure helper:

```ts
export function detectHiddenOverlapsFromFileLists(
  currentFiles: string[],
  otherFiles: string[],
  currentScope: string[],
  otherScope: string[]
): string[] {
  const overlaps = currentFiles.filter(file => otherFiles.includes(file));
  return overlaps.filter(file => !inScope(file, currentScope) && !inScope(file, otherScope));
}
```

Use a configured merge base if available. Fall back to `scope-freeze/pre-implementation`, then detected main branch. Do not hard-code `origin/master`.

**Step 6: Run tests and build**

Run:

```bash
npm --prefix orchestrator run test -- merge-queue
npm --prefix orchestrator run build
```

Expected: PASS.

**Step 7: Commit when requested**

```bash
git add orchestrator/src/orchestrator/merge-queue.ts orchestrator/src/orchestrator/merge-queue.test.ts
git commit -m "fix: harden merge queue command execution"
```

---

## Task 7: Add non-destructive recovery engine

**Files:**
- Create: `orchestrator/src/orchestrator/recovery.ts`
- Modify: `orchestrator/src/orchestrator/index.ts`
- Modify if needed: `tools/installer/wdf-cli.js`
- Test: `orchestrator/src/orchestrator/recovery.test.ts`

**Step 1: Write recovery tests**

Create `orchestrator/src/orchestrator/recovery.test.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { recoverStatus } from './recovery.js';

describe('recovery', () => {
  it('rebuilds corrupted derived sprint-status from split files', () => {
    const root = mkdtempSync(join(tmpdir(), 'wdf-recover-'));
    const out = join(root, '_bmad-output', 'wdf-method');
    const status = join(out, 'status');
    mkdirSync(status, { recursive: true });
    writeFileSync(join(status, 'global.yaml'), 'global_state:\n  project: test\n  workflow_version: 3.7.0\n');
    writeFileSync(join(status, 'phase-01.yaml'), 'phase_1:\n  status: LOCKED\n');
    writeFileSync(join(out, 'sprint-status.yaml'), 'not: [valid');

    const result = recoverStatus(root);

    expect(result.rebuiltDerivedStatus).toBe(true);
    expect(readFileSync(join(out, 'sprint-status.yaml'), 'utf8')).toContain('AUTO-GENERATED');
  });

  it('does not delete worktrees or branches', () => {
    const root = mkdtempSync(join(tmpdir(), 'wdf-recover-'));
    const result = recoverStatus(root);
    expect(result.actions.some(action => /delete|reset|revert|clean/i.test(action))).toBe(false);
  });
});
```

**Step 2: Run tests to verify failure**

Run:

```bash
npm --prefix orchestrator run test -- recovery
```

Expected: FAIL because `recovery.ts` does not exist.

**Step 3: Implement recovery module**

Create `orchestrator/src/orchestrator/recovery.ts`:

```ts
export interface RecoveryResult {
  rebuiltDerivedStatus: boolean;
  restoredFromBackup: string[];
  warnings: string[];
  actions: string[];
  dashboard: string;
}

export function recoverStatus(projectRoot: string): RecoveryResult {
  // locate _bmad-output/wdf-method/status
  // parse each status file independently
  // if sprint-status.yaml is missing/corrupt and split files are valid, rebuild derived index
  // if a split file is corrupt and backup exists, restore latest backup
  // collect warnings for anything unsafe or unresolved
  // do not delete/reset/revert/clean
}
```

Keep implementation conservative and deterministic.

**Step 4: Wire CLI entry**

If `orchestrator/src/orchestrator/index.ts` has command parsing, add:

```ts
case 'recover':
  console.log(recoverStatus(process.cwd()).dashboard);
  break;
```

If root installer CLI should expose it, add `recover` to `CMDS` in `tools/installer/wdf-cli.js` and print guidance or delegate to orchestrator if installed. Keep first pass simple.

**Step 5: Run tests and build**

Run:

```bash
npm --prefix orchestrator run test -- recovery
npm --prefix orchestrator run build
```

Expected: PASS.

**Step 6: Commit when requested**

```bash
git add orchestrator/src/orchestrator/recovery.ts orchestrator/src/orchestrator/recovery.test.ts orchestrator/src/orchestrator/index.ts tools/installer/wdf-cli.js
git commit -m "feat: add non-destructive status recovery"
```

---

## Task 8: Add engine fixture tests for critical path behavior

**Files:**
- Create: `orchestrator/src/orchestrator/engine-fixture.test.ts`
- Modify only if necessary: helper modules from previous tasks

**Step 1: Write fixture tests**

Create `orchestrator/src/orchestrator/engine-fixture.test.ts`:

```ts
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { GateEvaluator } from './gate-evaluator.js';
import { SprintStatusManager } from './sprint-status.js';
import { evaluateStoryReadyGate } from './story-ready-gate.js';
import { recoverStatus } from './recovery.js';

describe('engine fixture critical path', () => {
  it('fails closed, validates SRG, backs up state, and recovers derived status', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wdf-engine-'));
    const out = join(root, '_bmad-output', 'wdf-method');
    const statusDir = join(out, 'status');
    const storiesDir = join(out, 'stories');
    mkdirSync(statusDir, { recursive: true });
    mkdirSync(storiesDir, { recursive: true });
    mkdirSync(join(root, 'src', 'auth'), { recursive: true });
    writeFileSync(join(statusDir, 'global.yaml'), 'global_state:\n  project: fixture\n  workflow_version: 3.7.0\n');
    writeFileSync(join(storiesDir, 'S-1.1.md'), '# Story');

    const state = await SprintStatusManager.loadFromStatusDir(statusDir, join(out, 'sprint-status.yaml'));
    await state.setPhaseStatus(1, 'IN_PROGRESS' as any);
    expect(existsSync(join(statusDir, 'backup'))).toBe(true);

    const gate = new GateEvaluator(root);
    const gateResult = await gate.evaluate({ phase: 1, checks: [{ id: 'X', type: 'field_exists' as any, field: 'missing.value', description: 'missing' }], all_pass: false }, state);
    expect(gateResult.all_pass).toBe(false);

    const srg = evaluateStoryReadyGate({ story_id: 'S-1.1', title: 'Auth', track: 'backend', scope_write: ['src/auth'], acceptance_check: ['npm run test'] } as any, {
      projectRoot: root,
      storiesDir,
      activeStories: [],
      protectedPaths: [],
    });
    expect(srg.all_pass).toBe(true);

    writeFileSync(join(out, 'sprint-status.yaml'), 'broken: [');
    const recovery = recoverStatus(root);
    expect(recovery.rebuiltDerivedStatus).toBe(true);
  });
});
```

**Step 2: Run fixture test**

Run:

```bash
npm --prefix orchestrator run test -- engine-fixture
```

Expected: PASS after previous tasks.

**Step 3: Run full orchestrator tests**

Run:

```bash
npm --prefix orchestrator run test
npm --prefix orchestrator run build
```

Expected: PASS.

**Step 4: Commit when requested**

```bash
git add orchestrator/src/orchestrator/engine-fixture.test.ts
git commit -m "test: cover engine hardening critical path"
```

---

## Task 9: Final verification and documentation update

**Files:**
- Modify if needed: `orchestrator/README.md`
- Modify if needed: `README.md`
- Existing design: `docs/plans/2026-06-16-wdf-method-engine-hardening-design.md`
- This plan: `docs/plans/2026-06-16-wdf-method-engine-hardening-implementation.md`

**Step 1: Run all verification**

Run:

```bash
npm test
npm --prefix orchestrator run build
npm --prefix orchestrator run test
```

Expected: all pass.

**Step 2: Check working tree scope**

Run:

```bash
git diff --name-only
```

Expected: only targeted engine/test/package/docs files changed. No `node_modules/` changes should be introduced by this work.

**Step 3: Update docs only if behavior changed**

If recover command or root test behavior is exposed to users, update the relevant README section with concise usage:

```md
npm test
npm --prefix orchestrator run recover
```

Only document commands that actually exist after implementation.

**Step 4: Final commit when requested**

```bash
git add docs/plans/2026-06-16-wdf-method-engine-hardening-design.md docs/plans/2026-06-16-wdf-method-engine-hardening-implementation.md README.md orchestrator/README.md package.json package-lock.json orchestrator/src/orchestrator
git commit -m "fix: harden wdf-method execution engine"
```

---

## Execution Order

1. Task 1 — root test flow
2. Task 2 — command safety
3. Task 3 — status paths and backups
4. Task 4 — fail-closed gate evaluator
5. Task 5 — SRG module and StoryRunner wiring
6. Task 6 — merge queue safety
7. Task 7 — recovery engine
8. Task 8 — fixture critical path tests
9. Task 9 — final verification and docs

## Completion Criteria

- `npm test` passes.
- `npm --prefix orchestrator run build` passes.
- `npm --prefix orchestrator run test` passes.
- GateEvaluator does not silently pass unsupported checks.
- SRG-01 through SRG-09 are explicitly tested.
- Missing `scope_write`, missing `acceptance_check`, and missing story file fail.
- Protected paths produce serial-only scheduling metadata.
- Merge queue rejects unsafe branch names and integration checks.
- Merge failure path aborts and marks failed.
- State writes create backups.
- Recovery rebuilds corrupted derived status from split status files.
- No destructive recovery behavior is introduced.
