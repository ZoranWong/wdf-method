import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  buildPermissionStrings,
  applyPermissions,
  revokePermissions,
  revokeAllDispatchPermissions,
  listDispatchPermissions,
  readRolePermissions,
  applyRolePermissions,
  inferStoryPermissions,
  ROLE_BASELINE_FALLBACK,
} from './permission-injector.js';
import type { PipelineDispatchManifest } from './types.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'wdf-perm-test-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function manifest(
  overrides: Partial<Pick<PipelineDispatchManifest, 'story_id' | 'stage' | 'scope_write' | 'permissions'>> = {},
): Pick<PipelineDispatchManifest, 'story_id' | 'stage' | 'scope_write' | 'permissions'> {
  return {
    story_id: 'S-AUTH-01',
    stage: 'dev',
    scope_write: ['backend/src/auth.ts'],
    permissions: {
      bash_allow: ['npm test', 'npm run migrate:up'],
      bash_deny: ['git push'],
      scope_read: ['backend/_wdf_output/**'],
    },
    ...overrides,
  };
}

describe('buildPermissionStrings', () => {
  it('translates bash_allow to Bash(prefix:*)', () => {
    const { allow } = buildPermissionStrings(
      { bash_allow: ['npm test', 'vitest'] },
      [],
    );
    expect(allow).toContain('Bash(npm test:*)');
    expect(allow).toContain('Bash(vitest:*)');
  });

  it('translates bash_deny', () => {
    const { deny } = buildPermissionStrings({ bash_deny: ['git push'] }, []);
    expect(deny).toContain('Bash(git push:*)');
  });

  it('adds Edit/Write for each scope_write glob', () => {
    const { allow } = buildPermissionStrings({}, ['backend/src/**.ts', 'backend/test/**']);
    expect(allow).toContain('Edit(backend/src/**.ts)');
    expect(allow).toContain('Write(backend/src/**.ts)');
    expect(allow).toContain('Edit(backend/test/**)');
    expect(allow).toContain('Write(backend/test/**)');
  });

  it('adds Read for scope_read', () => {
    const { allow } = buildPermissionStrings({ scope_read: ['docs/**'] }, []);
    expect(allow).toContain('Read(docs/**)');
  });

  it('normalises "npm" to "npm:*" (bare command form)', () => {
    const { allow } = buildPermissionStrings({ bash_allow: ['npm'] }, []);
    expect(allow).toContain('Bash(npm:*)');
  });

  it('dedupes', () => {
    const { allow } = buildPermissionStrings(
      { bash_allow: ['npm test', 'npm test'] },
      ['backend/x.ts', 'backend/x.ts'],
    );
    expect(allow.filter((e) => e === 'Bash(npm test:*)')).toHaveLength(1);
    expect(allow.filter((e) => e === 'Edit(backend/x.ts)')).toHaveLength(1);
  });
});

describe('applyPermissions', () => {
  it('creates .claude/settings.local.json if absent', () => {
    applyPermissions(manifest(), projectRoot);
    const p = join(projectRoot, '.claude', 'settings.local.json');
    expect(existsSync(p)).toBe(true);
  });

  it('writes tagged allow entries', () => {
    applyPermissions(manifest(), projectRoot);
    const settings = JSON.parse(readFileSync(join(projectRoot, '.claude', 'settings.local.json'), 'utf8'));
    expect(settings.permissions.allow).toContain('Bash(npm test:*)  # wdf-dispatch:S-AUTH-01:dev');
    expect(settings.permissions.allow).toContain('Bash(npm run migrate:up:*)  # wdf-dispatch:S-AUTH-01:dev');
  });

  it('writes tagged deny entries', () => {
    applyPermissions(manifest(), projectRoot);
    const settings = JSON.parse(readFileSync(join(projectRoot, '.claude', 'settings.local.json'), 'utf8'));
    expect(settings.permissions.deny).toContain('Bash(git push:*)  # wdf-dispatch:S-AUTH-01:dev');
  });

  it('preserves pre-existing untagged entries', () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.claude', 'settings.local.json'),
      JSON.stringify({ permissions: { allow: ['Bash(ls:*)'] } }, null, 2),
    );
    applyPermissions(manifest(), projectRoot);
    const settings = JSON.parse(readFileSync(join(projectRoot, '.claude', 'settings.local.json'), 'utf8'));
    expect(settings.permissions.allow).toContain('Bash(ls:*)');
    expect(settings.permissions.allow).toContain('Bash(npm test:*)  # wdf-dispatch:S-AUTH-01:dev');
  });

  it('is idempotent (re-apply replaces, does not duplicate)', () => {
    applyPermissions(manifest(), projectRoot);
    applyPermissions(manifest(), projectRoot);
    const settings = JSON.parse(readFileSync(join(projectRoot, '.claude', 'settings.local.json'), 'utf8'));
    const count = settings.permissions.allow.filter((e: string) => e.includes('Bash(npm test:*)')).length;
    expect(count).toBe(1);
  });

  it('returns applied entries with story_id + stage', () => {
    const applied = applyPermissions(manifest(), projectRoot);
    expect(applied.length).toBeGreaterThan(0);
    expect(applied.every((a) => a.story_id === 'S-AUTH-01' && a.stage === 'dev')).toBe(true);
  });

  it('is a no-op when manifest has no permissions field', () => {
    const applied = applyPermissions(manifest({ permissions: undefined }), projectRoot);
    expect(applied).toEqual([]);
    expect(existsSync(join(projectRoot, '.claude', 'settings.local.json'))).toBe(false);
  });
});

