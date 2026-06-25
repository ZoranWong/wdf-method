/**
 * phase4-exit-gate — the fail-closed Phase 4 → MERGED boundary.
 *
 * The symmetric complement of phase4-entry-gate. These tests seed synthetic
 * projects and verify the gate:
 *   - honors the semantic_gate opt-out (disabled → ok:true, enabled:false),
 *   - blocks on an AC with no bound TEST (test_binding),
 *   - blocks on a STORY with no covering TEST (traceability STORY_NO_TEST),
 *   - passes once a matching test binds the AC,
 *   - scopes gaps to a single story when storyId is provided,
 *   - format reports the three states (DISABLED / PASS / FAIL).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { evaluatePhase4ExitGate, formatPhase4ExitGate } from './phase4-exit-gate.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'wdf-phase4-exit-'));
  mkdirSync(join(projectRoot, '_wdf_output'), { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function seedPrd(reqs: string[]): void {
  const lines = reqs.map(r => `## ${r}: Some requirement`);
  writeFileSync(join(projectRoot, '_wdf_output', 'prd.md'), `# PRD\n\n${lines.join('\n\n')}\n`);
}

function seedStory(storyId: string, refs: string[], acs: string[]): void {
  mkdirSync(join(projectRoot, '_wdf_output', 'stories'), { recursive: true });
  const refLines = refs.length > 0 ? `refs:\n${refs.map(r => `  - ${r}`).join('\n')}` : '';
  const acLines = acs.length > 0 ? `acceptance_criteria:\n${acs.map(a => `  - ${a}`).join('\n')}` : '';
  const fm = [`story_id: ${storyId}`, `title: ${storyId}`, 'track: backend', refLines, acLines]
    .filter(Boolean)
    .join('\n');
  writeFileSync(
    join(projectRoot, '_wdf_output', 'stories', `${storyId}.md`),
    `---\n${fm}\n---\n\nBody.\n`,
  );
}

/** Write a test file binding the given AC ids via the `it('AC-N: ...')` name prefix. */
function seedTests(fileName: string, acIds: string[]): void {
  const dir = join(projectRoot, 'tests');
  mkdirSync(dir, { recursive: true });
  const body = acIds
    .map(ac => `  it('${ac}: verifies the criterion', () => { expect(true).toBe(true); });`)
    .join('\n');
  writeFileSync(join(dir, fileName), `describe('suite', () => {\n${body}\n});\n`);
}

function optOut(): void {
  writeFileSync(join(projectRoot, 'wdf.toml'), '[semantic_gate]\nenabled = false\n');
}

describe('evaluatePhase4ExitGate — opt-out', () => {
  it('returns ok:true, enabled:false when semantic_gate disabled', () => {
    seedPrd(['REQ-001']);
    seedStory('S-001', ['REQ-001'], ['AC-1']); // no test → would normally block
    optOut();

    const r = evaluatePhase4ExitGate(projectRoot);
    expect(r.enabled).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.gaps).toEqual([]);
  });
});

describe('evaluatePhase4ExitGate — test binding', () => {
  it('blocks on an AC with no bound TEST', () => {
    seedPrd(['REQ-001']);
    seedStory('S-001', ['REQ-001'], ['AC-1']);
    // no tests at all

    const r = evaluatePhase4ExitGate(projectRoot);
    expect(r.enabled).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.totals.test_binding).toBeGreaterThanOrEqual(1);
    expect(r.gaps.some(g => g.category === 'test_binding' && g.message.includes('AC-1'))).toBe(true);
  });

  it('blocks on a STORY with no covering TEST (traceability)', () => {
    seedPrd(['REQ-001']);
    seedStory('S-001', ['REQ-001'], ['AC-1']);

    const r = evaluatePhase4ExitGate(projectRoot);
    expect(r.totals.traceability).toBeGreaterThanOrEqual(1);
    expect(r.gaps.some(g => g.category === 'traceability' && g.id === 'S-001')).toBe(true);
  });

  it('passes once a matching test binds the AC', () => {
    seedPrd(['REQ-001']);
    seedStory('S-001', ['REQ-001'], ['AC-1']);
    seedTests('s-001.test.ts', ['AC-1']);

    const r = evaluatePhase4ExitGate(projectRoot);
    expect(r.totals.test_binding).toBe(0);
    expect(r.totals.traceability).toBe(0);
  });
});

describe('evaluatePhase4ExitGate — per-story scoping', () => {
  it('keeps only gaps tied to the scoped story', () => {
    seedPrd(['REQ-001', 'REQ-002']);
    seedStory('S-001', ['REQ-001'], ['AC-1']); // unbound
    seedStory('S-002', ['REQ-002'], ['AC-2']); // unbound

    const scoped = evaluatePhase4ExitGate(projectRoot, { storyId: 'S-001' });
    expect(scoped.ok).toBe(false);
    // No gap should reference the other story.
    expect(scoped.gaps.every(g => !g.id.includes('S-002') && !g.message.includes('S-002'))).toBe(true);
    expect(scoped.gaps.some(g => g.id.includes('S-001') || g.message.includes('S-001'))).toBe(true);
  });
});

describe('formatPhase4ExitGate', () => {
  it('reports DISABLED when opted out', () => {
    optOut();
    const r = evaluatePhase4ExitGate(projectRoot);
    expect(formatPhase4ExitGate(r)).toContain('DISABLED');
  });

  it('reports PASS for a fully test-bound spec', () => {
    seedPrd(['REQ-001']);
    seedStory('S-001', ['REQ-001'], ['AC-1']);
    seedTests('s-001.test.ts', ['AC-1']);
    const r = evaluatePhase4ExitGate(projectRoot);
    expect(formatPhase4ExitGate(r)).toContain('PASS');
  });

  it('reports FAIL with a gap breakdown when blocked', () => {
    seedPrd(['REQ-001']);
    seedStory('S-001', ['REQ-001'], ['AC-1']);
    const out = formatPhase4ExitGate(evaluatePhase4ExitGate(projectRoot));
    expect(out).toContain('FAIL');
    expect(out).toContain('test_binding:');
  });
});
