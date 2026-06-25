/**
 * phase4-entry-gate — the fail-closed Phase 3.9 → Phase 4 boundary.
 *
 * These tests seed synthetic projects and verify the gate:
 *   - honors the semantic_gate opt-out (disabled → ok:true, enabled:false),
 *   - blocks on semantic gaps (uncovered REQ),
 *   - blocks on traceability gaps (story with no REQ),
 *   - EXCLUDES test-dependent checks (STORY_NO_TEST / AC_TEST_BINDING) so a
 *     spec with stories-but-no-tests can still enter Phase 4,
 *   - blocks on an existing-but-incomplete checklist,
 *   - does NOT block on a MISSING checklist (checklists are optional).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { evaluatePhase4EntryGate, formatPhase4EntryGate } from './phase4-entry-gate.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'wdf-phase4-gate-'));
  mkdirSync(join(projectRoot, '_wdf_output'), { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function seedPrd(reqs: string[]): void {
  const lines = reqs.map(r => `## ${r}: Some requirement`);
  writeFileSync(join(projectRoot, '_wdf_output', 'prd.md'), `# PRD\n\n${lines.join('\n\n')}\n`);
}

function seedStory(storyId: string, refs: string[] = []): void {
  mkdirSync(join(projectRoot, '_wdf_output', 'stories'), { recursive: true });
  const refLines = refs.length > 0 ? `refs:\n${refs.map(r => `  - ${r}`).join('\n')}` : '';
  const fm = [`story_id: ${storyId}`, `title: ${storyId}`, 'track: backend', refLines]
    .filter(Boolean)
    .join('\n');
  writeFileSync(
    join(projectRoot, '_wdf_output', 'stories', `${storyId}.md`),
    `---\n${fm}\n---\n\nBody.\n`,
  );
}

function seedChecklist(storyId: string, items: Array<{ id: string; checked: boolean }>): void {
  const dir = join(projectRoot, '_wdf_output', 'checklists');
  mkdirSync(dir, { recursive: true });
  const body = items.map(i => `- [${i.checked ? 'x' : ' '}] ${i.id} some requirement`).join('\n');
  writeFileSync(join(dir, `${storyId}.md`), `# Checklist ${storyId}\n\n${body}\n`);
}

function optOut(): void {
  writeFileSync(join(projectRoot, 'wdf.toml'), '[semantic_gate]\nenabled = false\n');
}

describe('evaluatePhase4EntryGate — opt-out', () => {
  it('returns ok:true, enabled:false when semantic_gate disabled', () => {
    seedPrd(['REQ-001', 'REQ-002']);
    seedStory('S-001', ['REQ-001']); // REQ-002 uncovered — would normally block
    optOut();

    const r = evaluatePhase4EntryGate(projectRoot);
    expect(r.enabled).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.gaps).toEqual([]);
  });
});

describe('evaluatePhase4EntryGate — semantic gaps', () => {
  it('blocks on an uncovered REQ', () => {
    seedPrd(['REQ-001', 'REQ-002']);
    seedStory('S-001', ['REQ-001']); // REQ-002 uncovered

    const r = evaluatePhase4EntryGate(projectRoot);
    expect(r.enabled).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.totals.semantic).toBeGreaterThanOrEqual(1);
    expect(r.gaps.some(g => g.category === 'semantic' && g.message.includes('REQ-002'))).toBe(true);
  });
});

describe('evaluatePhase4EntryGate — traceability gaps', () => {
  it('blocks on a story that derives from no REQ', () => {
    seedPrd(['REQ-001']);
    seedStory('S-001', ['REQ-001']); // covers REQ-001
    seedStory('S-002', []); // no refs → STORY_NO_REQ

    const r = evaluatePhase4EntryGate(projectRoot);
    expect(r.ok).toBe(false);
    expect(r.totals.traceability).toBeGreaterThanOrEqual(1);
    expect(r.gaps.some(g => g.category === 'traceability' && g.id === 'S-002')).toBe(true);
  });
});

describe('evaluatePhase4EntryGate — test-dependent checks excluded', () => {
  it('passes a spec with stories but no tests (STORY_NO_TEST / AC_TEST_BINDING excluded)', () => {
    seedPrd(['REQ-001']);
    seedStory('S-001', ['REQ-001']);

    const r = evaluatePhase4EntryGate(projectRoot);
    expect(r.enabled).toBe(true);
    expect(r.ok).toBe(true);
    // No traceability gap should be STORY_NO_TEST, no semantic gap AC_TEST_BINDING.
    expect(r.gaps.some(g => g.message.includes('STORY_NO_TEST'))).toBe(false);
    expect(r.gaps.some(g => g.id === 'AC_TEST_BINDING')).toBe(false);
  });
});

describe('evaluatePhase4EntryGate — checklists', () => {
  it('blocks on an existing-but-incomplete checklist', () => {
    seedPrd(['REQ-001']);
    seedStory('S-001', ['REQ-001']);
    seedChecklist('S-001', [
      { id: 'CHK-001', checked: true },
      { id: 'CHK-002', checked: false },
    ]);

    const r = evaluatePhase4EntryGate(projectRoot);
    expect(r.ok).toBe(false);
    expect(r.totals.checklist).toBe(1);
    expect(r.gaps.some(g => g.category === 'checklist' && g.id === 'S-001')).toBe(true);
  });

  it('does NOT block on a MISSING checklist (checklists are optional)', () => {
    seedPrd(['REQ-001']);
    seedStory('S-001', ['REQ-001']);
    // no checklists/ directory at all

    const r = evaluatePhase4EntryGate(projectRoot);
    expect(r.ok).toBe(true);
    expect(r.totals.checklist).toBe(0);
  });

  it('does NOT block on a fully-ticked checklist', () => {
    seedPrd(['REQ-001']);
    seedStory('S-001', ['REQ-001']);
    seedChecklist('S-001', [
      { id: 'CHK-001', checked: true },
      { id: 'CHK-002', checked: true },
    ]);

    const r = evaluatePhase4EntryGate(projectRoot);
    expect(r.ok).toBe(true);
    expect(r.totals.checklist).toBe(0);
  });
});

describe('formatPhase4EntryGate', () => {
  it('reports DISABLED when opted out', () => {
    optOut();
    const r = evaluatePhase4EntryGate(projectRoot);
    expect(formatPhase4EntryGate(r)).toContain('DISABLED');
  });

  it('reports PASS for a clean spec', () => {
    seedPrd(['REQ-001']);
    seedStory('S-001', ['REQ-001']);
    const r = evaluatePhase4EntryGate(projectRoot);
    expect(formatPhase4EntryGate(r)).toContain('PASS');
  });

  it('reports FAIL with a gap breakdown when blocked', () => {
    seedPrd(['REQ-001', 'REQ-002']);
    seedStory('S-001', ['REQ-001']);
    const r = evaluatePhase4EntryGate(projectRoot);
    const out = formatPhase4EntryGate(r);
    expect(out).toContain('FAIL');
    expect(out).toContain('semantic:');
  });
});
