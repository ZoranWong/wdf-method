import { describe, it, expect } from 'vitest';
import {
  validateScopeLock,
  validateActualChangesAgainstScope,
  applyEnforcementMode,
  matchesForbidden,
  matchesProtected,
  findOutsideBoundary,
  normalizeEnforcementMode,
  summarizeViolations,
  ScopeLockConfig,
} from './scope-lock.js';

const baseConfig: ScopeLockConfig = {
  enabled: true,
  enforcement_mode: 'strict',
  forbidden_paths: [
    '/etc/',
    '~/.ssh/',
    '.env.production',
    '.env.local',
    '.git/',
    'node_modules/',
  ],
  protected_paths: [
    'shared/contract',
    'shared/types',
    'schema/migration',
    'route/registry',
  ],
  srg_05_severity: 'blocking',
};

describe('matchesForbidden', () => {
  it('matches absolute system paths', () => {
    expect(matchesForbidden('/etc/passwd', baseConfig.forbidden_paths)).toBe('/etc/');
  });

  it('matches home-relative paths', () => {
    expect(matchesForbidden('~/.ssh/id_rsa', baseConfig.forbidden_paths)).toBe('~/.ssh/');
  });

  it('matches repo-relative directory at root', () => {
    expect(matchesForbidden('node_modules/foo', baseConfig.forbidden_paths)).toBe('node_modules/');
  });

  it('matches nested forbidden directory', () => {
    expect(matchesForbidden('packages/x/node_modules/y', baseConfig.forbidden_paths)).toBe('node_modules/');
  });

  it('matches dotfile leaf', () => {
    expect(matchesForbidden('.env.production', baseConfig.forbidden_paths)).toBe('.env.production');
    expect(matchesForbidden('apps/api/.env.production', baseConfig.forbidden_paths)).toBe('.env.production');
  });

  it('returns null for safe path', () => {
    expect(matchesForbidden('src/api/users.ts', baseConfig.forbidden_paths)).toBeNull();
  });

  it('does not match a similarly-named non-forbidden path', () => {
    expect(matchesForbidden('src/node_modules_helper.ts', baseConfig.forbidden_paths)).toBeNull();
    expect(matchesForbidden('docs/.env.production.md', baseConfig.forbidden_paths)).toBeNull();
  });
});

describe('matchesProtected', () => {
  it('matches exact zone', () => {
    expect(matchesProtected('shared/types', baseConfig.protected_paths)).toBe('shared/types');
  });

  it('matches inside protected zone', () => {
    expect(matchesProtected('shared/types/user.ts', baseConfig.protected_paths)).toBe('shared/types');
  });

  it('matches a parent that contains the protected zone', () => {
    expect(matchesProtected('app/shared/types', baseConfig.protected_paths)).toBe('shared/types');
  });

  it('returns null for unrelated path', () => {
    expect(matchesProtected('src/api/handlers.ts', baseConfig.protected_paths)).toBeNull();
  });
});

describe('findOutsideBoundary', () => {
  it('returns empty when all paths are inside boundary', () => {
    const boundary = ['src/api', 'src/db'];
    expect(findOutsideBoundary(['src/api/users.ts', 'src/db/migrations'], boundary)).toEqual([]);
  });

  it('flags paths outside boundary', () => {
    const boundary = ['src/api'];
    expect(findOutsideBoundary(['src/api/x', 'src/web/y'], boundary)).toEqual(['src/web/y']);
  });

  it('skips check when boundary is empty', () => {
    expect(findOutsideBoundary(['anywhere'], [])).toEqual([]);
  });

  it('treats parent-of-boundary as inside (boundary nested in declared scope)', () => {
    expect(findOutsideBoundary(['src'], ['src/api'])).toEqual([]);
  });
});

describe('normalizeEnforcementMode', () => {
  it('folds warning_only into warning', () => {
    expect(normalizeEnforcementMode('warning_only')).toBe('warning');
  });
  it('passes strict through', () => {
    expect(normalizeEnforcementMode('strict')).toBe('strict');
  });
  it('passes permissive through', () => {
    expect(normalizeEnforcementMode('permissive')).toBe('permissive');
  });
});

