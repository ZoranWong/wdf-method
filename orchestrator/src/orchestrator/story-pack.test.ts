/**
 * Phase A (Story Pack v1.0) integration tests.
 *
 * Covers:
 *   - template-renderer: variable substitution + each blocks
 *   - handoff-writer: starter file creation + section validation
 *   - story-pack-required lint rule
 *   - story-migrate-cmd: legacy → v1.0 backfill
 *   - pipeline-engine.selectActiveUnit: unit selection logic
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { renderTemplate, renderTemplateFile } from './template-renderer.js';
import {
  writeStarterHandoffFiles,
  validateHandoffSections,
  buildTemplateContext,
} from './handoff-writer.js';
import { StoryPackRequiredRule } from './linter/rules/story-pack-required.js';
import { migrateStoryPack } from './story-migrate-cmd.js';
import { selectActiveUnit } from './pipeline-engine.js';
import type { StoryEntry } from './types.js';

let tmpRoot: string;
let frameworkRoot: string;

function seedFrameworkTemplates(root: string): void {
  mkdirSync(join(root, 'templates', 'story-pack'), { recursive: true });
  writeFileSync(join(root, 'templates', 'story-pack', 'handoff.md.tmpl'),
    `# Handoff — {{story_id}}: {{title}}\n\nRun: {{run_id}}\nCompleted: {{completed_at}}\n\n## Summary\n\n<Brief change description>\n\n## Files changed\n\n- path/to/file\n\n## Verification summary\n\n<Verification details>\n\n## Known gaps\n\n- <Known gap>\n`);
  writeFileSync(join(root, 'templates', 'story-pack', 'self-check.md.tmpl'),
    `# Self-check — {{story_id}}\n\n## Commands run\n\n- <command>\n\n## Results\n\n<result summary>\n\n## Not run\n\n- <command not run>\n\n## Risks\n\n- <risk>\n`);
}

beforeEach(() => {
  tmpRoot = join(tmpdir(), `wdf-phase-a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmpRoot, { recursive: true });
  frameworkRoot = join(tmpdir(), `wdf-fw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(frameworkRoot, { recursive: true });
  seedFrameworkTemplates(frameworkRoot);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(frameworkRoot, { recursive: true, force: true });
});

// ── template-renderer ───────────────────────────────────────

describe('renderTemplate', () => {
  it('substitutes simple variables', () => {
    expect(renderTemplate('Hello {{name}}!', { name: 'world' })).toBe('Hello world!');
  });

  it('handles missing variables by replacing with empty string', () => {
    expect(renderTemplate('Hello {{name}}!', {})).toBe('Hello !');
  });

  it('iterates over arrays with {{#each}}', () => {
    const result = renderTemplate(
      '{{#each items}}- {{this}}\n{{/each}}',
      { items: ['a', 'b', 'c'] },
    );
    expect(result).toBe('- a\n- b\n- c\n');
  });

  it('iterates over object arrays with {{this.key}}', () => {
    const result = renderTemplate(
      '{{#each items}}- {{this.id}}: {{this.label}}\n{{/each}}',
      { items: [{ id: '1', label: 'one' }, { id: '2', label: 'two' }] },
    );
    expect(result).toBe('- 1: one\n- 2: two\n');
  });

  it('handles non-array each gracefully (empty output)', () => {
    expect(renderTemplate('{{#each items}}x{{/each}}', { items: 'not array' })).toBe('');
  });
});

// ── handoff-writer ──────────────────────────────────────────

describe('writeStarterHandoffFiles', () => {
  const story: StoryEntry = {
    story_id: 'S-TEST-01',
    title: 'Test story',
    track: 'backend',
    order: 1,
    scope_write: ['src/test.ts'],
    acceptance_check: ['npm test'],
    code_standards_source: ['AGENTS.md'],
  };

  it('writes handoff.md and self-check.md with template context', () => {
    const result = writeStarterHandoffFiles(story, tmpRoot, frameworkRoot);
    expect(result.skipped).toBe(false);
    expect(existsSync(result.handoffPath)).toBe(true);
    expect(existsSync(result.selfCheckPath)).toBe(true);

    const handoffContent = readFileSync(result.handoffPath, 'utf-8');
    expect(handoffContent).toContain('S-TEST-01');
    expect(handoffContent).toContain('Test story');
    expect(handoffContent).toContain('## Summary');
    expect(handoffContent).toContain('## Files changed');
  });

  it('is idempotent — does not overwrite existing files', () => {
    writeStarterHandoffFiles(story, tmpRoot, frameworkRoot);
    // Agent filled in some content
    const handoffPath = join(tmpRoot, 'handoff', 'S-TEST-01', 'handoff.md');
    writeFileSync(handoffPath, '## Summary\n\nAgent filled this in.');

    const result = writeStarterHandoffFiles(story, tmpRoot, frameworkRoot);
    expect(result.skipped).toBe(true);

    const content = readFileSync(handoffPath, 'utf-8');
    expect(content).toContain('Agent filled this in.');
  });
});

describe('validateHandoffSections', () => {
  it('flags missing required sections', () => {
    const filePath = join(tmpRoot, 'handoff.md');
    writeFileSync(filePath, '# Handoff\n\n## Summary\n\nNo other sections.');

    const missing = validateHandoffSections(filePath, 'handoff');
    expect(missing).toContain('Files changed');
    expect(missing).toContain('Verification summary');
  });

  it('accepts a fully filled handoff', () => {
    const filePath = join(tmpRoot, 'handoff.md');
    writeFileSync(
      filePath,
      '# Handoff\n\n## Summary\n\nDid the work.\n\n## Files changed\n\n- src/a.ts\n\n## Verification summary\n\nAll tests pass.',
    );

    const missing = validateHandoffSections(filePath, 'handoff');
    expect(missing).toEqual([]);
  });

  it('flags placeholder content as missing', () => {
    const filePath = join(tmpRoot, 'handoff.md');
    writeFileSync(
      filePath,
      '# Handoff\n\n## Summary\n\nTODO\n\n## Files changed\n\n- path/to/file\n\n## Verification summary\n\nReal content here.',
    );

    const missing = validateHandoffSections(filePath, 'handoff');
    expect(missing).toContain('Summary');
    expect(missing).not.toContain('Verification summary');
  });
});

// ── Story Pack lint rule ────────────────────────────────────

describe('StoryPackRequiredRule', () => {
  const rule = StoryPackRequiredRule;

  function makeStoryFile(frontmatter: string, body = 'Body content.'): { path: string; content: string; lines: string[] } {
    const content = `---\n${frontmatter}\n---\n${body}`;
    return {
      path: '_wdf_output/stories/S-TEST.md',
      content,
      lines: content.split('\n'),
    };
  }

  it('skips legacy stories without story_pack_version', async () => {
    const file = makeStoryFile('story_id: S-TEST\nscope_write:\n  - src/a.ts');
    const results = await rule.check({ projectRoot: tmpRoot, files: [file], config: {} });
    expect(results).toEqual([]);
  });

  it('flags v1.0 story missing execution_units', async () => {
    const file = makeStoryFile(
      `story_pack_version: '1.0'\nstory_id: S-TEST\nscope_write:\n  - src/a.ts`,
    );
    const results = await rule.check({ projectRoot: tmpRoot, files: [file], config: {} });
    expect(results.length).toBe(1);
    expect(results[0].message).toContain('execution_units');
  });

  it('flags v1.0 unit missing scope_write', async () => {
    const file = makeStoryFile(
      `story_pack_version: '1.0'
story_id: S-TEST
execution_units:
  auth-api:
    acceptance_check:
      - npm test`,
    );
    const results = await rule.check({ projectRoot: tmpRoot, files: [file], config: {} });
    expect(results.length).toBe(1);
    expect(results[0].message).toContain('"auth-api" missing scope_write');
  });

  it('accepts a well-formed v1.0 story', async () => {
    const file = makeStoryFile(
      `story_pack_version: '1.0'
story_id: S-TEST
execution_units:
  auth-api:
    scope_write:
      - src/auth.ts
    acceptance_check:
      - npm test`,
    );
    const results = await rule.check({ projectRoot: tmpRoot, files: [file], config: {} });
    expect(results).toEqual([]);
  });

  it('flags invalid reasoning_effort enum', async () => {
    const file = makeStoryFile(
      `story_pack_version: '1.0'
story_id: S-TEST
recommended_model_profile:
  reasoning_effort: extreme
execution_units:
  main:
    scope_write:
      - src/a.ts
    acceptance_check:
      - npm test`,
    );
    const results = await rule.check({ projectRoot: tmpRoot, files: [file], config: {} });
    expect(results.some((r) => r.message.includes('extreme'))).toBe(true);
  });
});

// ── story-migrate-cmd ───────────────────────────────────────

describe('migrateStoryPack', () => {
  function seedStory(storyId: string, scopeWrite: string[]): string {
    const storiesDir = join(tmpRoot, 'stories');
    mkdirSync(storiesDir, { recursive: true });
    const storyPath = join(storiesDir, `${storyId}.md`);
    const scopeLines = scopeWrite.map((s) => `  - ${s}`).join('\n');
    writeFileSync(
      storyPath,
      `---
story_id: ${storyId}
title: Legacy Story
track: backend
scope_write:
${scopeLines}
acceptance_check:
  - npm test
---

# ${storyId}

Legacy body.
`,
    );
    return storyPath;
  }

  it('synthesizes execution_unit from legacy scope_write', () => {
    seedStory('S-LEGACY-01', ['src/auth.ts', 'src/auth.test.ts']);
    const result = migrateStoryPack('S-LEGACY-01', tmpRoot);

    expect(result.migrated).toBe(true);
    expect(result.alreadyV1).toBe(false);
    expect(result.unitId).toBe('main');

    const content = readFileSync(result.storyPath, 'utf-8');
    expect(content).toContain("story_pack_version: '1.0'");
    expect(content).toContain('execution_units:');
    expect(content).toContain('main:');
    expect(content).toContain('src/auth.ts');
  });

  it('is idempotent — second run is a no-op', () => {
    seedStory('S-LEGACY-02', ['src/b.ts']);
    migrateStoryPack('S-LEGACY-02', tmpRoot);
    const result = migrateStoryPack('S-LEGACY-02', tmpRoot);

    expect(result.migrated).toBe(false);
    expect(result.alreadyV1).toBe(true);
  });

  it('throws on missing scope_write', () => {
    const storiesDir = join(tmpRoot, 'stories');
    mkdirSync(storiesDir, { recursive: true });
    writeFileSync(
      join(storiesDir, 'S-BAD.md'),
      `---
story_id: S-BAD
title: No scope
track: backend
---

Body.`,
    );

    expect(() => migrateStoryPack('S-BAD', tmpRoot)).toThrow(/scope_write/);
  });
});

// ── selectActiveUnit ────────────────────────────────────────

describe('selectActiveUnit', () => {
  it('returns null for legacy stories without execution_units', () => {
    const story: StoryEntry = {
      story_id: 'S-X',
      title: 't',
      track: 'backend',
      order: 1,
      scope_write: ['src/a.ts'],
      acceptance_check: ['npm test'],
      code_standards_source: [],
    };
    expect(selectActiveUnit(story)).toBeNull();
  });

  it('returns the first unit when no unit statuses provided', () => {
    const story: StoryEntry = {
      story_id: 'S-X',
      title: 't',
      track: 'backend',
      order: 1,
      scope_write: ['src/a.ts'],
      acceptance_check: ['npm test'],
      code_standards_source: [],
      execution_units: {
        'unit-a': { role: 'backend', scope_write: ['src/a.ts'], acceptance_check: [] },
        'unit-b': { role: 'backend', scope_write: ['src/b.ts'], acceptance_check: [] },
      },
    };
    expect(selectActiveUnit(story)).toBe('unit-a');
  });

  it('skips units already CODE_ACCEPTED', () => {
    const story: StoryEntry = {
      story_id: 'S-X',
      title: 't',
      track: 'backend',
      order: 1,
      scope_write: ['src/a.ts'],
      acceptance_check: ['npm test'],
      code_standards_source: [],
      execution_units: {
        'unit-a': { role: 'backend', scope_write: ['src/a.ts'], acceptance_check: [] },
        'unit-b': { role: 'backend', scope_write: ['src/b.ts'], acceptance_check: [] },
      },
    };
    const unitStatuses = {
      'unit-a': { status: 'CODE_ACCEPTED', code_acceptance: { review_passed: true } },
    };
    expect(selectActiveUnit(story, unitStatuses)).toBe('unit-b');
  });

  it('returns null when all units are CODE_ACCEPTED', () => {
    const story: StoryEntry = {
      story_id: 'S-X',
      title: 't',
      track: 'backend',
      order: 1,
      scope_write: ['src/a.ts'],
      acceptance_check: ['npm test'],
      code_standards_source: [],
      execution_units: {
        'unit-a': { role: 'backend', scope_write: ['src/a.ts'], acceptance_check: [] },
      },
    };
    const unitStatuses = {
      'unit-a': { code_acceptance: { review_passed: true } },
    };
    expect(selectActiveUnit(story, unitStatuses)).toBeNull();
  });
});

// ── buildTemplateContext ────────────────────────────────────

describe('buildTemplateContext', () => {
  it('fills in defaults for handoff_artifacts when absent', () => {
    const story: StoryEntry = {
      story_id: 'S-CTX',
      title: 'Ctx Test',
      track: 'frontend',
      order: 1,
      scope_write: ['src/a.ts'],
      acceptance_check: ['npm test'],
      code_standards_source: [],
    };
    const ctx = buildTemplateContext(story, 'run-123');
    expect(ctx.story_id).toBe('S-CTX');
    expect(ctx.title).toBe('Ctx Test');
    expect(ctx.track).toBe('frontend');
    expect(ctx.run_id).toBe('run-123');
    expect(ctx.handoff_artifacts).toEqual(['diff_summary', 'test_results', 'blockers']);
  });

  it('preserves explicit handoff_artifacts', () => {
    const story: StoryEntry = {
      story_id: 'S-CTX',
      title: 'Ctx Test',
      track: 'backend',
      order: 1,
      scope_write: ['src/a.ts'],
      acceptance_check: ['npm test'],
      code_standards_source: [],
      handoff_artifacts: ['custom-artifact'],
    };
    const ctx = buildTemplateContext(story);
    expect(ctx.handoff_artifacts).toEqual(['custom-artifact']);
  });
});
