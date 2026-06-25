/**
 * Tests for preset-loader.ts (C3 Extensions/Presets) — the reusable named
 * configuration layer that sits between skill-base customize.toml and
 * project overrides.
 *
 * Two surfaces under test:
 *   1. preset-loader API: list / load / apply / clear / getActive
 *   2. config.ts integration: loadConfig() merges the active preset at the
 *      correct precedence (defaults < skill-base < preset < project).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  listPresets,
  loadPreset,
  applyPreset,
  clearPreset,
  getActivePreset,
} from './preset-loader.js';
import { loadConfig } from './config.js';

let skillRoot: string;
let projectRoot: string;

beforeEach(() => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  skillRoot = join(tmpdir(), `wdf-preset-skill-${stamp}`);
  projectRoot = join(tmpdir(), `wdf-preset-proj-${stamp}`);
  mkdirSync(join(skillRoot, 'presets'), { recursive: true });
  mkdirSync(join(projectRoot, '_wdf_output'), { recursive: true });
});

afterEach(() => {
  rmSync(skillRoot, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

function seedPreset(name: string, body: string): void {
  writeFileSync(join(skillRoot, 'presets', `${name}.toml`), body);
}

describe('listPresets', () => {
  it('returns metadata for valid presets, sorted by name', () => {
    seedPreset('zebra', '[preset]\nname = "zebra"\ndescription = "z"\nversion = "1.0.0"\ncategory = "x"\n');
    seedPreset('alpha', '[preset]\nname = "alpha"\ndescription = "a"\nversion = "2.0.0"\n');
    const presets = listPresets(skillRoot);
    expect(presets.map(p => p.name)).toEqual(['alpha', 'zebra']);
    expect(presets[0].version).toBe('2.0.0');
    expect(presets[1].category).toBe('x');
  });

  it('skips files with no [preset] table', () => {
    seedPreset('broken', '[acceptance_gates]\ncode_acceptance_min_coverage = 10\n');
    expect(listPresets(skillRoot)).toEqual([]);
  });

  it('returns empty when the presets dir is absent', () => {
    expect(listPresets(join(tmpdir(), 'wdf-nope-xyz'))).toEqual([]);
  });
});

describe('loadPreset', () => {
  it('returns parsed content for a known preset', () => {
    seedPreset('demo', '[preset]\nname = "demo"\ndescription = "d"\nversion = "1.0.0"\n\n[acceptance_gates]\ncode_acceptance_min_coverage = 42\n');
    const p = loadPreset(skillRoot, 'demo');
    expect(p?.name).toBe('demo');
    expect(p?.parsed.acceptance_gates.code_acceptance_min_coverage).toBe(42);
  });

  it('returns null for an unknown preset', () => {
    expect(loadPreset(skillRoot, 'ghost')).toBeNull();
  });
});

describe('applyPreset / getActivePreset / clearPreset', () => {
  it('persists the active preset and reads it back', () => {
    seedPreset('demo', '[preset]\nname = "demo"\ndescription = "d"\nversion = "1.0.0"\n');
    const result = applyPreset(projectRoot, skillRoot, 'demo');
    expect(result.ok).toBe(true);
    expect(existsSync(join(projectRoot, '_wdf_output', 'active-preset.yaml'))).toBe(true);

    const active = getActivePreset(projectRoot);
    expect(active?.preset).toBe('demo');
  });

  it('fails when the preset does not exist', () => {
    const result = applyPreset(projectRoot, skillRoot, 'ghost');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it('fails when a required env var is missing', () => {
    seedPreset('linear', '[preset]\nname = "linear"\ndescription = "needs token"\nversion = "1.0.0"\nrequires_env = ["WDF_TEST_TOKEN_ABSENT"]\n');
    delete process.env.WDF_TEST_TOKEN_ABSENT;
    const result = applyPreset(projectRoot, skillRoot, 'linear');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/WDF_TEST_TOKEN_ABSENT/);
  });

  it('clears an active preset', () => {
    seedPreset('demo', '[preset]\nname = "demo"\ndescription = "d"\nversion = "1.0.0"\n');
    applyPreset(projectRoot, skillRoot, 'demo');
    expect(clearPreset(projectRoot)).toBe(true);
    expect(getActivePreset(projectRoot)?.preset).toBeNull();
  });
});

describe('loadConfig preset-layer integration', () => {
  it('merges the active preset over skill-base defaults', () => {
    // skill-base sets coverage 70; preset overrides to 95.
    writeFileSync(join(skillRoot, 'customize.toml'), '[acceptance_gates]\ncode_acceptance_min_coverage = 70\n');
    seedPreset('strict', '[preset]\nname = "strict"\ndescription = "s"\nversion = "1.0.0"\n\n[acceptance_gates]\ncode_acceptance_min_coverage = 95\n');
    applyPreset(projectRoot, skillRoot, 'strict');

    const { config, sources } = loadConfig(projectRoot, { skillRoot, silent: true });
    expect(config.acceptance_gates.code_acceptance_min_coverage).toBe(95);
    expect(sources.some(s => s.includes('presets/strict.toml'))).toBe(true);
  });

  it('lets a project override win over the preset', () => {
    seedPreset('strict', '[preset]\nname = "strict"\ndescription = "s"\nversion = "1.0.0"\n\n[acceptance_gates]\ncode_acceptance_min_coverage = 95\n');
    applyPreset(projectRoot, skillRoot, 'strict');
    // Project override (highest precedence) drops it back to 60.
    mkdirSync(join(projectRoot, '_bmad', 'custom'), { recursive: true });
    writeFileSync(
      join(projectRoot, '_bmad', 'custom', 'web-dev-flow.toml'),
      '[acceptance_gates]\ncode_acceptance_min_coverage = 60\n',
    );

    const { config } = loadConfig(projectRoot, { skillRoot, silent: true });
    expect(config.acceptance_gates.code_acceptance_min_coverage).toBe(60);
  });

  it('uses skill-base value when no preset is active', () => {
    writeFileSync(join(skillRoot, 'customize.toml'), '[acceptance_gates]\ncode_acceptance_min_coverage = 70\n');
    const { config } = loadConfig(projectRoot, { skillRoot, silent: true });
    expect(config.acceptance_gates.code_acceptance_min_coverage).toBe(70);
  });
});
