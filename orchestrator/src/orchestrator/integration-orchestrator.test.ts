/**
 * Tests for integration-orchestrator.ts (Phase C / V3.10.3)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { onStoryMerged, detectCrossStorySharedFiles } from './integration-orchestrator.js';
import { buildTraceabilityGraph } from './traceability-graph.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = join(tmpdir(), `wdf-int-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(projectRoot, { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function seedStatusStory(id: string, status: string): void {
  const storiesDir = join(projectRoot, '_wdf_output', 'status', 'stories');
  mkdirSync(storiesDir, { recursive: true });
  writeFileSync(
    join(storiesDir, `${id}.yaml`),
    `id: ${id}\nstatus: ${status}\n`,
  );
}

function seedStoryWithScope(storyId: string, scopeWriteFiles: string[]): void {
  mkdirSync(join(projectRoot, '_wdf_output', 'stories'), { recursive: true });
  writeFileSync(
    join(projectRoot, '_wdf_output', 'stories', `${storyId}.md`),
    `---
story_id: ${storyId}
title: ${storyId}
track: backend
scope_write:
${scopeWriteFiles.map(f => `  - ${f}`).join('\n')}
---

Body.
`,
  );
}

describe('onStoryMerged', () => {
  it('is a no-op when sprint is incomplete (not all stories MERGED)', async () => {
    seedStatusStory('S-001', 'MERGED');
    seedStatusStory('S-002', 'IN_PROGRESS');

    const result = await onStoryMerged(projectRoot, undefined, 'S-001');
    expect(result.ok).toBe(true);
    expect(result.crossStorySharedFiles).toEqual([]);
  });

  it('runs cross-story detection when all stories are MERGED', async () => {
    seedStatusStory('S-001', 'MERGED');
    seedStatusStory('S-002', 'MERGED');

    // Both stories write to the same file (shared)
    seedStoryWithScope('S-001', ['routes/api.ts']);
    seedStoryWithScope('S-002', ['routes/api.ts']);

    const result = await onStoryMerged(projectRoot, undefined, 'S-002');
    expect(result.crossStorySharedFiles.length).toBeGreaterThan(0);
    expect(result.crossStorySharedFiles.some(f => f.file.includes('api.ts'))).toBe(true);
  });

  it('writes a change request when shared files are detected', async () => {
    seedStatusStory('S-001', 'MERGED');
    seedStatusStory('S-002', 'MERGED');
    seedStoryWithScope('S-001', ['routes/api.ts']);
    seedStoryWithScope('S-002', ['routes/api.ts']);

    const result = await onStoryMerged(projectRoot, undefined, 'S-002');
    expect(result.ok).toBe(false);
    expect(result.changeRequestPath).toBeTruthy();
    expect(existsSync(result.changeRequestPath!)).toBe(true);
    expect(result.integrationFixTemplatePath).toBeTruthy();
    expect(existsSync(result.integrationFixTemplatePath!)).toBe(true);

    const tpl = readFileSync(result.integrationFixTemplatePath!, 'utf-8');
    expect(tpl).toContain('S-INTEGRATION-FIX');
    expect(tpl).toContain('routes/api.ts');
  });

  it('is a no-op when no stories exist', async () => {
    const result = await onStoryMerged(projectRoot);
    expect(result.ok).toBe(true);
    expect(result.crossStorySharedFiles).toEqual([]);
  });
});

describe('detectCrossStorySharedFiles', () => {
  it('returns empty array when no stories share files', () => {
    seedStoryWithScope('S-001', ['routes/a.ts']);
    seedStoryWithScope('S-002', ['routes/b.ts']);

    const graph = buildTraceabilityGraph({ projectRoot });
    const shared = detectCrossStorySharedFiles(graph);
    expect(shared).toEqual([]);
  });

  it('detects when two stories bind to the same FILE node', () => {
    seedStoryWithScope('S-001', ['routes/shared.ts']);
    seedStoryWithScope('S-002', ['routes/shared.ts']);

    const graph = buildTraceabilityGraph({ projectRoot });
    const shared = detectCrossStorySharedFiles(graph);
    expect(shared.length).toBe(1);
    expect(shared[0].file).toContain('shared.ts');
    expect(shared[0].stories).toContain('S-001');
    expect(shared[0].stories).toContain('S-002');
  });
});
