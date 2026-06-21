import { appendAudit } from './audit-logger.js';
import type { PhaseStatus } from './types.js';

export type { PhaseStatus } from './types.js';

/**
 * Define valid state transitions for phases and sub-phases.
 * Map from current state → allowed next states.
 */
export const VALID_TRANSITIONS: Record<PhaseStatus, PhaseStatus[]> = {
  NOT_STARTED: ['IN_PROGRESS', 'SKIPPED', 'BLOCKED'],
  IN_PROGRESS: ['DRAFT_COMPLETE', 'IN_REVIEW', 'BLOCKED', 'LOCKED'],
  DRAFT_COMPLETE: ['IN_REVIEW', 'APPROVED', 'BLOCKED'],
  IN_REVIEW: ['APPROVED', 'DRAFT_COMPLETE', 'APPROVED', 'BLOCKED'],
  APPROVED: ['LOCKED', 'UNLOCK_RESOLVE'],
  LOCKED: ['UNLOCK_RESOLVE'],
  BLOCKED: ['NOT_STARTED', 'IN_PROGRESS'],
  UNLOCK_RESOLVE: ['LOCKED', 'IN_PROGRESS'],
  SKIPPED: [], // Terminal state
  // Phase completion states
  ALL_SUB_PHASES_APPROVED: ['LOCKED'],
  ANALYSIS_COMPLETE: ['LOCKED'],
  PLANNING_COMPLETE: ['LOCKED'],
  SOLUTIONING_COMPLETE: ['LOCKED'],
  // Acceptance states
  CODE_ACCEPTANCE: ['CODE_ACCEPTED', 'BLOCKED'],
  CODE_ACCEPTED: ['FEATURE_ACCEPTANCE', 'LOCKED'],
  FEATURE_ACCEPTANCE: ['FEATURE_ACCEPTED', 'BLOCKED'],
  FEATURE_ACCEPTED: ['UI_ACCEPTANCE', 'LOCKED'],
  UI_ACCEPTANCE: ['UI_ACCEPTED', 'BLOCKED'],
  UI_ACCEPTED: ['E2E_BROWSER_ACCEPTANCE', 'LOCKED'],
  E2E_BROWSER_ACCEPTANCE: ['E2E_BROWSER_ACCEPTED', 'BLOCKED'],
  E2E_BROWSER_ACCEPTED: ['FULL_STACK_INTEGRATED', 'LOCKED'],
  // Track completion states
  BE_CODE_ACCEPTED: ['MERGE_QUEUED', 'FE_TRACK_COMPLETE'],
  FE_UI_ACCEPTED: ['MERGE_QUEUED', 'BE_TRACK_COMPLETE'],
  BE_TRACK_COMPLETE: ['FULL_STACK_INTEGRATED'],
  FE_TRACK_COMPLETE: ['FULL_STACK_INTEGRATED'],
  FULL_STACK_INTEGRATED: ['MERGED', 'LOCKED'],
  // Merge states
  MERGE_QUEUED: ['MERGED', 'BLOCKED_BY_DEPENDENCY'],
  MERGED: ['LOCKED'],
  BLOCKED_BY_DEPENDENCY: ['IN_PROGRESS', 'MERGE_QUEUED'],
  // Pipeline retry / escalation (Phase 4 story agent lifecycle)
  FIX_RETRY: ['IN_PROGRESS', 'PIPELINE_ESCALATED'],
  PIPELINE_ESCALATED: ['IN_PROGRESS', 'LOCKED'],
};

/**
 * Terminal states — no further transitions allowed.
 */
export const TERMINAL_STATES: PhaseStatus[] = [
  'LOCKED',
  'SKIPPED',
  'MERGED',
];

/**
 * States that indicate work has started.
 */
