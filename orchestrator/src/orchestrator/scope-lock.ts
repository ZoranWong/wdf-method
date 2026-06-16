/**
 * scope-lock.ts
 *
 * Pure validation utilities for the wdf-method scope-lock guardrail.
 *
 * Two validation entry points:
 *   1. validateScopeLock — pre-execution. Inspects a story's *declared*
 *      `scope_write` against the configured forbidden / protected paths and
 *      (optionally) the frozen implementation boundary. Used at the Story
 *      Ready Gate to block stories whose stated intent is illegal.
 *   2. validateActualChangesAgainstScope — pre-merge. Inspects the *actual*
 *      changed file list (typically from `git diff --name-only`) and confirms
 *      every change is inside the declared `scope_write` and that no change
 *      lands on a forbidden path. Used by the merge queue immediately before
 *      promoting a story branch onto main.
 *
 * Both helpers are *pure*: no fs / network / process / time. They take all
 * inputs as arguments and return a `{ all_pass, violations }` record. The
 * caller is responsible for:
 *   - Reading config (e.g. customize.toml `[scope_lock]` section).
 *   - Resolving / fetching the changed file list.
 *   - Translating violations into audit-log entries and merge-abort decisions.
 *   - Applying the `enforcement_mode` (strict / warning / permissive) policy
 *     to violations via `applyEnforcementMode`.
 */

/**
 * Configuration sourced from `customize.toml [scope_lock]`.
 *
 * `enforcement_mode` accepts `warning_only` as an alias for `warning`; both
 * map to the same behaviour. The two-name accept is intentional: the TOML
 * uses `warning_only` historically, but documentation / task specs use
 * `warning`. Callers may pass either.
 */
export interface ScopeLockConfig {
  enabled: boolean;
  enforcement_mode: 'strict' | 'warning' | 'permissive' | 'warning_only';
  forbidden_paths: string[];
  protected_paths: string[];
  srg_05_severity?: 'blocking' | 'warning';
}

/**
 * A single scope violation. `rule` identifies which guardrail tripped:
 *   - `forbidden`        — path matches a forbidden_paths entry.
 *   - `protected`        — path matches a protected_paths entry; the story
 *                          should be downgraded to serial_only execution.
 *   - `outside_boundary` — declared scope sits outside the frozen
 *                          implementation_boundary (Phase 4.1).
 *   - `outside_scope`    — actual changed file is not covered by any
 *                          declared `scope_write` entry.
 */
export type ScopeViolationRule =
  | 'forbidden'
  | 'protected'
  | 'outside_boundary'
  | 'outside_scope';

export interface ScopeViolation {
  path: string;
  rule: ScopeViolationRule;
  severity: 'error' | 'warning';
  message: string;
}

export interface ScopeValidationResult {
  all_pass: boolean;
  violations: ScopeViolation[];
}

/**
 * Normalise an enforcement mode token. `warning_only` is folded into
 * `warning` so downstream consumers only have to handle three values.
 */
export function normalizeEnforcementMode(
  mode: ScopeLockConfig['enforcement_mode'],
): 'strict' | 'warning' | 'permissive' {
  return mode === 'warning_only' ? 'warning' : mode;
}

/**
 * Decide the *effective* outcome of a validation result given the configured
 * enforcement mode. Pure — does not log, does not raise.
 *
 *   strict      — any error violation blocks (`should_block: true`).
 *                 Warning violations remain warnings.
 *   warning     — never blocks. All violations downgrade to warnings.
 *   permissive  — never blocks. Violations are silenced (returned as
 *                 `silenced` so callers can still emit a debug entry).
 */
export interface EnforcementOutcome {
  should_block: boolean;
  reported: ScopeViolation[];
  silenced: ScopeViolation[];
}

export function applyEnforcementMode(
  result: ScopeValidationResult,
  mode: ScopeLockConfig['enforcement_mode'],
): EnforcementOutcome {
  const m = normalizeEnforcementMode(mode);

  if (m === 'permissive') {
    return {
      should_block: false,
      reported: [],
      silenced: [...result.violations],
    };
  }

  if (m === 'warning') {
    const reported = result.violations.map((v) => ({ ...v, severity: 'warning' as const }));
    return { should_block: false, reported, silenced: [] };
  }

  // strict
  const blocking = result.violations.some((v) => v.severity === 'error');
  return {
    should_block: blocking,
    reported: [...result.violations],
    silenced: [],
  };
}

