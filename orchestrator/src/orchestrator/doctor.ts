// wdf doctor — Diagnose common issues with the wdf-method environment and project state.
import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { safeReadJson } from './atomic-operations.js';
import { detectAgentProvider } from './agent-dispatcher.js';

export type DiagnosticStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface DiagnosticCheck {
  id: string;
  name: string;
  status: DiagnosticStatus;
  message: string;
  suggestion?: string;
  details?: Record<string, any>;
}

export interface DoctorReport {
  generated_at: string;
  project_root: string;
  summary: {
    pass: number;
    warn: number;
    fail: number;
    info: number;
  };
  checks: DiagnosticCheck[];
  overall: DiagnosticStatus;
  next_steps: string[];
}

/**
 * Run the full diagnostic suite.
 */
export function runDoctor(projectRoot: string): DoctorReport {
  const checks: DiagnosticCheck[] = [
    ...runEnvironmentChecks(),
    ...runClaudeCliChecks(),
    ...runProjectChecks(projectRoot),
    ...runStateChecks(projectRoot),
    ...runDependencyChecks(projectRoot),
    ...runSandboxChecks(projectRoot),
  ];
  const summary = {
    pass: checks.filter(c => c.status === 'pass').length,
    warn: checks.filter(c => c.status === 'warn').length,
    fail: checks.filter(c => c.status === 'fail').length,
    info: checks.filter(c => c.status === 'info').length,
  };
  const overall: DiagnosticStatus = summary.fail > 0 ? 'fail' : summary.warn > 0 ? 'warn' : 'pass';
  const next_steps = generateNextSteps(checks);
  return {
    generated_at: new Date().toISOString(),
    project_root: projectRoot,
    summary,
    checks,
    overall,
    next_steps,
  };
}

/**
 * Format a doctor report for CLI display.
 */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  const overallIcon = report.overall === 'pass' ? '✅' : report.overall === 'fail' ? '❌' : '⚠️ ';
  lines.push('🏥 wdf Doctor Report');
  lines.push(`   Project: ${report.project_root}`);
  lines.push(`   Generated: ${report.generated_at}`);
  lines.push('');
  lines.push(`   Overall Status: ${overallIcon} ${report.overall.toUpperCase()}`);
  lines.push('');
  lines.push('📊 Summary:');
  lines.push(`   ✅ Pass: ${report.summary.pass}`);
  lines.push(`   ⚠️  Warn: ${report.summary.warn}`);
  lines.push(`   ❌ Fail: ${report.summary.fail}`);
  lines.push(`   ℹ️  Info: ${report.summary.info}`);
  lines.push('');
  lines.push('🔍 Checks:');
  for (const check of report.checks) {
    const icon = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️ ' : check.status === 'fail' ? '❌' : 'ℹ️ ';
    lines.push(`   ${icon} ${check.name}`);
    lines.push(`      ${check.message}`);
    if (check.suggestion) {
      lines.push(`      💡 ${check.suggestion}`);
    }
  }
  if (report.next_steps.length > 0) {
    lines.push('');
    lines.push('🚀 Recommended Next Steps:');
    for (const [i, step] of report.next_steps.entries()) {
      lines.push(`   ${i + 1}. ${step}`);
    }
  }
  return lines.join('\n');
}

// --- Check implementations ---

function runEnvironmentChecks(): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];
  // Node.js version
  try {
    const version = process.version;
    const major = parseInt(version.slice(1).split('.')[0], 10);
    checks.push({
      id: 'env-node-version',
      name: 'Node.js Version',
      status: major >= 18 ? 'pass' : major >= 16 ? 'warn' : 'fail',
      message: major >= 18 ? `Node.js ${version} is supported` :
        major >= 16 ? `Node.js ${version} may work but 18+ is recommended` :
          `Node.js ${version} is not supported`,
      suggestion: major < 18 ? 'Upgrade to Node.js 18 or newer' : undefined,
    });
  } catch (e) {
    checks.push({
      id: 'env-node-version',
      name: 'Node.js Version',
      status: 'fail',
      message: 'Could not determine Node.js version',
    });
  }
  // Git availability
  try {
    const gitVersion = execSync('git --version', { encoding: 'utf8', stdio: 'pipe' }).trim();
    checks.push({
      id: 'env-git',
      name: 'Git Installation',
      status: 'pass',
      message: gitVersion,
    });
  } catch (e) {
    checks.push({
      id: 'env-git',
      name: 'Git Installation',
      status: 'fail',
      message: 'Git is not installed or not in PATH',
      suggestion: 'Install git from https://git-scm.com/',
    });
  }
  // npm availability
  try {
    const npmVersion = execSync('npm --version', { encoding: 'utf8', stdio: 'pipe' }).trim();
    checks.push({
      id: 'env-npm',
      name: 'npm Installation',
      status: 'pass',
      message: `npm ${npmVersion}`,
    });
  } catch (e) {
    checks.push({
      id: 'env-npm',
      name: 'npm Installation',
      status: 'warn',
      message: 'npm not found',
      suggestion: 'Install npm or ensure it is in PATH',
    });
  }
  return checks;
}

