import { existsSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { resolve } from 'path';
import { SprintStatus } from './types.js';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  path: string;
  message: string;
}

export interface ValidationReport {
  valid: boolean;
  issues: ValidationIssue[];
  summary: {
    phases: number;
    substates: number;
    stories: number;
    changeRequests: number;
    mergeQueueItems: number;
  };
}

/**
 * SprintStatusValidator checks sprint-status.yaml for structural consistency,
 * FSM state validity, artifact checksum integrity, and merge queue dependency cycles.
 */
export class SprintStatusValidator {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Run all validation checks on a sprint status object.
   */
  validate(status: SprintStatus): ValidationReport {
    const issues: ValidationIssue[] = [];
    let substateCount = 0;
    let storyCount = 0;

    // 1. Required top-level fields
    if (!status.project) {
      issues.push({ severity: 'error', path: 'project', message: 'Missing required field: project' });
    }
    if (!status.workflow_version) {
      issues.push({ severity: 'error', path: 'workflow_version', message: 'Missing required field: workflow_version' });
    }
    if (!status.global_state) {
      issues.push({ severity: 'error', path: 'global_state', message: 'Missing required field: global_state' });
      return { valid: false, issues, summary: { phases: 0, substates: 0, stories: 0, changeRequests: 0, mergeQueueItems: 0 } };
    }

    // 2. FSM state validity
    this.validateFSMStates(status, issues);

    // 3. Phase structure
    for (let p = 1; p <= 4; p++) {
      const phase = status.phases[`phase_${p}`];
      if (!phase) {
        issues.push({ severity: 'error', path: `phases.phase_${p}`, message: `Phase ${p} is missing` });
        continue;
      }
      if (!this.isValidPhaseStatus(phase.status)) {
        issues.push({ severity: 'error', path: `phases.phase_${p}.status`, message: `Invalid phase status: ${phase.status}` });
      }

      // 4. Sub-phase structure
      if (phase.substates) {
        for (const [key, sub] of Object.entries(phase.substates)) {
          substateCount++;
          if (!this.isValidPhaseStatus(sub.status)) {
            issues.push({ severity: 'error', path: `phases.phase_${p}.substates.${key}.status`, message: `Invalid sub-phase status: ${sub.status}` });
          }

          // Story state validation
          if (sub.stories) {
            for (const story of sub.stories) {
              storyCount++;
              if (!story.id) {
                issues.push({ severity: 'error', path: `phases.phase_${p}.substates.${key}.stories`, message: 'Story missing id field' });
              }
              if (story.status && !this.isValidPhaseStatus(story.status)) {
                issues.push({ severity: 'warning', path: `phases.phase_${p}.substates.${key}.stories.${story.id}.status`, message: `Invalid story status: ${story.status}` });
              }
              if (story.status === 'IN_PROGRESS' && !story.started_at) {
                issues.push({ severity: 'warning', path: `phases.phase_${p}.substates.${key}.stories.${story.id}`, message: 'Story IN_PROGRESS but started_at not set' });
              }
              if ((story.status === 'MERGED' || story.status === 'CODE_ACCEPTED') && !story.completed_at) {
                issues.push({ severity: 'warning', path: `phases.phase_${p}.substates.${key}.stories.${story.id}`, message: `Story ${story.status} but completed_at not set` });
              }
            }
          }
        }
      }

      // Gate card validation
      if (phase.gate_card) {
        if (typeof phase.gate_card.all_pass !== 'boolean') {
          issues.push({ severity: 'error', path: `phases.phase_${p}.gate_card`, message: 'Gate card missing all_pass field' });
        }
      }
    }

    // 5. Global state consistency
    const gs = status.global_state;
    if (gs.current_phase < 1 || gs.current_phase > 4) {
      issues.push({ severity: 'error', path: 'global_state.current_phase', message: `Invalid current_phase: ${gs.current_phase}` });
    }
    if (!['separated', 'full_stack'].includes(gs.dev_mode)) {
      issues.push({ severity: 'error', path: 'global_state.dev_mode', message: `Invalid dev_mode: ${gs.dev_mode}` });
    }
    if (!['light', 'serial', 'parallel'].includes(gs.task_triage_mode ?? '')) {
      issues.push({ severity: 'error', path: 'global_state.task_triage_mode', message: `Invalid task_triage_mode: ${gs.task_triage_mode}` });
    }

    // Development order consistency
    if (gs.development_order) {
      for (const entry of gs.development_order) {
        if (!entry.story_id || !entry.track || !entry.scope_write) {
          issues.push({ severity: 'error', path: 'global_state.development_order', message: `Story entry missing required fields: ${JSON.stringify(entry)}` });
        }
      }
    }

    // 6. Merge queue dependency cycle detection
    if (gs.merge_queue?.items?.length) {
      const cycle = this.detectMergeCycle(gs.merge_queue.items);
      if (cycle) {
        issues.push({ severity: 'error', path: 'global_state.merge_queue.items', message: `Dependency cycle detected: ${cycle.join(' → ')}` });
      }
    }

    // 7. Change request consistency
    for (const cr of (status.change_requests ?? [])) {
      if (!cr.id || !cr.status) {
        issues.push({ severity: 'error', path: 'change_requests', message: `CR missing required fields: ${JSON.stringify(cr)}` });
      }
    }

    // 8. Artifact checksum validation (non-blocking)
    for (let p = 1; p <= 4; p++) {
      const phase = status.phases[`phase_${p}`];
      if (phase?.artifacts) {
        for (const artifact of phase.artifacts) {
          if (artifact.sha256) {
            const fullPath = resolve(this.projectRoot, artifact.path);
            if (existsSync(fullPath)) {
              const actual = this.computeSha256(fullPath);
              if (actual !== artifact.sha256) {
                issues.push({ severity: 'warning', path: `phases.phase_${p}.artifacts.${artifact.path}`, message: `Checksum mismatch: expected ${artifact.sha256.slice(0, 8)}..., actual ${actual.slice(0, 8)}...` });
              }
            } else {
              issues.push({ severity: 'warning', path: `phases.phase_${p}.artifacts`, message: `Artifact file not found: ${artifact.path}` });
            }
          }
        }
      }
    }

    const errors = issues.filter(i => i.severity === 'error');
    return {
      valid: errors.length === 0,
      issues,
      summary: {
        phases: 4,
        substates: substateCount,
        stories: storyCount,
        changeRequests: (status.change_requests ?? []).length,
        mergeQueueItems: gs.merge_queue?.items?.length ?? 0,
      },
    };
  }