// ── Path-matching helpers ──

/**
 * Normalise a path for comparison: collapse repeated slashes, strip a
 * trailing slash, leave the leading character untouched (so absolute paths
 * stay absolute and relative paths stay relative). NUL / empty inputs are
 * treated as the empty string by the caller.
 */
function normalisePath(p: string): string {
  if (typeof p !== 'string') return '';
  const collapsed = p.replace(/\/{2,}/g, '/');
  if (collapsed.length > 1 && collapsed.endsWith('/')) {
    return collapsed.slice(0, -1);
  }
  return collapsed;
}

/**
 * True iff `child` is inside `parent` with proper path-segment boundaries.
 * Both inputs must already be normalised. `parent === child` is considered
 * inside. `src/api` is inside `src/api`, `src/api/x` is inside `src/api`,
 * but `src/apix` is NOT inside `src/api`.
 */
function isInsidePath(child: string, parent: string): boolean {
  if (!parent || !child) return false;
  if (parent === child) return true;
  if (child.startsWith(parent + '/')) return true;
  return false;
}

/**
 * True iff `path` matches any forbidden_paths entry. Entries are interpreted
 * generously to cover the three forms documented in customize.toml:
 *
 *   - Absolute system paths: `/etc/`, `/var/log/` — matched as a prefix.
 *   - Home-relative paths: `~/.ssh/`, `~/.aws/` — matched as a prefix.
 *   - Repo-relative names:  `node_modules/`, `.git/`, `.env.production` —
 *     matched if the path equals the entry, has the entry as a leading
 *     directory, or contains the entry as an interior path segment.
 */
export function matchesForbidden(path: string, forbidden: string[]): string | null {
  const np = normalisePath(path);
  for (const raw of forbidden) {
    const f = normalisePath(raw);
    if (!f) continue;

    // Absolute or home-relative — leading-prefix match.
    if (f.startsWith('/') || f.startsWith('~')) {
      if (np === f || np.startsWith(f + '/') || np.startsWith(f)) return raw;
      continue;
    }

    // Repo-relative directory entry (originally ended in '/').
    if (raw.endsWith('/')) {
      const dir = f; // already trailing-slash-stripped
      if (np === dir) return raw;
      if (np.startsWith(dir + '/')) return raw;
      if (np.includes('/' + dir + '/')) return raw;
      if (np.endsWith('/' + dir)) return raw;
      continue;
    }

    // Repo-relative file or non-slash entry (e.g. `.env.production`).
    if (np === f) return raw;
    if (np.endsWith('/' + f)) return raw;
    if (np.startsWith(f + '/')) return raw;
  }
  return null;
}

/**
 * True iff `path` overlaps any protected_paths entry. Protected entries are
 * conceptual labels (e.g. `shared/types`, `schema/migration`). Match either:
 *   - the declared path is inside the protected zone, or
 *   - the declared path *contains* the protected zone (covers a parent dir).
 */
export function matchesProtected(path: string, protectedPaths: string[]): string | null {
  const np = normalisePath(path);
  for (const raw of protectedPaths) {
    const p = normalisePath(raw);
    if (!p) continue;
    if (isInsidePath(np, p) || isInsidePath(p, np)) return raw;
    // Allow substring fragment match (existing convention) for compound
    // tokens like `route/registry` appearing inside `app/route/registry/x`.
    if (np.includes('/' + p + '/') || np.endsWith('/' + p) || np.startsWith(p + '/')) {
      return raw;
    }
  }
  return null;
}

/**
 * True iff every `path` entry sits inside at least one boundary entry.
 * Returns the offending paths (empty array on success).
 */
export function findOutsideBoundary(paths: string[], boundary: string[]): string[] {
  if (!boundary || boundary.length === 0) return [];
  const offenders: string[] = [];
  for (const p of paths) {
    const np = normalisePath(p);
    const ok = boundary.some((b) => {
      const nb = normalisePath(b);
      return isInsidePath(np, nb) || isInsidePath(nb, np);
    });
    if (!ok) offenders.push(p);
  }
  return offenders;
}

