import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { spawn, execSync } from 'child_process';
import { StoryEntry, Track, AgentDispatchResult } from './types.js';
import { appendAudit } from './audit-logger.js';
import { assertSafeIdentifier } from './command-safety.js';
import {
  readResult,
  validateAgentDispatchResult,
  agentResultPath,
  AGENT_RESULT_RELPATH,
} from '../agent/write-result.js';

/**
 * Agent dispatch configuration.
 */
export interface AgentDispatchConfig {
  worktreePath: string;
  storyId: string;
  track: Track;
  timeoutMinutes: number;
  /**
   * Maximum number of dispatch attempts (1 = no retry on transient failure).
   * The orchestrator may retry once when the agent exits non-zero AND the
   * result file is missing — clearly a process / wiring failure rather than
   * an acceptance failure.
   */
  maxRetries: number;
}

/**
 * Legacy return shape kept for backward compatibility with `story-runner.ts`
 * and other call sites that switch on `status === 'CODE_ACCEPTED'`. New code
 * should consume the structured `AgentDispatchResult` returned by
 * `dispatchStoryAgent` (the standalone function).
 */
export interface AgentResult {
  storyId: string;
  status: 'CODE_ACCEPTED' | 'FAILED' | 'TIMEOUT' | 'BLOCKED_BY_DEPENDENCY';
  summary: string;
  exitCode: number;
  durationMs: number;
  /** Full structured result if the agent successfully wrote one. */
  dispatchResult?: AgentDispatchResult;
}

/**
 * Options accepted by the standalone `dispatchStoryAgent` function.
 * Mirrors `AgentDispatchConfig` plus a few hooks for testability.
 */
export interface DispatchOptions {
  worktreePath: string;
  track: Track;
  timeoutMinutes: number;
  maxRetries?: number;
  projectRoot: string;
  storiesDir: string;
  outputDir: string;
  /**
   * Override the spawn implementation. Tests inject a fake spawner that
   * writes a result file synchronously and resolves the child without going
   * through `claude`. Production callers should leave this unset.
   */
  spawnImpl?: typeof spawn;
}

/**
 * AgentPromptBuilder constructs the minimal context prompt for each story agent.
 * Following the "One Story = One Agent = One Worktree = One Context" principle,
 * each agent receives only: story file, api-spec, architecture, db-schema/design-tokens, code standards.
 */
export class AgentPromptBuilder {
  private projectRoot: string;
  private storiesDir: string;
  private outputDir: string;

  constructor(projectRoot: string, storiesDir: string, outputDir: string) {
    this.projectRoot = projectRoot;
    this.storiesDir = storiesDir;
    this.outputDir = outputDir;
  }

