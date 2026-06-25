/**
 * constitution-check — verifies CONSTITUTION_CHECK enforces the right file.
 *
 * The rule must prefer the per-project `_wdf_output/constitution.yaml` (written
 * by `wdf init`) over the framework-root `constitution.yaml`. Before the fix it
 * only ever read the root file, so init-generated project constitutions were
 * silently never enforced.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConstitutionCheckRule } from './constitution-check.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'wdf-const-check-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function ruleYaml(check: string, expected: number): string {
  return [
    'version: "0.1.0"',
    'rules:',
    '  - id: WDF-T1',
    '    name: Test rule',
    '    level: error',
    `    check: "${check}"`,
    `    expected: ${expected}`,
    '',
  ].join('\n');
}

async function run(): Promise<string[]> {
  const results = await ConstitutionCheckRule.check({ projectRoot, files: [], config: null });
  return results.map(r => r.message);
}

describe('ConstitutionCheckRule file resolution', () => {
  it('enforces _wdf_output/constitution.yaml', async () => {
    mkdirSync(join(projectRoot, '_wdf_output'), { recursive: true });
    // expected 0 but command prints 1 → must flag.
    writeFileSync(join(projectRoot, '_wdf_output', 'constitution.yaml'), ruleYaml('echo 1', 0));
    const msgs = await run();
    expect(msgs.some(m => m.includes('WDF-T1'))).toBe(true);
  });

  it('prefers _wdf_output over the framework-root constitution', async () => {
    mkdirSync(join(projectRoot, '_wdf_output'), { recursive: true });
    // Root would PASS (expected 1, prints 1); project FAILS (expected 0).
    writeFileSync(join(projectRoot, 'constitution.yaml'), ruleYaml('echo 1', 1));
    writeFileSync(join(projectRoot, '_wdf_output', 'constitution.yaml'), ruleYaml('echo 1', 0));
    const msgs = await run();
    expect(msgs.some(m => m.includes('WDF-T1'))).toBe(true);
  });

  it('falls back to the root constitution when no project one exists', async () => {
    writeFileSync(join(projectRoot, 'constitution.yaml'), ruleYaml('echo 1', 1));
    const msgs = await run();
    // expected 1 == got 1 → no findings.
    expect(msgs).toEqual([]);
  });
});