// ── Public API ──

/**
 * Pre-execution validation: inspect a story's declared `scope_write` against
 * forbidden / protected paths and (optionally) the frozen implementation
 * boundary.
 *
 * The returned result is *uninterpreted* — the caller must run
 * `applyEnforcementMode` to decide whether to block, warn, or silence.
 *
 * @param scopeWrite             The story's declared writeable paths.
 * @param config                 The active scope-lock configuration.
 * @param implementationBoundary Optional frozen boundary (Phase 4.1). When
 *                               omitted (or empty) the boundary check is
 *                               skipped.
 */
export function validateScopeLock(
  scopeWrite: string[],
  config: ScopeLockConfig,
  implementationBoundary?: string[],
): ScopeValidationResult {
  const violations: ScopeViolation[] = [];

  if (!config.enabled) {
    return { all_pass: true, violations };
  }

  const declared = Array.isArray(scopeWrite) ? scopeWrite : [];

  for (const path of declared) {
    if (typeof path !== 'string' || path.length === 0) continue;

    const f = matchesForbidden(path, config.forbidden_paths ?? []);
    if (f) {
      violations.push({
        path,
        rule: 'forbidden',
        severity: 'error',
        message: `scope_write entry "${path}" matches forbidden path "${f}"`,
      });
    }

    const pr = matchesProtected(path, config.protected_paths ?? []);
    if (pr) {
      violations.push({
        path,
        rule: 'protected',
        severity: 'warning',
        message: `scope_write entry "${path}" overlaps protected path "${pr}" — story must run serial_only`,
      });
    }
  }

  if (implementationBoundary && implementationBoundary.length > 0) {
    const outside = findOutsideBoundary(declared, implementationBoundary);
    for (const path of outside) {
      violations.push({
        path,
        rule: 'outside_boundary',
        severity: 'error',
        message: `scope_write entry "${path}" is outside the frozen implementation_boundary`,
      });
    }
  }

  return {
    all_pass: !violations.some((v) => v.severity === 'error'),
    violations,
  };
}

/**
 * Pre-merge validation: confirm every actually-changed file is covered by
 * the declared `scope_write` and that none of them touch a forbidden path.
 *
 * Files are considered "covered" if they sit inside any declared scope
 * entry under proper path-segment boundaries (see `isInsidePath`).
 *
 * @param changedFiles  Output of `git diff --name-only` (or equivalent).
 * @param declaredScope The story's `scope_write` declared at gate time.
 * @param config        The active scope-lock configuration.
 */
export function validateActualChangesAgainstScope(
  changedFiles: string[],
  declaredScope: string[],
  config: ScopeLockConfig,
): ScopeValidationResult {
  const violations: ScopeViolation[] = [];

  if (!config.enabled) {
    return { all_pass: true, violations };
  }

  const files = Array.isArray(changedFiles) ? changedFiles : [];
  const scope = (Array.isArray(declaredScope) ? declaredScope : []).map(normalisePath);

  for (const file of files) {
    if (typeof file !== 'string' || file.length === 0) continue;
    const nf = normalisePath(file);

    // Forbidden paths take precedence — they are blocking even if the file
    // happens to also fall inside a (mis-)declared scope entry.
    const f = matchesForbidden(nf, config.forbidden_paths ?? []);
    if (f) {
      violations.push({
        path: file,
        rule: 'forbidden',
        severity: 'error',
        message: `changed file "${file}" hits forbidden path "${f}"`,
      });
      continue;
    }

    // Inside any declared scope entry?
    const covered = scope.some((s) => isInsidePath(nf, s));
    if (!covered) {
      violations.push({
        path: file,
        rule: 'outside_scope',
        severity: 'error',
        message: `changed file "${file}" is outside declared scope_write`,
      });
    }
  }

  return {
    all_pass: !violations.some((v) => v.severity === 'error'),
    violations,
  };
}

/**
 * Convenience: collapse a result into a one-line audit-friendly summary.
 */
export function summarizeViolations(violations: ScopeViolation[]): string {
  if (violations.length === 0) return '0 violations';
  const counts = violations.reduce<Record<string, number>>((acc, v) => {
    acc[v.rule] = (acc[v.rule] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).map(([r, n]) => `${n} ${r}`).join(', ');
}