function runProjectChecks(projectRoot: string): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];
  // Is this a git repository?
  const gitDir = join(projectRoot, '.git');
  if (existsSync(gitDir)) {
    checks.push({
      id: 'project-git-repo',
      name: 'Git Repository',
      status: 'pass',
      message: 'Project is a git repository',
    });
    // Check git worktree support (git worktree has no --version flag)
    try {
      execSync('git worktree list', { cwd: projectRoot, encoding: 'utf8', stdio: 'pipe' });
      checks.push({
        id: 'project-git-worktree',
        name: 'Git Worktree Support',
        status: 'pass',
        message: 'Git worktree is supported',
      });
    } catch (e) {
      checks.push({
        id: 'project-git-worktree',
        name: 'Git Worktree Support',
        status: 'warn',
        message: 'Git worktree may not be available',
        suggestion: 'Upgrade git to version 2.20 or newer',
      });
    }
  } else {
    checks.push({
      id: 'project-git-repo',
      name: 'Git Repository',
      status: 'warn',
      message: 'Not a git repository',
      suggestion: 'Run `git init` to initialize git',
    });
  }
  // Is this already a wdf project?
  const wdfStatusDir = join(projectRoot, '_wdf_output', 'status');
  if (existsSync(wdfStatusDir)) {
    checks.push({
      id: 'project-initialized',
      name: 'wdf Project',
      status: 'pass',
      message: 'wdf-method project is initialized',
    });
  } else {
    checks.push({
      id: 'project-initialized',
      name: 'wdf Project',
      status: 'info',
      message: 'Not yet a wdf-method project',
      suggestion: 'Run `wdf init` to initialize',
    });
  }
  // Customize TOML exists?
  const customizePath = join(projectRoot, 'customize.toml');
  if (existsSync(customizePath)) {
    checks.push({
      id: 'project-customize-toml',
      name: 'Configuration File',
      status: 'pass',
      message: 'customize.toml found',
    });
  } else {
    checks.push({
      id: 'project-customize-toml',
      name: 'Configuration File',
      status: 'info',
      message: 'No customize.toml found',
      suggestion: 'Create one to customize thresholds and settings, or use defaults',
    });
  }
  return checks;
}

function runStateChecks(projectRoot: string): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];
  const statusDir = join(projectRoot, '_wdf_output', 'status');
  if (!existsSync(statusDir)) {
    return checks;
  }
  // Check for status files
  try {
    const fs = require('fs');
    const files = fs.readdirSync(statusDir).filter((f: string) => f.endsWith('.yaml')).length;
    checks.push({
      id: 'state-valid',
      name: 'Project State',
      status: 'pass',
      message: `Project state directory found with ${files} status file(s)`,
      details: { status_files: files },
    });
  } catch (e) {
    checks.push({
      id: 'state-valid',
      name: 'Project State',
      status: 'fail',
      message: 'Failed to read project state directory',
      suggestion: 'Run `wdf rebuild-status` to regenerate',
    });
  }
  // Check for orphaned lock files
  const lockFiles = ['global.lock', 'merge.lock', 'audit.lock'];
  for (const lockFile of lockFiles) {
    const path = join(projectRoot, '_wdf_output', lockFile);
    if (existsSync(path)) {
      try {
        const stats = require('fs').statSync(path);
        const ageMs = Date.now() - stats.mtimeMs;
        if (ageMs > 5 * 60 * 1000) { // 5 minutes
          checks.push({
            id: `state-stale-lock-${lockFile}`,
            name: `Stale Lock: ${lockFile}`,
            status: 'warn',
            message: `Lock file is ${Math.round(ageMs / 1000 / 60)} minutes old`,
            suggestion: 'If no process is running, delete the stale lock file',
          });
        }
      } catch {
        // ignore
      }
    }
  }
  return checks;
}

