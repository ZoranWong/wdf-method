// Type definitions for wdf-method V3.6 Orchestrator

export type PhaseStatus =
  | 'NOT_STARTED'
  | 'SKIPPED'
  | 'IN_PROGRESS'
  | 'DRAFT_COMPLETE'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'LOCKED'
  | 'BLOCKED'
  | 'UNLOCK_RESOLVE'
  | 'ALL_SUB_PHASES_APPROVED'
  | 'ANALYSIS_COMPLETE'
  | 'PLANNING_COMPLETE'
  | 'SOLUTIONING_COMPLETE'
  | 'CODE_ACCEPTANCE'
  | 'CODE_ACCEPTED'
  | 'FEATURE_ACCEPTANCE'
  | 'FEATURE_ACCEPTED'
  | 'UI_ACCEPTANCE'
  | 'UI_ACCEPTED'
  | 'E2E_BROWSER_ACCEPTANCE'
  | 'E2E_BROWSER_ACCEPTED'
  | 'BE_CODE_ACCEPTED'
  | 'FE_UI_ACCEPTED'
  | 'BE_TRACK_COMPLETE'
  | 'FE_TRACK_COMPLETE'
  | 'FULL_STACK_INTEGRATED'
  | 'MERGE_QUEUED'
  | 'MERGED'
  | 'BLOCKED_BY_DEPENDENCY'
  | 'FIX_RETRY'
  | 'PIPELINE_ESCALATED';  // retry budget exhausted — main agent must review

/** Pipeline stages for per-story dev→review→testing→QA flow */
export type PipelineStage = 'dev' | 'review' | 'testing' | 'qa';

export const PIPELINE_STAGES: PipelineStage[] = ['dev', 'review', 'testing', 'qa'];

/** Maximum fix attempts per stage before escalating to parent */
export const MAX_PIPELINE_RETRIES = 5;

export interface PipelineContext {
  stage: PipelineStage;
  attempt: number;          // 1-based, resets to 1 on each new stage
  total_retries: number;    // cumulative retries across all stages
  max_retries: number;      // 5 before escalation
  last_failure?: {
    stage: PipelineStage;
    error: string;
    at: string;
  };
  feedback?: string;        // feedback from review/testing/QA for dev-agent
}

export interface PipelineDispatchManifest {
  type: 'pipeline_dispatch';
  story_id: string;
  title: string;
  track: string;
  stage: PipelineStage;
  attempt: number;
  max_retries: number;
  scope_write: string[];
  acceptance_check: string[];
  worktree_path?: string;
  feedback?: string;
  prompt: string;
  previous_output?: {
    code_files?: string[];
    test_files?: string[];
    review_notes?: string;
    qa_report?: string;
  };
  /**
   * Permission scope the parent Claude session MUST inject into the host
   * `.claude/settings.local.json` before dispatching this sub-agent. Ensures
   * the sub-agent can run its acceptance checks without per-step prompts.
   * The injector tags each entry so it can be revoked after the story closes.
   */
  permissions?: DispatchPermissions;
}

/**
 * Permission scope attached to a dispatch manifest. Translated 1:1 to
 * Claude Code's `permissions.allow` / `permissions.deny` arrays.
 *
 * Bash entries use the form `Bash(<prefix>:*)` to match Claude Code's
 * permission grammar. File scope is implicit in `scope_write` (mapped to
 * `Edit(...)` / `Write(...)`).
 */
export interface DispatchPermissions {
  /** Bash command prefixes the sub-agent may run without prompting. */
  bash_allow?: string[];
  /** Bash command prefixes the sub-agent must NEVER run. */
  bash_deny?: string[];
  /** Read-only file globs the sub-agent may inspect beyond project root. */
  scope_read?: string[];
}

export interface PipelineEscalation {
  type: 'pipeline_escalation';
  story_id: string;
  title: string;
  track: string;
  failed_stage: PipelineStage;
  total_attempts: number;
  reason: string;
  recommendation: string;
  manifest_path: string;
  created_at: string;
}

/**
 * Pipeline stage-level dispatch configuration.
 * Used when a single story goes through dev→review→testing→QA
 * as separate agent dispatches rather than one monolithic agent.
 */