describe('validateScopeLock — declared paths', () => {
  it('passes a clean declaration', () => {
    const r = validateScopeLock(
      ['src/api/users.ts', 'src/db/migrations/001_init.sql'],
      baseConfig,
    );
    expect(r.all_pass).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('flags forbidden paths as blocking errors', () => {
    const r = validateScopeLock(
      ['src/api/users.ts', '.env.production'],
      baseConfig,
    );
    expect(r.all_pass).toBe(false);
    const forbidden = r.violations.find((v) => v.rule === 'forbidden');
    expect(forbidden?.severity).toBe('error');
    expect(forbidden?.path).toBe('.env.production');
  });

  it('flags protected paths as warnings (serial_only marker)', () => {
    const r = validateScopeLock(
      ['shared/types/user.ts'],
      baseConfig,
    );
    // protected alone is a warning — no error → still all_pass
    expect(r.all_pass).toBe(true);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].rule).toBe('protected');
    expect(r.violations[0].severity).toBe('warning');
  });

  it('flags outside_boundary when boundary is provided', () => {
    const r = validateScopeLock(
      ['src/api/x.ts', 'tools/random.ts'],
      baseConfig,
      ['src/api', 'src/db'],
    );
    expect(r.all_pass).toBe(false);
    const outside = r.violations.find((v) => v.rule === 'outside_boundary');
    expect(outside?.path).toBe('tools/random.ts');
    expect(outside?.severity).toBe('error');
  });

  it('skips boundary check when boundary is undefined or empty', () => {
    const r1 = validateScopeLock(['anywhere/x.ts'], baseConfig);
    expect(r1.all_pass).toBe(true);
    const r2 = validateScopeLock(['anywhere/x.ts'], baseConfig, []);
    expect(r2.all_pass).toBe(true);
  });

  it('returns clean when scope_lock disabled', () => {
    const r = validateScopeLock(
      ['.env.production', 'shared/types/x.ts'],
      { ...baseConfig, enabled: false },
    );
    expect(r.all_pass).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('handles non-string entries gracefully', () => {
    // Cast through unknown — production callers shouldn't do this, but the
    // helper must not throw on bad input.
    const r = validateScopeLock(
      ['src/api/x.ts', '', null as unknown as string, undefined as unknown as string],
      baseConfig,
    );
    expect(r.all_pass).toBe(true);
  });
});

describe('validateActualChangesAgainstScope', () => {
  it('passes when every change is inside declared scope', () => {
    const r = validateActualChangesAgainstScope(
      ['src/api/users.ts', 'src/api/users.test.ts'],
      ['src/api'],
      baseConfig,
    );
    expect(r.all_pass).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('flags files outside declared scope', () => {
    const r = validateActualChangesAgainstScope(
      ['src/api/users.ts', 'src/web/page.tsx'],
      ['src/api'],
      baseConfig,
    );
    expect(r.all_pass).toBe(false);
    const out = r.violations.find((v) => v.rule === 'outside_scope');
    expect(out?.path).toBe('src/web/page.tsx');
    expect(out?.severity).toBe('error');
  });

  it('flags forbidden paths in changed files', () => {
    const r = validateActualChangesAgainstScope(
      ['src/api/x.ts', '.env.production'],
      ['src/api', '.env.production'], // even if declared, forbidden wins
      baseConfig,
    );
    expect(r.all_pass).toBe(false);
    const fbd = r.violations.find((v) => v.rule === 'forbidden');
    expect(fbd?.path).toBe('.env.production');
  });

  it('does not double-flag a forbidden file as outside_scope', () => {
    const r = validateActualChangesAgainstScope(
      ['.env.production'],
      ['src/api'],
      baseConfig,
    );
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].rule).toBe('forbidden');
  });

  it('rejects path-segment lookalikes (src/apix not inside src/api)', () => {
    const r = validateActualChangesAgainstScope(
      ['src/apix/handler.ts'],
      ['src/api'],
      baseConfig,
    );
    expect(r.all_pass).toBe(false);
    expect(r.violations[0].rule).toBe('outside_scope');
  });

  it('returns clean when scope_lock disabled', () => {
    const r = validateActualChangesAgainstScope(
      ['anywhere/x.ts'],
      [],
      { ...baseConfig, enabled: false },
    );
    expect(r.all_pass).toBe(true);
  });

  it('handles empty changed file list', () => {
    const r = validateActualChangesAgainstScope([], ['src/api'], baseConfig);
    expect(r.all_pass).toBe(true);
    expect(r.violations).toEqual([]);
  });
});

describe('applyEnforcementMode', () => {
  const errorViolation = validateScopeLock(['.env.production'], baseConfig);
  const warningViolation = validateScopeLock(['shared/types/x.ts'], baseConfig);

  it('strict — error violation triggers should_block', () => {
    const out = applyEnforcementMode(errorViolation, 'strict');
    expect(out.should_block).toBe(true);
    expect(out.reported.length).toBeGreaterThan(0);
    expect(out.silenced).toEqual([]);
  });

  it('strict — pure-warning violation does not block', () => {
    const out = applyEnforcementMode(warningViolation, 'strict');
    expect(out.should_block).toBe(false);
    expect(out.reported).toHaveLength(1);
  });

  it('warning — never blocks; everything reported as warning', () => {
    const out = applyEnforcementMode(errorViolation, 'warning');
    expect(out.should_block).toBe(false);
    expect(out.reported.every((v) => v.severity === 'warning')).toBe(true);
  });

  it('warning_only — same as warning', () => {
    const out = applyEnforcementMode(errorViolation, 'warning_only');
    expect(out.should_block).toBe(false);
    expect(out.reported.every((v) => v.severity === 'warning')).toBe(true);
  });

  it('permissive — silences everything', () => {
    const out = applyEnforcementMode(errorViolation, 'permissive');
    expect(out.should_block).toBe(false);
    expect(out.reported).toEqual([]);
    expect(out.silenced.length).toBeGreaterThan(0);
  });

  it('clean result — never blocks regardless of mode', () => {
    const clean = validateScopeLock(['src/api/x.ts'], baseConfig);
    expect(applyEnforcementMode(clean, 'strict').should_block).toBe(false);
    expect(applyEnforcementMode(clean, 'warning').should_block).toBe(false);
    expect(applyEnforcementMode(clean, 'permissive').should_block).toBe(false);
  });
});

describe('summarizeViolations', () => {
  it('returns "0 violations" for empty list', () => {
    expect(summarizeViolations([])).toBe('0 violations');
  });

  it('groups by rule with counts', () => {
    const r = validateActualChangesAgainstScope(
      ['.env.production', 'unrelated/x.ts', 'unrelated/y.ts'],
      ['src/api'],
      baseConfig,
    );
    const summary = summarizeViolations(r.violations);
    expect(summary).toContain('forbidden');
    expect(summary).toContain('outside_scope');
  });
});

describe('integration — boundary + forbidden in one declaration', () => {
  it('reports both error categories for a sloppy story', () => {
    const r = validateScopeLock(
      ['.env.production', 'tools/random.ts', 'src/api/users.ts'],
      baseConfig,
      ['src/api'],
    );
    expect(r.all_pass).toBe(false);
    const rules = new Set(r.violations.map((v) => v.rule));
    expect(rules.has('forbidden')).toBe(true);
    expect(rules.has('outside_boundary')).toBe(true);
  });
});
