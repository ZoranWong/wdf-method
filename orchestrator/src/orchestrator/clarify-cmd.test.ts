/**
 * Tests for clarify-cmd.ts (Phase E / V3.11) — PRD clarification scanning.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  scanClarifications,
  verifyClarifications,
  detectFindings,
  parseClarifications,
} from './clarify-cmd.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = join(tmpdir(), `wdf-clarify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(join(projectRoot, '_wdf_output'), { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function seedPrd(body: string): void {
  writeFileSync(join(projectRoot, '_wdf_output', 'prd.md'), body);
}

describe('detectFindings', () => {
  it('flags ambiguous adjectives', () => {
    const findings = detectFindings('The system must be fast and user-friendly.');
    const cats = findings.map(f => f.category);
    expect(cats).toContain('ambiguity');
    expect(findings.some(f => f.question.includes('fast'))).toBe(true);
  });

  it('flags placeholder markers', () => {
    const findings = detectFindings('Rate limiting: TBD\nError handling as appropriate.');
    expect(findings.filter(f => f.category === 'placeholder').length).toBeGreaterThanOrEqual(2);
  });

  it('flags REQs with no measurable criterion', () => {
    const prd = `## REQ-001: Login\n\nUsers can log in.\n\n## REQ-002: Latency\n\nResponses under 200ms.\n`;
    const findings = detectFindings(prd);
    const nonMeasurable = findings.filter(f => f.category === 'non_measurable');
    expect(nonMeasurable.some(f => f.question.includes('REQ-001'))).toBe(true);
    // REQ-002 has "200ms" → measurable → not flagged
    expect(nonMeasurable.some(f => f.question.includes('REQ-002'))).toBe(false);
  });

  it('returns nothing for a clean, measurable PRD', () => {
    const prd = `## REQ-001: Latency\n\np95 response time under 200ms for 1000 concurrent users.\n`;
    expect(detectFindings(prd)).toEqual([]);
  });

  it('attaches suggested options to each finding', () => {
    const findings = detectFindings('The system must be fast.\n\n## REQ-001: Login\n\nUsers can log in.\n');
    const amb = findings.find(f => f.category === 'ambiguity');
    const nm = findings.find(f => f.category === 'non_measurable');
    expect(amb?.options?.length).toBeGreaterThanOrEqual(2);
    // "fast" is a performance term → latency-flavoured options.
    expect(amb?.options?.some(o => /latency|p95/i.test(o))).toBe(true);
    expect(nm?.options?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('scanClarifications', () => {
  it('creates the artifact and reports open count', () => {
    seedPrd('The UI should be intuitive and TBD.');
    const r = scanClarifications({ projectRoot });
    expect(r.created).toBe(true);
    expect(existsSync(r.path)).toBe(true);
    expect(r.open).toBeGreaterThanOrEqual(2);
    expect(r.resolved).toBe(0);
  });

  it('preserves resolved answers across a rescan', () => {
    seedPrd('The system must be fast.');
    const first = scanClarifications({ projectRoot });
    expect(first.open).toBe(1);

    // Resolve the item by editing the artifact: check the box + add an answer.
    const id = first.items[0].id;
    const key = first.items[0].key;
    const resolved = [
      '---', 'generator: wdf-cli', '---', '', '# Clarifications', '',
      '## Open', '', '_(none)_', '',
      '## Resolved', '',
      `- [x] ${id} [ambiguity] prd.md:1 — "fast" is not measurable. <!-- key:${key} -->`,
      '  **Answer:** p95 < 200ms.', '',
    ].join('\n');
    writeFileSync(first.path, resolved);

    // Rescan: the same finding must NOT reopen — it stays resolved.
    const second = scanClarifications({ projectRoot });
    expect(second.open).toBe(0);
    expect(second.resolved).toBe(1);
    const carried = second.items.find(i => i.id === id);
    expect(carried?.status).toBe('resolved');
    expect(carried?.answer).toContain('200ms');
  });

  it('drops an open finding once the PRD line is fixed', () => {
    seedPrd('The system must be fast.');
    const first = scanClarifications({ projectRoot });
    expect(first.open).toBe(1);

    // Fix the PRD — replace the vague adjective with a measurable target.
    seedPrd('The system must respond in under 200ms at p95.');
    const second = scanClarifications({ projectRoot });
    expect(second.open).toBe(0);
  });
});

describe('verifyClarifications', () => {
  it('fails when the artifact is missing', () => {
    const r = verifyClarifications({ projectRoot });
    expect(r.ok).toBe(false);
    expect(r.exists).toBe(false);
  });

  it('fails while an item is open and passes once resolved', () => {
    seedPrd('The system must be scalable.');
    scanClarifications({ projectRoot });
    expect(verifyClarifications({ projectRoot }).ok).toBe(false);

    // Resolve by fixing the PRD and rescanning.
    seedPrd('The system must support 10000 concurrent users.');
    scanClarifications({ projectRoot });
    expect(verifyClarifications({ projectRoot }).ok).toBe(true);
  });

  it('treats a checked box with no Answer as still open (standardized resolution)', () => {
    seedPrd('The system must be fast.');
    const first = scanClarifications({ projectRoot });
    const { id, key } = first.items[0];
    // Box checked but NO **Answer:** — must NOT count as resolved.
    const md = [
      '---', 'generator: wdf-cli', '---', '', '# Clarifications', '',
      '## Open', '', '_(none)_', '',
      '## Resolved', '',
      `- [x] ${id} [ambiguity] prd.md:1 — "fast" is not measurable. <!-- key:${key} -->`,
      '  **Answer:** ',
      '  **Rationale:** ', '',
    ].join('\n');
    writeFileSync(first.path, md);
    expect(verifyClarifications({ projectRoot }).ok).toBe(false);

    // Now add a real answer → passes.
    const withAnswer = md.replace('  **Answer:** ', '  **Answer:** p95 < 200ms');
    writeFileSync(first.path, withAnswer);
    expect(verifyClarifications({ projectRoot }).ok).toBe(true);
  });
});

describe('parseClarifications round-trip', () => {
  it('recovers id, status, key and answer', () => {
    const md = [
      '## Resolved', '',
      '- [x] CL001 [ambiguity] prd.md:3 — "fast" is not measurable. <!-- key:ambiguity::fast::3 -->',
      '  **Answer:** p95 < 200ms.',
    ].join('\n');
    const items = parseClarifications(md);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('CL001');
    expect(items[0].status).toBe('resolved');
    expect(items[0].key).toBe('ambiguity::fast::3');
    expect(items[0].answer).toContain('200ms');
  });

  it('recovers options, answer and rationale together', () => {
    const md = [
      '## Resolved', '',
      '- [x] CL001 [ambiguity] prd.md:3 — "fast" is not measurable. <!-- key:ambiguity::fast::3 -->',
      '  - Options: (a) p95 latency < 200ms (b) p95 latency < 500ms (c) other (specify)',
      '  **Answer:** p95 latency < 200ms',
      '  **Rationale:** matches the SLA in the contract',
    ].join('\n');
    const items = parseClarifications(md);
    expect(items).toHaveLength(1);
    expect(items[0].options).toEqual([
      'p95 latency < 200ms',
      'p95 latency < 500ms',
      'other (specify)',
    ]);
    expect(items[0].answer).toBe('p95 latency < 200ms');
    expect(items[0].rationale).toContain('SLA');
  });

  it('preserves a typed answer across a rescan even before the box is checked', () => {
    seedPrd('The system must be fast.');
    const first = scanClarifications({ projectRoot });
    // Author types an Answer but leaves the box unchecked.
    const content = readFileSync(first.path, 'utf-8')
      .replace('  **Answer:** \n', '  **Answer:** p95 < 200ms\n');
    writeFileSync(first.path, content);

    const second = scanClarifications({ projectRoot });
    const item = second.items.find(i => i.id === first.items[0].id);
    expect(item?.answer).toBe('p95 < 200ms');
  });
});
