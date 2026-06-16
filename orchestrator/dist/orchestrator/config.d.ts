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
export type DevMode = 'separated' | 'full_stack';
export type TriageMode = 'light' | 'serial' | 'parallel' | 'auto';
export interface WorkflowSection {
    version: string;
    dev_mode: DevMode;
    default_frontend_framework?: string;
    default_backend_framework?: string;
    default_database?: string;
    default_api_style?: string;
    default_auth_method?: string;
    default_deployment_target?: string;
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
    bmad_skill_fallbacks?: Record<string, any>;
    [extra: string]: any;
}
export declare const DEFAULT_CONFIG: WorkflowConfig;
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
export declare function parseToml(content: string): Record<string, any>;
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
 *   3. {projectRoot}/_bmad/custom/web-dev-flow.toml (team)
 *   4. {projectRoot}/_bmad/custom/web-dev-flow.user.toml (user)
 */
export declare function loadConfig(projectRoot: string, opts?: LoadConfigOptions): LoadConfigResult;
/**
 * Resolve a templated path. Replaces {project-root} and ~ tokens with absolute paths.
 */
export declare function resolvePath(template: string, projectRoot: string): string;
/** Get absolute output_dir. */
export declare function getOutputDir(config: WorkflowConfig, projectRoot: string): string;
/** Get absolute sprint-status.yaml path. */
export declare function getSprintTrackingPath(config: WorkflowConfig, projectRoot: string): string;
/** Get absolute status/ directory path. */
export declare function getStatusDir(config: WorkflowConfig, projectRoot: string): string;
/** Get absolute stories/ directory path. */
export declare function getStoriesDir(config: WorkflowConfig, projectRoot: string): string;
/** Get absolute audit log directory (sibling to sprint-status). */
export declare function getAuditDir(config: WorkflowConfig, projectRoot: string): string;
/** Get absolute merge-queue items directory. */
export declare function getMergeQueueDir(config: WorkflowConfig, projectRoot: string): string;
/** Get absolute signal directory (typically outside any worktree). */
export declare function getSignalDir(config: WorkflowConfig, _projectRoot: string): string;
//# sourceMappingURL=config.d.ts.map