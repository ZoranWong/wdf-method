/**
 * Tests for multi-agent-install.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadCommands,
  installForPlatforms,
  detectPlatforms,
  ALL_PLATFORMS,
} from './multi-agent-install.js';

function makeFrameworkRoot(): string {
  const dir = join(tmpdir(), `wdf-ma-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, 'commands'), { recursive: true });

  // Create a few test commands with different platform support
  writeFileSync(join(dir, 'commands', 'wdf-test1.md'), `---
name: wdf-test1
description: Test command 1
platforms: [claude, codex, cursor, copilot, gemini]
---

# Test Command 1

This is test command 1.
`);
  writeFileSync(join(dir, 'commands', 'wdf-test2.md'), `---
name: wdf-test2
description: Test command 2
platforms: [claude, cursor]
---

# Test Command 2

This is test command 2.
`);
  writeFileSync(join(dir, 'commands', 'wdf-test3.md'), `---
name: wdf-test3
description: Test command 3
platforms: [claude]
---

# Test Command 3

This is test command 3.
`);

  return dir;
}

function makeProjectRoot(): string {
  const dir = join(tmpdir(), `wdf-proj-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('multi-agent-install', () => {
  let frameworkRoot: string;
  let projectRoot: string;

  beforeEach(() => {
    frameworkRoot = makeFrameworkRoot();
    projectRoot = makeProjectRoot();
  });

  afterEach(() => {
    try { rmSync(frameworkRoot, { recursive: true, force: true }); } catch {}
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch {}
  });

  describe('loadCommands', () => {
    it('loads all commands from the commands directory', () => {
      const commands = loadCommands(frameworkRoot);
      expect(commands.length).toBe(3);
      expect(commands.map(c => c.name).sort()).toEqual(['wdf-test1', 'wdf-test2', 'wdf-test3']);
    });

    it('parses frontmatter correctly', () => {
      const commands = loadCommands(frameworkRoot);
      const test1 = commands.find(c => c.name === 'wdf-test1')!;
      expect(test1.description).toBe('Test command 1');
      expect(test1.platforms).toEqual(['claude', 'codex', 'cursor', 'copilot', 'gemini']);
    });

    it('extracts body without frontmatter', () => {
      const commands = loadCommands(frameworkRoot);
      const test1 = commands.find(c => c.name === 'wdf-test1')!;
      expect(test1.body).toContain('# Test Command 1');
      expect(test1.body).not.toContain('---');
    });
  });

  describe('installForPlatforms', () => {
    it('installs all platforms by default', () => {
      const results = installForPlatforms({ projectRoot, frameworkRoot });
      expect(results).toHaveLength(ALL_PLATFORMS.length);
    });

    it('installs Claude commands as individual .md files', () => {
      const [result] = installForPlatforms({
        projectRoot,
        frameworkRoot,
        platforms: ['claude'],
      });

      expect(result.platform).toBe('claude');
      expect(result.commands_installed).toBe(3);
      expect(result.files_written).toContain('.claude/commands/wdf-test1.md');
      expect(result.files_written).toContain('.claude/commands/wdf-test2.md');
      expect(result.files_written).toContain('.claude/commands/wdf-test3.md');

      // Verify files exist on disk
      expect(existsSync(join(projectRoot, '.claude/commands/wdf-test1.md'))).toBe(true);
    });

    it('installs Cursor rules as individual .mdc files', () => {
      const [result] = installForPlatforms({
        projectRoot,
        frameworkRoot,
        platforms: ['cursor'],
      });

      expect(result.platform).toBe('cursor');
      expect(result.commands_installed).toBe(2); // test1 + test2 only
      expect(result.files_written).toContain('.cursor/rules/wdf-test1.mdc');
      expect(result.files_written).toContain('.cursor/rules/wdf-test2.mdc');
    });

    it('installs Codex as a single AGENTS.md file', () => {
      const [result] = installForPlatforms({
        projectRoot,
        frameworkRoot,
        platforms: ['codex'],
      });

      expect(result.platform).toBe('codex');
      expect(result.files_written).toContain('AGENTS.md');
      expect(existsSync(join(projectRoot, 'AGENTS.md'))).toBe(true);

      const content = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('wdf-method');
      expect(content).toContain('wdf-test1');
    });

    it('installs Copilot as .github/copilot-instructions.md', () => {
      const [result] = installForPlatforms({
        projectRoot,
        frameworkRoot,
        platforms: ['copilot'],
      });

      expect(result.platform).toBe('copilot');
      expect(result.files_written).toContain('.github/copilot-instructions.md');
      expect(existsSync(join(projectRoot, '.github/copilot-instructions.md'))).toBe(true);
    });

    it('installs Gemini as GEMINI.md', () => {
      const [result] = installForPlatforms({
        projectRoot,
        frameworkRoot,
        platforms: ['gemini'],
      });

      expect(result.platform).toBe('gemini');
      expect(result.files_written).toContain('GEMINI.md');
      expect(existsSync(join(projectRoot, 'GEMINI.md'))).toBe(true);
    });

    it('respects dry-run mode', () => {
      const [result] = installForPlatforms({
        projectRoot,
        frameworkRoot,
        platforms: ['claude'],
        dryRun: true,
      });

      expect(result.files_written).toContain('.claude/commands/wdf-test1.md');
      // But file should NOT exist
      expect(existsSync(join(projectRoot, '.claude/commands/wdf-test1.md'))).toBe(false);
    });

    it('handles platform with no supported commands', () => {
      // Create a framework with no gemini-supporting commands
      const emptyFramework = join(tmpdir(), `wdf-empty-${Date.now()}`);
      mkdirSync(join(emptyFramework, 'commands'), { recursive: true });
      writeFileSync(join(emptyFramework, 'commands', 'wdf-only-claude.md'), `---
name: wdf-only-claude
description: Only Claude
platforms: [claude]
---

# Only Claude
`);

      const [result] = installForPlatforms({
        projectRoot,
        frameworkRoot: emptyFramework,
        platforms: ['gemini'],
      });

      expect(result.commands_installed).toBe(0);
      expect(result.warnings.length).toBeGreaterThan(0);
      rmSync(emptyFramework, { recursive: true, force: true });
    });
  });

  describe('detectPlatforms', () => {
    it('returns empty list when no platforms configured', () => {
      expect(detectPlatforms(projectRoot)).toEqual([]);
    });

    it('detects Claude when .claude exists', () => {
      mkdirSync(join(projectRoot, '.claude'));
      expect(detectPlatforms(projectRoot)).toContain('claude');
    });

    it('detects Codex when AGENTS.md exists', () => {
      writeFileSync(join(projectRoot, 'AGENTS.md'), '# Agents');
      expect(detectPlatforms(projectRoot)).toContain('codex');
    });

    it('detects Cursor when .cursor exists', () => {
      mkdirSync(join(projectRoot, '.cursor'));
      expect(detectPlatforms(projectRoot)).toContain('cursor');
    });

    it('detects Copilot when copilot-instructions.md exists', () => {
      mkdirSync(join(projectRoot, '.github'), { recursive: true });
      writeFileSync(join(projectRoot, '.github/copilot-instructions.md'), '# Copilot');
      expect(detectPlatforms(projectRoot)).toContain('copilot');
    });

    it('detects Gemini when GEMINI.md exists', () => {
      writeFileSync(join(projectRoot, 'GEMINI.md'), '# Gemini');
      expect(detectPlatforms(projectRoot)).toContain('gemini');
    });
  });
});
