/**
 * Tests for spec-drift-checker.ts (Phase D / V3.10.4)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { checkSpecDrift } from './spec-drift-checker.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = join(tmpdir(), `wdf-d2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(projectRoot, { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function seedApiSpec(endpoints: Array<{ method: string; path: string }>): void {
  mkdirSync(join(projectRoot, '_wdf_output'), { recursive: true });
  const lines = ['paths:'];
  for (const ep of endpoints) {
    lines.push(`  ${ep.path}:`);
    lines.push(`    ${ep.method.toLowerCase()}:`);
    lines.push(`      summary: ${ep.method} ${ep.path}`);
  }
  writeFileSync(join(projectRoot, '_wdf_output', 'api-spec.yaml'), lines.join('\n') + '\n');
}

function seedCodeRoute(method: string, path: string): void {
  writeFileSync(join(projectRoot, 'server.ts'),
    `app.${method.toLowerCase()}('${path}', handler);\n`,
  );
}

describe('checkSpecDrift', () => {
  it('reports no drift when spec and code agree', () => {
    seedApiSpec([{ method: 'GET', path: '/todos' }]);
    seedCodeRoute('GET', '/todos');

    const report = checkSpecDrift(projectRoot);
    expect(report.ok).toBe(true);
    expect(report.drift).toEqual([]);
  });

  it('flags orphan endpoints (in spec, missing from code)', () => {
    seedApiSpec([
      { method: 'GET', path: '/todos' },
      { method: 'POST', path: '/todos' },
    ]);
    seedCodeRoute('GET', '/todos'); // POST not implemented

    const report = checkSpecDrift(projectRoot);
    expect(report.counts.orphan_endpoints).toBe(1);
    expect(report.drift.some(d => d.kind === 'orphan_endpoint' && d.identifier === 'POST /todos')).toBe(true);
  });

  it('flags unspec\'d endpoints (in code, missing from spec)', () => {
    seedApiSpec([{ method: 'GET', path: '/todos' }]);
    // Code has GET /todos AND a route not in spec
    seedCodeRoute('GET', '/todos');
    seedCodeRoute('DELETE', '/todos');

    const report = checkSpecDrift(projectRoot);
    expect(report.counts.unspec_endpoints).toBe(1);
    expect(report.drift.some(d => d.kind === 'unspec_endpoint' && d.identifier === 'DELETE /todos')).toBe(true);
  });

  it('flags missing tests for stories with acceptance_criteria', () => {
    mkdirSync(join(projectRoot, '_wdf_output', 'stories'), { recursive: true });
    writeFileSync(
      join(projectRoot, '_wdf_output', 'stories', 'S-001.md'),
      `---
story_id: S-001
title: Test story
track: backend
acceptance_criteria:
  - AC-001
  - AC-002
---

Body.
`,
    );
    // No test files exist

    const report = checkSpecDrift(projectRoot);
    expect(report.counts.missing_tests).toBe(2);
  });

  it('renders markdown report with all sections', () => {
    seedApiSpec([{ method: 'GET', path: '/a' }]);
    seedCodeRoute('GET', '/b'); // different endpoint → both orphan and unspec'd

    const report = checkSpecDrift(projectRoot);
    expect(report.markdown).toContain('# Spec Drift Report');
    expect(report.markdown).toContain('Orphan Endpoints');
    expect(report.markdown).toContain('Unspec\'d Endpoints');
  });
});