export interface PipelineStageDispatchConfig {
  worktreePath: string;
  storyId: string;
  track: Track;
  stage: PipelineStage;
  attempt: number;
  manifestPath: string;
  feedback?: string;
}

/**
 * Return type for executeStorySteps() when using the pipeline mode.
 * Replaces the legacy { success, lastSubstep } shape.
 */
export interface StoryExecutionResult {
  success: boolean;
  lastSubstep?: string;
  /** Parent session should dispatch an agent using the manifest at dispatchManifestPath */
  needsDispatch?: boolean;
  /** Path to the pipeline dispatch manifest for the current stage */
  dispatchManifestPath?: string;
  /** Retry budget exhausted — main agent must review */
  escalated?: boolean;
  /** Story already merged/skipped — nothing to do */
  skipped?: boolean;
}

export type DevMode = 'separated' | 'full_stack';
export type TriageMode = 'light' | 'serial' | 'parallel' | 'auto';
export type Track = 'backend' | 'frontend' | 'full-stack';

export interface StoryEntry {
  track: Track;
  order: number;
  story_id: string;
  title: string;
  effort?: string;             // S | M | L | XL (used for slicing decisions)
  depends_on?: { story_id: string; track: Track }[];
  parallel_group?: number;
  parallel_safe?: boolean;
  scope_write: string[];
  acceptance_check: string[];
  code_standards_source: string[];
  slices?: StorySlice[];
  execution_units?: Record<string, ExecutionUnit>;
}

export interface StorySlice {
  slice_id: string;
  title: string;
  depends_on_slices?: string[];
  scope_write?: string[];
  acceptance_check?: string[];
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'CODE_ACCEPTED' | 'BLOCKED_BY_DEPENDENCY';
}

export interface ExecutionUnit {
  role: Track;
  scope_write: string[];
  acceptance_check: string[];
  depends_on?: string[];
}

export interface StoryStatus {
  id: string;
  bmad_story_state?: 'backlog' | 'ready-for-dev' | 'in-progress' | 'review' | 'done';
  status: PhaseStatus;
  bmad_review_passed?: boolean;
  started_at?: string;
  completed_at?: string;
  last_completed_substep?: string | null;
  serial_only?: boolean;
  step_history?: StepHistoryEntry[];
  scope_audit?: ScopeAudit;
  code_acceptance?: CodeAcceptance;
  feature_acceptance?: FeatureAcceptance;
  ui_acceptance?: UiAcceptance;
  e2e_browser_acceptance?: E2eBrowserAcceptance;
  units?: Record<string, UnitStatus>;
  /** Per-story pipeline context tracking */
  pipeline?: PipelineContext;
}

export interface StepHistoryEntry {
  step: string;
  at: string;
  substep: string | null;
  summary: string | null;
  status: string | null;
}

export interface ScopeAudit {
  gate_passed: boolean;
  exit_verified: boolean;
  exit_violations: number;
  ca05_passed: boolean;
}

export interface CodeAcceptance {
  review_passed: boolean;
  test_coverage: number;
  acceptance_checks_all_pass: boolean;
  reviewer_session: string;
}

export interface FeatureAcceptance {
  all_stories_code_accepted: boolean;
  contract_verified: boolean;
  e2e_critical_paths_pass: boolean;
}

export interface UiAcceptance {
  visual_parity: 'pass' | 'fail';
  a11y_critical_issues: number;
  a11y_serious_issues: number;
  lighthouse_performance: number;
  lighthouse_accessibility: number;
  lighthouse_best_practices: number;
  bundle_size_kb: number;
  axe_audit_pass: boolean;
}

export interface E2eBrowserAcceptance {
  browser_tests_pass: boolean;
  visual_regression_pct_diff: number;
  cross_browser: Record<string, 'pass' | 'fail'>;
  responsive: Record<string, 'pass' | 'fail'>;
  network: Record<string, 'pass' | 'fail'>;
}

export interface UnitStatus {
  status: PhaseStatus;
  started_at?: string;
  completed_at?: string;
  code_acceptance?: CodeAcceptance;
}

