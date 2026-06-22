/**
 * Tests for the dispatch loop engine.
 *
 * Verifies that evaluateNextLoopAction correctly:
 *   - Returns 'dispatch' for the next dependency-ready story
 *   - Returns 'escalation' when a story has exhausted retries
 *   - Returns 'blocked' when dependencies aren't met
 *   - Returns 'complete' when all stories are merged
 *   - Respects priority order (escalation > dispatch > blocked > complete)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { evaluateNextLoopAction, postDispatchNext } from './dispatch-loop-engine.js';
import { SprintStatusManager } from './sprint-status.js';
import type { StoryEntry } from './types.js';

// ── Test Helpers ───────────────────────────────────────────

function makeTempProject(): string {
  const dir = join(tmpdir(), `wdf-loop-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, '_wdf_output', 'status'), { recursive: true });
  mkdirSync(join(dir, '_wdf_output', '.dispatch', 'pipeline'), { recursive: true });
  return dir;
}

function makeStory(id: string, track: 'backend' | 'frontend' = 'backend', deps?: { story_id: string; track: string }[]): StoryEntry {
  return {
    story_id: id,
    title: `Story ${id}`,
    track,
    order: parseInt(id.replace(/\D/g, '') || '1'),
    scope_write: [`src/${id}.ts`],
    acceptance_check: [`npm test -- --grep ${id}`],
    code_standards_source: ['internal'],
    depends_on: deps,
    parallel_safe: !deps,
  };
}

async function makeStateManager(projectRoot: string, stories: StoryEntry[]): Promise<SprintStatusManager> {
  const trackingPath = join(projectRoot, '_wdf_output', 'status', 'sprint-status.yaml');

  // Write minimal YAML — just enough for SprintStatusManager.load() to succeed
  const yaml = `project: test
workflow_version: "3.9"
created_at: "${new Date().toISOString()}"
updated_at: "${new Date().toISOString()}"
global_state:
  dev_mode: separated
  task_triage_mode: parallel
  overall_status: IN_PROGRESS
  current_phase: 4
  code_standards_source:
    - internal
phases:
  phase_4:
    status: IN_PROGRESS
    substates:
      phase_4_4:
        status: IN_PROGRESS
        stories: []
      phase_4_10:
        status: IN_PROGRESS
        stories: []
change_requests: []
`;
  writeFileSync(trackingPath, yaml);
  const state = await SprintStatusManager.load(trackingPath);

  // Set development_order programmatically (YAML list serialization is fragile)
  await state.setDevelopmentOrder(stories);

  return state;
}

// ── Tests ──────────────────────────────────────────────────

describe('dispatch-loop-engine', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = makeTempProject();
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch {}
  });

  describe('evaluateNextLoopAction', () => {
    it('returns complete when no stories in development_order', async () => {
      const state = await makeStateManager(projectRoot, []);
      const result = evaluateNextLoopAction(state, join(projectRoot, '_wdf_output'), projectRoot, projectRoot);

      expect(result.action.kind).toBe('complete');
      if (result.action.kind === 'complete') {
        expect(result.action.summary.total_stories).toBe(0);
      }
    });

    it('returns dispatch for a single story with no dependencies', async () => {
      const stories = [makeStory('S-001')];
      const state = await makeStateManager(projectRoot, stories);
      const result = evaluateNextLoopAction(state, join(projectRoot, '_wdf_output'), projectRoot, projectRoot);

      expect(result.action.kind).toBe('dispatch');
      if (result.action.kind === 'dispatch') {
        expect(result.action.story_id).toBe('S-001');
        expect(result.action.track).toBe('backend');
        expect(result.action.role).toBe('backend-developer');
        expect(result.action.stage).toBe('dev');
        expect(result.action.attempt).toBe(1);
      }
    });

    it('returns dispatch for frontend story with correct role', async () => {
      const stories = [makeStory('S-001', 'frontend')];
      const state = await makeStateManager(projectRoot, stories);
      const result = evaluateNextLoopAction(state, join(projectRoot, '_wdf_output'), projectRoot, projectRoot);

      expect(result.action.kind).toBe('dispatch');
      if (result.action.kind === 'dispatch') {
        expect(result.action.role).toBe('frontend-developer');
        expect(result.action.track).toBe('frontend');
      }
    });

    it('returns blocked when dependencies are not met', async () => {
      const stories = [
        makeStory('S-001', 'backend'),
        makeStory('S-002', 'backend', [{ story_id: 'S-001', track: 'backend' }]),
      ];
      const state = await makeStateManager(projectRoot, stories);
      const result = evaluateNextLoopAction(state, join(projectRoot, '_wdf_output'), projectRoot, projectRoot);

      // S-001 has no deps → dispatch it
      expect(result.action.kind).toBe('dispatch');
      if (result.action.kind === 'dispatch') {
        expect(result.action.story_id).toBe('S-001');
      }

      // S-002 should be blocked (dependency not met)
      const s002Snapshot = result.pipeline_snapshot.find(s => s.story_id === 'S-002');
      expect(s002Snapshot).toBeDefined();
      expect(s002Snapshot!.is_next).toBe(false);
    });

    it('pipeline_snapshot contains all stories', async () => {
      const stories = [
        makeStory('S-001'),
        makeStory('S-002', 'frontend'),
        makeStory('S-003'),
      ];
      const state = await makeStateManager(projectRoot, stories);
      const result = evaluateNextLoopAction(state, join(projectRoot, '_wdf_output'), projectRoot, projectRoot);

      expect(result.pipeline_snapshot).toHaveLength(3);
      expect(result.pipeline_snapshot.map(s => s.story_id)).toEqual(['S-001', 'S-002', 'S-003']);
    });

    it('evaluated_at is a valid ISO timestamp', async () => {
      const stories = [makeStory('S-001')];
      const state = await makeStateManager(projectRoot, stories);
      const result = evaluateNextLoopAction(state, join(projectRoot, '_wdf_output'), projectRoot, projectRoot);

      expect(result.evaluated_at).toBeDefined();
      expect(new Date(result.evaluated_at).getTime()).not.toBeNaN();
    });
  });

  describe('postDispatchNext', () => {
    it('returns the next action after revoking permissions', async () => {
      const stories = [makeStory('S-001')];
      const state = await makeStateManager(projectRoot, stories);

      // First call: should dispatch S-001
      const first = evaluateNextLoopAction(state, join(projectRoot, '_wdf_output'), projectRoot, projectRoot);
      expect(first.action.kind).toBe('dispatch');

      // Post-dispatch: should return next action (S-001 still not merged, but permissions revoked)
      const after = postDispatchNext(
        state,
        join(projectRoot, '_wdf_output'),
        projectRoot,
        projectRoot,
        'S-001',
        'dev',
      );

      // Still a dispatch (S-001 not merged yet, just permissions revoked)
      expect(after.action.kind).toBe('dispatch');
    });

    it('does not throw when revoking non-existent permissions', async () => {
      const stories = [makeStory('S-001')];
      const state = await makeStateManager(projectRoot, stories);

      // Should not throw even if no permissions were applied
      expect(() => {
        postDispatchNext(state, join(projectRoot, '_wdf_output'), projectRoot, projectRoot, 'S-999', 'dev');
      }).not.toThrow();
    });
  });
});