export const STARTED_STATES: PhaseStatus[] = [
  'IN_PROGRESS',
  'DRAFT_COMPLETE',
  'IN_REVIEW',
  'APPROVED',
  'ALL_SUB_PHASES_APPROVED',
  'ANALYSIS_COMPLETE',
  'PLANNING_COMPLETE',
  'SOLUTIONING_COMPLETE',
  'CODE_ACCEPTANCE',
  'CODE_ACCEPTED',
  'FEATURE_ACCEPTANCE',
  'FEATURE_ACCEPTED',
  'UI_ACCEPTANCE',
  'UI_ACCEPTED',
  'E2E_BROWSER_ACCEPTANCE',
  'E2E_BROWSER_ACCEPTED',
  'BE_CODE_ACCEPTED',
  'FE_UI_ACCEPTED',
  'BE_TRACK_COMPLETE',
  'FE_TRACK_COMPLETE',
  'FULL_STACK_INTEGRATED',
  'MERGE_QUEUED',
  'MERGED',
];

/**
 * States that indicate completion/acceptance.
 */
export const COMPLETION_STATES: PhaseStatus[] = [
  'APPROVED',
  'CODE_ACCEPTED',
  'FEATURE_ACCEPTED',
  'UI_ACCEPTED',
  'E2E_BROWSER_ACCEPTED',
  'BE_CODE_ACCEPTED',
  'FE_UI_ACCEPTED',
  'BE_TRACK_COMPLETE',
  'FE_TRACK_COMPLETE',
  'FULL_STACK_INTEGRATED',
  'MERGED',
  'LOCKED',
  'ALL_SUB_PHASES_APPROVED',
  'ANALYSIS_COMPLETE',
  'PLANNING_COMPLETE',
  'SOLUTIONING_COMPLETE',
  'SKIPPED',
];

export interface TransitionValidationResult {
  valid: boolean;
  reason?: string;
  suggested?: PhaseStatus;
}

/**
 * Validate if a state transition is allowed.
 * Returns validation result with reason if invalid.
 */
export function validateStateTransition(
  from: PhaseStatus,
  to: PhaseStatus,
): TransitionValidationResult {
  // Same state is always valid (no-op)
  if (from === to) {
    return { valid: true };
  }
  // Terminal states can only transition to UNLOCK_RESOLVE (for LOCKED)
  if (TERMINAL_STATES.includes(from)) {
    if (from === 'LOCKED' && to === 'UNLOCK_RESOLVE') {
      return { valid: true };
    }
    return {
      valid: false,
      reason: `State "${from}" is terminal. Cannot transition to "${to}".`,
    };
  }
  // Check if transition is allowed
  const validNextStates = VALID_TRANSITIONS[from];
  if (!validNextStates) {
    return {
      valid: false,
      reason: `No transition rules defined for state "${from}".`,
    };
  }
  if (!validNextStates.includes(to)) {
    return {
      valid: false,
      reason: `Cannot transition from "${from}" to "${to}". Valid next states: ${validNextStates.join(', ')}.`,
      suggested: validNextStates[0],
    };
  }
  return { valid: true };
}

/**
 * Check if a state is terminal (no further transitions allowed).
 */
export function isTerminalState(state: PhaseStatus): boolean {
  return TERMINAL_STATES.includes(state);
}

/**
 * Check if work has started (state is beyond NOT_STARTED/SKIPPED).
 */
export function hasStarted(state: PhaseStatus): boolean {
  return STARTED_STATES.includes(state);
}

/**
 * Check if a state indicates completion.
 */
export function isCompleted(state: PhaseStatus): boolean {
  return COMPLETION_STATES.includes(state);
}

export interface StateHistoryEntry {
  state: PhaseStatus;
  at: string;
  by?: string;
  metadata?: Record<string, any>;
}

export interface TransitionOptions {
  /** Agent or user who initiated the transition */
  by?: string;
  /** Additional metadata to store with this transition */
  metadata?: Record<string, any>;
  /** Whether to write to audit log */
  audit?: boolean;
  /** Project root for audit log writing (required if audit is true) */
  projectRoot?: string;
  /** Phase number for audit context */
  phase?: number;
  /** Sub-phase ID for audit context */
  subPhase?: string;
  /** Story ID for audit context */
  storyId?: string;
}

