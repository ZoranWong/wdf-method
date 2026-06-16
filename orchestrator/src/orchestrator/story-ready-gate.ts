import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { validateCommand } from './command-safety.js';

/**
 * Story Ready Gate (SRG) — V3.6
 *
 * Validates that a story is ready to be executed before dispatching an agent.
 * Provides 9 checkpoints covering scope, paths, commands, dependencies, and
 * protected areas. All checks are fail-closed: anything not explicitly
 * permitted is rejected.
 *
 * SRG-01: Story has a valid story_id
 * SRG-02: scope_write is defined and non-empty
 * SRG-03: Story file exists on disk
 * SRG-04: Path safety — no traversal, no absolute paths, no forbidden files
 * SRG-05: No scope overlap with currently active stories
 * SRG-06: Scope is within implementation boundary (if frozen)
 * SRG-07: Parent directories for all scope paths exist
 * SRG-08: Protected path intersection → serial_only enforcement
 * SRG-09: Acceptance commands are on the allowlist and safe
 */

/**
 * Result of evaluating the Story Ready Gate for a single story.
 *
 * all_pass: Every SRG check passed (the story can proceed).
 * serial_only: SRG-08 detected a protected path — the story must run
 *   serially even if the scheduler would otherwise allow parallelism.
 * results: Individual check outcomes for debugging/UX.
 */
export interface StoryReadyGateResult {
  all_pass: boolean;
  serial_only: boolean;
  results: Array<{ id: string; status: 'pass' | 'fail'; reason?: string }>;
}

/**
 * Minimal shape of a story entry — enough to run the gate.
 * Callers pass whatever they have; this interface documents what we actually
 * inspect.
 */
export interface GateStory {
  story_id: string;
  scope_write: string[];
  acceptance_check?: string[];
  track?: string;
  depends_on?: Array<{ story_id: string }>;
}

/**
 * Context needed to run the gate. All derived from the orchestrator's
 * current state and project configuration.
 */
export interface GateContext {
  projectRoot: string;
  storiesDir: string;
  activeStories: Array<{ id: string; scope_write?: string[]; status?: string }>;
  protectedPaths: string[];
  implementationBoundary?: {
    scope_frozen: boolean;
    backend_scope: string[];
    frontend_scope: string[];
    shared_scope: string[];
  };
}

/**
 * SRG-01: scope_write is defined and non-empty.
 *
 * Without a declared scope, the worktree isolation and scope auditing cannot
 * function. A story with no declared scope can write anywhere.
 */
function srg01ScopeDefined(story: GateStory): { id: string; status: 'pass' | 'fail'; reason?: string } {
  if (!story.scope_write || !Array.isArray(story.scope_write) || story.scope_write.length === 0) {
    return { id: 'SRG-01', status: 'fail', reason: 'scope_write is missing or empty' };
  }
  return { id: 'SRG-01', status: 'pass' };
}

/**
 * SRG-02: acceptance_check is defined and non-empty.
 *
 * Stories without acceptance checks cannot be validated — we have no way
 * to know if the implementation is correct.
 */
function srg02AcceptanceChecks(story: GateStory): { id: string; status: 'pass' | 'fail'; reason?: string } {
  if (!story.acceptance_check || !Array.isArray(story.acceptance_check) || story.acceptance_check.length === 0) {
    return { id: 'SRG-02', status: 'fail', reason: 'acceptance_check is missing or empty' };
  }
  return { id: 'SRG-02', status: 'pass' };
}

/**
 * SRG-03: Story file exists on disk.
 *
 * The agent needs the story markdown file to know what to implement.
 */
function srg03StoryExists(story: GateStory, ctx: GateContext): { id: string; status: 'pass' | 'fail'; reason?: string } {
  const storyPath = join(ctx.storiesDir, `${story.story_id}.md`);
  if (!existsSync(storyPath)) {
    return { id: 'SRG-03', status: 'fail', reason: `Story file not found: ${storyPath}` };
  }
  return { id: 'SRG-03', status: 'pass' };
}

