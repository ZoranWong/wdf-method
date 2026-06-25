/**
 * Tests for context-distiller.ts (Phase E / V3.11) — graph-driven context
 * distillation for dispatch prompts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { distillContext, renderDistilledContext } from './context-distiller.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = join(tmpdir(), `wdf-distill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(join(projectRoot, '_wdf_output', 'stories'), { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function seedPrd(reqs: Array<{ id: string; title: string }>): void {
  const lines = reqs.map(r => `## ${r.id}: ${r.title}`);
  writeFileSync(join(projectRoot, '_wdf_output', 'prd.md'), `# PRD\n\n${lines.join('\n\n')}\n`);
}

function seedStory(storyId: string, refs: string[], scopeWrite: string[] = []): void {
  const refLines = refs.length > 0 ? `refs:\n${refs.map(r => `  - ${r}`).join('\n')}` : '';
  const swLines = scopeWrite.length > 0 ? `scope_write:\n${scopeWrite.map(s => `  - ${s}`).join('\n')}` : '';
  const fm = [
    `story_id: ${storyId}`,
    `title: ${storyId} title`,
    'track: backend',
    refLines,
    swLines,
  ].filter(Boolean).join('\n');
  writeFileSync(
    join(projectRoot, '_wdf_output', 'stories', `${storyId}.md`),
    `---\n${fm}\n---\n\nBody.\n`,
  );
}

describe('distillContext', () => {
  it('returns empty when the story node does not exist', () => {
    seedPrd([{ id: 'REQ-001', title: 'Some req' }]);
    const d = distillContext('S-NONE', projectRoot);
    expect(d.empty).toBe(true);
    expect(d.requirements).toEqual([]);
  });

  it('distils the requirements a story covers', () => {
    seedPrd([
      { id: 'REQ-001', title: 'Login flow' },
      { id: 'REQ-002', title: 'Logout flow' },
      { id: 'REQ-003', title: 'Unrelated' },
    ]);
    seedStory('S-AUTH-01', ['REQ-001', 'REQ-002']);

    const d = distillContext('S-AUTH-01', projectRoot);
    expect(d.empty).toBe(false);
    const ids = d.requirements.map(r => r.id).sort();
    expect(ids).toEqual(['REQ-001', 'REQ-002']);
    const r1 = d.requirements.find(r => r.id === 'REQ-001');
    expect(r1?.title).toContain('Login flow');
    // REQ-003 is not covered by this story
    expect(ids).not.toContain('REQ-003');
  });

  it('renders a markdown block with the requirements section', () => {
    seedPrd([{ id: 'REQ-001', title: 'Login flow' }]);
    seedStory('S-AUTH-01', ['REQ-001']);

    const md = renderDistilledContext(distillContext('S-AUTH-01', projectRoot));
    expect(md).toContain('## Distilled Context');
    expect(md).toContain('Requirements this story delivers');
    expect(md).toContain('REQ-001');
  });

  it('renders an empty string when there is nothing to distil', () => {
    seedPrd([{ id: 'REQ-001', title: 'Some req' }]);
    const md = renderDistilledContext(distillContext('S-NONE', projectRoot));
    expect(md).toBe('');
  });
});