export interface GateCheck {
  id: string;
  type: string;
  description: string;
  target?: string;
  source?: string;
  field?: string;
  operator?: string;
  expected?: unknown;
  severity?: 'blocking' | 'warning';
  status?: 'pending' | 'pass' | 'fail' | 'skipped';
  // Artifact checksum properties
  algorithm?: string;
  // Quality threshold properties
  metric?: string;
  threshold?: number;
  /**
   * For `user_confirmation` checks only.
   *
   * When true AND the workflow execution_mode is "auto", the gate
   * auto-passes with a recorded reason. When false (default) or when
   * execution_mode is "interactive", the gate stays fail-closed —
   * an explicit user authorization is required.
   *
   * This makes auto-degradation opt-in per gate: critical confirmations
   * (e.g. production deploy) keep their interactive contract, while
   * routine ones (e.g. "ready to merge to staging") can flow through.
   */
  allow_auto_degrade?: boolean;
}

export interface GateCard {
  phase?: number;
  sub_phase?: string;
  checks: GateCheck[];
  // `all_pass` is the evaluator's output, not input. Marked optional so callers
  // can construct a GateCard from raw `checks` without pre-computing the result.
  all_pass?: boolean;
}

export interface ChangeRequest {
  id: string;
  title: string;
  source_phase: number;
  source_artifact: string;
  discovered_in_phase: number;
  severity: 'blocking' | 'non_blocking';
  description: string;
  created_at: string;
  created_by: string;
  status: 'open' | 'in_progress' | 'resolved' | 'rejected';
  resolution?: string;
  resolved_at?: string;
  resolved_by?: string;
}

export interface ConstitutionCheckResult {
  ruleId: string;
  level: 'error' | 'warning';
  file: string;
  message: string;
  passed: boolean;
}

export interface MergeQueueItem {
  queue_item_id: string;
  story_id: string;
  unit_id?: string;
  run_id?: string;
  branch: string;
  depends_on: string[];
  merge_order: number;
  integration_checks: string[];
  merge_status: 'queued' | 'waiting_dependency' | 'merging' | 'merged' | 'failed';
  merge_failed_reason?: string;
  merged_at?: string;
  merge_commit?: string;
  /** Constitution verification results for this merge item */
  constitution_checks?: ConstitutionCheckResult[];
  /** Whether constitution checks passed */
  constitution_passed?: boolean;
}

export interface SubState {
  status: string;
  state_history?: { state: string; at: string; by?: string }[];
  artifacts?: { type: string; path: string; status: string; sha256?: string }[];
  gate_card?: { phase?: number; checks: GateCheck[]; all_pass: boolean };
  stories?: StoryStatus[];
}

export interface PhaseState {
  status: string;
  state_history?: { state: string; at: string; by?: string }[];
  artifacts?: { type: string; path: string; status: string; sha256?: string }[];
  gate_card?: { phase?: number; checks: GateCheck[]; all_pass: boolean };
  substates?: Record<string, SubState>;
  change_requests?: string[];
}

export interface ImplementationBoundary {
  defined_at: string;
  scope_frozen: boolean;
  backend_scope: string[];
  frontend_scope: string[];
  shared_scope: string[];
  forbidden_paths: string[];
}

export interface GlobalState {
  dev_mode: DevMode;
  task_triage_mode: TriageMode;
  /**
   * "auto" enables opt-in auto-degradation of `user_confirmation` gates
   * (those with allow_auto_degrade=true). "interactive" (default) keeps
   * every user confirmation fail-closed until an explicit authorization
   * is recorded.
   */
  execution_mode?: 'auto' | 'interactive';
  code_standards_source: string[];
  overall_status: string;
  current_phase: number;
  blocked_by?: string;
  requirements_frozen_at?: string;
  development_order?: StoryEntry[];
  development_order_frozen_at?: string;
  story_status_files?: Record<string, string>;
  implementation_boundary?: ImplementationBoundary;
  parallel_sessions?: {
    be_track?: { status: string; started_at?: string; agent_session?: string };
    fe_track?: { status: string; started_at?: string; agent_session?: string };
  };
  merge_queue?: {
    enabled: boolean;
    items: MergeQueueItem[];
  };
  quality_metrics?: Record<string, number>;
}