  /**
   * Validate that all FSM states in the document are known valid states.
   */
  private validateFSMStates(status: SprintStatus, issues: ValidationIssue[]): void {
    const allStatuses = new Set<string>();

    for (let p = 1; p <= 4; p++) {
      const phase = status.phases[`phase_${p}`];
      if (phase) {
        allStatuses.add(phase.status);
        if (phase.substates) {
          for (const sub of Object.values(phase.substates)) {
            allStatuses.add(sub.status);
            if (sub.stories) {
              for (const story of sub.stories) {
                if (story.status) allStatuses.add(story.status);
              }
            }
          }
        }
      }
    }

    // Report any status values not in the known FSM set
    for (const s of allStatuses) {
      if (!this.isValidPhaseStatus(s) && s !== '') {
        issues.push({ severity: 'warning', path: '(various)', message: `Unknown FSM state used: "${s}"` });
      }
    }
  }

  private isValidPhaseStatus(status: string): boolean {
    const valid = new Set([
      'NOT_STARTED', 'SKIPPED', 'IN_PROGRESS', 'DRAFT_COMPLETE', 'IN_REVIEW',
      'APPROVED', 'LOCKED', 'BLOCKED', 'UNLOCK_RESOLVE',
      'ALL_SUB_PHASES_APPROVED', 'ANALYSIS_COMPLETE', 'PLANNING_COMPLETE', 'SOLUTIONING_COMPLETE',
      'CODE_ACCEPTANCE', 'CODE_ACCEPTED', 'FEATURE_ACCEPTANCE', 'FEATURE_ACCEPTED',
      'UI_ACCEPTANCE', 'UI_ACCEPTED', 'E2E_BROWSER_ACCEPTANCE', 'E2E_BROWSER_ACCEPTED',
      'BE_CODE_ACCEPTED', 'FE_UI_ACCEPTED', 'BE_TRACK_COMPLETE', 'FE_TRACK_COMPLETE',
      'FULL_STACK_INTEGRATED', 'MERGE_QUEUED', 'MERGED',
      'BLOCKED_BY_DEPENDENCY', 'SUBMITTED', 'IMPLEMENTED', 'TESTED', 'SPEC_COMPLIANT',
      'A11Y_CHECKED', 'VERIFIED', 'REVIEWED',
      'SPRINT_PLANNED', 'SCAFFOLDED', 'MIGRATIONS_WRITTEN', 'MIGRATIONS_RUN',
      'CLIENT_GENERATED', 'MOCKS_READY', 'COMPONENTS_BUILT', 'DOCUMENTED',
      'TESTS_WRITTEN', 'ALL_PASSING', 'COVERAGE_MET',
      'A11Y_PASSED', 'PERF_PASSED',
      'CONTEXT_MAPPED', 'STYLE_SELECTED', 'CONTAINERS_DESIGNED', 'ATTRIBUTES_IDENTIFIED',
      'COMPONENTS_MAPPED', 'EPICS_DRAFTED', 'STORIES_DRAFTED',
      'API_SPEC_DRAFTED', 'DB_SCHEMA_DRAFTED', 'CHECKS_VERIFIED',
      'MAP_DRAFTED', 'EVENTS_IDENTIFIED', 'CONTEXTS_MAPPED', 'JOBS_IDENTIFIED', 'DIMENSIONS_MAPPED',
      'BRIEF_DRAFTED', 'RESEARCHED', 'BACKBONE_BUILT', 'STORIES_MAPPED', 'RELEASES_SLICED',
      'FEATURES_CLASSIFIED', 'PRIORITIZED', 'PRD_DRAFTED', 'FLOWS_MAPPED', 'IA_DEFINED',
      'WIREFRAMES_CREATED', 'TOKENS_DEFINED', 'CRITERIA_COMPILED', 'ACCEPTANCE_DEFINED',
      'QUEUED', 'WAITING_DEPENDENCY', 'MERGING', 'FAILED',
      'INTEGRATED', 'RETRO_COMPLETED', 'complete', 'blocked', 'not_started', 'ready_for_integration',
      'be_complete_awaiting_fe', 'fe_complete_awaiting_be',
    ]);
    return valid.has(status);
  }