  /**
   * Build the agent prompt for a story implementation.
   * The prompt includes only the minimum necessary context (~38KB).
   */
  buildPrompt(story: StoryEntry, track: Track): string {
    const storyFile = join(this.storiesDir, `${story.story_id}.md`);
    const apiSpecFile = join(this.outputDir, 'api-spec.yaml');
    const archFile = join(this.outputDir, 'architecture.md');
    const dbSchemaFile = join(this.outputDir, 'db-schema.md');
    const designTokensFile = join(this.outputDir, '_output', 'planning', 'design-tokens.md');
    const codeStandardsFile = join(this.projectRoot, 'AGENTS.md');

    const isFE = track === 'frontend';

    const prompt = [
      `You are implementing Story ${story.story_id}: ${story.title}`,
      `Track: ${track.toUpperCase()}`,
      '',
      `=== YOUR SCOPE ===`,
      `Files you MAY modify:`,
      ...story.scope_write.map(s => `  - ${s}`),
      '',
      `Files you MUST NOT touch (scope_lock strict):`,
      `  Everything outside scope_write above.`,
      '',
      `=== ACCEPTANCE CHECKS ===`,
      ...(story.acceptance_check?.map(c => `  [ ] ${c}`) ?? ['  [ ] No acceptance checks defined — define them before coding']),
      '',
      `=== EXECUTION STEPS ===`,
      `4b: Read the story file and mark status IN_PROGRESS`,
      `4c: Implement the code (follow architecture.md patterns, api-spec.yaml contract)`,
      `4d: Write tests — unit tests for services, integration tests for endpoints`,
      `4e: Validate against api-spec.yaml — check request/response shapes match`,
      `4f: Generate self-check.md and handoff.md`,
      `4f2/4h2: Scope Exit Verification — git diff HEAD must be within scope_write`,
      `4g: Run acceptance checks — all commands must exit 0`,
      `4h: CODE ACCEPTANCE: verify MG-01 through MG-09`,
      `4j/4k: Mark CODE_ACCEPTED and return result`,
      '',
      `=== COMMIT DISCIPLINE ===`,
      `You MUST commit at these 3 milestones (minimum):`,
      `  1. After step 4c: "${story.story_id}: ${story.title} — IMPLEMENTED"`,
      `  2. After step 4f: "${story.story_id}: ${story.title} — TESTED + SUBMITTED"`,
      `  3. After step 4j/4k: "${story.story_id}: ${story.title} — CODE_ACCEPTED"`,
      '',
      `=== REQUIRED CONTEXT FILES ===`,
    ];

    // Required context files with existence check
    const contextFiles: { path: string; label: string; required: boolean }[] = [
      { path: storyFile, label: 'Story definition', required: true },
      { path: apiSpecFile, label: 'API spec (contract)', required: true },
      { path: archFile, label: 'Architecture constraints', required: true },
      { path: dbSchemaFile, label: 'DB schema', required: !isFE },
      { path: designTokensFile, label: 'Design tokens', required: isFE },
      { path: codeStandardsFile, label: 'Code standards', required: false },
    ];

    for (const { path, label, required } of contextFiles) {
      if (existsSync(path)) {
        prompt.push(`  📄 ${label}: ${path}`);
      } else if (required) {
        prompt.push(`  ⚠ ${label} NOT FOUND at ${path} — this may cause implementation issues`);
      }
    }

    prompt.push('');
    prompt.push('=== RETURN VALUE ===');
    prompt.push('When done, write a JSON document to:');
    prompt.push(`  ./${AGENT_RESULT_RELPATH}`);
    prompt.push('with the following shape (no stdout parsing is used):');
    prompt.push('  {');
    prompt.push(`    "status": "success" | "failed" | "blocked",`);
    prompt.push(`    "story_id": "${story.story_id}",`);
    prompt.push('    "files_changed": ["path/relative/to/worktree", ...],');
    prompt.push('    "tests_passed": <number>,');
    prompt.push('    "tests_total": <number>,');
    prompt.push('    "summary": "<1-line summary>",');
    prompt.push('    "duration_ms": <number>,');
    prompt.push('    "error": "<optional, only when status != success>"');
    prompt.push('  }');
    prompt.push('Use status="success" only when all acceptance checks pass.');

    return prompt.join('\n');
  }

  /**
   * Read the story file content (for inclusion in full agent context).
   */
  readStoryContent(story: StoryEntry): string {
    const storyFile = join(this.storiesDir, `${story.story_id}.md`);
    if (!existsSync(storyFile)) {
      return `⚠ Story file not found: ${storyFile}`;
    }
    return readFileSync(storyFile, 'utf-8');
  }
}

/**
 * Map a structured `AgentDispatchResult` (file-based) to the legacy
 * `AgentResult` shape consumed by `story-runner.ts`.
 */
function toLegacyResult(
  storyId: string,
  result: AgentDispatchResult,
  exitCode: number,
): AgentResult {
  let legacyStatus: AgentResult['status'];
  switch (result.status) {
    case 'success':
      legacyStatus = 'CODE_ACCEPTED';
      break;
    case 'timeout':
      legacyStatus = 'TIMEOUT';
      break;
    case 'blocked':
      legacyStatus = 'BLOCKED_BY_DEPENDENCY';
      break;
    case 'failed':
    default:
      legacyStatus = 'FAILED';
      break;
  }
  return {
    storyId,
    status: legacyStatus,
    summary: result.summary,
    exitCode,
    durationMs: result.duration_ms,
    dispatchResult: result,
  };
}

