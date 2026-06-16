import { existsSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { homedir } from 'os';
// ─────────────────────────────────────────
// Built-in defaults
// ─────────────────────────────────────────
const DEFAULT_OUTPUT_BASE = '_bmad-output/web-dev-flow';
export const DEFAULT_CONFIG = {
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
export function parseToml(content) {
    const result = {};
    let currentSection = result;
    const lines = content.split('\n');
    let i = 0;
    while (i < lines.length) {
        const raw = lines[i];
        const trimmed = raw.trim();
        i++;
        if (!trimmed || trimmed.startsWith('#'))
            continue;
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
        if (!kvMatch)
            continue;
        const key = kvMatch[1];
        let valueStr = stripInlineComment(kvMatch[2]);
        // Multi-line array — accumulate until matching ']'
        if (valueStr.startsWith('[') && !valueStr.endsWith(']')) {
            const buf = [valueStr];
            while (i < lines.length) {
                const next = stripInlineComment(lines[i].trim());
                i++;
                buf.push(next);
                if (next.endsWith(']'))
                    break;
            }
            valueStr = buf.join(' ');
        }
        currentSection[key] = parseTomlValue(valueStr);
    }
    return result;
}
function stripInlineComment(s) {
    // Strip comments only when the # is outside a quoted string.
    let inStr = false;
    for (let j = 0; j < s.length; j++) {
        const c = s[j];
        if (c === '"' && (j === 0 || s[j - 1] !== '\\'))
            inStr = !inStr;
        if (!inStr && c === '#')
            return s.slice(0, j).trim();
    }
    return s.trim();
}
function parseTomlValue(raw) {
    const v = raw.trim();
    if (v === 'true')
        return true;
    if (v === 'false')
        return false;
    if (v.startsWith('"') && v.endsWith('"')) {
        return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
    }
    if (v.startsWith('[') && v.endsWith(']')) {
        const inner = v.slice(1, -1).trim();
        if (!inner)
            return [];
        // Split on commas at top-level (not inside quoted strings)
        const parts = [];
        let cur = '';
        let inStr = false;
        for (let k = 0; k < inner.length; k++) {
            const c = inner[k];
            if (c === '"' && (k === 0 || inner[k - 1] !== '\\'))
                inStr = !inStr;
            if (!inStr && c === ',') {
                parts.push(cur.trim());
                cur = '';
            }
            else {
                cur += c;
            }
        }
        if (cur.trim())
            parts.push(cur.trim());
        return parts.filter(Boolean).map(p => parseTomlValue(p));
    }
    // Number?
    if (/^-?\d+(\.\d+)?$/.test(v))
        return Number(v);
    // Fallback raw string (best-effort)
    return v;
}
/**
 * Load and merge configuration.
 *
 * Order (low → high precedence):
 *   1. Built-in DEFAULT_CONFIG
 *   2. {skillRoot}/customize.toml
 *   3. {projectRoot}/_bmad/custom/web-dev-flow.toml (team)
 *   4. {projectRoot}/_bmad/custom/web-dev-flow.user.toml (user)
 */
export function loadConfig(projectRoot, opts = {}) {
    const warnings = [];
    const sources = [];
    const skillRoot = opts.skillRoot ?? projectRoot;
    // Walk upward to find customize.toml if not found at skillRoot directly
    const candidatesRaw = [
        join(skillRoot, 'customize.toml'),
        join(projectRoot, 'customize.toml'),
        join(projectRoot, '_bmad', 'custom', 'web-dev-flow.toml'),
        join(projectRoot, '_bmad', 'custom', 'web-dev-flow.user.toml'),
    ];
    // Deduplicate (skillRoot may equal projectRoot)
    const seen = new Set();
    const candidates = candidatesRaw.filter(p => {
        const r = resolve(p);
        if (seen.has(r))
            return false;
        seen.add(r);
        return true;
    });
    let merged = deepClone(DEFAULT_CONFIG);
    for (const path of candidates) {
        if (!existsSync(path))
            continue;
        try {
            const parsed = parseToml(readFileSync(path, 'utf-8'));
            merged = deepMerge(merged, parsed);
            sources.push(path);
        }
        catch (err) {
            warnings.push(`Failed to parse ${path}: ${err?.message ?? err}`);
        }
    }
    // Validate required sections
    if (!merged.workflow?.output_dir) {
        warnings.push('workflow.output_dir is missing — using default _bmad-output/web-dev-flow');
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
        'acceptance_check_safety', 'bmad_skill_fallbacks',
    ]);
    for (const key of Object.keys(merged)) {
        if (!knownSections.has(key) && typeof merged[key] === 'object') {
            warnings.push(`Unknown top-level config section: [${key}] (ignored)`);
        }
    }
    if (!opts.silent && warnings.length > 0) {
        for (const w of warnings)
            console.warn(`[config] WARN: ${w}`);
    }
    return { config: merged, warnings, sources };
}
// ─────────────────────────────────────────
// Path resolution helpers
// ─────────────────────────────────────────
/**
 * Resolve a templated path. Replaces {project-root} and ~ tokens with absolute paths.
 */
export function resolvePath(template, projectRoot) {
    if (!template)
        return '';
    let p = template;
    if (p.includes('{project-root}')) {
        p = p.replace('{project-root}', projectRoot);
    }
    if (p.startsWith('~/')) {
        p = join(homedir(), p.slice(2));
    }
    if (p === '~')
        p = homedir();
    return resolve(projectRoot, p);
}
/** Get absolute output_dir. */
export function getOutputDir(config, projectRoot) {
    return resolvePath(config.workflow.output_dir, projectRoot);
}
/** Get absolute sprint-status.yaml path. */
export function getSprintTrackingPath(config, projectRoot) {
    return resolvePath(config.workflow.sprint_tracking, projectRoot);
}
/** Get absolute status/ directory path. */
export function getStatusDir(config, projectRoot) {
    return resolvePath(config.workflow.status_dir, projectRoot);
}
/** Get absolute stories/ directory path. */
export function getStoriesDir(config, projectRoot) {
    return resolvePath(config.workflow.stories_output, projectRoot);
}
/** Get absolute audit log directory (sibling to sprint-status). */
export function getAuditDir(config, projectRoot) {
    return join(dirname(getSprintTrackingPath(config, projectRoot)), 'audit');
}
/** Get absolute merge-queue items directory. */
export function getMergeQueueDir(config, projectRoot) {
    if (config.workflow.status_merge_queue_dir) {
        return resolvePath(config.workflow.status_merge_queue_dir, projectRoot);
    }
    return join(getStatusDir(config, projectRoot), 'merge-queue');
}
/** Get absolute signal directory (typically outside any worktree). */
export function getSignalDir(config, _projectRoot) {
    const raw = config.agent_communication?.signal_dir ?? DEFAULT_CONFIG.agent_communication.signal_dir;
    if (raw.startsWith('~/'))
        return join(homedir(), raw.slice(2));
    if (raw === '~')
        return homedir();
    if (raw.startsWith('/'))
        return raw;
    return resolve(_projectRoot, raw);
}
// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────
function deepClone(v) {
    return JSON.parse(JSON.stringify(v));
}
function deepMerge(base, override) {
    const out = { ...base };
    for (const [k, v] of Object.entries(override)) {
        if (v !== null && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && !Array.isArray(out[k])) {
            out[k] = deepMerge(out[k], v);
        }
        else {
            out[k] = v;
        }
    }
    return out;
}
//# sourceMappingURL=config.js.map