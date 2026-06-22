/**
 * Multi-Agent Install Engine — generates platform-specific configuration
 * for Claude Code, Codex, Cursor, GitHub Copilot, and Gemini.
 *
 * wdf-method commands are defined once in canonical markdown (commands/*.md)
 * with YAML frontmatter declaring supported platforms. This engine reads
 * those definitions and generates the right config format for each target.
 *
 * Platform formats:
 *   - claude:   .claude/commands/*.md  (slash commands)
 *   - codex:    AGENTS.md             (OpenAI Codex instructions)
 *   - cursor:   .cursor/rules/*.mdc   (Cursor rule files)
 *   - copilot:  .github/copilot-instructions.md
 *   - gemini:   GEMINI.md             (Google Gemini instructions)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';

// ── Types ──────────────────────────────────────────────────

export type TargetPlatform = 'claude' | 'codex' | 'cursor' | 'copilot' | 'gemini';

export const ALL_PLATFORMS: TargetPlatform[] = ['claude', 'codex', 'cursor', 'copilot', 'gemini'];

export interface CommandDefinition {
  /** Command name (e.g. "wdf-start") */
  name: string;
  /** Human-readable description */
  description: string;
  /** Supported platforms (from frontmatter) */
  platforms: TargetPlatform[];
  /** Full markdown content (without frontmatter) */
  body: string;
  /** Argument hint */
  argumentHint?: string;
}

export interface InstallResult {
  platform: TargetPlatform;
  files_written: string[];
  commands_installed: number;
  warnings: string[];
}

export interface InstallOptions {
  /** Target project root */
  projectRoot: string;
  /** Framework root (wdf-method directory) */
  frameworkRoot: string;
  /** Platforms to install (defaults to all) */
  platforms?: TargetPlatform[];
  /** Dry-run: report what would be written without writing */
  dryRun?: boolean;
}

// ── Frontmatter Parser ─────────────────────────────────────

function parseFrontmatter(text: string): { frontmatter: Record<string, any>; body: string } {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: text };

  const fm: Record<string, any> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1).trim();

    // Parse arrays: [a, b, c]
    if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
      fm[key] = rawVal.slice(1, -1).split(',').map(s => s.trim());
    } else {
      fm[key] = rawVal.replace(/^["']|["']$/g, '');
    }
  }

  return { frontmatter: fm, body: match[2] };
}

// ── Command Loader ─────────────────────────────────────────

/**
 * Read all command definitions from the framework's commands/ directory.
 */
export function loadCommands(frameworkRoot: string): CommandDefinition[] {
  const commandsDir = join(frameworkRoot, 'commands');
  if (!existsSync(commandsDir)) return [];

  const files = readdirSync(commandsDir).filter(f => f.endsWith('.md'));
  const commands: CommandDefinition[] = [];

  for (const file of files) {
    const text = readFileSync(join(commandsDir, file), 'utf-8');
    const { frontmatter, body } = parseFrontmatter(text);

    const name = frontmatter.name ?? basename(file, '.md');
    const platforms = (frontmatter.platforms ?? ['claude']) as TargetPlatform[];

    commands.push({
      name,
      description: frontmatter.description ?? '',
      platforms,
      body: body.trim(),
      argumentHint: frontmatter['argument-hint'],
    });
  }

  return commands;
}

// ── Platform Adapters ──────────────────────────────────────

/**
 * Generate platform-specific content for a command.
 */
type PlatformAdapter = (cmd: CommandDefinition, frameworkRoot: string) => { path: string; content: string };

const adapters: Record<TargetPlatform, PlatformAdapter> = {
  // ── Claude Code ──────────────────────────────────────────
  claude: (cmd, _frameworkRoot) => ({
    path: `.claude/commands/${cmd.name}.md`,
    content: [
      '---',
      `description: ${cmd.description}`,
      cmd.argumentHint ? `argument-hint: "${cmd.argumentHint}"` : null,
      '---',
      '',
      cmd.body,
    ].filter(Boolean).join('\n'),
  }),

  // ── OpenAI Codex (AGENTS.md) ─────────────────────────────
  codex: (cmd, frameworkRoot) => ({
    path: 'AGENTS.md',
    content: buildAgentsMd(cmd, frameworkRoot),
  }),

  // ── Cursor (.cursor/rules/*.mdc) ─────────────────────────
  cursor: (cmd, _frameworkRoot) => ({
    path: `.cursor/rules/${cmd.name}.mdc`,
    content: [
      '---',
      `description: ${cmd.description}`,
      'globs: ""',
      'alwaysApply: true',
      '---',
      '',
      `# ${cmd.name}`,
      '',
      cmd.body,
    ].join('\n'),
  }),

  // ── GitHub Copilot ───────────────────────────────────────
  copilot: (cmd, frameworkRoot) => ({
    path: '.github/copilot-instructions.md',
    content: buildCopilotInstructions(cmd, frameworkRoot),
  }),

  // ── Google Gemini (GEMINI.md) ────────────────────────────
  gemini: (cmd, frameworkRoot) => ({
    path: 'GEMINI.md',
    content: buildGeminiMd(cmd, frameworkRoot),
  }),
};

// ── Multi-file Builders ────────────────────────────────────

/**
 * Build a single AGENTS.md that consolidates all commands for Codex.
 * Called once per install, not per command.
 */
