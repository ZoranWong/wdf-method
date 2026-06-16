// wdf-method CLI test suite
// Tests core CLI functionality: validate, catalog, extension, hook, integrations, doctor

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'tools', 'installer', 'wdf-cli.js');

function run(args = '') {
  try {
    return execSync(`node ${CLI} ${args}`, { encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' } });
  } catch (e) {
    return e.stdout || e.stderr || e.message;
  }
}

describe('CLI — Core Commands', () => {
  beforeAll(() => {
    // Ensure signal directory exists for validate
    const sigDir = '/tmp/wdf-method/signals/agents';
    if (!existsSync(sigDir)) mkdirSync(sigDir, { recursive: true });
  });

  describe('help', () => {
    it('should display usage with all subcommands', () => {
      const out = run('help');
      expect(out).toContain('wdf-method');
      expect(out).toContain('install');
      expect(out).toContain('validate');
      expect(out).toContain('catalog');
      expect(out).toContain('integrations');
      expect(out).toContain('build');
    });

    it('should default to help when no command given', () => {
      const out = run('');
      expect(out).toContain('wdf-method');
    });
  });

  describe('validate', () => {
    it('should pass all 12 checks on clean install', () => {
      const out = run('validate');
      expect(out).toContain('Result: 12 passed');
      expect(out).toContain('0 failed');
    });

    it('should check SKILL.md exists', () => {
      const out = run('validate');
      expect(out).toContain('SKILL.md exists');
    });

    it('should check customize.toml exists', () => {
      const out = run('validate');
      expect(out).toContain('customize.toml exists');
    });

    it('should check agent skills count', () => {
      const out = run('validate');
      expect(out).toContain('Agent skills: 14');
    });

    it('should check slash commands', () => {
      const out = run('validate');
      expect(out).toContain('Slash commands:');
    });

    it('should check plugin.json exists', () => {
      const out = run('validate');
      expect(out).toContain('plugin.json exists');
    });

    it('should check references directories', () => {
      const out = run('validate');
      expect(out).toContain('references/agents/');
      expect(out).toContain('references/gate-cards/');
      expect(out).toContain('references/prompt-templates/');
      expect(out).toContain('references/sub-workflows/');
    });

    it('should check specs and schemas', () => {
      const out = run('validate');
      expect(out).toContain('specs/');
      expect(out).toContain('schemas/');
    });

    it('should check signal directory', () => {
      const out = run('validate');
      expect(out).toContain('Signal directory');
    });
  });

  describe('catalog', () => {
    it('should list all 14 skills', () => {
      const out = run('catalog list');
      expect(out).toContain('Skill Catalog');
      expect(out).toContain('wdf-orchestrator');
      expect(out).toContain('wdf-analyst');
      expect(out).toContain('wdf-architect');
      expect(out).toContain('wdf-backend-developer');
      expect(out).toContain('wdf-frontend-developer');
      expect(out).toContain('wdf-code-reviewer');
      expect(out).toContain('wdf-qa-verifier');
      expect(out).toContain('Phase:');
      expect(out).toContain('Track:');
      expect(out).toContain('Hooks:');
    });
  });

  describe('integrations', () => {
    it('should list all 6 supported agents', () => {
      const out = run('integrations');
      expect(out).toContain('Supported Agents');
      expect(out).toContain('claude');
      expect(out).toContain('codex');
      expect(out).toContain('cursor');
      expect(out).toContain('copilot');
      expect(out).toContain('gemini');
      expect(out).toContain('windsurf');
    });
  });

  describe('extension', () => {
    it('should list all 14 extensions', () => {
      const out = run('extension list');
      expect(out).toContain('Extensions');
      expect(out).toContain('wdf-orchestrator');
      expect(out).toContain('wdf-analyst');
    });
  });

  describe('hook', () => {
    it('should list hooks across extensions', () => {
      const out = run('hook list');
      expect(out).toContain('Active Hooks');
      expect(out).toContain('hooks across');
    });
  });

  describe('doctor', () => {
    it('should show diagnostic output', () => {
      const out = run('doctor');
      expect(out).toContain('wdf-method');
      expect(out).toContain('Node.js');
    });
  });

  describe('status', () => {
    it('should show installation status', () => {
      const out = run('status');
      expect(out).toContain('Status');
    });
  });

  describe('build', () => {
    it('should show build pipeline info', () => {
      const out = run('build test project');
      expect(out).toContain('Build Pipeline');
      expect(out).toContain('/wdf build');
    });
  });
});

describe('CLI — Error Handling', () => {
  it('should handle unknown commands gracefully', () => {
    const out = run('nonexistent_command');
    expect(out).toContain('wdf-method'); // defaults to help
  });

  it('should handle missing --project flag for init-project', () => {
    const out = run('init-project');
    expect(out).toContain('--project');
  });
});

describe('CLI — File System Integration', () => {
  it('should detect catalog.json exists and is valid JSON', () => {
    const catFile = resolve(__dirname, '..', 'skills', 'catalog.json');
    expect(existsSync(catFile)).toBe(true);
    const content = JSON.parse(require('fs').readFileSync(catFile, 'utf8'));
    expect(content.skills).toBeDefined();
    expect(Object.keys(content.skills).length).toBe(14);
  });

  it('should detect integrations catalog exists and is valid JSON', () => {
    const catFile = resolve(__dirname, '..', 'integrations', 'catalog.json');
    expect(existsSync(catFile)).toBe(true);
    const content = JSON.parse(require('fs').readFileSync(catFile, 'utf8'));
    expect(content.integrations).toBeDefined();
    expect(Object.keys(content.integrations).length).toBe(6);
  });

  it('should detect methods catalog exists and is valid JSON', () => {
    const catFile = resolve(__dirname, '..', 'references', 'methods', 'catalog.json');
    expect(existsSync(catFile)).toBe(true);
    const content = JSON.parse(require('fs').readFileSync(catFile, 'utf8'));
    expect(content.methods).toBeDefined();
    expect(content.methods.length).toBe(50);
  });

  it('should detect experts catalog exists and is valid JSON', () => {
    const catFile = resolve(__dirname, '..', 'references', 'experts', 'catalog.json');
    expect(existsSync(catFile)).toBe(true);
    const content = JSON.parse(require('fs').readFileSync(catFile, 'utf8'));
    expect(content.domains).toBeDefined();
    expect(Object.keys(content.domains).length).toBeGreaterThanOrEqual(13);
  });
});
