import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export type CheckStatus = 'pass' | 'warning' | 'error';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  version?: string;
}

export interface PreCheckOptions {
  projectRoot: string;
  json?: boolean;
  silent?: boolean;
}

export interface PreCheckOutput {
  success: boolean;
  overall: 'ready' | 'ready_with_warnings' | 'failed';
  checks: CheckResult[];
  summary: {
    passed: number;
    warnings: number;
    errors: number;
  };
}

function checkGit(): CheckResult {
  try {
    const version = execSync('git --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim()
      .replace('git version ', '');
    return { name: 'git', status: 'pass', message: 'Git is available', version };
  } catch {
    return { name: 'git', status: 'error', message: 'Git is not installed or not available in PATH' };
  }
}

function checkNode(): CheckResult {
  try {
    const version = process.version.replace('v', '');
    const major = parseInt(version.split('.')[0], 10);
    if (major >= 18) {
      return { name: 'node', status: 'pass', message: `Node.js ${version} is available`, version };
    }
    return { name: 'node', status: 'error', message: `Node.js version ${version} is too old. Required >= 18.` };
  } catch {
    return { name: 'node', status: 'error', message: 'Failed to check Node.js version' };
  }
}

function checkProjectDir(projectRoot: string): CheckResult {
  if (existsSync(projectRoot)) {
    return { name: 'project_dir', status: 'pass', message: 'Project directory exists' };
  }
  return { name: 'project_dir', status: 'error', message: `Project directory does not exist: ${projectRoot}` };
}

function checkWdfProject(projectRoot: string): CheckResult {
  const statusDir = join(projectRoot, '_wdf_output', 'status');
  const globalYaml = join(statusDir, 'global.yaml');
  if (existsSync(globalYaml)) {
    return { name: 'wdf_project', status: 'warning', message: 'WDF project is already initialized' };
  }
  return { name: 'wdf_project', status: 'pass', message: 'No existing WDF project found' };
}

function checkGitWorktree(projectRoot: string): CheckResult {
  try {
    execSync('git worktree list', {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return { name: 'git_worktree', status: 'pass', message: 'Git worktree is supported' };
  } catch {
    return {
      name: 'git_worktree',
      status: 'warning',
      message: 'Git worktree is not available (not a git repository or worktrees disabled). Parallel story execution will be limited.',
    };
  }
}

function checkAgentTool(): CheckResult {
  const hasClaudeEnv = !!process.env.CLAUDE_CODE_CLI || !!process.env.CLAUDE_API_KEY;
  const hasAgentIndicator = !!process.env.AGENT_EXECUTION_CONTEXT;
  if (hasClaudeEnv || hasAgentIndicator) {
    return { name: 'agent_tool', status: 'pass', message: 'Agent execution environment detected' };
  }
  return {
    name: 'agent_tool',
    status: 'warning',
    message: 'Agent execution environment not explicitly detected. Sub-agent dispatch may not work correctly.',
  };
}

export function formatPreCheckResult(output: PreCheckOutput): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════');
  lines.push('WDF Pre-check Results');
  lines.push('═══════════════════════════════════════════');
  lines.push('');
  for (const check of output.checks) {
    const prefix = check.status === 'pass' ? '✅' : check.status === 'warning' ? '⚠️' : '❌';
    const versionStr = check.version ? ` (version ${check.version})` : '';
    lines.push(`${prefix} ${check.name} — ${check.message}${versionStr}`);
  }
  lines.push('');
  lines.push('───────────────────────────────────────────');
  lines.push('Summary:');
  lines.push(`  ✅ Passed: ${output.summary.passed}`);
  lines.push(`  ⚠️ Warnings: ${output.summary.warnings}`);
  lines.push(`  ❌ Errors: ${output.summary.errors}`);
  lines.push('');
  if (output.overall === 'failed') {
    lines.push('❌ Status: FAILED — Fix errors before proceeding');
  } else if (output.overall === 'ready_with_warnings') {
    lines.push('⚠️ Status: READY (with warnings) — You may proceed but review warnings');
  } else {
    lines.push('✅ Status: READY — All checks passed');
  }
  lines.push('');
  return lines.join('\n');
}

export async function preCheckCommand(options: PreCheckOptions): Promise<PreCheckOutput> {
  const checks: CheckResult[] = [];
  checks.push(checkGit());
  checks.push(checkNode());
  checks.push(checkProjectDir(options.projectRoot));
  checks.push(checkWdfProject(options.projectRoot));
  checks.push(checkGitWorktree(options.projectRoot));
  checks.push(checkAgentTool());

  const passed = checks.filter(c => c.status === 'pass').length;
  const warnings = checks.filter(c => c.status === 'warning').length;
  const errors = checks.filter(c => c.status === 'error').length;

  let overall: PreCheckOutput['overall'];
  if (errors > 0) overall = 'failed';
  else if (warnings > 0) overall = 'ready_with_warnings';
  else overall = 'ready';

  const output: PreCheckOutput = {
    success: errors === 0,
    overall,
    checks,
    summary: { passed, warnings, errors },
  };

  if (!options.silent) {
    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(formatPreCheckResult(output));
    }
  }
  return output;
}