export interface StateTransitionResult {
  success: boolean;
  fromState: PhaseStatus;
  toState: PhaseStatus;
  reason?: string;
  stateHistory?: StateHistoryEntry[];
}

/**
 * Execute a state transition with validation and history recording.
 * This is the main FSM engine function.
 */
export function transitionState(
  currentState: PhaseStatus,
  targetState: PhaseStatus,
  currentHistory: StateHistoryEntry[],
  options: TransitionOptions = {},
): StateTransitionResult {
  // Validate the transition
  const validation = validateStateTransition(currentState, targetState);
  if (!validation.valid) {
    return {
      success: false,
      fromState: currentState,
      toState: targetState,
      reason: validation.reason,
      stateHistory: currentHistory,
    };
  }
  // No-op transition (same state)
  if (currentState === targetState) {
    return {
      success: true,
      fromState: currentState,
      toState: targetState,
      stateHistory: currentHistory,
    };
  }
  // Create new history entry
  const newEntry: StateHistoryEntry = {
    state: targetState,
    at: new Date().toISOString(),
    by: options.by,
    metadata: options.metadata,
  };
  // Append to history
  const newHistory = [...currentHistory, newEntry];
  // Write audit log if requested
  if (options.audit && options.projectRoot) {
    const context: Record<string, string> = {};
    if (options.phase !== undefined) context.phase = String(options.phase);
    if (options.subPhase) context.sub_phase = options.subPhase;
    if (options.storyId) context.story_id = options.storyId;
    appendAudit(options.projectRoot, 'state_transition' as any, {
      status: 'info',
      message: `State transition: ${currentState} → ${targetState}`,
      details: {
        transition_from: currentState,
        transition_to: targetState,
        ...context,
      },
    });
  }
  return {
    success: true,
    fromState: currentState,
    toState: targetState,
    stateHistory: newHistory,
  };
}

export interface SubPhaseStatus {
  id: string;
  status: PhaseStatus;
  auto_skip?: boolean;
}

export type AggregationStrategy = 'all' | 'any' | 'majority';

/**
 * Aggregate sub-phase states into a parent phase status.
 *
 * Strategy:
 * - ANY blocked → parent is BLOCKED
 * - ALL skipped and auto_skip → parent is SKIPPED
 * - ALL completed → parent is ALL_SUB_PHASES_APPROVED
 * - ANY in_progress → parent is IN_PROGRESS
 * - NOT_STARTED → default
 */
export function aggregateSubPhaseStates(
  subPhases: SubPhaseStatus[],
  strategy: AggregationStrategy = 'all',
): PhaseStatus {
  if (subPhases.length === 0) {
    return 'NOT_STARTED';
  }
  const states = subPhases.map((sp) => sp.status);
  const nonSkipped = subPhases.filter((sp) => !sp.auto_skip);
  const nonSkippedStates = nonSkipped.map((sp) => sp.status);
  // If all are auto-skipped, parent is SKIPPED
  if (nonSkipped.length === 0 && states.every((s) => s === 'SKIPPED' || s === 'NOT_STARTED')) {
    return 'SKIPPED';
  }
  const effectiveStates = nonSkipped.length > 0 ? nonSkippedStates : states;
  if (effectiveStates.length === 0) {
    return 'SKIPPED';
  }
  // Check for BLOCKED (highest priority)
  if (effectiveStates.some((s) => s === 'BLOCKED' || s === 'BLOCKED_BY_DEPENDENCY')) {
    return 'BLOCKED';
  }
  // Check for ALL completed
  const allCompleted = effectiveStates.every((s) => isCompleted(s) || s === 'LOCKED');
  if (allCompleted) {
    return 'ALL_SUB_PHASES_APPROVED';
  }
  // Check for ANY in progress
  const anyInProgress = effectiveStates.some((s) => hasStarted(s) && !isCompleted(s));
  if (anyInProgress) {
    return 'IN_PROGRESS';
  }
  // Default: NOT_STARTED
  return 'NOT_STARTED';
}

/**
 * Calculate progress percentage based on sub-phase states.
 */
