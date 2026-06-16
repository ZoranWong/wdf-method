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
  | 'BLOCKED_BY_DEPENDENCY';

export type DevMode = 'separated' | 'full_stack';
export type TriageMode = 'light' | 'serial' | 'parallel' | 'auto';
export type Track = 'backend' | 'frontend' | 'full-stack';

export interface StoryEntry {
  track: Track;
  order: number;
  story_id: string;
  title: string;
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
}

export interface GateCard {
  phase?: number;
  sub_phase?: string;
  checks: GateCheck[];
  all_pass: boolean;
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

// Re-export config types for backward compatibility
export {
  WorkflowConfig,
  AcceptanceGatesSection as AcceptanceGateConfig,
  ScopeLockSection as ScopeLockConfig,
} from './config.js';
