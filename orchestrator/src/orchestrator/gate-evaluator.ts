import { existsSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import YAML from 'js-yaml';
import { GateCard, GateCheck, Track } from './types.js';
import { SprintStatusManager } from './sprint-status.js';
import { resolve } from 'path';
import { appendAudit } from './audit-logger.js';
import { evaluateTraceabilityGate, formatTraceabilityResult } from './traceability-gate.js';

/**
 * Known check types — must be kept in sync with the workflow spec.
 * Adding a new type here forces the dispatch switch to handle it (TypeScript
 * exhaustiveness check via {@link assertNever}). Anything not in this set is
 * rejected as an unknown check type by {@link GateEvaluator.evaluate}.
 */
export type KnownCheckType =
  | 'artifact_exists'
  | 'artifact_metadata'
  | 'artifact_checksum'
  | 'dependency_status'
  | 'user_confirmation'
  | 'all_stories_complete'
  | 'scope_boundary'
  | 'quality_threshold'
  | 'field_exists'
  | 'traceability_complete'
  | 'custom_check';

const KNOWN_CHECK_TYPES = new Set<string>([
  'artifact_exists',
  'artifact_metadata',
  'artifact_checksum',
  'dependency_status',
  'user_confirmation',
  'all_stories_complete',
  'scope_boundary',
  'quality_threshold',
  'field_exists',
  'traceability_complete',
  'custom_check',
]);

/**
 * Supported dependency-status fields. Anything outside this set fails closed
 * — there is no catch-all "not yet implemented" pass.
 */
type SupportedDependencyField =
  | 'phase_3.status'
  | 'development_order_frozen_at'
  | 'requirements_frozen_at'
  | 'phase_3_9';

const SUPPORTED_DEPENDENCY_FIELDS: ReadonlyArray<SupportedDependencyField> = [
  'phase_3.status',
  'development_order_frozen_at',
  'requirements_frozen_at',
  'phase_3_9',
];

export type CheckResult = {
  id: string;
  status: 'pass' | 'fail' | 'warn' | 'skipped';
  reason?: string;
  // Alias for `id` — older callers (orchestrator.ts) used `gate_check_id`.
  // Kept for backward compat during the field rename.
  gate_check_id?: string;
  // Optional structured detail for failing checks.
  detail?: any;
};

/**
 * Helper used by exhaustive switch statements. If TypeScript ever sees a
 * {@link KnownCheckType} that isn't handled by the switch, it will refuse to
 * compile because the value is no longer narrowed to `never`.
 */
function assertNever(value: never): never {
  throw new Error(`Unhandled known check type: ${String(value)}`);
}

/**
 * Evaluates Gate Cards to determine whether a phase or sub-phase may be
 * entered. Behaviour is fail-closed: any check the evaluator does not
 * explicitly handle becomes a `fail` result with a human-readable reason.
 *
 * Supported types: artifact_exists, artifact_metadata, dependency_status,
 * user_confirmation, all_stories_complete, scope_boundary, field_exists,
 * custom_check.
 */
export class GateEvaluator {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Evaluate a full Gate Card. Returns `{ all_pass, results }`.
   */
  async evaluate(
    gateCard: GateCard,
    state: SprintStatusManager,
    options?: { storyId?: string; track?: Track; executionMode?: 'auto' | 'interactive' }
  ): Promise<{ all_pass: boolean; results: CheckResult[] }> {
    const results = await Promise.all(
      gateCard.checks.map(check => this.evaluateCheck(check, state, options))
    );
    const all_pass = results.every(r => r.status === 'pass');

    // Audit each check result so reviewers can see exactly which gate fired.
    for (const r of results) {
      appendAudit(this.projectRoot, 'gate_check', {
        status: r.status === 'pass' ? 'pass' : r.status === 'fail' ? 'fail' : 'info',
        message: r.reason ?? `${r.id}: ${r.status}`,
        story_id: options?.storyId,
        details: { check_id: r.id, phase: gateCard.phase, sub_phase: gateCard.sub_phase, track: options?.track },
      });
    }

    return { all_pass, results };
  }

  private async evaluateCheck(
    check: GateCheck,
    state: SprintStatusManager,
    options?: { storyId?: string; track?: Track; executionMode?: 'auto' | 'interactive' }
  ): Promise<CheckResult> {
    try {
      // Reject unknown check types up-front. No silent pass.
      if (!KNOWN_CHECK_TYPES.has(check.type)) {
        return {
          id: check.id,
          status: 'fail',
          reason: `Unknown check type: ${check.type}`,
        };
      }

      const knownType = check.type as KnownCheckType;

      switch (knownType) {
        case 'artifact_exists':
          return this.checkArtifactExists(check);

        case 'artifact_metadata':
          return this.checkArtifactMetadata(check);

        case 'artifact_checksum':
          return this.checkArtifactChecksum(check);

        case 'dependency_status':
          return this.checkDependencyStatus(check, state);

        case 'user_confirmation': {
          // Auto-degrade path: when a check is explicitly marked
          // `allow_auto_degrade: true` AND the workflow execution_mode is
          // "auto", the confirmation passes without an interactive prompt.
          // Critical confirmations (default) stay fail-closed.
          const autoDegradeOK =
            check.allow_auto_degrade === true &&
            options?.executionMode === 'auto';
          if (autoDegradeOK) {
            return {
              id: check.id,
              status: 'pass',
              reason:
                'Auto-degraded (allow_auto_degrade=true, execution_mode=auto) — interactive confirmation waived',
            };
          }
          // Fail-closed default: every user_confirmation without an explicit
          // authorization record fails instead of silently passing. This is
          // the contract that lets production gates stay interactive.
          return {
            id: check.id,
            status: 'fail',
            reason: options?.executionMode === 'auto'
              ? `User confirmation required — gate is not marked allow_auto_degrade=true, so auto-mode cannot waive it`
              : 'User confirmation required and no explicit authorization was provided',
          };
        }

        case 'all_stories_complete':
          return this.checkAllStoriesComplete(state, options);

        case 'scope_boundary':
          return this.checkScopeBoundary(check, state, options);

        case 'quality_threshold':
          return this.checkQualityThreshold(check, state);

        case 'field_exists':
          return this.checkFieldExists(check);

        case 'traceability_complete':
          return this.checkTraceabilityComplete(check);

        case 'custom_check':
          return this.checkCustom(check);

        default:
          // Exhaustiveness guard — if KnownCheckType gains a new member and
          // this switch isn't updated, the project will fail to compile.
          return assertNever(knownType);
      }
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      return { id: check.id, status: 'fail', reason };
    }
  }

  private checkArtifactExists(check: GateCheck): CheckResult {
    const source = check.target ?? check.source ?? '';
    if (!source) {
      return {
        id: check.id,
        status: 'fail',
        reason: 'artifact_exists: no target/source specified',
      };
    }
    const path = resolve(this.projectRoot, source);
    const exists = existsSync(path);
    return {
      id: check.id,
      status: exists ? 'pass' : 'fail',
      reason: exists ? undefined : `Artifact not found: ${source}`,
    };
  }

  private checkArtifactMetadata(check: GateCheck): CheckResult {
    const source = check.target ?? check.source ?? '';
    if (!source) {
      return {
        id: check.id,
        status: 'fail',
        reason: 'artifact_metadata: no target/source specified',
      };
    }
    const path = resolve(this.projectRoot, source);
    if (!existsSync(path)) {
      return { id: check.id, status: 'fail', reason: `File not found: ${source}` };
    }
    const content = readFileSync(path, 'utf-8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return { id: check.id, status: 'fail', reason: `No frontmatter in: ${source}` };
    }
    const frontmatter = YAML.load(frontmatterMatch[1]) as Record<string, unknown>;

    // Support nested field access via dot notation
    const field = check.target ?? 'status';
    const parts = field.split('.');
    let value: unknown = frontmatter;
    for (const part of parts) {
      if (value == null || typeof value !== 'object') {
        value = undefined;
        break;
      }
      value = (value as Record<string, unknown>)[part];
    }

    const expected = check.expected;
    const pass = Array.isArray(expected) ? expected.includes(value) : value === expected;
    return {
      id: check.id,
      status: pass ? 'pass' : 'fail',
      reason: pass
        ? undefined
        : `${source} field ${field}="${String(value)}", expected ${JSON.stringify(expected)}`,
    };
  }

  /**
   * dependency_status checks read against {@link SprintStatusManager}. Only
   * the four fields enumerated in {@link SUPPORTED_DEPENDENCY_FIELDS} are
   * implemented. Anything else — including unsupported operators (`eq`,
   * `neq`, etc.) — fails with an explicit reason. There is no catch-all
   * "not yet implemented" pass any longer.
   */
  private checkDependencyStatus(
    check: GateCheck,
    state: SprintStatusManager
  ): CheckResult {
    const gs = state.data.global_state;
    const field = check.field ?? '';

    if (!field) {
      return {
        id: check.id,
        status: 'fail',
        reason: 'dependency_status: missing field',
      };
    }

    if (field.includes('phase_3.status')) {
      if (check.expected !== 'LOCKED') {
        return {
          id: check.id,
          status: 'fail',
          reason: `dependency_status phase_3.status: unsupported expected value ${JSON.stringify(check.expected)} (only "LOCKED" is implemented)`,
        };
      }
      const status = state.getPhase(3)?.status;
      return {
        id: check.id,
        status: status === 'LOCKED' ? 'pass' : 'fail',
        reason:
          status === 'LOCKED'
            ? undefined
            : `Phase 3 status is "${status}", expected "LOCKED"`,
      };
    }

    if (field.includes('development_order_frozen_at')) {
      if (check.expected !== null) {
        return {
          id: check.id,
          status: 'fail',
          reason: `dependency_status development_order_frozen_at: unsupported expected value ${JSON.stringify(check.expected)} (only "null" — i.e. presence — is implemented)`,
        };
      }
      const pass = gs.development_order_frozen_at != null;
      return {
        id: check.id,
        status: pass ? 'pass' : 'fail',
        reason: pass ? undefined : 'Development order not frozen',
      };
    }

    if (field.includes('requirements_frozen_at')) {
      if (check.expected !== null) {
        return {
          id: check.id,
          status: 'fail',
          reason: `dependency_status requirements_frozen_at: unsupported expected value ${JSON.stringify(check.expected)} (only "null" — i.e. presence — is implemented)`,
        };
      }
      const pass = gs.requirements_frozen_at != null;
      return {
        id: check.id,
        status: pass ? 'pass' : 'fail',
        reason: pass ? undefined : 'Requirements not frozen',
      };
    }

    if (field.includes('phase_3_9')) {
      if (check.expected !== 'LOCKED') {
        return {
          id: check.id,
          status: 'fail',
          reason: `dependency_status phase_3_9: unsupported expected value ${JSON.stringify(check.expected)} (only "LOCKED" is implemented)`,
        };
      }
      const status = state.getSubState(3, 'phase_3_9');
      return {
        id: check.id,
        status: status === 'LOCKED' ? 'pass' : 'fail',
        reason:
          status === 'LOCKED'
            ? undefined
            : `Phase 3.9 status is "${status}", expected "LOCKED"`,
      };
    }

    // No supported field matched — fail-closed instead of falling through
    // to an unsupported-operator branch. The eq/neq operators are handled by
    // the field-specific branches above; if execution reaches here, neither
    // the field nor the operator is implemented.
    const op = check.operator ? ` (operator "${check.operator}")` : '';
    return {
      id: check.id,
      status: 'fail',
      reason: `dependency_status: field "${field}"${op} is not implemented. Supported fields: ${SUPPORTED_DEPENDENCY_FIELDS.join(', ')}`,
    };
  }

  private checkAllStoriesComplete(
    state: SprintStatusManager,
    options?: { storyId?: string; track?: Track }
  ): CheckResult {
    const phase = state.getPhase(4);
    const substates = phase?.substates;

    if (!substates) {
      return { id: 'ALL_STORIES', status: 'fail', reason: 'No substates found' };
    }

    const targetSubKey =
      options?.track === 'backend'
        ? 'phase_4_4'
        : options?.track === 'frontend'
        ? 'phase_4_10'
        : null;

    if (targetSubKey && substates[targetSubKey]?.stories) {
      const stories = substates[targetSubKey].stories!;
      const terminalStates = [
        'CODE_ACCEPTED',
        'FEATURE_ACCEPTED',
        'UI_ACCEPTED',
        'E2E_BROWSER_ACCEPTED',
        'MERGED',
      ];
      const nonBlocked = stories.filter(
        (s: { status: string }) => s.status !== 'BLOCKED_BY_DEPENDENCY'
      );
      const allDone = nonBlocked.every((s: { status: string }) =>
        terminalStates.includes(s.status)
      );
      const remaining =
        nonBlocked.length -
        nonBlocked.filter((s: { status: string }) => terminalStates.includes(s.status)).length;
      return {
        id: 'ALL_STORIES',
        status: allDone ? 'pass' : 'fail',
        reason: allDone ? undefined : `${remaining} stories not yet accepted`,
      };
    }

    // Track not specified or no stories registered for the relevant
    // sub-phase: fail-closed rather than silently passing.
    return {
      id: 'ALL_STORIES',
      status: 'fail',
      reason: targetSubKey
        ? `No stories registered for ${targetSubKey}`
        : 'all_stories_complete: track option is required',
    };
  }

  private checkScopeBoundary(
    check: GateCheck,
    state: SprintStatusManager,
    _options?: { storyId?: string }
  ): CheckResult {
    const boundary = state.data.global_state.implementation_boundary;
    if (!boundary || !boundary.scope_frozen) {
      return {
        id: check.id,
        status: 'fail',
        reason: 'Implementation boundary not frozen',
      };
    }
    return { id: check.id, status: 'pass' };
  }

  /**
   * field_exists fails when the named field is missing from the source
   * artifact. The legacy implementation always passed; that silent pass is
   * removed.
   *
   * The story runner is still responsible for resolving `source: story_file`
   * placeholders when it knows the active story file. If the source cannot
   * be resolved here (no file path / placeholder unresolved), the check
   * fails-closed with a clear reason.
   */
  private checkFieldExists(check: GateCheck): CheckResult {
    const source = check.source;
    const field = check.field;

    if (!field) {
      return {
        id: check.id,
        status: 'fail',
        reason: 'field_exists: missing field',
      };
    }

    if (!source || source === 'story_file') {
      return {
        id: check.id,
        status: 'fail',
        reason: `field_exists: source "${source ?? 'undefined'}" cannot be resolved at gate-evaluator level`,
      };
    }

    const path = resolve(this.projectRoot, source);
    if (!existsSync(path)) {
      return {
        id: check.id,
        status: 'fail',
        reason: `field_exists: source not found: ${source}`,
      };
    }

    const content = readFileSync(path, 'utf-8');
    let parsed: Record<string, unknown> | null = null;
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    try {
      if (frontmatterMatch) {
        parsed = YAML.load(frontmatterMatch[1]) as Record<string, unknown>;
      } else {
        parsed = YAML.load(content) as Record<string, unknown>;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        id: check.id,
        status: 'fail',
        reason: `field_exists: failed to parse ${source}: ${msg}`,
      };
    }

    if (parsed == null || typeof parsed !== 'object') {
      return {
        id: check.id,
        status: 'fail',
        reason: `field_exists: ${source} did not parse to an object`,
      };
    }

    const parts = field.split('.');
    let value: unknown = parsed;
    for (const part of parts) {
      if (value == null || typeof value !== 'object') {
        return {
          id: check.id,
          status: 'fail',
          reason: `field_exists: ${field} missing in ${source}`,
        };
      }
      value = (value as Record<string, unknown>)[part];
    }

    if (value === undefined) {
      return {
        id: check.id,
        status: 'fail',
        reason: `field_exists: ${field} missing in ${source}`,
      };
    }

    if (Array.isArray(value) && value.length === 0) {
      return {
        id: check.id,
        status: 'fail',
        reason: `field_exists: ${field} is empty in ${source}`,
      };
    }

    return { id: check.id, status: 'pass' };
  }

  /**
   * artifact_checksum verifies file integrity by comparing cryptographic hashes.
   * Supports md5, sha1, sha256, sha512 algorithms.
   */
  private checkArtifactChecksum(check: GateCheck): CheckResult {
    const source = check.target ?? check.source ?? '';
    const expected = check.expected;
    const algorithm = (check.algorithm as string) || 'sha256';

    if (!source) {
      return {
        id: check.id,
        status: 'fail',
        reason: 'artifact_checksum: no target/source specified',
      };
    }
    if (!expected) {
      return {
        id: check.id,
        status: 'fail',
        reason: 'artifact_checksum: no expected hash provided',
      };
    }

    const validAlgorithms = ['md5', 'sha1', 'sha256', 'sha512'];
    if (!validAlgorithms.includes(algorithm)) {
      return {
        id: check.id,
        status: 'fail',
        reason: `artifact_checksum: unsupported algorithm "${algorithm}". Valid: ${validAlgorithms.join(', ')}`,
      };
    }

    const path = resolve(this.projectRoot, source);
    if (!existsSync(path)) {
      return {
        id: check.id,
        status: 'fail',
        reason: `artifact_checksum: file not found: ${source}`,
      };
    }

    const content = readFileSync(path);
    const actual = createHash(algorithm).update(content).digest('hex');

    const pass = actual.toLowerCase() === String(expected).toLowerCase();
    return {
      id: check.id,
      status: pass ? 'pass' : 'fail',
      reason: pass
        ? undefined
        : `artifact_checksum: ${source} hash mismatch (${algorithm}). Expected: ${expected}, Actual: ${actual}`,
    };
  }

  /**
   * quality_threshold validates numeric quality metrics against thresholds.
   * Supports test coverage, lint issues, type errors, bundle size, etc.
   */
  private checkQualityThreshold(
    check: GateCheck,
    state: SprintStatusManager
  ): CheckResult {
    const metric = check.metric as string;
    const threshold = check.threshold as number;
    const operator = (check.operator as string) || 'gte';

    if (!metric) {
      return {
        id: check.id,
        status: 'fail',
        reason: 'quality_threshold: no metric specified',
      };
    }
    if (threshold === undefined || threshold === null) {
      return {
        id: check.id,
        status: 'fail',
        reason: 'quality_threshold: no threshold value specified',
      };
    }

    // Try to get metric value from state or fall back to reading from file
    let actual: number | null = null;
    const metrics = state.data.global_state.quality_metrics as Record<string, number> | undefined;

    if (metrics && metrics[metric] !== undefined) {
      actual = metrics[metric];
    } else if (check.source) {
      // Try reading from a metrics JSON/YAML file
      const path = resolve(this.projectRoot, check.source);
      if (existsSync(path)) {
        try {
          const content = readFileSync(path, 'utf-8');
          const data = JSON.parse(content) as Record<string, unknown>;
          if (data[metric] !== undefined && typeof data[metric] === 'number') {
            actual = data[metric] as number;
          }
        } catch {
          // Fall through to null handling
        }
      }
    }

    if (actual === null) {
      return {
        id: check.id,
        status: 'fail',
        reason: `quality_threshold: metric "${metric}" not found in state or source file`,
      };
    }

    let pass = false;
    switch (operator) {
      case 'gte':
        pass = actual >= threshold;
        break;
      case 'gt':
        pass = actual > threshold;
        break;
      case 'lte':
        pass = actual <= threshold;
        break;
      case 'lt':
        pass = actual < threshold;
        break;
      case 'eq':
        pass = actual === threshold;
        break;
      case 'neq':
        pass = actual !== threshold;
        break;
      default:
        return {
          id: check.id,
          status: 'fail',
          reason: `quality_threshold: unsupported operator "${operator}". Valid: gte, gt, lte, lt, eq, neq`,
        };
    }

    return {
      id: check.id,
      status: pass ? 'pass' : 'fail',
      reason: pass
        ? undefined
        : `quality_threshold: ${metric} = ${actual} ${operator} ${threshold} failed`,
    };
  }

  /**
   * Cross-artifact traceability gate. Builds the project-wide
   * JTBD→REQ→STORY→TEST graph and asserts every STORY links back to a
   * REQ, every REQ is covered by ≥1 STORY, and every STORY has ≥1
   * covering TEST. This is the entry gate for Phase 4 (no implementation
   * may begin until traceability is complete).
   */
  private checkTraceabilityComplete(check: GateCheck): CheckResult {
    const result = evaluateTraceabilityGate(this.projectRoot);
    if (result.ok) {
      return {
        id: check.id,
        status: 'pass',
        reason: `${result.totals.requirements} REQ / ${result.totals.stories} STORY / ${result.totals.tests} TEST — fully linked`,
      };
    }
    return {
      id: check.id,
      status: 'fail',
      reason: formatTraceabilityResult(result),
    };
  }

  /**
   * Custom checks (e.g. SRG-05 scope overlap, SRG-07 parent-dirs-exist) are
   * verified at the story-runner level — the gate evaluator records them
   * as `pass` with an explicit "delegated" reason so the audit trail makes
   * it clear the gate did not perform the verification itself. This is an
   * explicit, documented check type, not a catch-all default.
   */
  private checkCustom(check: GateCheck): CheckResult {
    return {
      id: check.id,
      status: 'pass',
      reason: `Custom check delegated to story runner: ${check.description}`,
    };
  }
}