function runDependencyChecks(projectRoot: string): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];
  const packageJsonPath = join(projectRoot, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return checks;
  }
  const pkg = safeReadJson<{ name?: string; version?: string }>(packageJsonPath);
  if (!pkg) {
    checks.push({
      id: 'deps-package-json',
      name: 'package.json',
      status: 'warn',
      message: 'package.json exists but is invalid',
      suggestion: 'Fix JSON syntax errors',
    });
    return checks;
  }
  checks.push({
    id: 'deps-package-json',
    name: 'package.json',
    status: 'pass',
    message: `Found ${pkg.name || 'unnamed'} v${pkg.version || 'unknown'}`,
  });
  // Check node_modules
  const nodeModules = join(projectRoot, 'node_modules');
  const hasNodeModules = existsSync(nodeModules);
  const hasLockFile =
    existsSync(join(projectRoot, 'package-lock.json')) ||
    existsSync(join(projectRoot, 'yarn.lock')) ||
    existsSync(join(projectRoot, 'pnpm-lock.yaml'));
  if (hasNodeModules) {
    checks.push({
      id: 'deps-installed',
      name: 'Dependencies Installed',
      status: 'pass',
      message: 'node_modules exists',
    });
  } else if (hasLockFile) {
    checks.push({
      id: 'deps-installed',
      name: 'Dependencies Installed',
      status: 'warn',
      message: 'Lock file exists but no node_modules',
      suggestion: 'Run `npm install` to install dependencies',
    });
  }
  return checks;
}

// --- Claude CLI Checks (CRITICAL for real execution) ---