export function calculatePhaseProgressFromSubPhases(subPhases: SubPhaseStatus[]): number {
  if (subPhases.length === 0) return 0;
  // If all are auto-skipped, consider as 100% complete
  const allAutoSkipped = subPhases.every((sp) => sp.auto_skip);
  if (allAutoSkipped) return 100;
  const nonSkipped = subPhases.filter((sp) => !sp.auto_skip);
  const total = nonSkipped.length > 0 ? nonSkipped : subPhases;
  if (total.length === 0) return 100; // All auto-skipped = 100%
  let progress = 0;
  for (const sp of total) {
    if (sp.auto_skip) {
      progress += 1; // Auto-skipped counts as complete
    } else if (isCompleted(sp.status) || sp.status === 'LOCKED') {
      progress += 1; // 100% complete for this sub-phase
    } else if (hasStarted(sp.status)) {
      progress += 0.5; // 50% for in progress
    }
    // else: 0% for NOT_STARTED
  }
  return Math.round((progress / total.length) * 100);
}

// ============================================================
// State Flow Helpers
// ============================================================
/**
 * Get the standard workflow progression for a phase.
 * Returns the default sequence of states a phase goes through.
 */
export function getPhaseWorkflowProgression(): PhaseStatus[] {
  return [
    'NOT_STARTED',
    'IN_PROGRESS',
    'DRAFT_COMPLETE',
    'IN_REVIEW',
    'APPROVED',
    'LOCKED',
  ];
}

/**
 * Get the standard workflow progression for Phase 4 (implementation).
 */
export function getImplementationWorkflowProgression(
  track: 'backend' | 'frontend' | 'full',
): PhaseStatus[] {
  if (track === 'backend') {
    return [
      'NOT_STARTED',
      'IN_PROGRESS',
      'DRAFT_COMPLETE',
      'IN_REVIEW',
      'CODE_ACCEPTANCE',
      'CODE_ACCEPTED',
      'BE_CODE_ACCEPTED',
      'MERGE_QUEUED',
      'MERGED',
      'BE_TRACK_COMPLETE',
      'LOCKED',
    ];
  }
  if (track === 'frontend') {
    return [
      'NOT_STARTED',
      'IN_PROGRESS',
      'DRAFT_COMPLETE',
      'IN_REVIEW',
      'UI_ACCEPTANCE',
      'UI_ACCEPTED',
      'FE_UI_ACCEPTED',
      'MERGE_QUEUED',
      'MERGED',
      'FE_TRACK_COMPLETE',
      'LOCKED',
    ];
  }
  // Full stack
  return [
    'NOT_STARTED',
    'IN_PROGRESS',
    'DRAFT_COMPLETE',
    'IN_REVIEW',
    'CODE_ACCEPTANCE',
    'CODE_ACCEPTED',
    'FEATURE_ACCEPTANCE',
    'FEATURE_ACCEPTED',
    'UI_ACCEPTANCE',
    'UI_ACCEPTED',
    'E2E_BROWSER_ACCEPTANCE',
    'E2E_BROWSER_ACCEPTED',
    'FULL_STACK_INTEGRATED',
    'MERGED',
    'LOCKED',
  ];
}

/**
 * Get the next logical state in the workflow.
 */
export function getNextState(
  current: PhaseStatus,
  track?: 'backend' | 'frontend' | 'full',
): PhaseStatus | null {
  const progression = track
    ? getImplementationWorkflowProgression(track)
    : getPhaseWorkflowProgression();
  const currentIndex = progression.indexOf(current);
  if (currentIndex === -1) {
    // State not in standard progression — return first valid transition
    return VALID_TRANSITIONS[current]?.[0] ?? null;
  }
  // Return next state in progression
  return currentIndex < progression.length - 1 ? progression[currentIndex + 1] : null;
}

/**
 * Get all valid next states for a given current state.
 */
export function getValidNextStates(current: PhaseStatus): PhaseStatus[] {
  return VALID_TRANSITIONS[current] ?? [];
}