export interface SprintStatus {
  project: string;
  workflow_version: string;
  created_at: string;
  updated_at: string;
  global_state: GlobalState;
  phases: Record<string, PhaseState>;
  change_requests: ChangeRequest[];
}

/**
 * Structured result returned by a dispatched story agent.
 *
 * The agent is required to write a JSON document conforming to this shape
 * to `_wdf_output/agent-result.json` inside its worktree. The orchestrator
 * reads that file on completion — no regex / stdout parsing is performed.
 *
 * `status` mapping:
 *   - 'success' → story is CODE_ACCEPTED
 *   - 'failed'  → agent ran but did not pass acceptance
 *   - 'timeout' → orchestrator timed the agent out before result file appeared
 *   - 'blocked' → cross-track dependency missing; will retry later
 */
export type AgentDispatchStatus = 'success' | 'failed' | 'timeout' | 'blocked';

export interface AgentDispatchResult {
  status: AgentDispatchStatus;
  story_id: string;
  files_changed: string[];
  tests_passed: number;
  tests_total: number;
  summary: string;
  duration_ms: number;
  error?: string;
}

// ============================================================
// Party Mode Types
// ============================================================

export type PartyRole =
  | 'analyst'
  | 'product_manager'
  | 'ux_designer'
  | 'architect'
  | 'story_planner'
  | 'api_designer'
  | 'external_expert';

export interface PartyAgent {
  id: string;
  role: PartyRole;
  name: string;
  persona: string;
  perspectives: string[];
  status: 'idle' | 'thinking' | 'responded' | 'reviewing' | 'converged';
  output?: string;
  started_at?: string;
  completed_at?: string;
}

export interface CrossTalkComment {
  id: string;
  from_agent: string;
  to_agent?: string;
  content: string;
  type: 'agreement' | 'disagreement' | 'question' | 'suggestion' | 'gap';
  created_at: string;
  resolved?: boolean;
  resolution?: string;
}

export interface PartyRound {
  round_number: number;
  phase: 'discovery' | 'design' | 'architecture' | 'convergence' | 'converged' | 'completed';
  prompt: string;
  agent_outputs: Record<string, string>;
  cross_talk: CrossTalkComment[];
  started_at: string;
  completed_at?: string;
}

export interface ConvergencePoint {
  id: string;
  topic: string;
  type: 'agreement' | 'disagreement' | 'gap' | 'decision_needed';
  agents_involved: string[];
  summary: string;
  resolution?: string;
  resolved_by?: 'user' | 'consensus' | 'lead_agent';
  resolved_at?: string;
}

export interface FirstPrincipleAnalysis {
  id: string;
  assumption: string;
  challenge: string;
  validity_score: number; // 1-10
  alternative?: string;
  impact?: string;
}

export interface PartyState {
  party_id: string;
  topic: string;
  phase: 'discovery' | 'design' | 'architecture' | 'converged' | 'completed';
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED';
  agents: PartyAgent[];
  rounds: PartyRound[];
  convergence_points: ConvergencePoint[];
  first_principles: FirstPrincipleAnalysis[];
  final_output?: string;
  output_artifact?: string;
  started_at?: string;
  completed_at?: string;
  paused_at?: string;
  resumed_at?: string;
  invited_experts: string[];
}

export interface PartyConfig {
  topic: string;
  phase: 'discovery' | 'design' | 'architecture';
  agents: PartyRole[];
  max_rounds: number;
  auto_converge: boolean;
  enable_first_principles: boolean;
}

export type PartyStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'PAUSED'
  | 'WAITING_USER_INPUT'
  | 'CONVERGING'
  | 'COMPLETED';

// Re-export config types for backward compatibility.
// Must use `export type` (not `export`) because these are interfaces —
// erased at runtime. Plain `export` makes Node.js ESM throw
// "does not provide an export named ..." under tsx runtime.
export type {
  WorkflowConfig,
  AcceptanceGatesSection as AcceptanceGateConfig,
  ScopeLockSection as ScopeLockConfig,
} from './config.js';