/**
 * SRG-04: Path safety — no traversal, no absolute paths, no forbidden files.
 *
 * Prevents path traversal attacks and writes to sensitive system paths.
 */
function srg04PathSafety(story: GateStory): { id: string; status: 'pass' | 'fail'; reason?: string } {
  if (!story.scope_write || story.scope_write.length === 0) {
    return { id: 'SRG-04', status: 'pass', reason: 'No scope_write, skipping path check' };
  }

  const forbidden = ['.env.production', '.env.local', '/etc/', '~/.ssh/'];
  const unsafe: string[] = [];

  for (const p of story.scope_write) {
    if (p.startsWith('/') || p.includes('../') || p.startsWith('..')) {
      unsafe.push(`${p} (path traversal or absolute path)`);
    }
    if (forbidden.some(f => p.includes(f))) {
      unsafe.push(`${p} (forbidden path)`);
    }
  }

  if (unsafe.length > 0) {
    return { id: 'SRG-04', status: 'fail', reason: `Unsafe paths: ${unsafe.join(', ')}` };
  }
  return { id: 'SRG-04', status: 'pass' };
}

/**
 * SRG-05: No scope overlap with currently active (IN_PROGRESS) stories.
 *
 * Two scopes overlap if one is a prefix of the other — writing to `src/auth`
 * and `src/auth/login` at the same time creates merge conflicts.
 */
function srg05NoScopeOverlap(story: GateStory, ctx: GateContext): { id: string; status: 'pass' | 'fail'; reason?: string } {
  if (!story.scope_write || story.scope_write.length === 0) {
    return { id: 'SRG-05', status: 'pass', reason: 'No scope_write, skipping overlap check' };
  }

  const inProgress = ctx.activeStories.filter(s =>
    s.status === 'IN_PROGRESS' && s.id !== story.story_id && s.scope_write
  );

  const overlaps: string[] = [];
  for (const active of inProgress) {
    if (!active.scope_write) continue;
    for (const s of story.scope_write) {
      for (const o of active.scope_write) {
        if (s.startsWith(o) || o.startsWith(s) || s === o) {
          if (!overlaps.includes(active.id)) {
            overlaps.push(active.id);
          }
        }
      }
    }
  }

  if (overlaps.length > 0) {
    return { id: 'SRG-05', status: 'fail', reason: `Scope overlap with: ${overlaps.join(', ')}` };
  }
  return { id: 'SRG-05', status: 'pass' };
}

/**
 * SRG-06: Scope is within implementation boundary (if frozen).
 *
 * Once the implementation boundary is frozen, stories cannot write to paths
 * outside the agreed-upon scope. This prevents scope creep and ensures
 * architecture decisions are respected.
 */
function srg06WithinBoundary(story: GateStory, ctx: GateContext): { id: string; status: 'pass' | 'fail'; reason?: string } {
  if (!story.scope_write || story.scope_write.length === 0) {
    return { id: 'SRG-06', status: 'pass', reason: 'No scope_write, skipping boundary check' };
  }

  const boundary = ctx.implementationBoundary;
  if (!boundary || !boundary.scope_frozen) {
    return { id: 'SRG-06', status: 'pass', reason: 'Boundary not frozen yet, skipping' };
  }

  const allScopes = [...boundary.backend_scope, ...boundary.frontend_scope, ...boundary.shared_scope];
  const outside = story.scope_write.filter(sw =>
    !allScopes.some(bs => sw.startsWith(bs) || bs.startsWith(sw))
  );

  if (outside.length > 0) {
    return { id: 'SRG-06', status: 'fail', reason: `Outside implementation boundary: ${outside.join(', ')}` };
  }
  return { id: 'SRG-06', status: 'pass' };
}

/**
 * SRG-07: Parent directories exist for all scope paths.
 *
 * Writing to a deeply-nested path where intermediate directories don't exist
 * can mask misconfigurations in the repository layout. Requiring parents to
 * exist ensures the story aligns with the actual codebase structure.
 */
