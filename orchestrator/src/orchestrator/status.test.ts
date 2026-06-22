import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { initCommand } from './init.js';
import { statusCommand, renderStatus, calculatePhaseProgress, renderProgressBar } from './status.js';

describe('status command', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'wdf-status-test-'));
    await initCommand({
      projectRoot,
      description: 'a team task management dashboard',
      complexity: 'standard',
      devMode: 'separated',
      triageMode: 'parallel',
      executionMode: 'interactive',
      frontend: 'react',
      backend: 'express',
      database: 'postgresql',
      apiStyle: 'rest',
      authMethod: 'jwt',
      deployment: 'docker',
    });
  });

  // ============================================================
  // Core functionality
  // ============================================================

  describe('core functionality', () => {
    it('should return correct status data after init', async () => {
      const result = await statusCommand(projectRoot);

      expect(result.overall_status).toBe('initialized');
      expect(result.current_phase).toBe(0);
      expect(result.project.name).toBe('team-task');
      expect(result.project.description).toBe('a team task management dashboard');
      expect(result.counts.stories_total).toBe(0);
    });

    it('should throw error for uninitialized project', async () => {
      const emptyDir = mkdtempSync(join(tmpdir(), 'wdf-empty-'));
      await expect(statusCommand(emptyDir)).rejects.toThrow('not initialized');
    });

    it('should have correct configuration', async () => {
      const result = await statusCommand(projectRoot);

      expect(result.configuration.complexity_tier).toBe('standard');
      expect(result.configuration.dev_mode).toBe('separated');
      expect(result.configuration.triage_mode).toBe('parallel');
      expect(result.configuration.tech_stack.frontend).toBe('react');
      expect(result.configuration.tech_stack.backend).toBe('express');
      expect(result.configuration.tech_stack.database).toBe('postgresql');
    });

    it('should have all 4 phases', async () => {
      const result = await statusCommand(projectRoot);

      expect(result.phases.length).toBe(4);
      expect(result.phases[0].phase).toBe(1);
      expect(result.phases[1].phase).toBe(2);
      expect(result.phases[2].phase).toBe(3);
      expect(result.phases[3].phase).toBe(4);
    });
  });

  // ============================================================
  // Progress calculation
  // ============================================================

  describe('progress calculation', () => {
    it('should calculate 0% for no subphases', () => {
      expect(calculatePhaseProgress([])).toBe(0);
    });

    it('should calculate 33% for 1 done out of 3', () => {
      const progress = calculatePhaseProgress([
        { status: 'DONE' },
        { status: 'NOT_STARTED' },
        { status: 'NOT_STARTED' },
      ]);
      expect(progress).toBe(33);
    });

    it('should calculate 100% for all done', () => {
      const progress = calculatePhaseProgress([
        { status: 'DONE' },
        { status: 'COMPLETED' },
        { status: 'APPROVED' },
      ]);
      expect(progress).toBe(100);
    });

    it('should calculate 50% for in-progress', () => {
      const progress = calculatePhaseProgress([
        { status: 'IN_PROGRESS' },
        { status: 'NOT_STARTED' },
      ]);
      expect(progress).toBe(25); // 0.5 / 2 = 0.25 = 25%
    });
  });

  // ============================================================
  // Progress bar rendering
  // ============================================================

  describe('progress bar rendering', () => {
    it('should render empty progress bar', () => {
      expect(renderProgressBar(0)).toBe('[░░░░]');
    });

    it('should render full progress bar', () => {
      expect(renderProgressBar(100)).toBe('[▓▓▓▓]');
    });

    it('should render half progress bar', () => {
      expect(renderProgressBar(50)).toBe('[▓▓░░]');
    });

    it('should render custom width', () => {
      expect(renderProgressBar(50, 10)).toBe('[▓▓▓▓▓░░░░░]');
    });
  });

  // ============================================================
  // Output rendering
  // ============================================================

  describe('output rendering', () => {
    it('should render short output correctly', async () => {
      const result = await statusCommand(projectRoot);
      const rendered = renderStatus(result, { short: true });

      expect(rendered).toContain('team-task');
      expect(rendered).toContain('initialized');
      expect(rendered.length).toBeLessThan(100);
    });

    it('should render full dashboard', async () => {
      const result = await statusCommand(projectRoot);
      const rendered = renderStatus(result, {});

      expect(rendered).toContain('WDF Project Status');
      expect(rendered).toContain('Phase 1');
      expect(rendered).toContain('Phase 2');
      expect(rendered).toContain('Phase 3');
      expect(rendered).toContain('Phase 4');
      expect(rendered).toContain('Configuration');
      expect(rendered).toContain('Quality Gates');
      expect(rendered).toContain('Next Actions');
    });

    it('should render phase details', async () => {
      const result = await statusCommand(projectRoot);
      const rendered = renderStatus(result, { phase: 1 });

      expect(rendered).toContain('Phase 1: Analysis');
      expect(rendered).toContain('Brainstorming');
      expect(rendered).toContain('Domain Research');
      expect(rendered).toContain('Gate Status');
      expect(rendered).toContain('Next Action');
    });

    it('should output valid JSON', async () => {
      const result = await statusCommand(projectRoot);
      const rendered = renderStatus(result, { json: true });

      const parsed = JSON.parse(rendered);
      expect(parsed.project.name).toBe('team-task');
      expect(parsed.overall_status).toBe('initialized');
    });

    it('should handle non-existent phase gracefully', async () => {
      const result = await statusCommand(projectRoot);
      const rendered = renderStatus(result, { phase: 99 });

      expect(rendered).toContain('not found');
    });
  });

  // ============================================================
  // Phase sub_phases
  // ============================================================

  describe('phase sub_phases', () => {
    it('should have correct sub_phases count for phase 1', async () => {
      const result = await statusCommand(projectRoot);
      const phase1 = result.phases.find(p => p.phase === 1);

      expect(phase1?.sub_phases.length).toBe(3); // Brainstorming, Domain Research, Product Brief
    });

    it('should have correct sub_phases count for phase 2', async () => {
      const result = await statusCommand(projectRoot);
      const phase2 = result.phases.find(p => p.phase === 2);

      expect(phase2?.sub_phases.length).toBe(10); // Full planning sub-phases
    });

    it('should have correct sub_phases count for phase 3', async () => {
      const result = await statusCommand(projectRoot);
      const phase3 = result.phases.find(p => p.phase === 3);

      expect(phase3?.sub_phases.length).toBe(9); // Full solutioning sub-phases
    });

    it('should combine BE and FE sub_phases for phase 4', async () => {
      const result = await statusCommand(projectRoot);
      const phase4 = result.phases.find(p => p.phase === 4);

      // Shared (3: 4.1 Sprint Planning, 4.13 Integration, 4.14 Retrospective)
      // + BE (5: 4.2-4.6) + FE (6: 4.7-4.12) = 14 sub-phases
      expect(phase4?.sub_phases.length).toBe(14);
      expect(phase4?.sub_phases.some(sp => sp.name.startsWith('[BE]'))).toBe(true);
      expect(phase4?.sub_phases.some(sp => sp.name.startsWith('[FE]'))).toBe(true);
    });

    it('should mark auto_skip correctly for standard complexity', async () => {
      const result = await statusCommand(projectRoot);
      const phase1 = result.phases.find(p => p.phase === 1);

      // Brainstorming: not auto-skipped
      const brainstorming = phase1?.sub_phases.find(sp => sp.name.includes('Brainstorming'));
      expect(brainstorming?.auto_skip).toBe(false);

      // Domain Research: auto-skipped for standard
      const domainResearch = phase1?.sub_phases.find(sp => sp.name.includes('Domain Research'));
      expect(domainResearch?.auto_skip).toBe(true);
    });
  });

  // ============================================================
  // Counts
  // ============================================================

  describe('counts', () => {
    it('should have zero counts for fresh project', async () => {
      const result = await statusCommand(projectRoot);

      expect(result.counts.stories_total).toBe(0);
      expect(result.counts.stories_in_progress).toBe(0);
      expect(result.counts.stories_done).toBe(0);
      expect(result.counts.crs_open).toBe(0);
      expect(result.counts.crs_resolved).toBe(0);
      expect(result.counts.queue_queued).toBe(0);
      expect(result.counts.queue_merged).toBe(0);
    });
  });

  // ============================================================
  // Quality gates
  // ============================================================

  describe('quality gates', () => {
    it('should have default quality gates', async () => {
      const result = await statusCommand(projectRoot);

      expect(result.quality_gates.min_test_coverage).toBe(80);
      expect(result.quality_gates.min_lighthouse_score).toBe(90);
      expect(result.quality_gates.max_bundle_size_kb).toBe(500);
    });
  });
});