/**
 * Build a synthetic `AgentDispatchResult` for failure / timeout cases when
 * the agent never wrote a file.
 */
function syntheticResult(
  storyId: string,
  status: AgentDispatchResult['status'],
  summary: string,
  durationMs: number,
  error?: string,
): AgentDispatchResult {
  return {
    status,
    story_id: storyId,
    files_changed: [],
    tests_passed: 0,
    tests_total: 0,
    summary,
    duration_ms: durationMs,
    error,
  };
}

/**
 * Standalone, file-based dispatch entry point.
 *
 * Spawns Claude Code in the worktree, waits for the child to exit, then
 * reads `_wdf_output/agent-result.json` from the worktree. No regex / stdout
 * parsing. If the child exits cleanly but the result file is missing, the
 * dispatcher retries up to `maxRetries` times. If the child times out but a
 * partially-written result file is on disk, that file is honoured.
 */
export async function dispatchStoryAgent(
  story: StoryEntry,
  options: DispatchOptions,
): Promise<AgentDispatchResult> {
  // Defensive identifier validation — guards against `..` traversal in
  // story IDs that would otherwise be embedded in file paths.
  assertSafeIdentifier(story.story_id, 'story.story_id');

  const maxAttempts = Math.max(1, options.maxRetries ?? 1);
  let attempt = 0;
  let lastSyntheticError: string | undefined;
  const startTime = Date.now();

  // Clean any stale result file from a prior aborted run so a missing file
  // unambiguously means "agent did not produce one".
  const resultFile = agentResultPath(options.worktreePath);
  if (existsSync(resultFile)) {
    try {
      rmSync(resultFile, { force: true });
    } catch {
      // Best-effort: a leftover file just means we'll trust the latest one.
    }
  }

  const promptBuilder = new AgentPromptBuilder(
    options.projectRoot,
    options.storiesDir,
    options.outputDir,
  );
  const prompt = promptBuilder.buildPrompt(story, options.track);
  const storyContent = promptBuilder.readStoryContent(story);

  // Persist the prompt as a debugging aid; the agent does NOT need to read
  // it back because `-p` carries the prompt directly.
  const promptDir = join(options.worktreePath, '.claude', 'agent-prompts');
  mkdirSync(promptDir, { recursive: true });
  const promptFile = join(promptDir, `${story.story_id}.md`);
  writeFileSync(
    promptFile,
    `# Story Agent Prompt — ${story.story_id}\n\n${prompt}\n\n---\n\n## Story File\n\n${storyContent}`,
    'utf-8',
  );

  while (attempt < maxAttempts) {
    attempt += 1;
    const attemptStart = Date.now();
    const outcome = await runAgentOnce(story, options, prompt, attemptStart);

    if (outcome.kind === 'result') {
      // Result file present — trust it (validated by readResult).
      return { ...outcome.result, duration_ms: Date.now() - startTime };
    }

    if (outcome.kind === 'timeout') {
      // Salvage attempt — the agent may have written the file just before
      // we killed it. If so, return that; otherwise emit a synthetic timeout.
      const salvaged = trySalvage(options.worktreePath);
      if (salvaged) {
        return { ...salvaged, duration_ms: Date.now() - startTime };
      }
      return syntheticResult(
        story.story_id,
        'timeout',
        `Agent timed out after ${options.timeoutMinutes} minutes (attempt ${attempt}/${maxAttempts})`,
        Date.now() - startTime,
        outcome.error,
      );
    }

    // outcome.kind === 'no_file' or 'spawn_error' — retry if budget allows.
    lastSyntheticError = outcome.error;

    // If a partial file was somehow written even on a non-zero exit, honour it.
    const salvaged = trySalvage(options.worktreePath);
    if (salvaged) {
      return { ...salvaged, duration_ms: Date.now() - startTime };
    }

    if (attempt >= maxAttempts) {
      return syntheticResult(
        story.story_id,
        'failed',
        `Dispatch failed after ${attempt} attempt(s): ${outcome.error}`,
        Date.now() - startTime,
        outcome.error,
      );
    }
    // else: loop and retry
  }

  // Should be unreachable.
  return syntheticResult(
    story.story_id,
    'failed',
    'Dispatch exhausted retry budget without resolving',
    Date.now() - startTime,
    lastSyntheticError,
  );
}