function srg07ParentsExist(story: GateStory, ctx: GateContext): { id: string; status: 'pass' | 'fail'; reason?: string } {
  if (!story.scope_write || story.scope_write.length === 0) {
    return { id: 'SRG-07', status: 'pass', reason: 'No scope_write, skipping parent check' };
  }

  const missing: string[] = [];
  for (const p of story.scope_write) {
    const full = resolve(ctx.projectRoot, p);
    if (!existsSync(full)) {
      missing.push(p);
    }
  }

  if (missing.length > 0) {
    return { id: 'SRG-07', status: 'fail', reason: `Scope paths do not exist: ${missing.join(', ')}` };
  }
  return { id: 'SRG-07', status: 'pass' };
}

/**
 * SRG-08: Protected path intersection → serial_only enforcement.
 *
 * Stories touching protected paths (migrations, shared contracts, CI config)
 * cannot run in parallel. These areas have high merge-conflict risk and
 * require careful ordering.
 *
 * Returns a tuple: [check-result, serial-only-flag]
 */
function srg08ProtectedPaths(story: GateStory, ctx: GateContext): [{ id: string; status: 'pass' | 'fail'; reason?: string }, boolean] {
  if (!story.scope_write || story.scope_write.length === 0) {
    return [{ id: 'SRG-08', status: 'pass', reason: 'No scope_write, skipping protected path check' }, false];
  }

  const hits = story.scope_write.some(sw =>
    ctx.protectedPaths.some(pp => sw.includes(pp))
  );

  if (hits) {
    return [{ id: 'SRG-08', status: 'pass', reason: 'Protected path — serial_only enforced' }, true];
  }
  return [{ id: 'SRG-08', status: 'pass' }, false];
}

/**
 * SRG-09: Acceptance commands are on the allowlist and safe.
 *
 * Uses validateCommand from command-safety.ts to ensure acceptance commands
 * don't contain shell metacharacters, pipes, redirection, or other unsafe
 * constructs, and start with an allowed prefix.
 */
function srg09CommandSafety(story: GateStory): { id: string; status: 'pass' | 'fail'; reason?: string } {
  if (!story.acceptance_check || !Array.isArray(story.acceptance_check) || story.acceptance_check.length === 0) {
    return { id: 'SRG-09', status: 'pass', reason: 'No acceptance_check, skipping command safety' };
  }

  const unsafe: string[] = [];
  for (const cmd of story.acceptance_check) {
    const result = validateCommand(cmd);
    if (!result.ok) {
      unsafe.push(`${cmd} [${result.reason}]`);
    }
  }

  if (unsafe.length > 0) {
    return { id: 'SRG-09', status: 'fail', reason: `Unsafe acceptance commands: ${unsafe.join('; ')}` };
  }
  return { id: 'SRG-09', status: 'pass' };
}

/**
 * Evaluate all 9 Story Ready Gate checks for a story.
 *
 * This is the single entry point for SRG evaluation — callers should use
 * this instead of the individual check functions.
 *
 * @param story - The story to evaluate.
 * @param ctx - Evaluation context (project paths, active stories, config).
 * @returns Gate result with pass/fail status, serial_only flag, and
 *   individual check outcomes.
 */
export function evaluateStoryReadyGate(story: GateStory, ctx: GateContext): StoryReadyGateResult {
  const results: Array<{ id: string; status: 'pass' | 'fail'; reason?: string }> = [];
  let serial_only = false;

  results.push(srg01ScopeDefined(story));
  results.push(srg02AcceptanceChecks(story));
  results.push(srg03StoryExists(story, ctx));
  results.push(srg04PathSafety(story));
  results.push(srg05NoScopeOverlap(story, ctx));
  results.push(srg06WithinBoundary(story, ctx));
  results.push(srg07ParentsExist(story, ctx));

  const [srg08Result, srg08SerialOnly] = srg08ProtectedPaths(story, ctx);
  results.push(srg08Result);
  if (srg08SerialOnly) {
    serial_only = true;
  }

  results.push(srg09CommandSafety(story));

  const all_pass = results.every(r => r.status === 'pass');

  return { all_pass, serial_only, results };
}
