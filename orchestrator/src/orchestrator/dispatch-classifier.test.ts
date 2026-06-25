/**
 * Tests for dispatch-classifier.ts (Phase C / V3.10.3)
 */

import { describe, it, expect } from 'vitest';
import { classifyDispatch, formatRecommendation } from './dispatch-classifier.js';
import type { StoryEntry, PipelineContext } from './types.js';

function minimalPipeline(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    stage: 'dev',
    attempt: 1,
    total_retries: 0,
    max_retries: 5,
    ...overrides,
  } as PipelineContext;
}

function minimalStory(overrides: Partial<StoryEntry> = {}): StoryEntry {
  return {
    story_id: 'S-TEST-01',
    title: 'Test',
    track: 'backend',
    order: 1,
    scope_write: ['src/a.ts'],
    acceptance_check: ['npm test'],
    code_standards_source: [],
    ...overrides,
  } as StoryEntry;
}

describe('classifyDispatch', () => {
  it('recommends backend-developer for fresh dev on a backend track', () => {
    const r = classifyDispatch({
      stage: 'dev',
      pipeline: minimalPipeline(),
      story: minimalStory(),
    });
    expect(r?.agent_role).toBe('backend-developer');
    expect(r?.auto_dispatch_eligible).toBe(false);
    expect(r?.is_fix_loop).toBe(false);
    expect(r?.decision_rule).toBe('dev:fresh');
  });

  it('recommends frontend-developer for fresh dev on a frontend track', () => {
    const r = classifyDispatch({
      stage: 'dev',
      pipeline: minimalPipeline(),
      story: minimalStory({ track: 'frontend' }),
    });
    expect(r?.agent_role).toBe('frontend-developer');
  });

  it('flags dev fix loop when last_failure is set and stage is dev', () => {
    const r = classifyDispatch({
      stage: 'dev',
      pipeline: minimalPipeline({
        last_failure: { stage: 'review', error: 'review failed: missing tests', at: new Date().toISOString() },
      }),
      story: minimalStory(),
    });
    expect(r?.agent_role).toBe('backend-developer');
    expect(r?.is_fix_loop).toBe(true);
    expect(r?.reason).toContain('Fix loop');
    expect(r?.reason).toContain('review');
  });

  it('recommends code-reviewer for review stage', () => {
    const r = classifyDispatch({
      stage: 'review',
      pipeline: minimalPipeline({ stage: 'review' }),
      story: minimalStory(),
    });
    expect(r?.agent_role).toBe('code-reviewer');
    expect(r?.auto_dispatch_eligible).toBe(true);
    expect(r?.decision_rule).toBe('review:adversarial');
  });

  it('recommends code-reviewer for testing stage', () => {
    const r = classifyDispatch({
      stage: 'testing',
      pipeline: minimalPipeline({ stage: 'testing' }),
      story: minimalStory(),
    });
    expect(r?.agent_role).toBe('code-reviewer');
    expect(r?.auto_dispatch_eligible).toBe(true);
    expect(r?.decision_rule).toBe('testing:coverage');
  });

  it('recommends qa-verifier for qa stage', () => {
    const r = classifyDispatch({
      stage: 'qa',
      pipeline: minimalPipeline({ stage: 'qa' }),
      story: minimalStory(),
    });
    expect(r?.agent_role).toBe('qa-verifier');
    expect(r?.auto_dispatch_eligible).toBe(true);
    expect(r?.decision_rule).toBe('qa:final-acceptance');
  });

  it('returns null when budget is exhausted (escalation territory)', () => {
    const r = classifyDispatch({
      stage: 'dev',
      pipeline: minimalPipeline({ total_retries: 5, max_retries: 5 }),
      story: minimalStory(),
    });
    expect(r).toBeNull();
  });

  it('stamps manifest_path when provided', () => {
    const r = classifyDispatch({
      stage: 'review',
      pipeline: minimalPipeline({ stage: 'review' }),
      story: minimalStory(),
      manifestPath: '/foo/bar/manifest.json',
    });
    expect(r?.manifest_path).toBe('/foo/bar/manifest.json');
  });
});

describe('formatRecommendation', () => {
  it('includes fix tag on fix-loop dispatches', () => {
    const r = classifyDispatch({
      stage: 'dev',
      pipeline: minimalPipeline({
        last_failure: { stage: 'testing', error: 'fail', at: new Date().toISOString() },
      }),
      story: minimalStory(),
    })!;
    const s = formatRecommendation(r);
    expect(s.startsWith('[fix]')).toBe(true);
  });

  it('includes ok tag and auto marker for review', () => {
    const r = classifyDispatch({
      stage: 'review',
      pipeline: minimalPipeline({ stage: 'review' }),
      story: minimalStory(),
    })!;
    const s = formatRecommendation(r);
    expect(s.startsWith('[ok]')).toBe(true);
    expect(s).toContain('(auto)');
  });
});