type RunOutcome =
  | { kind: 'result'; result: AgentDispatchResult }
  | { kind: 'no_file'; error: string }
  | { kind: 'spawn_error'; error: string }
  | { kind: 'timeout'; error: string };

/**
 * Run a single agent attempt and resolve to a structured outcome. This
 * function never throws — all error paths funnel into `RunOutcome` so the
 * retry loop is straightforward.
 */
function runAgentOnce(
  story: StoryEntry,
  options: DispatchOptions,
  prompt: string,
  attemptStart: number,
): Promise<RunOutcome> {
  const timeoutMs = options.timeoutMinutes * 60 * 1000;
  const spawnFn = options.spawnImpl ?? spawn;

  return new Promise((resolveOutcome) => {
    let timedOut = false;
    let stderrBuf = '';

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* already exited */
      }
      resolveOutcome({
        kind: 'timeout',
        error: `agent did not exit within ${options.timeoutMinutes} minutes`,
      });
    }, timeoutMs);

    let child: ReturnType<typeof spawn>;
    try {
      child = spawnFn(
        'claude',
        [
          '--print',
          '--output-format',
          'json',
          '--allowedTools',
          'Read,Write,Edit,Bash(ls),Bash(git *),Bash(npm *),Bash(npx *)',
          '-p',
          prompt,
        ],
        {
          cwd: options.worktreePath,
          env: { ...process.env, CI: 'true' },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
    } catch (err: any) {
      clearTimeout(timer);
      resolveOutcome({
        kind: 'spawn_error',
        error: `failed to spawn claude: ${err?.message ?? String(err)}`,
      });
      return;
    }

    child.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      stderrBuf += msg;
      // Surface only non-noise stderr to the orchestrator log; never parsed.
      if (!msg.includes('Warning') && !msg.includes('info')) {
        console.error(`     [${story.story_id}] ${msg.trim()}`);
      }
    });

    // We deliberately ignore stdout — the agent communicates via the result
    // file. Drain it to prevent backpressure stalls.
    child.stdout?.on('data', () => {
      /* discard */
    });

    child.on('error', (err: Error) => {
      if (timedOut) return;
      clearTimeout(timer);
      resolveOutcome({
        kind: 'spawn_error',
        error: `claude process error: ${err.message}`,
      });
    });

    child.on('close', (code: number | null) => {
      if (timedOut) return;
      clearTimeout(timer);

      // Always look for the file first — exit code is advisory.
      let result: AgentDispatchResult | null = null;
      try {
        result = readResult(options.worktreePath);
      } catch (err: any) {
        resolveOutcome({
          kind: 'no_file',
          error: `result file present but invalid: ${err.message}`,
        });
        return;
      }

      if (result) {
        // Stamp the actual elapsed time so callers see real wall-clock duration.
        const elapsed = Date.now() - attemptStart;
        if (result.duration_ms === 0 || result.duration_ms > elapsed) {
          result.duration_ms = elapsed;
        }
        resolveOutcome({ kind: 'result', result });
        return;
      }

      const tail = stderrBuf.slice(-200).trim();
      resolveOutcome({
        kind: 'no_file',
        error:
          code === 0
            ? `agent exited cleanly but did not write ${AGENT_RESULT_RELPATH}`
            : `agent exited with code ${code} and did not write ${AGENT_RESULT_RELPATH}: ${tail}`,
      });
    });
  });
}

