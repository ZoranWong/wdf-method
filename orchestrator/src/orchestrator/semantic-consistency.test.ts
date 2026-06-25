/**
 * semantic-consistency — cross-artifact "meaning" checks surfaced by
 * `wdf check` (advisory) and reused by the Phase 4 entry gate (blocking).
 *
 * These tests seed synthetic projects with known cross-artifact gaps and
 * verify the bridge aggregates the four semantic rules, maps severities
 * correctly (advisory vs blocking), and that `wdf check` honors the
 * semantic_gate opt-out.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  runSemanticRules,
  runSemanticConsistency,
  semanticFindingsToCheckResult,
} from './semantic-consistency.js';
import { checkArtifact } from './artifact-checker.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'wdf-semantic-'));
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

function seedApiSpec(endpoints: Array<{ method: string; path: string }>): void {
  const lines = ['paths:'];
  for (const ep of endpoints) {
    lines.push(`  ${ep.path}:`);
    lines.push(`    ${ep.method.toLowerCase()}:`);
    lines.push(`      summary: ${ep.method} ${ep.path}`);
  }
  writeFileSync(join(projectRoot, '_wdf_output', 'api-spec.yaml'), lines.join('\n') + '\n');
}

describe('runSemanticRules', () => {
  it('aggregates findings across rules (uncovered REQ + orphan endpoint)', () => {
    seedPrd(['REQ-001', 'REQ-002']);
    seedStory('S-001', ['REQ-001']); // REQ-002 uncovered
    seedApiSpec([{ method: 'GET', path: '/todos' }]); // unclaimed endpoint

    const findings = runSemanticRules(projectRoot);

    expect(findings.some(f => f.ruleId === 'REQ_COVERAGE' && f.message.includes('REQ-002'))).toBe(true);
    expect(findings.some(f => f.ruleId === 'API_SCOPE_MAPPING' && f.message.includes('/todos'))).toBe(true);
  });

  it('returns no findings for an empty project', () => {
    expect(runSemanticRules(projectRoot)).toEqual([]);
  });

  it('returns no findings when every REQ is covered and no API/DB exists', () => {
    seedPrd(['REQ-001']);
    seedStory('S-001', ['REQ-001']);
    expect(runSemanticRules(projectRoot)).toEqual([]);
  });
});

describe('semanticFindingsToCheckResult', () => {
  it('keeps advisory findings as warnings → passed stays true', () => {
    seedPrd(['REQ-001', 'REQ-002']);
    seedStory('S-001', ['REQ-001']);

    const result = semanticFindingsToCheckResult(runSemanticRules(projectRoot), { blocking: false });

    expect(result.artifact).toBe('semantic-consistency');
    expect(result.issues.length).toBeGreaterThanOrEqual(1);
    expect(result.issues.every(i => i.severity === 'warning')).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('promotes findings to errors in blocking mode → passed becomes false', () => {
    seedPrd(['REQ-001', 'REQ-002']);
    seedStory('S-001', ['REQ-001']);

    const result = semanticFindingsToCheckResult(runSemanticRules(projectRoot), { blocking: true });

    expect(result.issues.every(i => i.severity === 'error')).toBe(true);
    expect(result.passed).toBe(false);
  });

  it('a clean project passes in both modes with no issues', () => {
    seedPrd(['REQ-001']);
    seedStory('S-001', ['REQ-001']);
    const findings = runSemanticRules(projectRoot);
    expect(semanticFindingsToCheckResult(findings, { blocking: false }).passed).toBe(true);
    expect(semanticFindingsToCheckResult(findings, { blocking: true }).passed).toBe(true);
  });
});

describe('wdf check wiring', () => {
  it('appends a semantic-consistency result on a project-wide check', () => {
    seedPrd(['REQ-001', 'REQ-002']);
    seedStory('S-001', ['REQ-001']);

    const results = checkArtifact({ projectRoot });

    const semantic = results.find(r => r.artifact === 'semantic-consistency');
    expect(semantic).toBeDefined();
    expect(semantic!.issues.some(i => i.rule === 'REQ_COVERAGE')).toBe(true);
    // Advisory: a semantic gap must NOT fail the artifact check (passed=true).
    expect(semantic!.passed).toBe(true);
  });

  it('omits the semantic result when scoped to a single --artifact', () => {
    seedPrd(['REQ-001', 'REQ-002']);
    seedStory('S-001', ['REQ-001']);

    const results = checkArtifact({ projectRoot, artifact: 'prd.md' });
    expect(results.find(r => r.artifact === 'semantic-consistency')).toBeUndefined();
  });

  it('respects the semantic_gate opt-out in wdf.toml', () => {
    seedPrd(['REQ-001', 'REQ-002']);
    seedStory('S-001', ['REQ-001']);
    writeFileSync(join(projectRoot, 'wdf.toml'), '[semantic_gate]\nenabled = false\n');

    const results = checkArtifact({ projectRoot });
    expect(results.find(r => r.artifact === 'semantic-consistency')).toBeUndefined();
  });
});
