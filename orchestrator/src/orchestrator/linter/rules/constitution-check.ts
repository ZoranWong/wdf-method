import { readFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { LintRule, LintContext, LintResult } from '../types.js';

/**
 * CONSTITUTION_CHECK — execute the project's constitution.yaml shell rules.
 *
 * The constitution lists rules with a `check:` shell snippet and an
 * `expected:` integer. This rule parses the YAML, runs every check snippet
 * from the project root, and flags any whose stdout (trimmed, parsed as int)
 * does not equal `expected`.
 *
 * This is the engine behind WDF-002 (stale dispatch perms), WDF-003
 * (scratch dirs leaked), WDF-010 (no secrets in source) — and any future
 * rule added to constitution.yaml with the same shape. Previously
 * `wdf constitution` referenced a `CONSTITUTION_THRESHOLDS` rule that was
 * never registered; this implementation closes that gap.
 *
 * Scope filtering: rules with a `scope:` field that does not match the
 * current project root are skipped (e.g. WDF-006 todo-app tests only run
 * inside examples/todo-app). Rules without a shell `check` are skipped
 * (e.g. WDF-001 tsc strict is enforced by `npm run build`).
 */
export const ConstitutionCheckRule: LintRule = {
  id: 'CONSTITUTION_CHECK',
  level: 'error',
  description: 'Execute constitution.yaml shell-check rules',

  async check(context: LintContext): Promise<LintResult[]> {
    const results: LintResult[] = [];
    const constitutionPath = join(context.projectRoot, 'constitution.yaml');

    if (!existsSync(constitutionPath)) {
      // Projects without a constitution are exempt — framework repo always
      // has one, target projects get one from `wdf init`.
      return results;
    }

    const raw = readFileSync(constitutionPath, 'utf8');
    const rules = parseConstitutionRules(raw);

    for (const rule of rules) {
      if (!rule.check) continue;
      const expected = typeof rule.expected === 'number' ? rule.expected : null;
      if (expected === null) continue;

      // Scope guard: skip rules whose scope doesn't include project root.
      // We approximate "scope matches" as: the scope string (treated as a
      // glob prefix) is satisfied by the current working directory.
      if (rule.scope && !scopeMatchesProject(rule.scope, context.projectRoot)) {
        continue;
      }

      let actual: number;
      let stderr = '';
      try {
        // spawnSync('/bin/sh', ['-c', cmd]) is the most explicit way to
        // get shell parsing — execSync with shell:true can be tripped up
        // by quoting on macOS, and zsh-as-$SHELL silently misbehaves.
        // We pass the rule.check string verbatim; the constitution author
        // is responsible for sh-compatible syntax.
        const result = spawnSync('/bin/sh', ['-c', rule.check], {
          cwd: context.projectRoot,
          encoding: 'utf8',
          timeout: 15_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (result.status === null && result.signal) {
          stderr = `killed by signal ${result.signal}`;
          actual = NaN;
        } else {
          const out = (result.stdout ?? '').trim();
          // Many constitution checks use `|| echo 0` so the command
          // exits 0 even on grep miss. The exit status is still
          // informative when nonzero (e.g. find errors).
          if (result.status !== 0 && !out) {
            stderr = (result.stderr ?? '').trim() || `exited ${result.status}`;
            actual = NaN;
          } else {
            actual = parseInt(out.split('\n')[0].trim(), 10);
            if (Number.isNaN(actual)) actual = out.length > 0 ? 1 : 0;
          }
        }
      } catch (err: any) {
        // Non-zero exit with `|| echo 0` style fallback returns "0" — that
        // path lands in the success branch above. A real failure (timeout,
        // signal) lands here and is reported as an error.
        stderr = err?.stderr?.toString()?.trim() ?? err?.message ?? '';
        actual = NaN;
      }

      if (Number.isNaN(actual)) {
        results.push({
          ruleId: 'CONSTITUTION_CHECK',
          level: rule.level === 'warning' ? 'warning' : 'error',
          file: 'constitution.yaml',
          message: `${rule.id} (${rule.name}): check command failed — ${stderr}`,
        });
        continue;
      }

      if (actual !== expected) {
        results.push({
          ruleId: 'CONSTITUTION_CHECK',
          level: rule.level === 'warning' ? 'warning' : 'error',
          file: 'constitution.yaml',
          message: `${rule.id} (${rule.name}): expected ${expected}, got ${actual}`,
        });
      }
    }

    return results;
  },
};

interface ConstitutionRule {
  id: string;
  name: string;
  level: 'error' | 'warning';
  scope?: string;
  check?: string;
  expected?: number;
}

/**
 * Minimal constitution.yaml parser.
 *
 * We avoid a YAML dependency here because the constitution grammar in use
 * is intentionally narrow: top-level `rules:` is a list of `- id: ...`
 * entries with simple scalar fields. A hand-rolled parser keeps the
 * orchestrator dependency-free and resilient to formatting drift.
 */
function parseConstitutionRules(raw: string): ConstitutionRule[] {
  const rules: ConstitutionRule[] = [];
  const lines = raw.split('\n');

  let inRules = false;
  let current: Partial<ConstitutionRule> | null = null;

  const pushCurrent = () => {
    if (current && current.id) {
      rules.push({
        id: current.id,
        name: current.name ?? current.id,
        level: (current.level as 'error' | 'warning') ?? 'error',
        scope: current.scope,
        check: current.check,
        expected: current.expected,
      });
    }
    current = null;
  };

  for (const line of lines) {
    // Detect `rules:` header at top level (no leading whitespace).
    if (/^rules:\s*$/.test(line)) {
      inRules = true;
      continue;
    }
    // A new top-level key ends the rules block.
    if (inRules && /^\S/.test(line) && !line.startsWith('#') && !line.startsWith('-')) {
      pushCurrent();
      inRules = false;
      continue;
    }
    if (!inRules) continue;

    // New rule entry starts with `  - id:`
    const entryMatch = line.match(/^\s*-\s+id:\s*(\S+)\s*$/);
    if (entryMatch) {
      pushCurrent();
      current = { id: entryMatch[1] };
      continue;
    }

    if (!current) continue;

    // Subsequent fields are `    key: value` (4-space indent) or deeper
    // for folded scalars.
    const fieldMatch = line.match(/^\s{4}([a-z_]+):\s*(.*?)\s*$/);
    if (!fieldMatch) continue;
    const [, key, value] = fieldMatch;

    if (value === '>' || value === '|') {
      // Folded scalar — capture following indented lines as the value.
      const foldedLines: string[] = [];
      const idx = lines.indexOf(line);
      for (let j = idx + 1; j < lines.length; j++) {
        const next = lines[j];
        if (!/^\s{6,}\S/.test(next)) break;
        foldedLines.push(next.trim());
      }
      (current as any)[key] = foldedLines.join(' ');
      continue;
    }

    if (key === 'expected') {
      (current as any)[key] = parseInt(value, 10);
    } else if (key === 'level') {
      (current as any)[key] = value === 'warning' ? 'warning' : 'error';
    } else {
      // Strip surrounding YAML quotes (double or single). Without this
      // a check like `check: "grep ... | wc -l"` is passed to /bin/sh
      // with the literal quotes intact, which makes sh treat the entire
      // quoted blob as a single command name.
      const stripped = value.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
      (current as any)[key] = stripped;
    }
  }
  pushCurrent();

  return rules;
}

function scopeMatchesProject(scope: string, projectRoot: string): boolean {
  // `orchestrator/src/**/*.ts` → matches if the project root is the
  // framework repo. We approximate by checking whether the scope's first
  // path segment exists as a child of projectRoot. For scope like
  // `examples/todo-app/backend` we require projectRoot basename to be
  // `backend` (or one of its parents).
  const firstSegment = scope.split('/')[0];
  if (!firstSegment || firstSegment.includes('*')) return true;
  if (existsSync(join(projectRoot, firstSegment))) return true;
  // Scope targeting a deeper directory: match if the project root's
  // basename appears in the scope path.
  const rootBasename = projectRoot.split('/').filter(Boolean).pop();
  return rootBasename ? scope.includes(rootBasename) : true;
}
