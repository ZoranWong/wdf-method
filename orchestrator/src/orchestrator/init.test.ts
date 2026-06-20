import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'os';
import { mkdtempSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import YAML from 'js-yaml';
import { initCommand, InitOptions } from './init.js';

describe('init command', () => {
  let projectRoot: string;
  let defaultOptions: InitOptions;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'wdf-init-test-'));
    defaultOptions = {
      projectRoot,
      description: 'a team task management dashboard with React + Express + PostgreSQL',
      complexity: 'standard',
      devMode: 'separated',
      triageMode: 'parallel',
      frontend: 'react',
      backend: 'express',
      database: 'postgresql',
      apiStyle: 'rest',
      authMethod: 'jwt',
      deployment: 'docker',
    };
  });

  // ============================================================
  // Core functionality tests
  // ============================================================

  describe('core functionality', () => {
    it('should create all status files in empty directory', async () => {
      const result = await initCommand(defaultOptions);

      expect(result.success).toBe(true);
      expect(result.projectName).toBe('team-task');
      expect(result.filesCreated.length).toBeGreaterThanOrEqual(9);

      // Verify all key files exist
      expect(existsSync(join(projectRoot, '_wdf_output/status/global.yaml'))).toBe(true);
      expect(existsSync(join(projectRoot, '_wdf_output/status/phase-01.yaml'))).toBe(true);
      expect(existsSync(join(projectRoot, '_wdf_output/status/phase-02.yaml'))).toBe(true);
      expect(existsSync(join(projectRoot, '_wdf_output/status/phase-03.yaml'))).toBe(true);
      expect(existsSync(join(projectRoot, '_wdf_output/status/phase-04-be.yaml'))).toBe(true);
      expect(existsSync(join(projectRoot, '_wdf_output/status/phase-04-fe.yaml'))).toBe(true);
      expect(existsSync(join(projectRoot, '_wdf_output/status/change-requests.yaml'))).toBe(true);
      expect(existsSync(join(projectRoot, '_wdf_output/status/merge-queue/queue.yaml'))).toBe(true);
      expect(existsSync(join(projectRoot, 'wdf.toml'))).toBe(true);
    });

    it('should fail if project already exists', async () => {
      // First init should succeed
      await initCommand(defaultOptions);

      // Second init should fail
      await expect(initCommand(defaultOptions)).rejects.toThrow('already initialized');
    });

    it('should derive project name from description', async () => {
      const result = await initCommand(defaultOptions);
      expect(result.projectName).toBe('team-task');
    });

    it('should use provided name when given', async () => {
      const result = await initCommand({
        ...defaultOptions,
        name: 'my-custom-project',
      });
      expect(result.projectName).toBe('my-custom-project');
    });
  });

  // ============================================================
  // global.yaml tests
  // ============================================================

  describe('global.yaml', () => {
    it('should contain all required fields', async () => {
      await initCommand(defaultOptions);
      const global = YAML.load(readFileSync(join(projectRoot, '_wdf_output/status/global.yaml'), 'utf-8')) as any;

      expect(global.project.name).toBeDefined();
      expect(global.project.description).toBe(defaultOptions.description);
      expect(global.project.version).toBe('0.1.0');

      expect(global.workflow.version).toBe('3.6.0');
      expect(global.workflow.dev_mode).toBe('separated');
      expect(global.workflow.task_triage_mode).toBe('parallel');
      expect(global.workflow.complexity_tier).toBe('standard');
      expect(global.workflow.overall_status).toBe('initialized');
      expect(global.workflow.current_phase).toBe(0);
      expect(global.workflow.requirements_frozen_at).toBeNull();
      expect(global.workflow.development_order_frozen_at).toBeNull();

      expect(global.tech_stack.frontend).toBe('react');
      expect(global.tech_stack.backend).toBe('express');
      expect(global.tech_stack.database).toBe('postgresql');

      expect(global.quality_gates.min_test_coverage).toBe(80);
      expect(global.quality_gates.min_lighthouse_score).toBe(90);
      expect(global.quality_gates.max_bundle_size_kb).toBe(500);

      expect(global.scope_lock.enabled).toBe(true);
      expect(global.scope_lock.enforcement_mode).toBe('strict');
      expect(global.scope_lock.protected_paths.length).toBe(12); // 12 protected paths

      expect(global.agents.available.length).toBeGreaterThan(5);
      expect(global.agents.party_participants).toBeDefined();
    });

    it('should have correct timestamps', async () => {
      await initCommand(defaultOptions);
      const global = YAML.load(readFileSync(join(projectRoot, '_wdf_output/status/global.yaml'), 'utf-8')) as any;

      expect(global.project.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(global.audit.initialized_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(global.audit.last_updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  // ============================================================
  // Phase state tests
  // ============================================================

  describe('phase state files', () => {
    it('phase-01.yaml should have correct structure', async () => {
      await initCommand(defaultOptions);
      const phase1 = YAML.load(readFileSync(join(projectRoot, '_wdf_output/status/phase-01.yaml'), 'utf-8')) as any;

      expect(phase1.phase).toBe(1);
      expect(phase1.title).toBe('Analysis');
      expect(phase1.status).toBe('NOT_STARTED');
      expect(phase1.fsm.current_state).toBe('NOT_STARTED');
      expect(phase1.fsm.state_history.length).toBe(1);
      expect(Object.keys(phase1.sub_phases).length).toBe(3); // 3 sub-phases
    });

    it('phase-02.yaml should have correct structure', async () => {
      await initCommand(defaultOptions);
      const phase2 = YAML.load(readFileSync(join(projectRoot, '_wdf_output/status/phase-02.yaml'), 'utf-8')) as any;

      expect(phase2.phase).toBe(2);
      expect(phase2.title).toBe('Planning');
      expect(Object.keys(phase2.sub_phases).length).toBe(10); // 10 sub-phases
    });

    it('phase-03.yaml should have correct structure', async () => {
      await initCommand(defaultOptions);
      const phase3 = YAML.load(readFileSync(join(projectRoot, '_wdf_output/status/phase-03.yaml'), 'utf-8')) as any;

      expect(phase3.phase).toBe(3);
      expect(phase3.title).toBe('Solutioning');
      expect(Object.keys(phase3.sub_phases).length).toBe(9); // 9 sub-phases
    });

    it('phase-04-be.yaml and phase-04-fe.yaml should have correct structure', async () => {
      await initCommand(defaultOptions);
      const be = YAML.load(readFileSync(join(projectRoot, '_wdf_output/status/phase-04-be.yaml'), 'utf-8')) as any;
      const fe = YAML.load(readFileSync(join(projectRoot, '_wdf_output/status/phase-04-fe.yaml'), 'utf-8')) as any;

      expect(be.phase).toBe(4);
      expect(be.track).toBe('backend');
      expect(be.title).toContain('Backend');
      expect(Object.keys(be.sub_phases).length).toBe(5); // 5 BE sub-phases (4.2-4.6)

      expect(fe.phase).toBe(4);
      expect(fe.track).toBe('frontend');
      expect(fe.title).toContain('Frontend');
      expect(Object.keys(fe.sub_phases).length).toBe(6); // 6 FE sub-phases (4.7-4.12)
    });
  });

  // ============================================================
  // Complexity-based auto-skip tests
  // ============================================================

  describe('complexity-based auto-skip', () => {
    it('should set auto_skip correctly for simple complexity', async () => {
      await initCommand({ ...defaultOptions, complexity: 'simple' });
      const phase1 = YAML.load(readFileSync(join(projectRoot, '_wdf_output/status/phase-01.yaml'), 'utf-8')) as any;

      expect(phase1.sub_phases.phase_1_1.auto_skip).toBe(false); // Brainstorming never skipped
      expect(phase1.sub_phases.phase_1_2.auto_skip).toBe(true); // Domain Research skipped for simple
      expect(phase1.sub_phases.phase_1_3.auto_skip).toBe(true); // Product Brief skipped for simple
    });

    it('should set auto_skip correctly for standard complexity', async () => {
      await initCommand({ ...defaultOptions, complexity: 'standard' });
      const phase1 = YAML.load(readFileSync(join(projectRoot, '_wdf_output/status/phase-01.yaml'), 'utf-8')) as any;

      expect(phase1.sub_phases.phase_1_1.auto_skip).toBe(false);
      expect(phase1.sub_phases.phase_1_2.auto_skip).toBe(true); // Domain Research skipped for standard
      expect(phase1.sub_phases.phase_1_3.auto_skip).toBe(true); // Product Brief skipped for standard
    });

    it('should set auto_skip correctly for complex complexity', async () => {
      await initCommand({ ...defaultOptions, complexity: 'complex' });
      const phase1 = YAML.load(readFileSync(join(projectRoot, '_wdf_output/status/phase-01.yaml'), 'utf-8')) as any;

      // Complex: No auto-skip
      expect(phase1.sub_phases.phase_1_1.auto_skip).toBe(false);
      expect(phase1.sub_phases.phase_1_2.auto_skip).toBe(false);
      expect(phase1.sub_phases.phase_1_3.auto_skip).toBe(false);
    });
  });

  // ============================================================
  // Change Requests & Merge Queue tests
  // ============================================================

  describe('change-requests.yaml and merge-queue', () => {
    it('change-requests.yaml should be empty initially', async () => {
      await initCommand(defaultOptions);
      const cr = YAML.load(readFileSync(join(projectRoot, '_wdf_output/status/change-requests.yaml'), 'utf-8')) as any;

      expect(cr.version).toBe('3.6.0');
      expect(cr.change_requests).toEqual([]);
    });

    it('merge-queue/queue.yaml should be idle initially', async () => {
      await initCommand(defaultOptions);
      const queue = YAML.load(readFileSync(join(projectRoot, '_wdf_output/status/merge-queue/queue.yaml'), 'utf-8')) as any;

      expect(queue.version).toBe('3.6.0');
      expect(queue.status).toBe('idle');
      expect(queue.queued).toEqual([]);
      expect(queue.merged).toEqual([]);
      expect(queue.failed).toEqual([]);
      expect(queue.waiting_dependency).toEqual([]);
    });
  });

  // ============================================================
  // wdf.toml and .gitignore tests
  // ============================================================

  describe('wdf.toml and .gitignore', () => {
    it('wdf.toml should be created', async () => {
      await initCommand(defaultOptions);
      const tomlPath = join(projectRoot, 'wdf.toml');
      expect(existsSync(tomlPath)).toBe(true);

      const content = readFileSync(tomlPath, 'utf-8');
      expect(content).toContain('[project]');
      expect(content).toContain('name = "team-task"');
      expect(content).toContain('[workflow]');
      expect(content).toContain('[tech_stack]');
    });

    it('.gitignore should include _wdf_output', async () => {
      await initCommand(defaultOptions);
      const gitignorePath = join(projectRoot, '.gitignore');
      const content = readFileSync(gitignorePath, 'utf-8');
      expect(content).toContain('_wdf_output');
    });

    it('should not duplicate _wdf_output in .gitignore if already exists', async () => {
      // Pre-create .gitignore with _wdf_output rule
      const gitignorePath = join(projectRoot, '.gitignore');
      import('fs').then(fs => {
        fs.writeFileSync(gitignorePath, 'node_modules\n_wdf_output/\n', 'utf-8');
      });

      await initCommand(defaultOptions);

      // Check it still has only one line
      const content = readFileSync(gitignorePath, 'utf-8');
      const matches = content.match(/_wdf_output/g);
      expect(matches?.length).toBe(1);
    });
  });

  // ============================================================
  // Directory structure tests
  // ============================================================

  describe('directory structure', () => {
    it('should create the complete directory structure', async () => {
      await initCommand(defaultOptions);

      const root = join(projectRoot, '_wdf_output');

      expect(existsSync(join(root, 'status'))).toBe(true);
      expect(existsSync(join(root, 'status', 'stories'))).toBe(true);
      expect(existsSync(join(root, 'status', 'merge-queue', 'items'))).toBe(true);
      expect(existsSync(join(root, 'signals'))).toBe(true);
      expect(existsSync(join(root, '_output', 'analysis'))).toBe(true);
      expect(existsSync(join(root, '_output', 'planning'))).toBe(true);
      expect(existsSync(join(root, '_output', 'solutioning'))).toBe(true);
      expect(existsSync(join(root, '_output', 'acceptance'))).toBe(true);
    });
  });
});
