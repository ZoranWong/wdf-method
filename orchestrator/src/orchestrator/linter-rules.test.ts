import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SpecLinter } from './linter/linter.js';
import { BUILTIN_RULES } from './linter/rules/index.js';
import { StoryRefsResolveRule } from './linter/rules/story-refs-resolve.js';
import { StoryScopeRequiredRule } from './linter/rules/story-scope-required.js';
import { AgentSafetyRule } from './linter/rules/agent-safety.js';
import { ConstitutionCheckRule } from './linter/rules/constitution-check.js';
import type { FileEntry, LintContext } from './linter/types.js';

function makeFile(path: string, content: string): FileEntry {
  return { path, content, lines: content.split('\n') };
}

function makeContext(projectRoot: string, files: FileEntry[]): LintContext {
  return { projectRoot, files, config: null };
}

describe('lint rules — V3.9 expansion', async () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'wdf-lint-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  // ── STORY_REFS_RESOLVE ────────────────────────────────────────────

  describe('STORY_REFS_RESOLVE', async () => {
    it('flags dangling maps_to_req / depends_on / refs', async () => {
      const files = [
        makeFile('_wdf_output/stories/S-001.md',
          `---
story_id: S-001
title: Test
maps_to_req: REQ-999
depends_on: S-GHOST
refs: [EPIC-MISSING]
---
# body`),
      ];
      const results = await StoryRefsResolveRule.check(makeContext(tmp, files));
      expect(results.length).toBe(3);
      expect(results.some(r => r.message.includes('REQ-999'))).toBe(true);
      expect(results.some(r => r.message.includes('S-GHOST'))).toBe(true);
      expect(results.some(r => r.message.includes('EPIC-MISSING'))).toBe(true);
    });

    it('passes when refs resolve upstream', async () => {
      const files = [
        makeFile('_wdf_output/prd.md', `# PRD\n\n### REQ-001: User Registration\n`),
        makeFile('_wdf_output/epics.md', `## EPIC-AUTH: Auth\n`),
        makeFile('_wdf_output/stories/S-001.md',
          `---
story_id: S-001
title: Test
maps_to_req: REQ-001
refs: [EPIC-AUTH]
---
# body`),
      ];
      const results = await StoryRefsResolveRule.check(makeContext(tmp, files));
      expect(results.length).toBe(0);
    });

    it('resolves API paths and operationIds', async () => {
      const files = [
        makeFile('_wdf_output/api-spec.yaml',
          `openapi: 3.0.0
paths:
  /auth/register:
    post:
      operationId: registerUser
`),
        makeFile('_wdf_output/stories/S-001.md',
          `---
story_id: S-001
title: Test
refs: [/auth/register, registerUser]
---
# body`),
      ];
      const results = await StoryRefsResolveRule.check(makeContext(tmp, files));
      expect(results.length).toBe(0);
    });
  });

  // ── STORY_SCOPE_REQUIRED ──────────────────────────────────────────

  describe('STORY_SCOPE_REQUIRED', async () => {
    it('flags missing scope_write + acceptance_check', async () => {
      const files = [
        makeFile('_wdf_output/stories/S-001.md',
          `---
story_id: S-001
title: Test
---
# body`),
      ];
      const results = await StoryScopeRequiredRule.check(makeContext(tmp, files));
      expect(results.length).toBe(2);
      expect(results.some(r => r.message.includes('scope_write'))).toBe(true);
      expect(results.some(r => r.message.includes('acceptance_check'))).toBe(true);
    });

    it('rejects absolute paths and parent traversal', async () => {
      const files = [
        makeFile('_wdf_output/stories/S-001.md',
          `---
story_id: S-001
title: Test
scope_write:
  - /etc/passwd
  - ../../../etc/shadow
acceptance_check:
  - npm test
---
# body`),
      ];
      const results = await StoryScopeRequiredRule.check(makeContext(tmp, files));
      expect(results.length).toBe(2);
      expect(results.some(r => r.message.includes('absolute'))).toBe(true);
      expect(results.some(r => r.message.includes('".."'))).toBe(true);
    });

    it('passes well-formed stories', async () => {
      const files = [
        makeFile('_wdf_output/stories/S-001.md',
          `---
story_id: S-001
title: Test
scope_write:
  - backend/src/auth.ts
acceptance_check:
  - npm test auth
---
# body`),
      ];
      const results = await StoryScopeRequiredRule.check(makeContext(tmp, files));
      expect(results.length).toBe(0);
    });
  });

  // ── AGENT_SAFETY ──────────────────────────────────────────────────

  describe('AGENT_SAFETY', async () => {
    it('flags missing bash_deny', async () => {
      const files = [
        makeFile('references/agents/risky.md',
          `---
name: risky
description: No safety floor
default_permissions:
  bash_allow:
    - ls
---
# body`),
      ];
      const results = await AgentSafetyRule.check(makeContext(tmp, files));
      expect(results.length).toBe(1);
      expect(results[0].message).toContain('bash_deny');
    });

    it('flags missing rm -rf even with bash_deny', async () => {
      const files = [
        makeFile('references/agents/partial.md',
          `---
name: partial
description: Only git push denied
default_permissions:
  bash_deny:
    - git push
---
# body`),
      ];
      const results = await AgentSafetyRule.check(makeContext(tmp, files));
      expect(results.length).toBe(1);
      expect(results[0].message).toContain('rm -rf');
    });

    it('passes agents with full safety floor', async () => {
      const files = [
        makeFile('references/agents/safe.md',
          `---
name: safe
description: Has both
default_permissions:
  bash_allow:
    - npm test
  bash_deny:
    - git push
    - rm -rf
---
# body`),
      ];
      const results = await AgentSafetyRule.check(makeContext(tmp, files));
      expect(results.length).toBe(0);
    });
  });

  // ── CONSTITUTION_CHECK ───────────────────────────────────────────

  describe('CONSTITUTION_CHECK', async () => {
    it('executes a passing shell rule', async () => {
      writeFileSync(join(tmp, 'constitution.yaml'),
        `version: "3.9.0"
rules:
  - id: WDF-TEST
    name: Always zero
    level: error
    check: "echo 0"
    expected: 0
`);
      const results = await ConstitutionCheckRule.check(makeContext(tmp, []));
      expect(results.length).toBe(0);
    });

    it('flags a failing shell rule', async () => {
      writeFileSync(join(tmp, 'constitution.yaml'),
        `version: "3.9.0"
rules:
  - id: WDF-TEST
    name: Always two
    level: error
    check: "echo 2"
    expected: 0
`);
      const results = await ConstitutionCheckRule.check(makeContext(tmp, []));
      expect(results.length).toBe(1);
      expect(results[0].message).toContain('expected 0, got 2');
    });

    it('skips rules without a check field', async () => {
      writeFileSync(join(tmp, 'constitution.yaml'),
        `version: "3.9.0"
rules:
  - id: WDF-DOC
    name: Doc-only rule
    level: error
    description: No shell check
`);
      const results = await ConstitutionCheckRule.check(makeContext(tmp, []));
      expect(results.length).toBe(0);
    });

    it('returns no results when constitution.yaml is absent', async () => {
      const results = await ConstitutionCheckRule.check(makeContext(tmp, []));
      expect(results.length).toBe(0);
    });
  });

  // ── --strict mode (engine-level) ─────────────────────────────────

  describe('--strict mode', async () => {
    it('promotes warnings to errors when strict: true', async () => {
      // Drop a file with a deprecated term — NO_DEPRECATED_TERMS is
      // warning-level, so without --strict it produces 0 errors.
      writeFileSync(join(tmp, 'docs.md'),
        `# Title\n\nThe Pure Orchestrator pattern is deprecated.\n`);

      const linter = new SpecLinter(tmp);
      linter.registerRules(BUILTIN_RULES);

      const without = await linter.lint({ onlyRules: ['NO_DEPRECATED_TERMS'], strict: false });
      expect(without.errors).toBe(0);
      expect(without.warnings).toBeGreaterThan(0);

      const withStrict = await linter.lint({ onlyRules: ['NO_DEPRECATED_TERMS'], strict: true });
      expect(withStrict.errors).toBeGreaterThan(0);
    });

    it('formatReport shows strict-mode banner', async () => {
      const linter = new SpecLinter(tmp);
      linter.registerRules(BUILTIN_RULES);
      const report = await linter.lint({ strict: true });
      const formatted = linter.formatReport(report, { strict: true });
      expect(formatted).toContain('strict mode');
    });
  });
});
