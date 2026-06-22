/**
 * Tests for custom-schema.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadCustomSchemaConfig,
  resolveSchema,
  getEnabledSubPhases,
  isSubPhaseEnabled,
} from './custom-schema.js';

function makeFrameworkRoot(): string {
  const dir = join(tmpdir(), `wdf-cs-fw-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, 'customize.toml'), `
[workflow]
version = "3.9.0"

[workflow.phase_01]
produces = ["brainstorming.md", "domain-research.md"]

[workflow.phase_01.sub_phase_1_1]
name = "Brainstorming"
produces = "brainstorming.md"
skip_allowed = true
dod = "Ideas explored"

[workflow.phase_01.sub_phase_1_2]
name = "Domain Research"
produces = "domain-research.md"
skip_allowed = true
dod = "Sources analyzed"

[workflow.phase_02]
produces = ["prd.md", "wireframes.md"]

[workflow.phase_02.sub_phase_2_1]
name = "Impact Mapping"
produces = "impact-map.md"
skip_allowed = false
dod = "Goal defined"

[workflow.phase_02.sub_phase_2_5]
name = "PRD"
produces = "prd.md"
skip_allowed = false
dod = "PRD compiled"
`);

  return dir;
}

function makeProjectRoot(): string {
  const dir = join(tmpdir(), `wdf-cs-proj-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('custom-schema', () => {
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

  describe('loadCustomSchemaConfig', () => {
    it('returns empty config when no custom files exist', () => {
      const { config, sources } = loadCustomSchemaConfig(projectRoot);
      expect(config.disabled_sub_phases).toEqual([]);
      expect(config.ordering).toEqual({});
      expect(config.custom_sub_phases).toEqual([]);
      expect(sources).toEqual([]);
    });

    it('loads disabled_sub_phases from custom toml', () => {
      mkdirSync(join(projectRoot, '_bmad', 'custom'), { recursive: true });
      writeFileSync(join(projectRoot, '_bmad', 'custom', 'web-dev-flow.toml'), `
[custom_schema]
disabled_sub_phases = ["phase_1_1", "phase_1_2"]
`);
      const { config, sources } = loadCustomSchemaConfig(projectRoot);
      expect(config.disabled_sub_phases).toContain('phase_1_1');
      expect(config.disabled_sub_phases).toContain('phase_1_2');
      expect(sources.length).toBe(1);
    });

    it('loads ordering from custom toml', () => {
      mkdirSync(join(projectRoot, '_bmad', 'custom'), { recursive: true });
      writeFileSync(join(projectRoot, '_bmad', 'custom', 'web-dev-flow.toml'), `
[custom_schema.ordering]
phase_02 = ["2_5", "2_1"]
`);
      const { config } = loadCustomSchemaConfig(projectRoot);
      expect(config.ordering.phase_02).toEqual(['2_5', '2_1']);
    });

    it('merges from multiple sources', () => {
      mkdirSync(join(projectRoot, '_bmad', 'custom'), { recursive: true });
      writeFileSync(join(projectRoot, '_bmad', 'custom', 'web-dev-flow.toml'), `
[custom_schema]
disabled_sub_phases = ["phase_1_1"]
`);
      writeFileSync(join(projectRoot, '_bmad', 'custom', 'web-dev-flow.user.toml'), `
[custom_schema]
disabled_sub_phases = ["phase_1_2"]
`);
      const { config } = loadCustomSchemaConfig(projectRoot);
      // Both should be present (union)
      expect(config.disabled_sub_phases).toContain('phase_1_1');
      expect(config.disabled_sub_phases).toContain('phase_1_2');
    });
  });

  describe('resolveSchema', () => {
    it('returns all phases with sub-phases from framework', () => {
      const resolved = resolveSchema(frameworkRoot, projectRoot);
      expect(Object.keys(resolved.phases)).toContain('phase_01');
      expect(Object.keys(resolved.phases)).toContain('phase_02');
    });

    it('all sub-phases enabled by default', () => {
      const resolved = resolveSchema(frameworkRoot, projectRoot);
      const phase1 = resolved.phases.phase_01;
      expect(phase1).toHaveLength(2);
      expect(phase1.every(sp => sp.enabled)).toBe(true);
    });

    it('filters out disabled sub-phases', () => {
      mkdirSync(join(projectRoot, '_bmad', 'custom'), { recursive: true });
      writeFileSync(join(projectRoot, '_bmad', 'custom', 'web-dev-flow.toml'), `
[custom_schema]
disabled_sub_phases = ["phase_1_2"]
`);
      const resolved = resolveSchema(frameworkRoot, projectRoot);
      const phase1 = resolved.phases.phase_01;
      // Only one sub-phase remains enabled
      const enabled = phase1.filter(sp => sp.enabled);
      expect(enabled.length).toBe(1);
      expect(enabled[0].name).toBe('Brainstorming');
    });

    it('applies explicit ordering', () => {
      mkdirSync(join(projectRoot, '_bmad', 'custom'), { recursive: true });
      writeFileSync(join(projectRoot, '_bmad', 'custom', 'web-dev-flow.toml'), `
[custom_schema.ordering]
phase_02 = ["2_5", "2_1"]
`);
      const resolved = resolveSchema(frameworkRoot, projectRoot);
      const phase2 = resolved.phases.phase_02;
      // PRD (2_5) should come before Impact Mapping (2_1)
      expect(phase2[0].sub_phase).toBe('2_5');
      expect(phase2[1].sub_phase).toBe('2_1');
    });

    it('adds custom sub-phases', () => {
      mkdirSync(join(projectRoot, '_bmad', 'custom'), { recursive: true });
      writeFileSync(join(projectRoot, '_bmad', 'custom', 'web-dev-flow.toml'), `
[[custom_schema.custom_sub_phases]]
phase = "phase_03"
key = "3_10"
name = "Security Review"
produces = "security-review.md"
dod = "Security threats mitigated"
`);
      const resolved = resolveSchema(frameworkRoot, projectRoot);
      // Phase 3 isn't in the framework config, but custom sub-phases should still appear
      const phase3 = resolved.phases.phase_03 ?? [];
      const security = phase3.find(sp => sp.is_custom);
      expect(security).toBeDefined();
      expect(security!.name).toBe('Security Review');
    });

    it('sub-phases have correct metadata', () => {
      const resolved = resolveSchema(frameworkRoot, projectRoot);
      const brainstorming = resolved.phases.phase_01.find(sp => sp.sub_phase === '1_1');
      expect(brainstorming).toBeDefined();
      expect(brainstorming!.name).toBe('Brainstorming');
      expect(brainstorming!.skip_allowed).toBe(true);
      expect(brainstorming!.is_custom).toBe(false);
      expect(brainstorming!.enabled).toBe(true);
    });

    it('tracks sources for observability', () => {
      mkdirSync(join(projectRoot, '_bmad', 'custom'), { recursive: true });
      writeFileSync(join(projectRoot, '_bmad', 'custom', 'web-dev-flow.toml'), `
[custom_schema]
disabled_sub_phases = ["phase_1_1"]
`);
      const resolved = resolveSchema(frameworkRoot, projectRoot);
      expect(resolved.sources.length).toBeGreaterThan(0);
      expect(resolved.sources[0]).toContain('web-dev-flow.toml');
    });
  });

  describe('getEnabledSubPhases', () => {
    it('returns only enabled sub-phases sorted by order', () => {
      mkdirSync(join(projectRoot, '_bmad', 'custom'), { recursive: true });
      writeFileSync(join(projectRoot, '_bmad', 'custom', 'web-dev-flow.toml'), `
[custom_schema]
disabled_sub_phases = ["phase_1_2"]
`);
      const resolved = resolveSchema(frameworkRoot, projectRoot);
      const enabled = getEnabledSubPhases(resolved, 'phase_01');
      expect(enabled).toHaveLength(1);
      expect(enabled[0].sub_phase).toBe('1_1');
    });

    it('returns empty array for non-existent phase', () => {
      const resolved = resolveSchema(frameworkRoot, projectRoot);
      expect(getEnabledSubPhases(resolved, 'phase_99')).toEqual([]);
    });
  });

  describe('isSubPhaseEnabled', () => {
    it('returns true for enabled sub-phase', () => {
      const resolved = resolveSchema(frameworkRoot, projectRoot);
      expect(isSubPhaseEnabled(resolved, 'phase_1_1')).toBe(true);
    });

    it('returns false for disabled sub-phase', () => {
      mkdirSync(join(projectRoot, '_bmad', 'custom'), { recursive: true });
      writeFileSync(join(projectRoot, '_bmad', 'custom', 'web-dev-flow.toml'), `
[custom_schema]
disabled_sub_phases = ["phase_1_2"]
`);
      const resolved = resolveSchema(frameworkRoot, projectRoot);
      expect(isSubPhaseEnabled(resolved, 'phase_1_2')).toBe(false);
    });

    it('returns false for non-existent sub-phase', () => {
      const resolved = resolveSchema(frameworkRoot, projectRoot);
      expect(isSubPhaseEnabled(resolved, 'phase_99_9')).toBe(false);
    });
  });
});
