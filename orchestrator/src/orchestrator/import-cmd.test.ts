/**
 * Tests for import-cmd.ts (Phase D / V3.10.4)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runImport, detectSource } from './import-cmd.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = join(tmpdir(), `wdf-d3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(projectRoot, { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('detectSource', () => {
  it('detects nextjs from next.config.js', () => {
    writeFileSync(join(projectRoot, 'next.config.js'), `module.exports = {};\n`);
    expect(detectSource(projectRoot)).toBe('nextjs');
  });

  it('detects nextjs from package.json dependency', () => {
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({
      name: 'demo',
      dependencies: { next: '^14.0.0', react: '^18.0.0' },
    }));
    expect(detectSource(projectRoot)).toBe('nextjs');
  });

  it('detects express from package.json dependency', () => {
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({
      name: 'demo',
      dependencies: { express: '^4.18.0' },
    }));
    expect(detectSource(projectRoot)).toBe('express');
  });
});

describe('runImport', () => {
  it('extracts candidates and writes summary', async () => {
    // Seed an Express-shaped code file
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({
      name: 'demo',
      dependencies: { express: '^4.18.0' },
    }));
    writeFileSync(join(projectRoot, 'server.ts'),
      `app.get('/todos', listTodos);\n`,
    );

    const result = await runImport({ root: projectRoot });
    expect(result.detectedSource).toBe('express');
    expect(result.reverseEngineer.candidates.length).toBeGreaterThan(0);
    expect(existsSync(result.summaryPath)).toBe(true);
    const summary = readFileSync(result.summaryPath, 'utf-8');
    expect(summary).toContain('Brownfield Import Summary');
    expect(summary).toContain('express');
  });

  it('scaffolds _bmad-output/ skeleton on first run', async () => {
    const result = await runImport({ root: projectRoot });
    expect(result.scaffoldedSkeleton).toBe(true);
    expect(existsSync(join(projectRoot, '_bmad-output', 'README.md'))).toBe(true);
  });

  it('does not scaffold _bmad-output/ on second run (idempotent)', async () => {
    await runImport({ root: projectRoot });
    const result = await runImport({ root: projectRoot });
    expect(result.scaffoldedSkeleton).toBe(false);
  });

  it('seeds prd.md placeholder when none exists', async () => {
    const result = await runImport({ root: projectRoot });
    expect(existsSync(join(projectRoot, '_wdf_output', 'prd.md'))).toBe(true);
    // Summary should mention the placeholder
    const summary = readFileSync(result.summaryPath, 'utf-8');
    expect(summary).toContain('placeholder');
  });

  it('respects explicit --source override', async () => {
    writeFileSync(join(projectRoot, 'next.config.js'), `module.exports = {};\n`);
    const result = await runImport({ root: projectRoot, source: 'express' });
    expect(result.detectedSource).toBe('express'); // explicit override wins
  });
});