describe('revokePermissions', () => {
  it('removes only entries for the tagged (story, stage)', () => {
    applyPermissions(manifest(), projectRoot);
    applyPermissions(manifest({ story_id: 'S-TODO-01', stage: 'dev' }), projectRoot);
    const removed = revokePermissions('S-AUTH-01', 'dev', projectRoot);
    expect(removed).toBeGreaterThan(0);
    const settings = JSON.parse(readFileSync(join(projectRoot, '.claude', 'settings.local.json'), 'utf8'));
    const remaining = settings.permissions.allow.filter((e: string) => e.includes('wdf-dispatch:')).length;
    expect(remaining).toBeGreaterThan(0); // S-TODO-01 still there
    const authLeft = settings.permissions.allow.filter((e: string) => e.includes('wdf-dispatch:S-AUTH-01')).length;
    expect(authLeft).toBe(0);
  });
});

describe('revokeAllDispatchPermissions', () => {
  it('purges every wdf-dispatch tag', () => {
    applyPermissions(manifest(), projectRoot);
    applyPermissions(manifest({ story_id: 'S-TODO-01', stage: 'qa' }), projectRoot);
    const removed = revokeAllDispatchPermissions(projectRoot);
    expect(removed).toBeGreaterThan(0);
    const settings = JSON.parse(readFileSync(join(projectRoot, '.claude', 'settings.local.json'), 'utf8'));
    const leftover = [...(settings.permissions.allow ?? []), ...(settings.permissions.deny ?? [])]
      .filter((e: string) => typeof e === 'string' && e.includes('wdf-dispatch:'));
    expect(leftover).toEqual([]);
  });
});

describe('listDispatchPermissions', () => {
  it('lists currently-injected entries', () => {
    applyPermissions(manifest(), projectRoot);
    const list = listDispatchPermissions(projectRoot);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((l) => l.story_id === 'S-AUTH-01')).toBe(true);
  });

  it('returns empty when no dispatch permissions present', () => {
    expect(listDispatchPermissions(projectRoot)).toEqual([]);
  });
});