function buildAgentsMd(_cmd: CommandDefinition, frameworkRoot: string): string {
  const commands = loadCommands(frameworkRoot).filter(c => c.platforms.includes('codex'));
  const lines: string[] = [
    '# wdf-method — Agent Instructions',
    '',
    '> Auto-generated by `wdf install`. Do not edit manually.',
    '',
    'This project uses the **wdf-method** workflow (V3.9).',
    'The TypeScript CLI at `orchestrator/` manages state; you write artifacts and code.',
    '',
    '## Key Commands',
    '',
  ];

  for (const c of commands) {
    lines.push(`### ${c.name}`);
    lines.push('');
    lines.push(c.description);
    if (c.argumentHint) lines.push(`Usage: \`${c.name} ${c.argumentHint}\``);
    lines.push('');
    // Condensed body (first 30 lines)
    const condensed = c.body.split('\n').slice(0, 30).join('\n');
    lines.push(condensed);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Build copilot instructions that consolidate all commands.
 */
function buildCopilotInstructions(_cmd: CommandDefinition, frameworkRoot: string): string {
  const commands = loadCommands(frameworkRoot).filter(c => c.platforms.includes('copilot'));
  const lines: string[] = [
    '# wdf-method — Copilot Instructions',
    '',
    '> Auto-generated by `wdf install`. Do not edit manually.',
    '',
    'This project uses the **wdf-method** workflow (V3.9).',
    'The TypeScript CLI manages state machines and quality gates.',
    '',
    '## Available Commands',
    '',
  ];

  for (const c of commands) {
    lines.push(`- **${c.name}**: ${c.description}`);
  }

  lines.push('');
  lines.push('## Workflow');
  lines.push('');
  lines.push('1. Run `wdf start` to check state and get next action');
  lines.push('2. Execute the action (write artifact, dispatch agent, etc.)');
  lines.push('3. Run `wdf start` again to advance');
  lines.push('');
  lines.push('## Rules');
  lines.push('');
  lines.push('- Never modify `_wdf_output/status/` files directly');
  lines.push('- Always run `wdf start` after completing a step');
  lines.push('- Follow the scope_write boundaries in each story');

  return lines.join('\n');
}

/**
 * Build GEMINI.md consolidating all commands.
 */
function buildGeminiMd(_cmd: CommandDefinition, frameworkRoot: string): string {
  const commands = loadCommands(frameworkRoot).filter(c => c.platforms.includes('gemini'));
  const lines: string[] = [
    '# wdf-method — Gemini Instructions',
    '',
    '> Auto-generated by `wdf install`. Do not edit manually.',
    '',
    '## Project Context',
    '',
    'This project uses the **wdf-method** workflow (V3.9).',
    'A TypeScript CLI (`wdf` command) manages the state machine.',
    'Your role is to write artifacts and code as directed by the CLI.',
    '',
    '## Commands',
    '',
  ];

  for (const c of commands) {
    lines.push(`### ${c.name}`);
    lines.push(`${c.description}`);
    lines.push('');
    // Brief summary (first 20 lines)
    const brief = c.body.split('\n').slice(0, 20).join('\n');
    lines.push(brief);
    lines.push('');
  }

  return lines.join('\n');
}

// ── Main Install Function ──────────────────────────────────

/**
 * Install wdf-method commands into the target project for the specified platforms.
 */
export function installForPlatforms(opts: InstallOptions): InstallResult[] {
  const {
    projectRoot,
    frameworkRoot,
    platforms = ALL_PLATFORMS,
    dryRun = false,
  } = opts;

  const commands = loadCommands(frameworkRoot);
  const results: InstallResult[] = [];

  for (const platform of platforms) {
    const result = installSinglePlatform(platform, commands, projectRoot, frameworkRoot, dryRun);
    results.push(result);
  }

  return results;
}

function installSinglePlatform(
  platform: TargetPlatform,
  commands: CommandDefinition[],
  projectRoot: string,
  frameworkRoot: string,
  dryRun: boolean,
): InstallResult {
  const filesWritten: string[] = [];
  const warnings: string[] = [];
  const supportedCommands = commands.filter(c => c.platforms.includes(platform));

  if (supportedCommands.length === 0) {
    warnings.push(`No commands support platform "${platform}"`);
    return { platform, files_written: [], commands_installed: 0, warnings };
  }

  // For multi-file platforms (claude, cursor), write one file per command
  if (platform === 'claude' || platform === 'cursor') {
    const adapter = adapters[platform];
    for (const cmd of supportedCommands) {
      const { path, content } = adapter(cmd, frameworkRoot);
      const fullPath = join(projectRoot, path);

      if (!dryRun) {
        mkdirSync(join(fullPath, '..'), { recursive: true });
        writeFileSync(fullPath, content);
      }
      filesWritten.push(path);
    }
  }

  // For single-file platforms (codex, copilot, gemini), write one consolidated file
  if (platform === 'codex' || platform === 'copilot' || platform === 'gemini') {
    const adapter = adapters[platform];
    // Use the first command as a seed (the adapter reads all commands internally)
    const { path, content } = adapter(supportedCommands[0], frameworkRoot);
    const fullPath = join(projectRoot, path);

    if (!dryRun) {
      mkdirSync(join(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, content);
    }
    filesWritten.push(path);
  }

  return {
    platform,
    files_written: filesWritten,
    commands_installed: supportedCommands.length,
    warnings,
  };
}

// ── Utility ────────────────────────────────────────────────

/**
 * Detect which AI platforms are already configured in a project.
 */
export function detectPlatforms(projectRoot: string): TargetPlatform[] {
  const detected: TargetPlatform[] = [];

  if (existsSync(join(projectRoot, '.claude'))) detected.push('claude');
  if (existsSync(join(projectRoot, 'AGENTS.md'))) detected.push('codex');
  if (existsSync(join(projectRoot, '.cursor'))) detected.push('cursor');
  if (existsSync(join(projectRoot, '.github', 'copilot-instructions.md'))) detected.push('copilot');
  if (existsSync(join(projectRoot, 'GEMINI.md'))) detected.push('gemini');

  return detected;
}
