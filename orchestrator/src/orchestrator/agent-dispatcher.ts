import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'fs';
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
import {
  HeartbeatEmitter,
  CheckpointWriter,
  computeProjectHash,
  cleanupAgent,
} from './signal-manager.js';

/**
 * 支持的 AI 编辑器/工具类型
 */
export type AgentTool =
  | 'claude-code'      // Anthropic Claude Code
  | 'cursor'           // Cursor (内置 Claude)
  | 'cline'            // Cline (VS Code 扩展)
  | 'vscode-claude'    // VS Code Claude 扩展
  | 'codex'            // OpenAI Codex CLI
  | 'gemini'           // Google Gemini CLI
  | 'copilot'          // GitHub Copilot CLI
  | 'windsurf'         // Windsurf (Codeium)
  | 'unknown';

/**
 * Agent 提供者接口
 * 不同工具实现不同的调度策略
 */
export interface AgentProvider {
  tool: AgentTool;
  name: string;
  /** Binary name to spawn. CLI must be on PATH for the provider's detect() to succeed. */
  command: string;
  detect(): boolean;
  buildArgs(prompt: string, worktree: string): string[];
  getEnvOverrides(): NodeJS.ProcessEnv;
}

// ============================================================================
// Claude Code Provider (默认 + 最完整支持)
// ============================================================================
const ClaudeCodeProvider: AgentProvider = {
  tool: 'claude-code',
  name: 'Claude Code',
  command: 'claude',

  detect(): boolean {
    try {
      execSync('claude --version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  },

  buildArgs(prompt: string): string[] {
    return [
      '--bare',           // 最小模式：禁用所有 skills/plugins/hooks
      '--fork-session',   // 全新会话，100% 上下文隔离
      '--allowed-tools',
      'Read,Write,Edit,Bash(ls),Bash(git),Bash(npm),Bash(npx)',
      '-p',
      prompt,
    ];
  },

  getEnvOverrides(): NodeJS.ProcessEnv {
    return {
      CI: 'true',
      WDF_AGENT_MODE: 'claude-code',
    };
  },
};

// ============================================================================
// Cursor Provider
// ============================================================================
const CursorProvider: AgentProvider = {
  tool: 'cursor',
  name: 'Cursor',
  command: 'claude',

  detect(): boolean {
    // Cursor 通过环境变量检测
    return !!(process.env.CURSOR_PATH || process.env.VSCODE_CURSOR_MODE);
  },

  buildArgs(prompt: string, worktree: string): string[] {
    // Cursor 目前没有官方 CLI，但可以通过 Claude Code 兼容模式
    // 实际使用时 Cursor 用户需要先安装 claude CLI
    return ClaudeCodeProvider.buildArgs(prompt, worktree);
  },

  getEnvOverrides(): NodeJS.ProcessEnv {
    return {
      ...ClaudeCodeProvider.getEnvOverrides(),
      WDF_AGENT_MODE: 'cursor',
    };
  },
};

// ============================================================================
// Unknown Provider - 降级模式
// ============================================================================
const UnknownProvider: AgentProvider = {
  tool: 'unknown',
  name: 'Unknown (Fallback)',
  command: 'claude',

  detect(): boolean {
    return true; // 总是匹配
  },

  buildArgs(prompt: string, _worktree: string): string[] {
    // 降级：只使用基础参数，不使用特殊特性
    return ['-p', prompt];
  },

  getEnvOverrides(): NodeJS.ProcessEnv {
    return {
      CI: 'true',
      WDF_AGENT_MODE: 'fallback',
    };
  },
};

// ============================================================================
// OpenAI Codex Provider
// ============================================================================
const CodexProvider: AgentProvider = {
  tool: 'codex',
  name: 'OpenAI Codex CLI',
  command: 'codex',

  detect(): boolean {
    try {
      execSync('codex --version', { stdio: 'ignore' });
      return true;
    } catch {
      // Also check for codex env var as fallback
      return !!(process.env.CODEX_HOME || process.env.OPENAI_CODEX_PATH);
    }
  },

  buildArgs(prompt: string, _worktree: string): string[] {
    return [
      'exec',
      '--no-interactive',
      '--model', 'gpt-5',
      '--allowed-tools', 'read,write,edit,bash',
      prompt,
    ];
  },

  getEnvOverrides(): NodeJS.ProcessEnv {
    return {
      CI: 'true',
      WDF_AGENT_MODE: 'codex',
      CODEX_NO_COLOR: 'true',
      // Codex respects OPENAI_API_KEY from environment
    };
  },
};

// ============================================================================
// Google Gemini CLI Provider
// ============================================================================
const GeminiProvider: AgentProvider = {
  tool: 'gemini',
  name: 'Google Gemini CLI',
  command: 'gemini',

  detect(): boolean {
    try {
      execSync('gemini --version', { stdio: 'ignore' });
      return true;
    } catch {
      // Check for gemini env
      return !!(process.env.GEMINI_CLI_PATH || process.env.GOOGLE_GEMINI_CLI);
    }
  },

  buildArgs(prompt: string, _worktree: string): string[] {
    return [
      '--prompt', prompt,
      '--no-extensions',
      '--output-format', 'json',
      '--tool-restriction', 'read,write,edit,bash',
    ];
  },

  getEnvOverrides(): NodeJS.ProcessEnv {
    return {
      CI: 'true',
      WDF_AGENT_MODE: 'gemini',
      GEMINI_NO_COLOR: 'true',
    };
  },
};

// ============================================================================
// GitHub Copilot CLI Provider
// ============================================================================
const CopilotProvider: AgentProvider = {
  tool: 'copilot',
  name: 'GitHub Copilot CLI',
  command: 'gh',

  detect(): boolean {
    // `gh copilot --help` exists if the copilot extension is installed.
    try {
      execSync('gh copilot --help', { stdio: 'ignore' });
      return true;
    } catch {
      // Allow override via env for CI / dev containers.
      return !!process.env.COPILOT_CLI_PATH;
    }
  },

  buildArgs(prompt: string): string[] {
    // `gh copilot suggest` is non-interactive when given --target shell -t.
    // For an agentic prompt we use `gh copilot explain` with the prompt.
    // NOTE: Copilot CLI is suggestion-focused, not a full agent runtime —
    // prompts are limited compared to Claude Code / Codex.
    return ['copilot', 'suggest', '-t', 'shell', prompt];
  },

  getEnvOverrides(): NodeJS.ProcessEnv {
    return {
      CI: 'true',
      WDF_AGENT_MODE: 'copilot',
      GH_COPILOT_NO_COLOR: 'true',
    };
  },
};

// ============================================================================
// Windsurf (Codeium) Provider
// ============================================================================
const WindsurfProvider: AgentProvider = {
  tool: 'windsurf',
  name: 'Windsurf (Codeium)',
  command: 'windsurf',

  detect(): boolean {
    try {
      execSync('windsurf --version', { stdio: 'ignore' });
      return true;
    } catch {
      return !!process.env.WINDSURF_CLI_PATH;
    }
  },

  buildArgs(prompt: string, worktree: string): string[] {
    // Windsurf CLI exposes `windsurf agent run` for headless agent execution.
    return ['agent', 'run', '--prompt', prompt, '--cwd', worktree];
  },

  getEnvOverrides(): NodeJS.ProcessEnv {
    return {
      CI: 'true',
      WDF_AGENT_MODE: 'windsurf',
      WINDSURF_NO_COLOR: '1',
    };
  },
};

// ============================================================================
// Cline (VS Code Extension) Provider
// ============================================================================
// Cline is a VS Code extension, not a standalone CLI. Dispatch is best-effort:
// we write the prompt to a file Cline watches (`.cline/prompt.txt`) and rely on
// a configured task watcher to pick it up. This is the same pattern used by
// vibe-kanban and similar orchestration layers.
const ClineProvider: AgentProvider = {
  tool: 'cline',
  name: 'Cline (VS Code Extension)',
  command: 'code',

  detect(): boolean {
    // Cline itself has no CLI; we detect the host editor + extension folder.
    try {
      execSync('code --version', { stdio: 'ignore' });
      // Best-effort check for the Cline extension directory.
      const extPaths = [
        join(process.env.HOME ?? '', '.vscode', 'extensions'),
        join(process.env.HOME ?? '', '.vscode-server', 'extensions'),
      ];
      for (const p of extPaths) {
        try {
          if (existsSync(p) && readdirSync(p).some(d => d.startsWith('saoudrizwan.claude-dev'))) {
            return true;
          }
        } catch { /* ignore */ }
      }
      return false;
    } catch {
      return !!process.env.CLINE_VSCODE;
    }
  },

  buildArgs(prompt: string, worktree: string): string[] {
    // Open VS Code on the worktree; the user must trigger Cline manually.
    // We additionally write the prompt to `.cline/prompt.txt` in the worktree
    // so the user can paste it into Cline.
    const promptDir = join(worktree, '.cline');
    try { mkdirSync(promptDir, { recursive: true }); } catch { /* ignore */ }
    writeFileSync(join(promptDir, 'prompt.txt'), prompt, 'utf8');
    return ['--reuse-window', worktree];
  },

  getEnvOverrides(): NodeJS.ProcessEnv {
    return {
      CI: 'true',
      WDF_AGENT_MODE: 'cline',
    };
  },
};

// ============================================================================
// VS Code Claude Extension Provider
// ============================================================================
const VSCodeClaudeProvider: AgentProvider = {
  tool: 'vscode-claude',
  name: 'VS Code Claude Extension',
  command: 'code',

  detect(): boolean {
    try {
      execSync('code --version', { stdio: 'ignore' });
      const extPaths = [
        join(process.env.HOME ?? '', '.vscode', 'extensions'),
        join(process.env.HOME ?? '', '.vscode-server', 'extensions'),
      ];
      for (const p of extPaths) {
        try {
          if (existsSync(p) && readdirSync(p).some(d => d.startsWith('anthropic.claude-'))) {
            return true;
          }
        } catch { /* ignore */ }
      }
      return false;
    } catch {
      return !!process.env.VSCODE_CLAUDE;
    }
  },

  buildArgs(prompt: string, worktree: string): string[] {
    const promptDir = join(worktree, '.vscode-claude');
    try { mkdirSync(promptDir, { recursive: true }); } catch { /* ignore */ }
    writeFileSync(join(promptDir, 'prompt.txt'), prompt, 'utf8');
    return ['--reuse-window', worktree];
  },

  getEnvOverrides(): NodeJS.ProcessEnv {
    return {
      CI: 'true',
      WDF_AGENT_MODE: 'vscode-claude',
    };
  },
};

/**
 * 已注册的 Provider 优先级列表
 * 按优先级排序，第一个匹配的获胜
 */
export const PROVIDERS: AgentProvider[] = [
  ClaudeCodeProvider,
  CodexProvider,
  GeminiProvider,
  CursorProvider,
  CopilotProvider,
  WindsurfProvider,
  ClineProvider,
  VSCodeClaudeProvider,
];

/**
 * 检测当前运行环境，选择最合适的 Agent Provider
 */
export function detectAgentProvider(): AgentProvider {
  // Allow explicit override (CI, dev containers, user preference).
  const forced = process.env.WDF_FORCE_PROVIDER;
  if (forced) {
    const match = PROVIDERS.find(p => p.tool === forced || p.command === forced);
    if (match) return match;
  }
  for (const provider of PROVIDERS) {
    if (provider.detect()) {
      return provider;
    }
  }
  return UnknownProvider;
}

/**
 * 获取当前检测到的 Agent Provider
 */
export const currentAgentProvider = detectAgentProvider();

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

    // Dependency watch — if this story depends on others, include polling instructions
    if (story.depends_on?.length) {
      const projectHash = computeProjectHash(this.projectRoot);
      const signalDir = join(
        process.env.HOME ?? process.env.USERPROFILE ?? '/tmp',
        '.wdf-method', 'signals', 'dependencies', projectHash,
      );
      prompt.push('');
      prompt.push('=== DEPENDENCY WATCH ===');
      prompt.push('This story has upstream dependencies. BEFORE implementing, verify they are complete.');
      prompt.push('Your dependencies:');
      for (const dep of story.depends_on) {
        const depFile = `${signalDir}/${dep.story_id}-ready.json`;
        prompt.push(`  ${dep.story_id} (${dep.track ?? 'unknown'}): check ${depFile}`);
      }
      prompt.push('');
      prompt.push('To check if a dependency is ready:');
      prompt.push(`  1. Read ${signalDir}/{story_id}-ready.json`);
      prompt.push('  2. If status="ready", that dependency is satisfied.');
      prompt.push('  3. If status="failed", report BLOCKED — the dependency failed and needs human attention.');
      prompt.push('  4. If the file does not exist, wait up to 15 minutes and check again.');
      prompt.push('  5. If after 15 min the file still does not exist, report BLOCKED with reason "dependency timeout".');
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
 * @deprecated **Legacy / test-only path.** The canonical wdf-method execution
 * model is "CLI emits a dispatch manifest → host Claude session uses its Agent
 * tool to spawn sub-agents in fresh-chat isolation" (see
 * `executeImplementationPhase()` in `orchestrator.ts` and the architectural
 * note in `docs/MULTI-IDE.md`). This function still subprocess-spawns the
 * provider's CLI binary as a fallback for non-Claude-Code hosts and for
 * integration tests; new callers should consume the manifest instead. The
 * `provider.command` field exists so this legacy path is at least
 * provider-aware rather than hardcoded to `claude`, but multi-IDE support
 * proper is delivered through the manifest, not by expanding this spawn matrix.
 *
 * Spawns the configured provider's CLI in the worktree, waits for the child
 * to exit, then reads `_wdf_output/agent-result.json` from the worktree. No
 * regex / stdout parsing. If the child exits cleanly but the result file is
 * missing, the dispatcher retries up to `maxRetries` times. If the child
 * times out but a partially-written result file is on disk, that file is
 * honoured.
 */
export async function dispatchStoryAgent(
  story: StoryEntry,
  options: DispatchOptions,
): Promise<AgentDispatchResult> {
  // Architectural guard: wdf-method's contract is "CLI never spawns agents".
  // Production paths must use manifest-based dispatch via pipeline-runner.ts
  // so the parent Claude session retains control. This guard fails loud if
  // any caller forgets and tries the legacy spawn path.
  //
  // Tests opt out via WDF_ALLOW_SPAWN=1 since they need to exercise the
  // spawn/timeout/retry mechanics directly.
  if (process.env.WDF_ALLOW_SPAWN !== '1') {
    throw new Error(
      'dispatchStoryAgent is disabled by default — wdf-method CLI must not spawn agents. ' +
      'Use pipeline-runner.ts to emit a dispatch manifest, or set WDF_ALLOW_SPAWN=1 for tests.',
    );
  }

  // Defensive identifier validation — guards against `..` traversal in
  // story IDs that would otherwise be embedded in file paths.
  assertSafeIdentifier(story.story_id, 'story.story_id');

  const maxAttempts = Math.max(1, options.maxRetries ?? 1);
  let attempt = 0;
  let lastSyntheticError: string | undefined;
  const startTime = Date.now();

  // Start heartbeat so the orchestrator knows this agent is alive.
  const agentId = `${story.story_id}-${options.track}`;
  const heartbeat = new HeartbeatEmitter({
    agent_id: agentId,
    story_id: story.story_id,
    track: options.track,
  });
  heartbeat.start();

  const projectHash = computeProjectHash(options.projectRoot);
  const checkpointWriter = new CheckpointWriter(projectHash);

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
      const finalResult = { ...outcome.result, duration_ms: Date.now() - startTime };

      // Write checkpoint for downstream agents
      checkpointWriter.write({
        story_id: story.story_id,
        status: finalResult.status === 'success' ? 'CODE_ACCEPTED' : 'FAILED',
        timestamp: new Date().toISOString(),
        track: options.track,
        files_changed: finalResult.files_changed,
        tests_passed: finalResult.tests_passed,
        tests_total: finalResult.tests_total,
        summary: finalResult.summary,
      });

      // Signal dependency readiness on success
      if (finalResult.status === 'success') {
        checkpointWriter.signalReady(story.story_id, finalResult.files_changed);
      } else {
        checkpointWriter.signalFailed(
          story.story_id,
          finalResult.error ?? finalResult.summary,
        );
      }

      heartbeat.stop();
      cleanupAgent(agentId);
      return finalResult;
    }

    if (outcome.kind === 'timeout') {
      // Salvage attempt — the agent may have written the file just before
      // we killed it. If so, return that; otherwise emit a synthetic timeout.
      const salvaged = trySalvage(options.worktreePath);
      heartbeat.stop();
      cleanupAgent(agentId);
      if (salvaged) {
        checkpointWriter.write({
          story_id: story.story_id,
          status: salvaged.status === 'success' ? 'CODE_ACCEPTED' : 'TIMEOUT',
          timestamp: new Date().toISOString(),
          track: options.track,
          files_changed: salvaged.files_changed,
          tests_passed: salvaged.tests_passed,
          tests_total: salvaged.tests_total,
          summary: salvaged.summary,
        });
        checkpointWriter.signalFailed(story.story_id, 'agent timeout');
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
      heartbeat.stop();
      cleanupAgent(agentId);
      return { ...salvaged, duration_ms: Date.now() - startTime };
    }

    if (attempt >= maxAttempts) {
      heartbeat.stop();
      cleanupAgent(agentId);
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
  heartbeat.stop();
  cleanupAgent(agentId);
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
 *
 * Spawn-based execution. Disabled in production via the WDF_ALLOW_SPAWN gate
 * in `dispatchStoryAgent` above — the canonical flow is manifest-based. This
 * helper is retained so tests can exercise the spawn/timeout/retry mechanics.
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
      // 使用检测到的 Agent Provider 构建参数
      // 支持不同 AI 编辑器环境：Claude Code, Cursor, Cline, VSCode 等
      const provider = currentAgentProvider;
      const args = provider.buildArgs(prompt, options.worktreePath);
      const providerEnv = provider.getEnvOverrides();

      child = spawnFn(
        provider.command,
        args,
        {
          cwd: options.worktreePath,
          env: {
            ...process.env,
            ...providerEnv,
            WDF_AGENT: story.story_id,          // 标记子 Agent 便于审计
            WDF_PROVIDER: provider.tool,        // 记录使用的 provider
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
    } catch (err: any) {
      clearTimeout(timer);
      resolveOutcome({
        kind: 'spawn_error',
        error: `failed to spawn agent (${currentAgentProvider.tool}): ${err?.message ?? String(err)}`,
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
        error: `agent process error (${currentAgentProvider.tool}): ${err.message}`,
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
   *
   * @deprecated CLI must NOT spawn agents — the loop authority belongs to the
   * Claude session. Use {@link buildDispatchManifest} instead: it emits a JSON
   * file the Claude session reads, then spawns each story via its own Agent
   * tool in fresh-chat isolation (BMAD-style). Kept for legacy callers and
   * tests until they migrate.
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

  /**
   * Build a dispatch manifest for the Claude session.
   *
   * Instead of spawning agents itself (which would put the loop authority in
   * the CLI — forbidden by the architecture), the orchestrator writes a JSON
   * file listing every story ready to dispatch along with the prompt the
   * Claude session should pass to its Agent tool. Each story gets its own
   * prompt file under `.dispatch/<phase>/<story-id>.prompt.md` so it can be
   * dispatched in a fresh chat (BMAD-style fresh-context isolation).
   *
   * The Claude session then enumerates the manifest and dispatches each one
   * via its native Agent tool. Story implementation parallelism is bounded
   * by the manifest's `max_concurrent` field; concrete enforcement of that
   * bound is the Claude session's responsibility.
   *
   * Returns the manifest object plus the path it was written to so callers
   * can echo it to stdout.
   */
  buildDispatchManifest(opts: {
    stories: StoryEntry[];
    projectRoot: string;
    phase: string; // e.g. "phase_4_4" or "phase_4_10"
    maxConcurrent: number;
  }): { manifest: DispatchManifest; manifestPath: string } {
    const { mkdirSync, writeFileSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');

    const dispatchDir = join(opts.projectRoot, '_wdf_output', '.dispatch', opts.phase);
    mkdirSync(dispatchDir, { recursive: true });

    const entries: DispatchEntry[] = opts.stories.map(story => {
      const promptFile = join(dispatchDir, `${story.story_id}.prompt.md`);
      const prompt = renderStoryPrompt(story);
      writeFileSync(promptFile, prompt, 'utf-8');
      return {
        story_id: story.story_id,
        title: story.title ?? story.story_id,
        track: story.track,
        scope_write: story.scope_write,
        depends_on: (story.depends_on ?? []).map(d => d.story_id),
        prompt_file: promptFile,
        acceptance_check: story.acceptance_check ?? [],
      };
    });

    const manifest: DispatchManifest = {
      phase: opts.phase,
      generated_at: new Date().toISOString(),
      max_concurrent: opts.maxConcurrent,
      protocol: 'fresh-chat-per-story',
      instructions: [
        'For each entry in `stories`, spawn a sub-agent (Claude Agent tool with',
        'subagent_type=general-purpose, or equivalent) using the contents of',
        'prompt_file as the agent task. Respect depends_on ordering and run no',
        'more than max_concurrent simultaneously. After each story completes,',
        'call `wdf start` again so the CLI can re-sync state.',
      ].join(' '),
      stories: entries,
    };

    const manifestPath = join(dispatchDir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    return { manifest, manifestPath };
  }
}

/**
 * Single story entry inside a dispatch manifest.
 */
export interface DispatchEntry {
  story_id: string;
  title: string;
  track: Track;
  scope_write: string[];
  depends_on: string[];
  prompt_file: string;
  acceptance_check: string[];
}

/**
 * JSON contract written to `_wdf_output/.dispatch/<phase>/manifest.json`.
 * Consumed by the Claude session, which fans out the work via its own
 * Agent tool. Never read back by the CLI.
 */
export interface DispatchManifest {
  phase: string;
  generated_at: string;
  max_concurrent: number;
  protocol: 'fresh-chat-per-story';
  instructions: string;
  stories: DispatchEntry[];
}

/**
 * Render a fresh-chat-ready prompt for a single story. Pure function so it
 * can be reused by the manifest builder and any future test fixtures.
 */
function renderStoryPrompt(story: StoryEntry): string {
  const lines = [
    `# Story Implementation Task — ${story.story_id}`,
    '',
    `**Title:** ${story.title ?? story.story_id}`,
    `**Track:** ${story.track}`,
    `**Scope (write):** ${story.scope_write.join(', ')}`,
    '',
    '## What to do',
    '1. Read the architecture and API contract under `_wdf_output/`.',
    '2. Implement the code within the scope paths listed above.',
    '3. Write tests for every acceptance criterion.',
    '4. Run the acceptance checks and ensure they pass.',
    '5. Commit with message `' + story.story_id + ': <title> — IMPLEMENTED`.',
    '',
  ];
  if (story.acceptance_check?.length) {
    lines.push('## Acceptance checks');
    for (const c of story.acceptance_check) lines.push(`- ${c}`);
    lines.push('');
  }
  if (story.depends_on?.length) {
    lines.push('## Dependencies (must already be complete)');
    for (const d of story.depends_on) lines.push(`- ${d.story_id}`);
    lines.push('');
  }
  lines.push('## When done');
  lines.push('Return a short summary plus the list of files you changed.');
  lines.push('The orchestrator will detect your code via `wdf start` on the next run.');
  return lines.join('\n');
}

// Re-export schema validator so tests and other call sites can validate
// arbitrary JSON without importing the agent helper module directly.
export { validateAgentDispatchResult };