/**
 * Look for an agent result file and return it if it parses. Used after a
 * timeout or non-zero exit to recover any structured output the agent
 * managed to flush before being killed.
 */
function trySalvage(worktreePath: string): AgentDispatchResult | null {
  try {
    return readResult(worktreePath);
  } catch {
    return null;
  }
}

/**
 * AgentDispatcher — backward-compatible wrapper exposing the legacy
 * `AgentResult` shape used by `story-runner.ts`. Internally delegates to
 * the file-based `dispatchStoryAgent` function.
 */
export class AgentDispatcher {
  private projectRoot: string;
  private storiesDir: string;
  private outputDir: string;
  private promptBuilder: AgentPromptBuilder;

  constructor(projectRoot: string, storiesDir: string, outputDir: string) {
    this.projectRoot = projectRoot;
    this.storiesDir = storiesDir;
    this.outputDir = outputDir;
    this.promptBuilder = new AgentPromptBuilder(projectRoot, storiesDir, outputDir);
  }
  /**
   * Dispatch a story agent via Claude Code CLI.
   * Delegates to the standalone dispatchStoryAgent function for the actual execution.
   */
  async dispatchStoryAgent(
    story: StoryEntry,
    config: AgentDispatchConfig,
  ): Promise<AgentResult> {
    console.log(`  🚀 Dispatching agent for ${story.story_id} (${config.track})...`);
    console.log(`     Worktree: ${config.worktreePath}`);

    appendAudit(this.projectRoot, 'agent_dispatch_start', {
      status: 'info',
      story_id: story.story_id,
      message: `dispatch ${story.story_id} (${config.track})`,
      details: {
        track: config.track,
        worktree: config.worktreePath,
        timeout_minutes: config.timeoutMinutes,
      },
    });

    const dispatchResult = await dispatchStoryAgent(story, {
      ...config,
      projectRoot: this.projectRoot,
      storiesDir: this.storiesDir,
      outputDir: this.outputDir,
      maxRetries: 1,
    });

    const exitCode = dispatchResult.status === 'success' ? 0 : -1;
    const result = toLegacyResult(story.story_id, dispatchResult, exitCode);

    appendAudit(this.projectRoot, 'agent_dispatch_complete', {
      status: result.status === 'CODE_ACCEPTED' ? 'pass' : 'fail',
      story_id: story.story_id,
      message: `${result.status} (${(result.durationMs / 1000).toFixed(1)}s): ${result.summary || '-'}`,
      details: {
        track: config.track,
        exit_code: result.exitCode,
        duration_ms: result.durationMs,
      },
    });

    return result;
  }

  /**
   * Dispatch multiple story agents in parallel, respecting the concurrency limit.
   */
  async dispatchParallel(
    stories: StoryEntry[],
    configs: AgentDispatchConfig[],
    maxConcurrent: number,
  ): Promise<AgentResult[]> {
    const results: AgentResult[] = [];
    const queue = stories.map((s, i) => ({ story: s, config: configs[i] }));

    for (let i = 0; i < queue.length; i += maxConcurrent) {
      const batch = queue.slice(i, i + maxConcurrent);
      console.log(
        `\n  📦 Batch ${Math.floor(i / maxConcurrent) + 1}: ${batch.map(b => b.story.story_id).join(', ')}`,
      );

      const batchResults = await Promise.all(
        batch.map(({ story, config }) => this.dispatchStoryAgent(story, config)),
      );
      results.push(...batchResults);

      for (const r of batchResults) {
        const icon = r.status === 'CODE_ACCEPTED' ? '✓' : r.status === 'TIMEOUT' ? '⏱' : '✗';
        console.log(
          `  ${icon} ${r.storyId}: ${r.status} (${(r.durationMs / 1000).toFixed(1)}s)`,
        );
      }
    }

    return results;
  }
}

// Re-export schema validator so tests and other call sites can validate
// arbitrary JSON without importing the agent helper module directly.
export { validateAgentDispatchResult };
