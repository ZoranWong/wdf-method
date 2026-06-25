import { existsSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { homedir } from 'os';

/**
 * Unified configuration loader for wdf-method V3.6.
 *
 * Single source of truth for all paths, thresholds, and policies declared
 * in customize.toml. Source files MUST go through this module instead of
 * hardcoding strings like '_bmad-output', 'web-dev-flow', 'status', etc.
 *
 * Layers (highest to lowest precedence):
 *   1. Project override:  <project-root>/_bmad/custom/web-dev-flow.user.toml
 *   2. Team override:     <project-root>/_bmad/custom/web-dev-flow.toml
 *   3. Skill base:        <skill-root>/customize.toml
 *   4. Built-in defaults  (this file)
 */

// ─────────────────────────────────────────
// Type definitions
// ─────────────────────────────────────────

export type DevMode = 'separated' | 'full_stack';
export type TriageMode = 'light' | 'serial' | 'parallel' | 'auto';

export interface WorkflowSection {
  version: string;
  dev_mode: DevMode;

  // Tech stack defaults
  default_frontend_framework?: string;
  default_backend_framework?: string;
  default_database?: string;
  default_api_style?: string;
  default_auth_method?: string;
  default_deployment_target?: string;

  // Output paths (templated with {project-root})
  output_dir: string;
  prd_output?: string;
  research_output?: string;
  architecture_output?: string;
  api_spec_output?: string;
  db_schema_output?: string;
  epics_output?: string;
  stories_output: string;
  sprint_tracking: string;
  integration_output?: string;
  sprint_plan_output?: string;

  // V3.6 Status directory split-file
  status_dir: string;
  status_global_file?: string;
  status_phase_01_file?: string;
  status_phase_02_file?: string;
  status_phase_03_file?: string;
  status_phase_04_be_file?: string;
  status_phase_04_fe_file?: string;
  status_change_requests_file?: string;
  status_stories_dir?: string;
  status_merge_queue_dir?: string;

  // Phase C (V3.10.3): auto-dispatch mode. When true, the loop engine
  // populates next_dispatch with an explicit agent_role + manifest_path
  // recommendation and downstream-stage manifests auto-inject upstream
  // artifacts (dev files_changed, acceptance_check list, prior reports).
  // Default false to preserve existing manual-dispatch UX.
  auto_dispatch?: boolean;

  // Stage 1: requirement-quality checklist (CHK###) gate.
  // checklists_output overrides the default `_wdf_output/checklists` dir.
  // req_quality_gate, when true, makes the Story Ready Gate refuse dispatch
  // unless every CHK item in the story's checklist is `[x]`.
  checklists_output?: string;
  req_quality_gate?: boolean;
  checklist?: {
    scope_max_files?: number;
    ac_min_count?: number;
  };

  // Phase outputs (any other *_output keys)
  [extra: string]: any;
}

export interface AcceptanceGatesSection {
  code_acceptance_min_coverage: number;
  code_acceptance_require_lint: boolean;
  code_acceptance_require_type_check: boolean;
  ui_acceptance_min_lighthouse_performance: number;
  ui_acceptance_min_lighthouse_accessibility: number;
  ui_acceptance_min_lighthouse_best_practices: number;
  ui_acceptance_max_bundle_size_kb: number;
  ui_acceptance_require_axe_audit: boolean;
  feature_acceptance_require_contract_compliance: boolean;
  feature_acceptance_require_e2e_tests: boolean;
  feature_acceptance_require_security_audit: boolean;
  e2e_browser_acceptance_browsers: string[];
  e2e_browser_acceptance_visual_diff_threshold_pct: number;
}

export interface ScopeLockSection {
  enabled: boolean;
  enforcement_mode: 'strict' | 'permissive' | 'warning_only';
  srg_05_severity: 'blocking' | 'warning';
  scope_expansion_requires: 'user_approval' | 'auto_approve';
  forbidden_paths: string[];
  protected_paths: string[];
}

export interface MergeQueueSection {
  enabled: boolean;
  auto_promote_on_deps_met: boolean;
  integration_check_on_merge: boolean;
  default_integration_checks: string[];
  merge_order_increment: number;
  lock_timeout_seconds: number;
  stale_lock_cleanup_seconds: number;
  constitution_check: boolean;
}

export interface ChangeRequestSection {
  enabled: boolean;
  blocking_stops_phase: boolean;
  non_blocking_deferred_to: string;
  max_open_blocking_crs: number;
}

export interface AutoRunSection {
  enabled: boolean;
  auto_progress_phases: boolean;
  auto_skip_optional_sub_phases: boolean;
  halt_on_gate_failure: boolean;
  halt_on_acceptance_failure: boolean;
  max_story_retries: number;
  continuous_scope_validation: boolean;
  cross_story_validation: boolean;
  auto_skip?: Record<string, string>;
  merge_queue?: {
    auto_process: boolean;
    auto_retry_failed_merges: number;
    pre_merge_integration_check: boolean;
    integration_checks: string[];
  };
  concurrency?: {
    max_concurrent_stories: number;
    story_agent_timeout_minutes: number;
    dependency_wait_timeout_minutes: number;
  };
}

export interface AgentCommunicationSection {
  enabled: boolean;
  signal_dir: string;
  heartbeat_interval_seconds: number;
  pause_timeout_seconds: number;
  heartbeat_timeout_seconds: number;
  cleanup_on_complete: boolean;
}

export interface DefaultsSection {
  default_code_standards_source: string[];
  default_acceptance_checks_require_executable: boolean;
  task_triage_mode: TriageMode;
}

export interface AcceptanceCheckSafetySection {
  enabled: boolean;
  enforcement: 'blocking' | 'warning';
  allowed_prefixes: string[];
  forbidden_patterns: string[];
  allowed_exceptions: string[];
}

export interface SemanticGateSection {
  /**
   * Master switch for cross-artifact semantic validation.
   *
   * When true (default):
   *   - `wdf check` (project-wide / --phase mode) surfaces the four semantic
   *     rules (REQ_COVERAGE, API_SCOPE_MAPPING, DB_API_CONSISTENCY,
   *     AC_TEST_BINDING) as advisory warnings — meaning, not just per-file form.
   *   - The Phase 3.9 → Phase 4 entry gate runs those four rules + the
   *     traceability gate + per-story checklist verify as a FAIL-CLOSED gate:
   *     a project with semantic gaps cannot enter implementation.
   *
   * Set to false to opt out (legacy / in-flight projects that have not yet
   * migrated to Story Pack v1.0). Opt-out removes the hard gate AND the
   * advisory `wdf check` findings.
   */
  enabled: boolean;
}

export interface SpecsSection {
  // v3.8.x: false (PRD remained canonical; reverse sync bootstrapped specs/)
  // v3.9.0 (CHG-2026-015 S6): flipped to true (specs/ becomes source; forward sync overwrites PRD)
  source_of_truth: boolean;
  specs_dir: string;
  default_sync_direction: 'forward' | 'reverse';
  managed_region_marker: string;
  enforce_unique_requirement_names: boolean;
  // S3: paths to derived artifacts that forward-sync regenerates
  api_spec_path?: string;
  db_schema_path?: string;
}

export interface WorkflowConfig {
  workflow: WorkflowSection;
  acceptance_gates: AcceptanceGatesSection;
  scope_lock: ScopeLockSection;
  merge_queue: MergeQueueSection;
  change_request: ChangeRequestSection;
  auto_run: AutoRunSection;
  agent_communication: AgentCommunicationSection;
  defaults: DefaultsSection;
  acceptance_check_safety: AcceptanceCheckSafetySection;
  specs: SpecsSection;
  semantic_gate: SemanticGateSection;
  bmad_skill_fallbacks?: Record<string, any>;
  // Catch-all for unknown sections
  [extra: string]: any;
}

// ─────────────────────────────────────────
// Built-in defaults
// ─────────────────────────────────────────

const DEFAULT_OUTPUT_BASE = '_wdf_output';

export const DEFAULT_CONFIG: WorkflowConfig = {
  workflow: {
    version: '3.6.0',
    dev_mode: 'separated',
    output_dir: `{project-root}/${DEFAULT_OUTPUT_BASE}`,
    sprint_tracking: `{project-root}/${DEFAULT_OUTPUT_BASE}/sprint-status.yaml`,
    stories_output: `{project-root}/${DEFAULT_OUTPUT_BASE}/stories`,
    status_dir: `{project-root}/${DEFAULT_OUTPUT_BASE}/status`,
  },
  acceptance_gates: {
    code_acceptance_min_coverage: 80,
    code_acceptance_require_lint: true,
    code_acceptance_require_type_check: true,
    ui_acceptance_min_lighthouse_performance: 90,
    ui_acceptance_min_lighthouse_accessibility: 90,
    ui_acceptance_min_lighthouse_best_practices: 90,
    ui_acceptance_max_bundle_size_kb: 500,
    ui_acceptance_require_axe_audit: true,
    feature_acceptance_require_contract_compliance: true,
    feature_acceptance_require_e2e_tests: true,
    feature_acceptance_require_security_audit: true,
    e2e_browser_acceptance_browsers: ['chrome', 'firefox', 'safari'],
    e2e_browser_acceptance_visual_diff_threshold_pct: 0.5,
  },
  scope_lock: {
    enabled: true,
    enforcement_mode: 'strict',
    srg_05_severity: 'blocking',
    scope_expansion_requires: 'user_approval',
    forbidden_paths: [
      '/etc/', '~/.ssh/', '~/.aws/',
      '.env.production', '.env.local', '.env.development', '.env.staging',
      '.git/', 'node_modules/',
    ],
    protected_paths: [],
  },
  merge_queue: {
    enabled: true,
    auto_promote_on_deps_met: true,
    integration_check_on_merge: true,
    default_integration_checks: ['npm run test', 'npm run build'],
    merge_order_increment: 10,
    lock_timeout_seconds: 5,
    stale_lock_cleanup_seconds: 60,
    constitution_check: true,
  },
  change_request: {
    enabled: true,
    blocking_stops_phase: true,
    non_blocking_deferred_to: 'phase_4',
    max_open_blocking_crs: 5,
  },
  auto_run: {
    enabled: true,
    auto_progress_phases: true,
    auto_skip_optional_sub_phases: true,
    halt_on_gate_failure: true,
    halt_on_acceptance_failure: true,
    max_story_retries: 2,
    continuous_scope_validation: true,
    cross_story_validation: true,
    merge_queue: {
      auto_process: true,
      auto_retry_failed_merges: 1,
      pre_merge_integration_check: true,
      integration_checks: ['npm run test', 'npm run build', 'npm run type-check'],
    },
    concurrency: {
      max_concurrent_stories: 5,
      story_agent_timeout_minutes: 30,
      dependency_wait_timeout_minutes: 15,
    },
  },
  agent_communication: {
    enabled: true,
    // Default lives outside any worktree so cross-worktree signaling works.
    signal_dir: '~/.wdf-method/signals',
    heartbeat_interval_seconds: 30,
    pause_timeout_seconds: 300,
    heartbeat_timeout_seconds: 120,
    cleanup_on_complete: true,
  },
  defaults: {
    default_code_standards_source: ['AGENTS.md'],
    default_acceptance_checks_require_executable: true,
    task_triage_mode: 'auto',
  },
  acceptance_check_safety: {
    enabled: true,
    enforcement: 'blocking',
    allowed_prefixes: [],
    forbidden_patterns: [],
    allowed_exceptions: [],
  },
  specs: {
    // CHG-2026-015 S6: flipped to true for v3.9.0 enforcement.
    source_of_truth: true,
    specs_dir: `{project-root}/${DEFAULT_OUTPUT_BASE}/specs`,
    default_sync_direction: 'reverse',
    managed_region_marker: 'wdf:specs-sync',
    enforce_unique_requirement_names: true,
    api_spec_path: `{project-root}/${DEFAULT_OUTPUT_BASE}/api-spec.yaml`,
    db_schema_path: `{project-root}/${DEFAULT_OUTPUT_BASE}/db-schema.md`,
  },
  semantic_gate: {
    enabled: true,
  },
};

// ─────────────────────────────────────────
// Minimal TOML parser (handles customize.toml structure)
// ─────────────────────────────────────────

/**
 * Parses a subset of TOML sufficient for customize.toml:
 * - [section] and [section.subsection] headers
 * - key = "string"
 * - key = true | false
 * - key = number
 * - key = ["a", "b"] (single-line arrays only)
 * - Comments starting with #
 * - Multi-line arrays with each entry on its own line
 */
export function parseToml(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  let currentSection: Record<string, any> = result;
  const lines = content.split('\n');

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    i++;

    if (!trimmed || trimmed.startsWith('#')) continue;

    // Section header
    const sectionMatch = trimmed.match(/^\[(.+?)\]\s*(?:#.*)?$/);
    if (sectionMatch) {
      const path = sectionMatch[1].split('.');
      currentSection = result;
      for (const key of path) {
        if (!currentSection[key] || typeof currentSection[key] !== 'object') {
          currentSection[key] = {};
        }
        currentSection = currentSection[key];
      }
      continue;
    }

    // key = value (strip inline comments outside of quoted strings)
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+?)\s*$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    let valueStr = stripInlineComment(kvMatch[2]);

    // Multi-line array — accumulate until matching ']'
    if (valueStr.startsWith('[') && !valueStr.endsWith(']')) {
      const buf: string[] = [valueStr];
      while (i < lines.length) {
        const next = stripInlineComment(lines[i].trim());
        i++;
        buf.push(next);
        if (next.endsWith(']')) break;
      }
      valueStr = buf.join(' ');
    }

    currentSection[key] = parseTomlValue(valueStr);
  }

  return result;
}

function stripInlineComment(s: string): string {
  // Strip comments only when the # is outside a quoted string.
  let inStr = false;
  for (let j = 0; j < s.length; j++) {
    const c = s[j];
    if (c === '"' && (j === 0 || s[j - 1] !== '\\')) inStr = !inStr;
    if (!inStr && c === '#') return s.slice(0, j).trim();
  }
  return s.trim();
}

function parseTomlValue(raw: string): any {
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    // Split on commas at top-level (not inside quoted strings)
    const parts: string[] = [];
    let cur = '';
    let inStr = false;
    for (let k = 0; k < inner.length; k++) {
      const c = inner[k];
      if (c === '"' && (k === 0 || inner[k - 1] !== '\\')) inStr = !inStr;
      if (!inStr && c === ',') {
        parts.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts.filter(Boolean).map(p => parseTomlValue(p));
  }
  // Number?
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  // Fallback raw string (best-effort)
  return v;
}

// ─────────────────────────────────────────
// Loading
// ─────────────────────────────────────────

export interface LoadConfigOptions {
  /** Skill root containing customize.toml. Defaults to projectRoot. */
  skillRoot?: string;
  /** Suppress warnings about unread keys. */
  silent?: boolean;
}

export interface LoadConfigResult {
  config: WorkflowConfig;
  /** Warnings emitted during load (e.g. missing files, unknown keys). */
  warnings: string[];
  /** Resolved file paths, in load order (low → high precedence). */
  sources: string[];
}

/**
 * Load and merge configuration.
 *
 * Order (low → high precedence):
 *   1. Built-in DEFAULT_CONFIG
 *   2. {skillRoot}/customize.toml
 *   3. Active preset: {skillRoot}/presets/<name>.toml (C3 Extensions/Presets)
 *   4. {projectRoot}/_bmad/custom/web-dev-flow.toml (team)
 *   5. {projectRoot}/_bmad/custom/web-dev-flow.user.toml (user)
 */
/**
 * Whether cross-artifact semantic validation is enabled for this project.
 *
 * Resolution order:
 *   1. The project's own wdf.toml [semantic_gate] enabled — this is where
 *      `wdf init` writes and documents the flag, so it's the place users look.
 *      (loadConfig does NOT read wdf.toml — it reads the customize.toml /
 *      _bmad/custom chain — so we check wdf.toml explicitly here.)
 *   2. The layered config (customize.toml, _bmad/custom/*.toml).
 *   3. Default: enabled.
 *
 * Shared by `wdf check`'s advisory semantic pass (step 3) and the Phase 3.9 →
 * Phase 4 entry hard gate (step 2) so a single opt-out governs both.
 */
export function isSemanticGateEnabled(projectRoot: string): boolean {
  try {
    const wdfToml = join(projectRoot, 'wdf.toml');
    if (existsSync(wdfToml)) {
      const parsed = parseToml(readFileSync(wdfToml, 'utf8')) as any;
      const v = parsed?.semantic_gate?.enabled;
      if (v === false) return false;
      if (v === true) return true;
    }
  } catch {
    // Fall through to the layered config.
  }
  try {
    const { config } = loadConfig(projectRoot, { silent: true });
    return config.semantic_gate?.enabled !== false;
  } catch {
    return true;
  }
}

export function loadConfig(projectRoot: string, opts: LoadConfigOptions = {}): LoadConfigResult {
  const warnings: string[] = [];
  const sources: string[] = [];
  const skillRoot = opts.skillRoot ?? projectRoot;

  // Walk upward to find customize.toml if not found at skillRoot directly
  const candidatesRaw = [
    join(skillRoot, 'customize.toml'),
    join(projectRoot, 'customize.toml'),
    join(projectRoot, '_bmad', 'custom', 'web-dev-flow.toml'),
    join(projectRoot, '_bmad', 'custom', 'web-dev-flow.user.toml'),
  ];
  // Deduplicate (skillRoot may equal projectRoot)
  const seen = new Set<string>();
  const candidates = candidatesRaw.filter(p => {
    const r = resolve(p);
    if (seen.has(r)) return false;
    seen.add(r);
    return true;
  });

  let merged: any = deepClone(DEFAULT_CONFIG);

  // Find the boundary between skill-base paths and project-override paths.
  // The active preset is injected at that boundary (layer 3 of 5).
  // Heuristic: any path containing '_bmad' OR starting with projectRoot
  // (but not skillRoot's customize.toml) is a project override.
  const isProjectOverride = (p: string) =>
    p.includes('_bmad') ||
    resolve(p).startsWith(resolve(projectRoot) + '/');

  let presetInjected = false;
  let presetState: { active: any; preset: any } | null = null;
  const loadPresetState = () => {
    if (presetState !== null) return;
    try {
      // Sync access pattern: read active-preset.yaml + preset file directly.
      // Avoids async import + ESM/CJS boundary issues.
      const activePath = join(projectRoot, '_wdf_output', 'active-preset.yaml');
      if (!existsSync(activePath)) { presetState = { active: null, preset: null }; return; }
      const activeRaw = readFileSync(activePath, 'utf8');
      const activeMatch = activeRaw.match(/^preset:\s*(\S+)/m);
      const activeName = activeMatch ? activeMatch[1] : null;
      if (!activeName || activeName === 'null') { presetState = { active: null, preset: null }; return; }
      const presetPath = join(skillRoot, 'presets', `${activeName}.toml`);
      if (!existsSync(presetPath)) { presetState = { active: { preset: activeName }, preset: null }; return; }
      const presetParsed = parseToml(readFileSync(presetPath, 'utf8'));
      presetState = {
        active: { preset: activeName },
        preset: { path: presetPath, parsed: presetParsed },
      };
    } catch {
      presetState = { active: null, preset: null };
    }
  };
  const tryInjectPreset = () => {
    if (presetInjected) return;
    presetInjected = true;
    loadPresetState();
    if (presetState?.preset) {
      merged = deepMerge(merged, presetState.preset.parsed);
      sources.push(presetState.preset.path);
    }
  };

  // Layer 2: skill-base customize.toml
  for (const path of candidates) {
    // Inject preset (layer 3) right before the first project-override.
    if (isProjectOverride(path)) tryInjectPreset();
    if (!existsSync(path)) continue;
    try {
      const parsed = parseToml(readFileSync(path, 'utf-8'));
      merged = deepMerge(merged, parsed);
      sources.push(path);
    } catch (err: any) {
      warnings.push(`Failed to parse ${path}: ${err?.message ?? err}`);
    }
  }
  // If no project overrides were present, still inject preset (last chance).
  tryInjectPreset();

  // Validate required sections
  if (!merged.workflow?.output_dir) {
    warnings.push('workflow.output_dir is missing — using default _wdf_output');
    merged.workflow = merged.workflow ?? {};
    merged.workflow.output_dir = DEFAULT_CONFIG.workflow.output_dir;
  }
  if (!merged.workflow?.sprint_tracking) {
    warnings.push('workflow.sprint_tracking is missing — using default sprint-status.yaml');
    merged.workflow.sprint_tracking = DEFAULT_CONFIG.workflow.sprint_tracking;
  }
  if (!merged.workflow?.status_dir) {
    warnings.push('workflow.status_dir is missing — using default status/');
    merged.workflow.status_dir = DEFAULT_CONFIG.workflow.status_dir;
  }
  if (!merged.workflow?.stories_output) {
    warnings.push('workflow.stories_output is missing — using default stories/');
    merged.workflow.stories_output = DEFAULT_CONFIG.workflow.stories_output;
  }

  // Detect unrecognized top-level sections (informational only)
  const knownSections = new Set([
    'workflow', 'acceptance_gates', 'scope_lock', 'merge_queue',
    'change_request', 'auto_run', 'agent_communication', 'defaults',
    'acceptance_check_safety', 'bmad_skill_fallbacks', 'specs', 'semantic_gate',
  ]);
  for (const key of Object.keys(merged)) {
    if (!knownSections.has(key) && typeof merged[key] === 'object') {
      warnings.push(`Unknown top-level config section: [${key}] (ignored)`);
    }
  }

  if (!opts.silent && warnings.length > 0) {
    for (const w of warnings) console.warn(`[config] WARN: ${w}`);
  }

  return { config: merged as WorkflowConfig, warnings, sources };
}

// ─────────────────────────────────────────
// Path resolution helpers
// ─────────────────────────────────────────

/**
 * Resolve a templated path. Replaces {project-root} and ~ tokens with absolute paths.
 */
export function resolvePath(template: string, projectRoot: string): string {
  if (!template) return '';
  let p = template;
  if (p.includes('{project-root}')) {
    p = p.replace('{project-root}', projectRoot);
  }
  if (p.startsWith('~/')) {
    p = join(homedir(), p.slice(2));
  }
  if (p === '~') p = homedir();
  return resolve(projectRoot, p);
}

/** Get absolute output_dir. */
export function getOutputDir(config: WorkflowConfig, projectRoot: string): string {
  return resolvePath(config.workflow.output_dir, projectRoot);
}

/** Get absolute specs/ directory path (canonical BDD source of truth). */
export function getSpecsDir(config: WorkflowConfig, projectRoot: string): string {
  return resolvePath(config.specs.specs_dir, projectRoot);
}

/** S3: Get absolute api-spec.yaml path. */
export function getApiSpecPath(config: WorkflowConfig, projectRoot: string): string {
  return resolvePath(config.specs.api_spec_path ?? `{project-root}/_wdf_output/api-spec.yaml`, projectRoot);
}

/** S3: Get absolute db-schema.md path. */
export function getDbSchemaPath(config: WorkflowConfig, projectRoot: string): string {
  return resolvePath(config.specs.db_schema_path ?? `{project-root}/_wdf_output/db-schema.md`, projectRoot);
}

/** Get absolute sprint-status.yaml path. */
export function getSprintTrackingPath(config: WorkflowConfig, projectRoot: string): string {
  return resolvePath(config.workflow.sprint_tracking, projectRoot);
}

/** Get absolute status/ directory path. */
export function getStatusDir(config: WorkflowConfig, projectRoot: string): string {
  return resolvePath(config.workflow.status_dir, projectRoot);
}

/** Get absolute stories/ directory path. */
export function getStoriesDir(config: WorkflowConfig, projectRoot: string): string {
  return resolvePath(config.workflow.stories_output, projectRoot);
}

/** Get absolute audit log directory (sibling to sprint-status). */
export function getAuditDir(config: WorkflowConfig, projectRoot: string): string {
  return join(dirname(getSprintTrackingPath(config, projectRoot)), 'audit');
}

/** Get absolute merge-queue items directory. */
export function getMergeQueueDir(config: WorkflowConfig, projectRoot: string): string {
  if (config.workflow.status_merge_queue_dir) {
    return resolvePath(config.workflow.status_merge_queue_dir, projectRoot);
  }
  return join(getStatusDir(config, projectRoot), 'merge-queue');
}

/** Get absolute signal directory (typically outside any worktree). */
export function getSignalDir(config: WorkflowConfig, _projectRoot: string): string {
  const raw = config.agent_communication?.signal_dir ?? DEFAULT_CONFIG.agent_communication.signal_dir;
  if (raw.startsWith('~/')) return join(homedir(), raw.slice(2));
  if (raw === '~') return homedir();
  if (raw.startsWith('/')) return raw;
  return resolve(_projectRoot, raw);
}

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function deepMerge<T extends Record<string, any>>(base: T, override: Record<string, any>): T {
  const out: any = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