function runClaudeCliChecks(): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];
  // 检测当前环境使用的 Agent Provider
  try {
    // 动态导入避免循环依赖
    const { currentAgentProvider, detectAgentProvider } = require('./agent-dispatcher.js');
    const provider = currentAgentProvider ?? detectAgentProvider();
    checks.push({
      id: 'claude-provider',
      name: 'Agent Provider Detection',
      status: 'pass',
      message: `Detected: ${provider.name} (${provider.tool})`,
      details: {
        tool: provider.tool,
        name: provider.name,
      },
    });
  } catch {
    checks.push({
      id: 'claude-provider',
      name: 'Agent Provider Detection',
      status: 'info',
      message: 'Using default dispatch mode',
    });
  }
  // 1. Check if claude command exists
  try {
    const versionOutput = execSync('claude --version', { encoding: 'utf8', stdio: 'pipe' }).trim();
    checks.push({
      id: 'claude-cli-exists',
      name: 'Claude CLI Installation',
      status: 'pass',
      message: versionOutput || 'Claude CLI is installed',
    });
    // 2. Check claude command help output for required flags
    try {
      const helpOutput = execSync('claude --help', { encoding: 'utf8', stdio: 'pipe' });
      const hasPromptFlag = helpOutput.includes('-p') || helpOutput.includes('--prompt');
      const hasAllowedTools = helpOutput.includes('--allowedTools');
      const hasOutputFormat = helpOutput.includes('--output-format');
      const hasPrint = helpOutput.includes('--print');
      checks.push({
        id: 'claude-cli-flags',
        name: 'Claude CLI Required Flags',
        status: hasPromptFlag && hasAllowedTools ? 'pass' : 'warn',
        message:
          hasPromptFlag && hasAllowedTools
            ? 'All required flags available (-p, --allowedTools)'
            : `Missing flags: prompt=${hasPromptFlag}, allowedTools=${hasAllowedTools}`,
        suggestion:
          !hasPromptFlag || !hasAllowedTools ? 'Upgrade Claude CLI to the latest version' : undefined,
        details: { hasPromptFlag, hasAllowedTools, hasOutputFormat, hasPrint },
      });
    } catch {
      checks.push({
        id: 'claude-cli-flags',
        name: 'Claude CLI Required Flags',
        status: 'warn',
        message: 'Could not verify CLI flags',
        suggestion: 'Run `claude --help` manually to verify',
      });
    }
    // 3. Check if logged in (try a simple prompt)
    try {
      const testDir = join(tmpdir(), `wdf-doctor-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      const provider = detectAgentProvider();
      const result = spawnSync(provider.command, ['-p', 'Respond with exactly: OK'], {
        cwd: testDir,
        encoding: 'utf8',
        timeout: 15000,
        stdio: 'pipe',
        env: { ...process.env, CI: 'true' },
      });
      const hasOutput = result.stdout?.includes('OK') || result.stderr?.includes('OK');
      const needsAuth =
        result.stderr?.includes('login') ||
        result.stderr?.includes('auth') ||
        result.stderr?.includes('sign in') ||
        result.status !== 0;
      if (needsAuth && !hasOutput) {
        checks.push({
          id: 'claude-cli-auth',
          name: 'Claude CLI Authentication',
          status: 'fail',
          message: 'Claude CLI is not logged in',
          suggestion: 'Run `claude login` to authenticate',
          details: { stderr: result.stderr?.slice(0, 200) },
        });
      } else {
        checks.push({
          id: 'claude-cli-auth',
          name: 'Claude CLI Authentication',
          status: 'pass',
          message: 'Claude CLI is authenticated and responsive',
          details: { responseTime: result.error ? 'timeout' : 'ok' },
        });
      }
      // Cleanup
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch { /* ignore */ }
    } catch (e: any) {
      checks.push({
        id: 'claude-cli-auth',
        name: 'Claude CLI Authentication',
        status: 'warn',
        message: 'Could not verify authentication (timeout or error)',
        suggestion: 'Run `claude --help` to verify your installation',
        details: { error: e?.message?.slice(0, 100) },
      });
    }
  } catch (e) {
    checks.push({
      id: 'claude-cli-exists',
      name: 'Claude CLI Installation',
      status: 'fail',
      message: 'Claude CLI is not installed or not in PATH',
      suggestion: 'Install from https://github.com/anthropics/claude-cli',
    });
    // Add placeholder for dependent checks
    checks.push({
      id: 'claude-cli-auth',
      name: 'Claude CLI Authentication',
      status: 'info',
      message: 'Skipped (CLI not available)',
    });
    checks.push({
      id: 'claude-cli-flags',
      name: 'Claude CLI Required Flags',
      status: 'info',
      message: 'Skipped (CLI not available)',
    });
  }
  return checks;
}

// --- Sandbox Execution Checks ---

function runSandboxChecks(projectRoot: string): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];
  // 1. Test temp directory writability (for agent worktrees)
  try {
    const testPath = join(tmpdir(), `wdf-sandbox-test-${Date.now()}`);
    mkdirSync(testPath, { recursive: true });
    writeFileSync(join(testPath, 'test.txt'), 'test', 'utf8');
    const readBack = readFileSync(join(testPath, 'test.txt'), 'utf8');
    rmSync(testPath, { recursive: true, force: true });
    if (readBack === 'test') {
      checks.push({
        id: 'sandbox-tmp-writable',
        name: 'Temp Directory Writable',
        status: 'pass',
        message: 'Temporary directory is writable',
      });
    } else {
      throw new Error('File read mismatch');
    }
  } catch {
    checks.push({
      id: 'sandbox-tmp-writable',
      name: 'Temp Directory Writable',
      status: 'fail',
      message: 'Cannot write to temporary directory',
      suggestion: 'Check permissions on your system temp directory',
    });
  }
  // 2. Test project directory writability
  try {
    const testFile = join(projectRoot, `.wdf-doctor-test-${Date.now()}`);
    writeFileSync(testFile, 'test', 'utf8');
    rmSync(testFile, { force: true });
    checks.push({
      id: 'sandbox-project-writable',
      name: 'Project Directory Writable',
      status: 'pass',
      message: 'Project directory is writable',
    });
  } catch {
    checks.push({
      id: 'sandbox-project-writable',
      name: 'Project Directory Writable',
      status: 'fail',
      message: 'Cannot write to project directory',
      suggestion: 'Check directory permissions',
    });
  }
  // 3. Check for potential path issues
  if (projectRoot.includes(' ')) {
    checks.push({
      id: 'sandbox-path-spaces',
      name: 'Path Spaces Warning',
      status: 'warn',
      message: 'Project path contains spaces which may cause issues',
      suggestion: 'Consider using a path without spaces for best compatibility',
    });
  }
  if (projectRoot.length > 200) {
    checks.push({
      id: 'sandbox-path-length',
      name: 'Path Length Warning',
      status: 'warn',
      message: 'Project path is very long which may cause issues on some systems',
      suggestion: 'Consider moving the project to a shorter path',
    });
  }
  return checks;
}

function generateNextSteps(checks: DiagnosticCheck[]): string[] {
  const steps: string[] = [];
  const fails = checks.filter(c => c.status === 'fail');
  const warns = checks.filter(c => c.status === 'warn');
  if (fails.length > 0) {
    steps.push(`Fix ${fails.length} failing issue(s)`);
  }
  if (warns.length > 0) {
    steps.push(`Review ${warns.length} warning(s)`);
  }
  // Suggest initialization if not already done
  const initCheck = checks.find(c => c.id === 'project-initialized');
  if (initCheck?.status === 'info') {
    steps.push('Run `wdf init` to initialize your project');
  }
  if (steps.length === 0) {
    steps.push('All checks passed! Ready to use wdf-method');
  }
  return steps;
}