describe('readRolePermissions', () => {
  it('reads default_permissions from agent frontmatter when present', () => {
    const frameworkRoot = mkdtempSync(join(tmpdir(), 'wdf-fw-'));
    try {
      const agentsDir = join(frameworkRoot, 'references', 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        join(agentsDir, 'backend-developer.md'),
        '---\nname: backend-developer\ndefault_permissions:\n  bash_allow:\n    - npm test\n    - npx vitest\n  bash_deny:\n    - git push\n---\n\n# Native Agent: backend-developer\n',
      );
      const result = readRolePermissions('backend-developer', frameworkRoot);
      expect(result.from).toBe('agent-frontmatter');
      expect(result.permissions.bash_allow).toContain('npm test');
      expect(result.permissions.bash_deny).toContain('git push');
    } finally {
      rmSync(frameworkRoot, { recursive: true, force: true });
    }
  });

  it('falls back to ROLE_BASELINE_FALLBACK when agent file is missing', () => {
    const frameworkRoot = mkdtempSync(join(tmpdir(), 'wdf-fw-'));
    try {
      const result = readRolePermissions('backend-developer', frameworkRoot);
      expect(result.from).toBe('fallback');
      expect(result.permissions.bash_allow).toEqual(ROLE_BASELINE_FALLBACK['backend-developer'].bash_allow);
    } finally {
      rmSync(frameworkRoot, { recursive: true, force: true });
    }
  });

  it('falls back when agent file has no frontmatter', () => {
    const frameworkRoot = mkdtempSync(join(tmpdir(), 'wdf-fw-'));
    try {
      const agentsDir = join(frameworkRoot, 'references', 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, 'backend-developer.md'), '# Native Agent: backend-developer\n');
      const result = readRolePermissions('backend-developer', frameworkRoot);
      expect(result.from).toBe('fallback');
    } finally {
      rmSync(frameworkRoot, { recursive: true, force: true });
    }
  });

  it('falls back when role is unknown', () => {
    const frameworkRoot = mkdtempSync(join(tmpdir(), 'wdf-fw-'));
    try {
      const result = readRolePermissions('nonexistent-role', frameworkRoot);
      expect(result.from).toBe('fallback');
      expect(result.permissions.bash_allow).toEqual([]);
    } finally {
      rmSync(frameworkRoot, { recursive: true, force: true });
    }
  });
});

describe('applyRolePermissions', () => {
  it('applies role baseline tagged with story+stage', () => {
    const frameworkRoot = mkdtempSync(join(tmpdir(), 'wdf-fw-'));
    try {
      const applied = applyRolePermissions(
        'backend-developer',
        'S-AUTH-01',
        'dev',
        projectRoot,
        frameworkRoot,
      );
      expect(applied.length).toBeGreaterThan(0);
      expect(applied.every((a) => a.story_id === 'S-AUTH-01' && a.stage === 'dev')).toBe(true);
      const settings = JSON.parse(readFileSync(join(projectRoot, '.claude', 'settings.local.json'), 'utf8'));
      expect(settings.permissions.allow.some((e: string) => e.includes('Bash(npm test:*)'))).toBe(true);
      expect(settings.permissions.deny.some((e: string) => e.includes('Bash(git push:*)'))).toBe(true);
    } finally {
      rmSync(frameworkRoot, { recursive: true, force: true });
    }
  });

  it('respects agent frontmatter when present', () => {
    const frameworkRoot = mkdtempSync(join(tmpdir(), 'wdf-fw-'));
    try {
      const agentsDir = join(frameworkRoot, 'references', 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        join(agentsDir, 'backend-developer.md'),
        '---\nname: backend-developer\ndefault_permissions:\n  bash_allow:\n    - pnpm test\n  bash_deny:\n    - git push\n---\n\n# Native Agent: backend-developer\n',
      );
      applyRolePermissions('backend-developer', 'S-X', 'dev', projectRoot, frameworkRoot);
      const settings = JSON.parse(readFileSync(join(projectRoot, '.claude', 'settings.local.json'), 'utf8'));
      expect(settings.permissions.allow.some((e: string) => e.includes('Bash(pnpm test:*)'))).toBe(true);
    } finally {
      rmSync(frameworkRoot, { recursive: true, force: true });
    }
  });
});

describe('inferStoryPermissions', () => {
  it('derives Bash prefixes from acceptance_check entries', () => {
    const perms = inferStoryPermissions(
      ['npm test auth.test.ts', 'npx vitest run', 'git status'],
      [],
    );
    expect(perms.bash_allow).toContain('npm test auth.test.ts');
    expect(perms.bash_allow).toContain('npx vitest run');
    expect(perms.bash_allow).not.toContain('git status');
  });

  it('always includes git push + rm -rf in deny', () => {
    const perms = inferStoryPermissions([], []);
    expect(perms.bash_deny).toContain('git push');
    expect(perms.bash_deny).toContain('rm -rf');
  });

  it('exposes scope_read when scope_write is non-empty', () => {
    const perms = inferStoryPermissions([], ['backend/src/auth.ts']);
    expect(perms.scope_read).toContain('_wdf_output/**');
  });

  it('returns undefined scope_read when scope_write is empty', () => {
    const perms = inferStoryPermissions([], []);
    expect(perms.scope_read).toBeUndefined();
  });
});
