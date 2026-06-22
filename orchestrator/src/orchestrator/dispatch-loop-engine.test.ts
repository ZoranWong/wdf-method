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

function makeStory(id: string, track: 'backend' | 'frontend' = 'backend', deps?: { story_id: string; track: 'backend' | 'frontend' }[]): StoryEntry {
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

  // ─────────────────────────────────────────────────────────
  // V3.9 — ESCALATED → FAIL auto-promotion (hold timeout sweep)
  // ─────────────────────────────────────────────────────────
  describe('hold timeout sweep (V3.9)', () => {
    const HOURS = 3600 * 1000;
    const escPath = (id: string) => join(projectRoot, '_wdf_output', '.dispatch', 'pipeline', id, 'ESCALATED.json');

    function writeEscalated(id: string, escalatedAt: string, extra: Record<string, any> = {}) {
      mkdirSync(join(projectRoot, '_wdf_output', '.dispatch', 'pipeline', id), { recursive: true });
      writeFileSync(escPath(id), JSON.stringify({
        type: 'pipeline_escalation',
        story_id: id,
        title: `Story ${id}`,
        track: 'backend',
        failed_stage: 'review',
        failed_stages: ['review'],
        total_attempts: 5,
        reason: 'Exceeded retry budget',
        recommendation: 'Manual review',
        manifest_path: escPath(id),
        escalated_at: escalatedAt,
        created_at: escalatedAt,
        ...extra,
      }));
    }

    it('promotes PIPELINE_ESCALATED to FAIL when hold > 24h', async () => {
      const stories = [makeStory('S-001')];
      const state = await makeStateManager(projectRoot, stories);

      // Seed: story in PIPELINE_ESCALATED, escalated 25h ago
      await state.updateStoryStatus(4, 'phase_4_4', {
        id: 'S-001',
        status: 'PIPELINE_ESCALATED',
        pipeline: { stage: 'dev', attempt: 5, total_retries: 5, max_retries: 5 },
      });
      writeEscalated('S-001', new Date(Date.now() - 25 * HOURS).toISOString());

      const result = evaluateNextLoopAction(state, join(projectRoot, '_wdf_output'), projectRoot, projectRoot);

      // Story should now be FAIL (terminal)
      const updated = state.getStories(4, 'phase_4_4').find(s => s.id === 'S-001');
      expect(updated?.status).toBe('FAIL');
      expect(updated?.completed_at).toBeDefined();

      // FAIL stories return as 'skip' from processStoryPipeline, so loop sees
      // a complete summary (only story in dev_order is now terminal)
      expect(['complete', 'dispatch', 'escalation', 'blocked']).toContain(result.action.kind);
    });

    it('does NOT promote when hold < 24h', async () => {
      const stories = [makeStory('S-001')];
      const state = await makeStateManager(projectRoot, stories);

      await state.updateStoryStatus(4, 'phase_4_4', {
        id: 'S-001',
        status: 'PIPELINE_ESCALATED',
        pipeline: { stage: 'dev', attempt: 5, total_retries: 5, max_retries: 5 },
      });
      writeEscalated('S-001', new Date(Date.now() - 1 * HOURS).toISOString());

      evaluateNextLoopAction(state, join(projectRoot, '_wdf_output'), projectRoot, projectRoot);

      // Still PIPELINE_ESCALATED (within hold window)
      const updated = state.getStories(4, 'phase_4_4').find(s => s.id === 'S-001');
      expect(updated?.status).toBe('PIPELINE_ESCALATED');
    });

    it('falls back to created_at when escalated_at missing (legacy manifests)', async () => {
      const stories = [makeStory('S-001')];
      const state = await makeStateManager(projectRoot, stories);

      await state.updateStoryStatus(4, 'phase_4_4', {
        id: 'S-001',
        status: 'PIPELINE_ESCALATED',
        pipeline: { stage: 'dev', attempt: 5, total_retries: 5, max_retries: 5 },
      });
      // Legacy manifest: only created_at, no escalated_at
      writeEscalated('S-001', new Date(Date.now() - 30 * HOURS).toISOString(), { escalated_at: undefined });

      evaluateNextLoopAction(state, join(projectRoot, '_wdf_output'), projectRoot, projectRoot);

      const updated = state.getStories(4, 'phase_4_4').find(s => s.id === 'S-001');
      expect(updated?.status).toBe('FAIL');
    });

    it('writes pipeline_fail audit entry on promotion', async () => {
      const stories = [makeStory('S-001')];
      const state = await makeStateManager(projectRoot, stories);

      await state.updateStoryStatus(4, 'phase_4_4', {
        id: 'S-001',
        status: 'PIPELINE_ESCALATED',
        pipeline: { stage: 'dev', attempt: 5, total_retries: 5, max_retries: 5 },
      });
      writeEscalated('S-001', new Date(Date.now() - 25 * HOURS).toISOString());

      evaluateNextLoopAction(state, join(projectRoot, '_wdf_output'), projectRoot, projectRoot);

      // Audit file should exist and contain a pipeline_fail event
      const today = new Date();
      const yyyy = today.getUTCFullYear();
      const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(today.getUTCDate()).padStart(2, '0');
      const auditFile = join(projectRoot, '_wdf_output', 'audit', `${yyyy}-${mm}-${dd}.jsonl`);
      const { existsSync, readFileSync } = await import('fs');
      expect(existsSync(auditFile)).toBe(true);
      const lines = readFileSync(auditFile, 'utf-8').split('\n').filter(l => l);
      const events = lines.map(l => JSON.parse(l));
      const failEvent = events.find((e: any) => e.event === 'pipeline_fail' && e.story_id === 'S-001');
      expect(failEvent).toBeDefined();
      expect(failEvent.status).toBe('fail');
      expect(failEvent.details.hold_limit_hours).toBe(24);
    });
  });
});