  /**
   * Detect cycles in the merge queue dependency graph using DFS.
   */
  private detectMergeCycle(items: Array<{ story_id: string; depends_on: string[] }>): string[] | null {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const path: string[] = [];

    function dfs(nodeId: string, graph: Map<string, string[]>): boolean {
      visited.add(nodeId);
      inStack.add(nodeId);
      path.push(nodeId);

      for (const dep of graph.get(nodeId) ?? []) {
        if (!visited.has(dep)) {
          if (dfs(dep, graph)) return true;
        } else if (inStack.has(dep)) {
          path.push(dep);
          return true; // Cycle found
        }
      }

      path.pop();
      inStack.delete(nodeId);
      return false;
    }

    const graph = new Map<string, string[]>();
    for (const item of items) {
      graph.set(item.story_id, item.depends_on ?? []);
    }

    for (const nodeId of graph.keys()) {
      if (!visited.has(nodeId)) {
        if (dfs(nodeId, graph)) return path;
      }
      path.length = 0;
    }

    return null;
  }

  private computeSha256(filePath: string): string {
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Format validation report as readable text.
   */
  formatReport(report: ValidationReport): string {
    const lines = [
      '═══════════════════════════════════════════',
      'sprint-status.yaml — Consistency Validation',
      '═══════════════════════════════════════════',
      `Status: ${report.valid ? '✓ VALID' : '✗ INVALID'}`,
      `Phases: ${report.summary.phases} | Sub-states: ${report.summary.substates} | Stories: ${report.summary.stories}`,
      `Change Requests: ${report.summary.changeRequests} | Merge Queue: ${report.summary.mergeQueueItems}`,
      '',
    ];

    if (report.issues.length === 0) {
      lines.push('✓ No issues found');
    } else {
      const errors = report.issues.filter(i => i.severity === 'error');
      const warnings = report.issues.filter(i => i.severity === 'warning');

      if (errors.length > 0) {
        lines.push(`ERRORS (${errors.length}):`);
        for (const e of errors) {
          lines.push(`  ✗ ${e.path}: ${e.message}`);
        }
        lines.push('');
      }
      if (warnings.length > 0) {
        lines.push(`WARNINGS (${warnings.length}):`);
        for (const w of warnings) {
          lines.push(`  ⚠ ${w.path}: ${w.message}`);
        }
      }
    }

    lines.push('═══════════════════════════════════════════');
    return lines.join('\n');
  }
}
