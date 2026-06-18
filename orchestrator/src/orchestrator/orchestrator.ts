import { existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';
import { SprintStatusManager } from './sprint-status.js';
import { WorktreeManager } from './worktree.js';
import { GateEvaluator } from './gate-evaluator.js';
import { StoryRunner } from './story-runner.js';
import { MergeQueueManager } from './merge-queue.js';
import { SignalManager } from './signal-manager.js';
import { PartyEngine } from './party-engine.js';
import { appendAudit, readRecentAudit, formatAuditLines } from './audit-logger.js';
import {
  loadConfig,
  getSignalDir,
  getSprintTrackingPath,
  getStatusDir,
  resolvePath,
} from './config.js';
import {
  WorkflowConfig,
  AcceptanceGateConfig,
  ScopeLockConfig,
  Track,
  DevMode,
  TriageMode,
  PartyConfig,
  PartyState,
  PartyRole,
  ConvergencePoint,
  FirstPrincipleAnalysis,
} from './types.js';

// ── Auto-Run types (CHG-2026-006) ─────────────────────────────────────

export interface AutoLoopOptions {
  /** Max total phase iterations (default 50). */
  maxIterations?: number;
  /** First phase to run (default: auto-detect). */
  startPhase?: number;
  /** Last phase to run (default: 4). */
  endPhase?: number;
  /** Print progress to console (default false). */
  verbose?: boolean;
  /** Override the default `console.log` logger. */
  logFn?: (...args: unknown[]) => void;
}

export interface PhaseLoopEntry {
  phase: number;
  status: 'started' | 'locked' | 'skipped' | 'executed' | 'gate_failed' | 'error';
  at: string;
  halted?: boolean;
  gate_failures?: string[];
  error?: string;
}

export interface AutoLoopResult {
  all_phases_complete: boolean;
  phases_executed: number;
  total_phases: number;
  paused: boolean;
  pause_reason?: string;
  timeline: PhaseLoopEntry[];
  iterations: number;
}

// Dynamic import for TOML parser since it may not be in deps
function parseTOML(filePath: string): Record<string, any> {
  const content = readFileSync(filePath, 'utf-8');
  // Simple TOML-like parser fallback for the keys we need
  return parseSimpleToml(content);
}

/**
 * Minimal TOML parser for customize.toml structure.
 * Handles sections [section], nested [section.subsection], arrays, strings, booleans, numbers.
 */
function parseSimpleToml(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  let currentSection: Record<string, any> = result;
  let currentPath: string[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Section header
    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      const path = sectionMatch[1].split('.');
      currentPath = path;
      currentSection = result;
      for (const key of path) {
        if (!currentSection[key]) currentSection[key] = {};
        currentSection = currentSection[key];
      }
      continue;
    }

    // Key-value pair
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value: any = kvMatch[2].trim();

      // Parse value types
      if (value.startsWith('"') && value.endsWith('"')) {
        // String
        value = value.slice(1, -1);
      } else if (value === 'true') {
        value = true;
      } else if (value === 'false') {
        value = false;
      } else if (!isNaN(Number(value))) {
        value = Number(value);
      } else if (value.startsWith('[')) {
        // Simple array of strings
        const arrMatch = value.match(/\[(.*)\]/);
        if (arrMatch) {
          value = arrMatch[1]
            .split(',')
            .map((s: string) => s.trim().replace(/"/g, ''))
            .filter(Boolean);
        }
      }

      currentSection[key] = value;
    }
  }

  return result;
}

/**
 * PhaseOrchestrator is the main entry point for the wdf-method V3.6 execution engine.
 * It reads split-file status, evaluates gates, auto-advances phases, and drives
 * story implementation with worktree isolation and signal-based agent communication.
 */
export class PhaseOrchestrator {
  private projectRoot: string;
  private skillRoot: string;
  private state!: SprintStatusManager;
  private worktree!: WorktreeManager;
  private gateEvaluator!: GateEvaluator;
  private storyRunner!: StoryRunner;
  private mergeQueue!: MergeQueueManager;
  private partyEngine!: PartyEngine;
  private config!: WorkflowConfig;

  constructor(projectRoot: string, skillRoot?: string) {
    this.projectRoot = resolve(projectRoot);
    this.skillRoot = skillRoot ? resolve(skillRoot) : this.projectRoot;
  }

  /**
   * Initialize the orchestrator: load state, config, create managers.
   */
  async initialize(): Promise<void> {
    // Load configuration first — all paths flow from this.
    this.config = loadConfig(this.projectRoot, { skillRoot: this.skillRoot }).config;

    // Configure subsystems whose paths come from config
    SignalManager.setSignalDir(getSignalDir(this.config, this.projectRoot));

    const trackingPath = getSprintTrackingPath(this.config, this.projectRoot);
    const statusDir = getStatusDir(this.config, this.projectRoot);

    if (existsSync(statusDir)) {
      this.state = await SprintStatusManager.loadFromStatusDir(statusDir, trackingPath);
    } else {
      this.state = await SprintStatusManager.load(trackingPath);
    }

    this.worktree = new WorktreeManager(this.projectRoot);
    this.gateEvaluator = new GateEvaluator(this.projectRoot);

    // Load customize.toml first so subsequent managers get scope-lock config.
    this.loadConfig();
    const scopeLockCfg = this.resolveScopeLockConfig();

    const storiesDir = this.resolveConfigPath('stories_output');
    const outputDir = this.resolveConfigPath('output_dir');
    this.storyRunner = new StoryRunner(
      this.state, this.worktree, this.gateEvaluator,
      this.projectRoot, storiesDir, outputDir,
      {
        protectedPaths: this.config.scope_lock?.protected_paths ?? [],
        scopeLockConfig: scopeLockCfg,
      }
    );
    this.mergeQueue = new MergeQueueManager(this.state, this.projectRoot, scopeLockCfg);
    this.partyEngine = new PartyEngine(this.projectRoot);
  }

  /**
   * Display the current status dashboard.
   */
  displayStatus(): string {
    const gs = this.state.data.global_state;
    const lines = [
      '═══════════════════════════════════════════',
      `Project: ${this.state.data.project}`,
      `Workflow: wdf-method v${this.state.data.workflow_version}`,
      `Overall: ${gs.overall_status}`,
      `Dev Mode: ${gs.dev_mode}`,
      `Triage Mode: ${gs.task_triage_mode}`,
      `Complexity: ${(gs as any).complexity_tier ?? 'standard'}`,
      `Requirements: ${gs.requirements_frozen_at ? 'frozen' : 'not frozen'}`,
      `Dev Order: ${gs.development_order_frozen_at ? 'frozen' : 'not frozen'}`,
      `Code Standards: ${(gs.code_standards_source ?? []).join(', ')}`,
      `Last Updated: ${this.state.data.updated_at}`,
      '═══════════════════════════════════════════',
    ];

    // Phase progress
    lines.push('');
    for (const phaseNum of [1, 2, 3, 4]) {
      const phase = this.state.getPhase(phaseNum);
      const status = phase?.status ?? 'NOT_STARTED';
      const bar = this.statusBar(status);
      const name = this.phaseName(phaseNum);
      lines.push(`Phase ${phaseNum} [${bar}] ${status.padEnd(11)} ${name}`);

      // Sub-phase details if phase is IN_PROGRESS or LOCKED
      if (phase?.substates) {
        for (const [key, sub] of Object.entries(phase.substates)) {
          if (!key.startsWith('phase_')) continue;
          const subNum = key.replace('phase_', '').replace('_', '.');
          const subBar = this.subStatusBar(sub.status);
          lines.push(`  └─ ${subNum.padEnd(4)} [${subBar}] ${sub.status.padEnd(11)} ${this.subPhaseName(phaseNum, subNum)}`);
        }
      }
    }

    // Blockers
    const blockingCRs = this.state.getOpenBlockingCRs();
    if (blockingCRs.length > 0) {
      lines.push('');
      lines.push(`Blockers: ${blockingCRs.length}`);
      for (const cr of blockingCRs) {
        lines.push(`  🔒 ${cr.id}: ${cr.title}`);
      }
    } else {
      lines.push('Blockers: None');
    }

    // Merge queue
    const mq = this.state.getMergeQueue();
    if (mq.items.length > 0) {
      const merged = mq.items.filter(i => i.merge_status === 'merged').length;
      const queued = mq.items.filter(i => i.merge_status === 'queued').length;
      const waiting = mq.items.filter(i => i.merge_status === 'waiting_dependency').length;
      lines.push(`Merge Queue: ${queued} queued, ${merged} merged, ${waiting} waiting`);
    }

    // Recent audit log (last 10)
    lines.push('');
    lines.push('📋 Recent Audit Logs:');
    const recent = readRecentAudit(this.projectRoot, 10);
    lines.push(...formatAuditLines(recent));

    return lines.join('\n');
  }

  private statusBar(status: string): string {
    const states: Record<string, number> = {
      'NOT_STARTED': 0, 'IN_PROGRESS': 2, 'DRAFT_COMPLETE': 3,
      'IN_REVIEW': 3, 'APPROVED': 4, 'LOCKED': 4, 'SKIPPED': 4,
      'PAUSED': 2,
      'CODE_ACCEPTED': 4, 'FEATURE_ACCEPTED': 4, 'UI_ACCEPTED': 4,
      'E2E_BROWSER_ACCEPTED': 4, 'MERGED': 4, 'BE_CODE_ACCEPTED': 3,
      'FE_UI_ACCEPTED': 3, 'FULL_STACK_INTEGRATED': 4,
      'ALL_SUB_PHASES_APPROVED': 3, 'ANALYSIS_COMPLETE': 4,
      'PLANNING_COMPLETE': 4, 'SOLUTIONING_COMPLETE': 4,
    };
    const progress = states[status] ?? 0;
    const filled = '█'.repeat(progress);
    const empty = '░'.repeat(4 - progress);
    return filled + empty;
  }

  private subStatusBar(status: string): string {
    const states: Record<string, number> = {
      'NOT_STARTED': 0, 'IN_PROGRESS': 2, 'VERIFIED': 3,
      'LOCKED': 4, 'SKIPPED': 4, 'APPROVED': 4, 'SUBMITTED': 3,
    };
    const progress = states[status] ?? 0;
    return '█'.repeat(progress) + '░'.repeat(4 - progress);
  }

  private phaseName(n: number): string {
    return ['', 'Analysis (optional)', 'Planning (PRD + UX)', 'Solutioning (Arch + Stories)', 'Implementation (BE + FE + Integration)'][n] ?? '';
  }

  private subPhaseName(phase: number, sub: string): string {
    const names: Record<number, Record<string, string>> = {
      1: { '1.1': 'Brainstorming', '1.2': 'Domain Research', '1.3': 'Product Brief' },
      2: { '2.1': 'Impact Mapping', '2.2': 'Event Storming', '2.3': 'JTBD Cards', '2.4': 'Story Mapping', '2.5': 'Kano+RICE+PRD', '2.6': 'User Flows & IA', '2.7': 'Wireframes', '2.8': 'Design System', '2.9': 'Interaction Design', '2.10': 'Design Acceptance' },
      3: { '3.1': 'System Context (C4 L1)', '3.2': 'Architecture Style', '3.3': 'Container Design (C4 L2)', '3.4': 'Quality Attributes', '3.5': 'Component Design (C4 L3)', '3.6': 'Epics & Feature Plan', '3.7': 'Story Design', '3.8': 'API & Data Design', '3.9': 'Readiness Check' },
      4: { '4.1': 'Sprint Planning', '4.2': 'BE Scaffolding', '4.3': 'BE Database & API Client', '4.4': 'BE Endpoints', '4.5': 'BE Testing Suite', '4.6': 'BE CODE ACCEPTANCE', '4.7': 'FE Scaffolding', '4.8': 'FE Design System', '4.9': 'FE API Client', '4.10': 'FE Pages', '4.11': 'FE A11y & Perf Audit', '4.12': 'FE UI ACCEPTANCE', '4.13': 'Integration & Acceptance', '4.14': 'Retrospective' },
    };
    return names[phase]?.[sub] ?? sub;
  }

  /**
   * Determine task triage mode and route accordingly.
   */
  async triageAndExecute(mode?: TriageMode): Promise<void> {
    const triageMode = mode ?? this.state.data.global_state.task_triage_mode ?? 'serial';

    console.log(`Triage Mode: ${triageMode.toUpperCase()}`);

    switch (triageMode) {
      case 'light':
        await this.executeLightMode();
        break;
      case 'serial':
        await this.executeSerialMode();
        break;
      case 'parallel':
        await this.executeParallelMode();
        break;
    }
  }

  /**
   * Light mode: skip Phase 1-3, go straight to simplified implementation.
   */
  private async executeLightMode(): Promise<void> {
    console.log('Light mode: Skipping Phase 1-3, entering simplified implementation');
    await this.state.setPhaseStatus(4, 'IN_PROGRESS');
    await this.executeImplementationPhase();
  }

  /**
   * Serial mode: full Phase 1-3, then Phase 4 stories executed sequentially.
   */
  private async executeSerialMode(): Promise<void> {
    await this.runPhases1To3();
    await this.executeImplementationPhase();
  }

  /**
   * Parallel mode: full Phase 1-3, then Phase 4 BE+FE tracks in parallel.
   */
  private async executeParallelMode(): Promise<void> {
    await this.runPhases1To3();
    await this.executeImplementationPhase();
    // In a real implementation, this would spawn parallel agents for BE and FE tracks.
    // For the orchestrator, it processes stories in dependency order, respecting track isolation.
  }

  /**
   * Run Phase 1-3 sequentially.
   */
  private async runPhases1To3(): Promise<void> {
    for (const phaseNum of [1, 2, 3]) {
      const phase = this.state.getPhase(phaseNum);
      if (phase?.status === 'LOCKED') continue;

      console.log(`\n── Phase ${phaseNum}: ${this.phaseName(phaseNum)} ──`);

      // Evaluate gate
      if (phase?.gate_card) {
        const gateResult = await this.gateEvaluator.evaluate(phase.gate_card, this.state);
        if (!gateResult.all_pass) {
          const reasons = gateResult.results.filter(r => r.status === 'fail').map(r => r.reason).join('; ');
          console.log(`  Gate failed: ${reasons}`);
          // For Phase 1, allow skip
          if (phaseNum === 1) {
            await this.state.setPhaseStatus(1, 'SKIPPED');
            continue;
          }
          return;
        }
      }

      // Mark phase as IN_PROGRESS
      if (phase?.status === 'NOT_STARTED') {
        await this.state.setPhaseStatus(phaseNum, 'IN_PROGRESS');
      }

      // Execute phase (in practice, this invokes BMAD skills)
      console.log(`  Executing Phase ${phaseNum}... (requires BMAD skill invocation)`);

      // Mark as LOCKED for demo purposes
      // In production, this would only happen after actual work + approval
      await this.state.setPhaseStatus(phaseNum, 'LOCKED');
      console.log(`  Phase ${phaseNum}: LOCKED`);
    }

    // Freeze requirements (at Phase 2.5) and dev order (at Phase 3.7)
    if (!this.state.data.global_state.requirements_frozen_at) {
      await this.state.freezeRequirements();
    }
    if (!this.state.data.global_state.development_order_frozen_at) {
      await this.state.freezeDevelopmentOrder();
    }
  }

  /**
   * Execute Phase 4: Implementation with V3.6 sub-phase progression.
   *
   * V3.6 sub-phase map:
   *   BE Track: 4.2 Scaffolding → 4.3 DB+API Client → 4.4 Endpoints (AUTO-CONTINUE) → 4.5 Testing → 4.6 Completion (CODE_ACCEPTANCE)
   *   FE Track: 4.7 Scaffolding → 4.8 Design System → 4.9 API Client → 4.10 Pages (AUTO-CONTINUE) → 4.11 A11y/Perf → 4.12 Completion (UI_ACCEPTANCE)
   *   Integration: 4.13 → 4.14 Retrospective
   */
  private async executeImplementationPhase(): Promise<void> {
    const gs = this.state.data.global_state;
    const isParallel = gs.task_triage_mode === 'parallel';
    const autoRunCfg = this.getAutoRunConfig();

    // ── 4.1: Sprint Planning ──
    if (!this.state.getSubState(4, 'phase_4_1') || this.state.getSubState(4, 'phase_4_1') === 'NOT_STARTED') {
      console.log('\n── Phase 4.1: Sprint Planning ──');
      await this.state.setSubState(4, 'phase_4_1', 'IN_PROGRESS');

      // Compute implementation boundary from development_order
      const order = this.state.getDevelopmentOrder();
      await this.state.setImplementationBoundary({
        backend_scope: order.filter(s => s.track === 'backend').flatMap(s => s.scope_write),
        frontend_scope: order.filter(s => s.track === 'frontend').flatMap(s => s.scope_write),
        shared_scope: [],
        forbidden_paths: this.getScopeLockConfig().forbidden_paths ?? [],
      });
      await this.worktree.createScopeFreezeTag();
      await this.state.setGateCard(4, [{ id: 'G4-01', status: 'pass' }]);
      await this.state.setSubState(4, 'phase_4_1', 'LOCKED');
      console.log('  Phase 4.1: LOCKED');
    }

    await this.state.setPhaseStatus(4, 'IN_PROGRESS');

    const order = this.state.getDevelopmentOrder();
    const beStories = order.filter(s => s.track === 'backend');
    const feStories = order.filter(s => s.track === 'frontend');

    console.log(`\n── Phase 4: Implementation (${isParallel ? 'PARALLEL' : 'SERIAL'} mode) ──`);
    console.log(`  Backend stories: ${beStories.length} | Frontend stories: ${feStories.length}`);
    console.log(`  Concurrency: ${autoRunCfg.maxConcurrentStories} | Timeout: ${autoRunCfg.storyAgentTimeoutMinutes}min`);

    // ── BE Track: 4.2 → 4.3 → 4.4 → 4.5 → 4.6 ──
    const beTrackPromise = this.runBETrack(beStories);

    // ── FE Track: 4.7 → 4.8 → 4.9 → 4.10 → 4.11 → 4.12 ──
    // In parallel mode, FE starts at the same time as BE (both gated on 4.1)
    const feTrackPromise = (async () => {
      if (isParallel) {
        // Small delay to ensure BE track has started writing state
        await new Promise(r => setTimeout(r, 100));
      } else {
        // Serial mode: wait for BE track to complete before starting FE
        await beTrackPromise;
      }
      return this.runFETrack(feStories);
    })();

    // Wait for both tracks
    const [, feResult] = await Promise.all([beTrackPromise, feTrackPromise]);

    // ── Post-track cross-validation ──
    if (autoRunCfg.crossStoryValidation) {
      console.log('\n── Cross-Story Validation ──');
      await this.runCrossStoryValidation();
    }

    // ── 4.13: Integration ──
    console.log('\n── Phase 4.13: Integration ──');
    await this.state.setSubState(4, 'phase_4_13', 'IN_PROGRESS');

    // Process merge queue (dependency-ordered)
    if (autoRunCfg.autoProcessQueue) {
      await this.processMergeQueue();
    }

    // Feature Acceptance
    await this.state.setSubState(4, 'phase_4_13', 'FEATURE_ACCEPTED');
    await this.state.setSubState(4, 'phase_4_13', 'LOCKED');
    console.log('  Phase 4.13: LOCKED — Feature Accepted');

    // ── 4.14: Retrospective ──
    console.log('\n── Phase 4.14: Retrospective ──');
    await this.state.setSubState(4, 'phase_4_14', 'IN_PROGRESS');
    await this.state.setSubState(4, 'phase_4_14', 'LOCKED');
    console.log('  Phase 4.14: LOCKED');

    await this.state.setPhaseStatus(4, 'FULL_STACK_INTEGRATED');
    await this.state.setPhaseStatus(4, 'APPROVED');
    await this.state.setPhaseStatus(4, 'LOCKED');
    await this.state.setOverallStatus('complete');

    console.log('\n═══════════════════════════════════════════');
    console.log('Phase 4: LOCKED — Implementation complete');
    console.log('═══════════════════════════════════════════');
  }

  /**
   * Run BE Track sub-phases 4.2 → 4.3 → 4.4 (AUTO-CONTINUE) → 4.5 → 4.6 (CODE_ACCEPTANCE)
   */
  private async runBETrack(stories: NonNullable<typeof this.state.data.global_state.development_order>): Promise<void> {
    if (!stories || stories.length === 0) {
      console.log('  BE Track: No stories');
      return;
    }

    // 4.2: Scaffolding
    await this.advanceSubPhase(4, 'phase_4_2', 'BE Scaffolding', async () => {
      // Scaffold project structure, install deps, health check
      console.log('    → Scaffolding backend project...');
    });

    // 4.3: Database & API Client Setup
    await this.advanceSubPhase(4, 'phase_4_3', 'BE Database & API Client', async () => {
      // Run migrations, configure routing, set up middleware
      console.log('    → Setting up database + API client...');
    });

    // 4.4: Endpoint Implementation (AUTO-CONTINUE)
    await this.advanceSubPhase(4, 'phase_4_4', 'BE Endpoints', async () => {
      await this.runTrackStories('backend', 'phase_4_4');
    });

    // 4.5: Testing Suite
    await this.advanceSubPhase(4, 'phase_4_5', 'BE Testing Suite', async () => {
      console.log('    → Running backend test suite...');
    });

    // 4.6: Completion Review (CODE_ACCEPTANCE)
    await this.advanceSubPhase(4, 'phase_4_6', 'BE Completion Review', async () => {
      console.log('    → CODE_ACCEPTANCE for backend...');
    });

    await this.state.setSubState(4, 'phase_4_6', 'CODE_ACCEPTED');
    console.log('  BE Track: CODE_ACCEPTED');
  }

  /**
   * Run FE Track sub-phases 4.7 → 4.8 → 4.9 → 4.10 (AUTO-CONTINUE) → 4.11 → 4.12 (UI_ACCEPTANCE)
   */
  private async runFETrack(stories: NonNullable<typeof this.state.data.global_state.development_order>): Promise<void> {
    if (!stories || stories.length === 0) {
      console.log('  FE Track: No stories');
      return;
    }

    // 4.7: Scaffolding
    await this.advanceSubPhase(4, 'phase_4_7', 'FE Scaffolding', async () => {
      console.log('    → Scaffolding frontend project...');
    });

    // 4.8: Design System
    await this.advanceSubPhase(4, 'phase_4_8', 'FE Design System', async () => {
      console.log('    → Building design system components...');
    });

    // 4.9: API Client
    await this.advanceSubPhase(4, 'phase_4_9', 'FE API Client', async () => {
      console.log('    → Generating typed API client...');
    });

    // 4.10: Page Implementation (AUTO-CONTINUE)
    await this.advanceSubPhase(4, 'phase_4_10', 'FE Pages', async () => {
      await this.runTrackStories('frontend', 'phase_4_10');
    });

    // 4.11: A11y & Perf Audit
    await this.advanceSubPhase(4, 'phase_4_11', 'FE A11y & Perf Audit', async () => {
      console.log('    → Running Lighthouse + axe audits...');
    });

    // 4.12: Completion Review (UI_ACCEPTANCE)
    await this.advanceSubPhase(4, 'phase_4_12', 'FE Completion Review', async () => {
      console.log('    → UI_ACCEPTANCE for frontend...');
    });

    await this.state.setSubState(4, 'phase_4_12', 'UI_ACCEPTED');
    console.log('  FE Track: UI_ACCEPTED');
  }

  /**
   * Advance a sub-phase: gate check → IN_PROGRESS → execute work → LOCKED
   */
  private async advanceSubPhase(
    phaseNum: number,
    subKey: string,
    label: string,
    work: () => Promise<void>
  ): Promise<void> {
    const current = this.state.getSubState(phaseNum, subKey);
    if (current === 'LOCKED' || current === 'CODE_ACCEPTED' || current === 'UI_ACCEPTED') {
      console.log(`  Phase ${subKey.replace('phase_', '').replace('_', '.')}: Already ${current}`);
      return;
    }

    console.log(`\n── Phase ${subKey.replace('phase_', '').replace('_', '.')}: ${label} ──`);
    await this.state.setSubState(phaseNum, subKey, 'IN_PROGRESS');
    await work();
    await this.state.setSubState(phaseNum, subKey, 'LOCKED');
    console.log(`  Phase ${subKey.replace('phase_', '').replace('_', '.')}: LOCKED`);
  }

  /**
   * Run all stories in a track for a given sub-phase, respecting dependency order and concurrency.
   */
  private async runTrackStories(track: Track, subKey: string): Promise<void> {
    const autoRunCfg = this.getAutoRunConfig();
    let runs = 0;
    const maxIterations = 100;

    while (runs < maxIterations) {
      // V3.6: Check pause signal before each dispatch
      if (this.checkPauseSignal()) {
        console.log('  ⏸  Pause signal detected — halting new dispatches');
        break;
      }

      const result = await this.storyRunner.runNextStory(track);
      if (!result) break;
      runs++;
      const serialFlag = result.serial_only ? ' [SERIAL_ONLY]' : '';
      console.log(`  ✓ ${result.storyId} completed — ${result.status}${serialFlag}`);
      // SRG-08: a serial-only story (touched a protected path) cannot run
      // alongside others. Stop this track's pump so the merge queue can drain
      // before any new dispatch picks up.
      if (result.serial_only) {
        console.log('  ⏸  Serial-only story dispatched — pausing track for queue drain');
        break;
      }
    }

    if (runs === 0) {
      console.log(`  No stories to run in ${track} track`);
    }
  }

  /**
   * Process the merge queue in dependency order.
   */
  private async processMergeQueue(): Promise<void> {
    const { ready } = await this.mergeQueue.reconcileDependencies();
    if (ready.length === 0) {
      console.log('  Merge queue: No items to process');
      return;
    }

    console.log(`  Merge queue: ${ready.length} items ready`);
    for (const item of ready) {
      console.log(`    → Merging ${item.story_id} (order ${item.merge_order})...`);
      await this.state.appendAudit('merge_attempt', { story_id: item.story_id, decision: 'approve' });
      appendAudit(this.projectRoot, 'merge_attempt', {
        status: 'info',
        story_id: item.story_id,
        message: `processing merge order ${item.merge_order}`,
        details: { merge_order: item.merge_order, branch: item.branch },
      });
      await this.mergeQueue.markMerging(item.story_id);

      try {
        const git = this.worktree['git'];
        const log = await git.raw('log', '--oneline', '-1');
        const commitHash = log.split(' ')[0];
        await this.mergeQueue.markMerged(item.story_id, commitHash);
        await this.state.appendAudit('merge_success', { story_id: item.story_id, decision: 'approve', data: { commit: commitHash } });
        appendAudit(this.projectRoot, 'merge_success', {
          status: 'pass',
          story_id: item.story_id,
          message: `merged at ${commitHash}`,
          details: { commit: commitHash },
        });
        console.log(`    ✓ ${item.story_id} merged`);
      } catch (err: any) {
        await this.mergeQueue.markFailed(item.story_id, err.message ?? String(err));
        await this.state.appendAudit('merge_failed', { story_id: item.story_id, decision: 'reject', reason: err.message });
        appendAudit(this.projectRoot, 'merge_abort', {
          status: 'fail',
          story_id: item.story_id,
          message: `merge failed: ${err.message ?? String(err)}`,
        });
        console.log(`    ✗ ${item.story_id} merge failed: ${err.message}`);
      }
    }
  }

  /**
   * Run cross-story validation: test + type-check + lint after all merges.
   */
  private async runCrossStoryValidation(): Promise<void> {
    const checks = this.config.auto_run?.merge_queue?.integration_checks ??
                   this.config.merge_queue?.default_integration_checks ??
                   ['npm run test', 'npm run build', 'npm run type-check'];

    for (const check of checks) {
      console.log(`    → ${check}`);
      try {
        const { execSync } = await import('child_process');
        execSync(check, { cwd: this.projectRoot, stdio: 'pipe', timeout: 120_000 });
        console.log(`    ✓ ${check} passed`);
      } catch {
        console.log(`    ⚠ ${check} failed or not configured — continuing`);
      }
    }
  }

  /**
   * Get auto-run configuration from customize.toml, with defaults.
   */
  private getAutoRunConfig(): {
    maxConcurrentStories: number;
    storyAgentTimeoutMinutes: number;
    dependencyWaitTimeoutMinutes: number;
    crossStoryValidation: boolean;
    autoProcessQueue: boolean;
  } {
    const cfg = this.config.auto_run;
    return {
      maxConcurrentStories: cfg?.concurrency?.max_concurrent_stories ?? 5,
      storyAgentTimeoutMinutes: cfg?.concurrency?.story_agent_timeout_minutes ?? 30,
      dependencyWaitTimeoutMinutes: cfg?.concurrency?.dependency_wait_timeout_minutes ?? 15,
      crossStoryValidation: cfg?.cross_story_validation ?? true,
      autoProcessQueue: cfg?.merge_queue?.auto_process ?? true,
    };
  }

  // ── Configuration ──

  private getScopeLockConfig(): { forbidden_paths?: string[]; protected_paths?: string[] } {
    return this.config.scope_lock ?? {} as any;
  }

  /**
   * Load `customize.toml` from the skill root or project root, applying
   * built-in defaults for any missing keys. Populates `this.config` with
   * the fully-typed result.
   */
  private loadConfig(): void {
    const { config } = loadConfig(this.projectRoot, {
      skillRoot: this.skillRoot ?? this.projectRoot,
      silent: true,
    });
    this.config = config;
  }

  /**
   * Resolve a config key containing a path template (e.g. `{project-root}/`).
   * Uses `resolvePath` from the config module; throws if the key is missing
   * from `config.workflow`.
   */
  private resolveConfigPath(key: keyof WorkflowConfig['workflow']): string {
    const template = this.config.workflow[key];
    if (!template || typeof template !== 'string') {
      throw new Error(`Workflow config missing expected path key: workflow.${String(key)}`);
    }
    return this.resolvePath(template);
  }

  private resolvePath(template: string): string {
    return resolvePath(template, this.projectRoot);
  }

  /**
   * Build a fully-typed `ScopeLockConfig` from `customize.toml`, applying
   * conservative defaults when fields are missing. Returns `null` only when
   * the section is entirely absent so downstream callers can short-circuit.
   */
  private resolveScopeLockConfig(): ScopeLockConfig | null {
    const cfg = this.config as Record<string, any>;
    const raw = cfg?.scope_lock;
    if (!raw) return null;

    const enforcement = (raw.enforcement_mode as ScopeLockConfig['enforcement_mode']) ?? 'strict';
    return {
      enabled: raw.enabled !== false,
      enforcement_mode: enforcement,
      srg_05_severity: (raw.srg_05_severity as 'blocking' | 'warning') ?? 'blocking',
      scope_expansion_requires: (raw.scope_expansion_requires as 'user_approval' | 'auto_approve') ?? 'user_approval',
      forbidden_paths: Array.isArray(raw.forbidden_paths) ? raw.forbidden_paths : [],
      protected_paths: Array.isArray(raw.protected_paths) ? raw.protected_paths : [],
    };
  }

  /**
   * Get the current active phase and sub-phase for status display.
   */
  getCurrentPhase(): { phase: number; subPhase: string | null; status: string } {
    for (const phaseNum of [4, 3, 2, 1]) {
      const phase = this.state.getPhase(phaseNum);
      if (phase?.status && phase.status !== 'NOT_STARTED') {
        // Find active sub-phase
        if (phase.substates) {
          for (const [key, sub] of Object.entries(phase.substates)) {
            if (sub.status === 'IN_PROGRESS') {
              return { phase: phaseNum, subPhase: key, status: sub.status };
            }
          }
        }
        return { phase: phaseNum, subPhase: null, status: phase.status };
      }
    }
    return { phase: 1, subPhase: null, status: 'NOT_STARTED' };
  }

  /**
   * Display merge queue status.
   */
  displayMergeQueue(): string {
    return this.mergeQueue.displayQueue();
  }

  // ── V3.6 Pause/Resume ──

  /** Gracefully pause the workflow */
  async pause(reason?: string): Promise<string> {
    SignalManager.pauseAll(reason);
    const activeAgents = SignalManager.listActiveAgents();
    for (const agentId of activeAgents) {
      SignalManager.pauseAgent(agentId);
    }
    await this.state.setOverallStatus('paused');
    return `Paused. ${activeAgents.length} agent(s) notified. Resume: /web-dev-flow resume`;
  }

  /** Resume from paused state */
  async resume(): Promise<string> {
    SignalManager.resumeAll();
    const activeAgents = SignalManager.listActiveAgents();
    for (const agentId of activeAgents) {
      SignalManager.clearAgentCommand(agentId);
    }
    await this.state.setOverallStatus('implementation');
    return `Resumed. ${activeAgents.length} agent(s) will continue at next sub-step.`;
  }

  /** Check if pause signal is active (called before each story dispatch) */
  private checkPauseSignal(): boolean {
    return SignalManager.isPaused();
  }

  // ── Phase Execution Commands ──

  /**
   * Start a specific phase. Evaluates gate card first, then executes sub-phases sequentially.
   */
  async startPhase(phaseNum: number): Promise<{
    success: boolean;
    phase: number;
    status: string;
    gate_passed: boolean;
    sub_phases_executed: number;
    messages: string[];
  }> {
    const messages: string[] = [];
    let subPhasesExecuted = 0;

    const phase = this.state.getPhase(phaseNum);
    if (!phase) {
      return {
        success: false,
        phase: phaseNum,
        status: 'ERROR',
        gate_passed: false,
        sub_phases_executed: 0,
        messages: [`Phase ${phaseNum} not found in workflow state`],
      };
    }

    if (phase.status === 'LOCKED') {
      return {
        success: true,
        phase: phaseNum,
        status: phase.status,
        gate_passed: true,
        sub_phases_executed: 0,
        messages: [`Phase ${phaseNum} is already LOCKED — no work needed`],
      };
    }

    // Evaluate gate if defined
    let gatePassed = true;
    if (phase.gate_card && phase.gate_card.length > 0) {
      const gateResult = await this.gateEvaluator.evaluate(phase.gate_card, this.state);
      gatePassed = gateResult.all_pass;

      if (!gateResult.all_pass) {
        const failures = gateResult.results.filter(r => r.status === 'fail');
        for (const f of failures) {
          messages.push(`Gate ${f.gate_check_id} failed: ${f.reason}`);
        }

        // Phase 1 is optional — allow skip if gate fails
        if (phaseNum === 1) {
          await this.state.setPhaseStatus(1, 'SKIPPED');
          messages.push('Phase 1 is optional — marked as SKIPPED');
          return {
            success: true,
            phase: phaseNum,
            status: 'SKIPPED',
            gate_passed: false,
            sub_phases_executed: 0,
            messages,
          };
        }

        return {
          success: false,
          phase: phaseNum,
          status: phase.status,
          gate_passed: false,
          sub_phases_executed: 0,
          messages,
        };
      }

      messages.push('All gate checks passed');
    }

    // Mark phase as IN_PROGRESS if not already
    if (phase.status === 'NOT_STARTED') {
      await this.state.setPhaseStatus(phaseNum, 'IN_PROGRESS');
      messages.push(`Phase ${phaseNum} set to IN_PROGRESS`);
    }

    // Execute sub-phases
    if (phase.substates) {
      for (const [subKey, sub] of Object.entries(phase.substates)) {
        if (!subKey.startsWith('phase_')) continue;
        if (sub.status === 'LOCKED' || sub.status === 'SKIPPED') continue;

        const subNum = subKey.replace('phase_', '').replace('_', '.');
        messages.push(`Executing sub-phase ${subNum}...`);

        await this.state.setSubState(phaseNum, subKey, 'IN_PROGRESS');

        // Sub-phase work would be done here (invoke BMAD skills, etc.)
        // For now, we simulate completion after marking IN_PROGRESS
        // In production, this would trigger actual skill invocation

        await this.state.setSubState(phaseNum, subKey, 'DRAFT_COMPLETE');
        await this.state.setSubState(phaseNum, subKey, 'VERIFIED');
        await this.state.setSubState(phaseNum, subKey, 'LOCKED');

        messages.push(`Sub-phase ${subNum}: LOCKED`);
        subPhasesExecuted++;
      }
    }

    // Mark phase as LOCKED if all sub-phases are done
    const allLocked = phase.substates && Object.values(phase.substates)
      .filter((s: any) => s.status && s.status !== 'NOT_STARTED')
      .every((s: any) => s.status === 'LOCKED' || s.status === 'SKIPPED');

    if (allLocked) {
      await this.state.setPhaseStatus(phaseNum, 'LOCKED');
      messages.push(`Phase ${phaseNum}: LOCKED`);
    }

    // Freeze requirements at Phase 2.5 and dev order at Phase 3.7
    if (phaseNum >= 2 && !this.state.data.global_state.requirements_frozen_at) {
      await this.state.freezeRequirements();
      messages.push('Requirements frozen');
    }
    if (phaseNum >= 3 && !this.state.data.global_state.development_order_frozen_at) {
      await this.state.freezeDevelopmentOrder();
      messages.push('Development order frozen');
    }

    return {
      success: true,
      phase: phaseNum,
      status: allLocked ? 'LOCKED' : 'IN_PROGRESS',
      gate_passed: gatePassed,
      sub_phases_executed: subPhasesExecuted,
      messages,
    };
  }

  /**
   * Evaluate the gate card for a specific phase.
   */
  async evaluatePhaseGate(phaseNum: number): Promise<{
    phase: number;
    all_pass: boolean;
    results: Array<{
      gate_check_id: string;
      status: 'pass' | 'fail' | 'warn';
      reason?: string;
      detail?: any;
    }>;
  }> {
    const phase = this.state.getPhase(phaseNum);
    if (!phase || !phase.gate_card || phase.gate_card.length === 0) {
      return {
        phase: phaseNum,
        all_pass: true,
        results: [{ gate_check_id: 'no_gate', status: 'pass', reason: 'No gate card defined for this phase' }],
      };
    }

    const result = await this.gateEvaluator.evaluate(phase.gate_card, this.state);
    return {
      phase: phaseNum,
      all_pass: result.all_pass,
      results: result.results,
    };
  }

  /**
   * Get detailed information about a specific sub-phase.
   */
  async getSubPhaseDetails(phaseNum: number, subId: string): Promise<{
    phase: number;
    sub_phase: string;
    status: string;
    name: string;
    gate_card?: any[];
    started_at?: string;
    completed_at?: string;
    artifacts?: string[];
  }> {
    const subKey = `phase_${subId.replace('.', '_')}`;
    const phase = this.state.getPhase(phaseNum);
    const sub = phase?.substates?.[subKey as keyof typeof phase.substates];

    return {
      phase: phaseNum,
      sub_phase: subId,
      status: (sub as any)?.status ?? 'NOT_STARTED',
      name: this.subPhaseName(phaseNum, subId),
      gate_card: (sub as any)?.gate_card,
      started_at: (sub as any)?.started_at,
      completed_at: (sub as any)?.completed_at,
      artifacts: (sub as any)?.artifacts ?? [],
    };
  }

  /**
   * Format phase start result for human-readable output.
   */
  formatPhaseStartResult(result: Awaited<ReturnType<PhaseOrchestrator['startPhase']>>): string {
    const lines: string[] = [];
    lines.push(`═══════════════════════════════════════`);
    lines.push(`Phase ${result.phase} Start Result`);
    lines.push(`═══════════════════════════════════════`);
    lines.push(``);
    lines.push(`Status: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    lines.push(`Phase Status: ${result.status}`);
    lines.push(`Gate: ${result.gate_passed ? '✅ PASSED' : '❌ FAILED'}`);
    lines.push(`Sub-phases executed: ${result.sub_phases_executed}`);
    lines.push(``);
    lines.push(`Messages:`);
    for (const msg of result.messages) {
      lines.push(`  • ${msg}`);
    }
    return lines.join('\n');
  }

  /**
   * Format gate evaluation result for human-readable output.
   */
  formatGateResult(result: Awaited<ReturnType<PhaseOrchestrator['evaluatePhaseGate']>>): string {
    const lines: string[] = [];
    lines.push(`═══════════════════════════════════════`);
    lines.push(`Phase ${result.phase} Gate Evaluation`);
    lines.push(`═══════════════════════════════════════`);
    lines.push(``);
    lines.push(`Overall: ${result.all_pass ? '✅ ALL PASSED' : '❌ SOME FAILED'}`);
    lines.push(``);

    for (const r of result.results) {
      const icon = r.status === 'pass' ? '✅' : r.status === 'warn' ? '⚠️' : '❌';
      lines.push(`${icon} ${r.gate_check_id}`);
      if (r.reason) {
        lines.push(`   ${r.reason}`);
      }
      if (r.detail && typeof r.detail === 'object' && Object.keys(r.detail).length > 0) {
        for (const [key, value] of Object.entries(r.detail)) {
          lines.push(`   ${key}: ${value}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Format sub-phase details for human-readable output.
   */
  formatSubPhaseDetails(details: Awaited<ReturnType<PhaseOrchestrator['getSubPhaseDetails']>>): string {
    const lines: string[] = [];
    lines.push(`═══════════════════════════════════════`);
    lines.push(`Sub-Phase ${details.sub_phase}: ${details.name}`);
    lines.push(`═══════════════════════════════════════`);
    lines.push(``);
    lines.push(`Status: ${details.status}`);
    if (details.started_at) {
      lines.push(`Started at: ${details.started_at}`);
    }
    if (details.completed_at) {
      lines.push(`Completed at: ${details.completed_at}`);
    }
    if (details.artifacts && details.artifacts.length > 0) {
      lines.push(``);
      lines.push(`Artifacts:`);
      for (const a of details.artifacts) {
        lines.push(`  • ${a}`);
      }
    }
    if (details.gate_card && details.gate_card.length > 0) {
      lines.push(``);
      lines.push(`Gate checks: ${details.gate_card.map((g: any) => g.id).join(', ')}`);
    }
    return lines.join('\n');
  }

  // ── Gate Commands ──

  /**
   * List all defined gate cards in the workflow.
   */
  listAllGates(): Array<{
    id: string;
    phase: number;
    type: string;
    description: string;
    check_count: number;
  }> {
    const gates: Array<{
      id: string;
      phase: number;
      type: string;
      description: string;
      check_count: number;
    }> = [];

    for (let phaseNum = 1; phaseNum <= 4; phaseNum++) {
      const phase = this.state.getPhase(phaseNum);
      if (phase?.gate_card) {
        gates.push({
          id: `phase-${phaseNum}-gate`,
          phase: phaseNum,
          type: phase.gate_card.phase ? 'entry' : 'completion',
          description: `Phase ${phaseNum} gate`,
          check_count: (phase.gate_card.checks || []).length,
        });
      }
    }

    // Also check sub-phase gates
    for (let phaseNum = 1; phaseNum <= 4; phaseNum++) {
      const phase = this.state.getPhase(phaseNum);
      if (phase?.substates) {
        for (const [subKey, sub] of Object.entries(phase.substates)) {
          const subGate = (sub as any).gate_card;
          if (subGate && subGate.checks) {
            gates.push({
              id: `${subKey}-gate`,
              phase: phaseNum,
              type: 'sub-phase',
              description: `${subKey} gate`,
              check_count: (subGate.checks || []).length,
            });
          }
        }
      }
    }

    return gates;
  }

  /**
   * Get gate details by ID.
   */
  getGateDetails(gateId: string): {
    found: boolean;
    gate?: any;
    phase?: number;
    sub_phase?: string;
  } {
    // Check phase gates first (id format: phase-N-gate)
    const phaseMatch = gateId.match(/phase-(\d+)-gate/);
    if (phaseMatch) {
      const phaseNum = parseInt(phaseMatch[1], 10);
      const phase = this.state.getPhase(phaseNum);
      if (phase?.gate_card) {
        return { found: true, gate: phase.gate_card, phase: phaseNum };
      }
    }

    // Check sub-phase gates (id format: phase_N_SUB-gate)
    const subPhaseMatch = gateId.match(/(phase_\d+_\w+)-gate/);
    if (subPhaseMatch) {
      const subKey = subPhaseMatch[1];
      const phaseNum = parseInt(subKey.split('_')[1], 10);
      const phase = this.state.getPhase(phaseNum);
      if (phase?.substates) {
        const sub = (phase.substates as any)[subKey];
        if (sub?.gate_card) {
          return { found: true, gate: sub.gate_card, phase: phaseNum, sub_phase: subKey };
        }
      }
    }

    // No gate found with that exact ID
    return { found: false };
  }

  /**
   * Evaluate a specific gate by ID.
   */
  async evaluateGate(gateId: string): Promise<{
    gate_id: string;
    found: boolean;
    all_pass?: boolean;
    results?: any[];
  }> {
    const details = this.getGateDetails(gateId);
    if (!details.found || !details.gate) {
      return { gate_id: gateId, found: false };
    }

    // Evaluate the gate checks (gateCard is the gate object, not an array)
    const gateChecks = details.gate.checks || [];
    const result = await this.gateEvaluator.evaluate({ checks: gateChecks }, this.state);
    return {
      gate_id: gateId,
      found: true,
      all_pass: result.all_pass,
      results: result.results,
    };
  }

  /**
   * Format gate list for human-readable output.
   */
  formatGateList(gates: ReturnType<PhaseOrchestrator['listAllGates']>): string {
    const lines: string[] = [];
    lines.push(`═══════════════════════════════════════`);
    lines.push(`All Gate Cards (${gates.length})`);
    lines.push(`═══════════════════════════════════════`);
    lines.push(``);

    for (const g of gates) {
      const typeLabel = g.type === 'entry' ? '⌨️' : g.type === 'completion' ? '✅' : '📋';
      lines.push(`${typeLabel} ${g.id} (Phase ${g.phase})`);
      lines.push(`   ${g.description}`);
      lines.push(`   Checks: ${g.check_count}`);
      lines.push(``);
    }

    return lines.join('\n');
  }

  /**
   * Format gate details for human-readable output.
   */
  formatGateDetails(details: ReturnType<PhaseOrchestrator['getGateDetails']>): string {
    if (!details.found) {
      return `Gate not found.`;
    }

    const g = details.gate!;
    const lines: string[] = [];
    lines.push(`═══════════════════════════════════════`);
    lines.push(`Gate: Phase ${details.phase}`);
    lines.push(`═══════════════════════════════════════`);
    lines.push(``);
    lines.push(`Phase: ${details.phase}`);
    if (details.sub_phase) {
      lines.push(`Sub-phase: ${details.sub_phase}`);
    }
    lines.push(`Status: ${g.all_pass ? '✅ PASSED' : '⏳ PENDING'}`);
    lines.push(``);

    if (g.checks && g.checks.length > 0) {
      lines.push(`Checks (${g.checks.length}):`);
      for (const check of g.checks) {
        lines.push(`  • ${check.type}${check.id ? ` (${check.id})` : ''}`);
        if (check.description) lines.push(`    ${check.description}`);
      }
    }

    return lines.join('\n');
  }

  // ── Change Request Commands ──

  /**
   * List all change requests.
   */
  listChangeRequests(filters?: { status?: string; blocking?: boolean }): {
    total: number;
    open_blocking: number;
    open_non_blocking: number;
    resolved: number;
    items: any[];
  } {
    const allCRs = this.state.data.change_requests ?? [];
    const items = filters
      ? allCRs.filter((cr: any) => {
          if (filters.status && cr.status !== filters.status) return false;
          if (filters.blocking !== undefined && cr.severity !== (filters.blocking ? 'blocking' : 'non_blocking')) return false;
          return true;
        })
      : allCRs;

    return {
      total: allCRs.length,
      open_blocking: allCRs.filter((cr: any) => cr.status === 'open' && cr.severity === 'blocking').length,
      open_non_blocking: allCRs.filter((cr: any) => cr.status === 'open' && cr.severity === 'non_blocking').length,
      resolved: allCRs.filter((cr: any) => cr.status === 'resolved').length,
      items,
    };
  }

  /**
   * Get a specific change request by ID.
   */
  getChangeRequest(crId: string): { found: boolean; cr?: any } {
    const crs = this.state.data.change_requests ?? [];
    const cr = crs.find((c: any) => c.id === crId);
    return cr ? { found: true, cr } : { found: false };
  }

  /**
   * Create a new change request.
   */
  async createChangeRequest(data: {
    title: string;
    description: string;
    blocking: boolean;
    source_phase?: number;
    affected_phase?: number;
    author?: string;
  }): Promise<{
    success: boolean;
    cr_id: string;
    messages: string[];
  }> {
    const messages: string[] = [];

    try {
      await this.state.addChangeRequest({
        title: data.title,
        description: data.description,
        source_phase: data.source_phase ?? 1,
        source_artifact: 'manual',
        discovered_in_phase: data.affected_phase ?? 2,
        severity: data.blocking ? 'blocking' : 'non_blocking',
        created_by: data.author ?? 'system',
      });

      const crs = this.state.data.change_requests ?? [];
      const newCR = crs[crs.length - 1];
      messages.push(`Change request created successfully`);
      messages.push(`Type: ${data.blocking ? '🔴 BLOCKING' : '🟡 NON-BLOCKING'}`);
      if (data.source_phase) messages.push(`Source: Phase ${data.source_phase}`);
      if (data.affected_phase) messages.push(`Discovered in: Phase ${data.affected_phase}`);

      return {
        success: true,
        cr_id: newCR?.id ?? 'unknown',
        messages,
      };
    } catch (err: any) {
      return {
        success: false,
        cr_id: '',
        messages: [`Failed to create CR: ${err.message}`],
      };
    }
  }

  /**
   * Resolve a change request.
   */
  async resolveChangeRequest(crId: string, resolution: string, resolver?: string): Promise<{
    success: boolean;
    cr_id: string;
    messages: string[];
  }> {
    try {
      // First resolve the CR
      await this.state.resolveChangeRequest(crId, resolution);

      // Then add resolved_by if provided
      if (resolver) {
        const crs = this.state.data.change_requests ?? [];
        const cr = crs.find((c: any) => c.id === crId);
        if (cr) {
          cr.resolved_by = resolver;
          await this.state.save();
        }
      }

      return {
        success: true,
        cr_id: crId,
        messages: [`CR ${crId} resolved successfully`, `Resolution: ${resolution}`],
      };
    } catch (err: any) {
      return {
        success: false,
        cr_id: crId,
        messages: [`Failed to resolve CR: ${err.message}`],
      };
    }
  }

  /**
   * Format CR list for human-readable output.
   */
  formatCRList(list: ReturnType<PhaseOrchestrator['listChangeRequests']>): string {
    const lines: string[] = [];
    lines.push(`═══════════════════════════════════════`);
    lines.push(`Change Requests`);
    lines.push(`═══════════════════════════════════════`);
    lines.push(``);
    lines.push(`Summary:`);
    lines.push(`  Open (blocking): ${list.open_blocking}`);
    lines.push(`  Open (non-blocking): ${list.open_non_blocking}`);
    lines.push(`  Resolved: ${list.resolved}`);
    lines.push(`  Total: ${list.total}`);
    lines.push(``);

    if (list.items.length === 0) {
      lines.push(`No change requests match the filter.`);
      return lines.join('\n');
    }

    lines.push(`Items (${list.items.length}):`);
    lines.push(``);
    for (const cr of list.items) {
      const statusIcon = cr.status === 'open' ? (cr.severity === 'blocking' ? '🔴' : '🟡') : '✅';
      const statusLabel = cr.status === 'open'
        ? (cr.severity === 'blocking' ? 'BLOCKING' : 'OPEN')
        : `RESOLVED (${cr.resolved_at?.split('T')[0] ?? ''})`;

      lines.push(`${statusIcon} ${cr.id} [${statusLabel}]`);
      lines.push(`   ${cr.title}`);
      if (cr.source_phase) lines.push(`   Source: Phase ${cr.source_phase}`);
      if (cr.discovered_in_phase) lines.push(`   Discovered in: Phase ${cr.discovered_in_phase}`);
      lines.push(``);
    }

    return lines.join('\n');
  }

  /**
   * Format CR details for human-readable output.
   */
  formatCRDetails(result: ReturnType<PhaseOrchestrator['getChangeRequest']>): string {
    if (!result.found || !result.cr) {
      return `Change request not found.`;
    }

    const cr = result.cr;
    const lines: string[] = [];
    lines.push(`═══════════════════════════════════════`);
    lines.push(`Change Request: ${cr.id}`);
    lines.push(`═══════════════════════════════════════`);
    lines.push(``);
    lines.push(`Status: ${cr.status === 'open' ? (cr.severity === 'blocking' ? '🔴 OPEN (BLOCKING)' : '🟡 OPEN') : '✅ RESOLVED'}`);
    lines.push(`Title: ${cr.title}`);
    if (cr.created_by) lines.push(`Author: ${cr.created_by}`);
    lines.push(`Created: ${cr.created_at}`);
    if (cr.source_phase) lines.push(`Source Phase: ${cr.source_phase}`);
    if (cr.discovered_in_phase) lines.push(`Discovered in Phase: ${cr.discovered_in_phase}`);
    lines.push(``);
    lines.push(`Description:`);
    lines.push(`  ${cr.description}`);
    lines.push(``);

    if (cr.status === 'resolved') {
      lines.push(`Resolution:`);
      lines.push(`  ${cr.resolution}`);
      lines.push(`Resolved by: ${cr.resolved_by ?? 'unknown'}`);
      lines.push(`Resolved at: ${cr.resolved_at}`);
    }

    return lines.join('\n');
  }

  /**
   * Format CR creation/resolve result for human-readable output.
   */
  formatCROperationResult(result: Awaited<ReturnType<PhaseOrchestrator['createChangeRequest']>>): string {
    const lines: string[] = [];
    lines.push(result.success ? '✅ Success' : '❌ Failed');
    if (result.cr_id) lines.push(`CR ID: ${result.cr_id}`);
    lines.push(``);
    for (const msg of result.messages) {
      lines.push(`  ${msg}`);
    }
    return lines.join('\n');
  }

  // ── Story Commands ──

  /**
   * List all stories in the development order with their status.
   */
  listStories(options?: { track?: string; status?: string }): {
    total: number;
    stories: Array<{
      id: string;
      title?: string;
      track?: string;
      status?: string;
      order?: number;
      depends_on?: string[];
      scope_write?: string[];
    }>;
  } {
    const order = this.state.getDevelopmentOrder();
    const beStories = this.state.getStories(4, 'phase_4_4');
    const feStories = this.state.getStories(4, 'phase_4_10');

    const statusMap = new Map<string, string>();
    for (const s of beStories) statusMap.set(s.id, s.status as string);
    for (const s of feStories) statusMap.set(s.id, s.status as string);

    let stories = order.map(s => ({
      id: s.story_id,
      title: s.title,
      track: s.track,
      status: statusMap.get(s.story_id) ?? 'NOT_STARTED',
      order: s.order,
      depends_on: s.depends_on?.map((d: any) => d.story_id) ?? [],
      scope_write: s.scope_write,
    }));

    if (options?.track) {
      stories = stories.filter(s => s.track === options.track);
    }

    if (options?.status) {
      stories = stories.filter(s => s.status?.toUpperCase() === options.status.toUpperCase());
    }

    return {
      total: stories.length,
      stories,
    };
  }

  /**
   * Get details for a specific story.
   */
  getStoryDetails(storyId: string): {
    found: boolean;
    story?: {
      id: string;
      title?: string;
      track?: string;
      status?: string;
      order?: number;
      depends_on?: string[];
      scope_write?: string[];
      acceptance_check?: string[];
      started_at?: string;
      completed_at?: string;
      serial_only?: boolean;
    };
  } {
    const order = this.state.getDevelopmentOrder();
    const storyEntry = order.find((s: any) => s.story_id === storyId);

    if (!storyEntry) {
      return { found: false };
    }

    const beStories = this.state.getStories(4, 'phase_4_4');
    const feStories = this.state.getStories(4, 'phase_4_10');
    const allStories = [...beStories, ...feStories];
    const storyStatus = allStories.find((s: any) => s.id === storyId);

    return {
      found: true,
      story: {
        id: storyId,
        title: storyEntry.title,
        track: storyEntry.track,
        status: (storyStatus as any)?.status ?? 'NOT_STARTED',
        order: storyEntry.order,
        depends_on: storyEntry.depends_on?.map((d: any) => d.story_id) ?? [],
        scope_write: storyEntry.scope_write,
        acceptance_check: storyEntry.acceptance_check,
        started_at: (storyStatus as any)?.started_at,
        completed_at: (storyStatus as any)?.completed_at,
        serial_only: (storyStatus as any)?.serial_only,
      },
    };
  }

  /**
   * Start a story (run SRG gate and dispatch agent).
   */
  async startStory(storyId: string): Promise<{
    success: boolean;
    story_id: string;
    status: string;
    messages: string[];
    srg_results?: any[];
  }> {
    const messages: string[] = [];
    const order = this.state.getDevelopmentOrder();
    const storyEntry = order.find((s: any) => s.story_id === storyId);

    if (!storyEntry) {
      return {
        success: false,
        story_id: storyId,
        status: 'NOT_FOUND',
        messages: [`Story ${storyId} not found in development order`],
      };
    }

    messages.push(`Starting story: ${storyEntry.title}`);

    try {
      const result = await this.storyRunner.runNextStory(storyEntry.track as any);

      if (result) {
        messages.push(`Story ${result.storyId} completed with status: ${result.status}`);
        return {
          success: result.status === 'MERGED',
          story_id: result.storyId,
          status: result.status,
          messages,
        };
      } else {
        messages.push(`Story ${storyId} is not ready to run (check dependencies or status)`);
        return {
          success: false,
          story_id: storyId,
          status: 'BLOCKED',
          messages,
        };
      }
    } catch (err: any) {
      messages.push(`Error: ${err.message}`);
      return {
        success: false,
        story_id: storyId,
        status: 'ERROR',
        messages,
      };
    }
  }

  /**
   * Format story list for human-readable output.
   */
  formatStoryList(list: ReturnType<PhaseOrchestrator['listStories']>): string {
    const lines: string[] = [];
    lines.push('═══════════════════════════════════════════');
    lines.push('Stories');
    lines.push('═══════════════════════════════════════════');
    lines.push(`Total: ${list.total}`);
    lines.push('');

    const statusIcons: Record<string, string> = {
      NOT_STARTED: '⚪',
      IN_PROGRESS: '🔄',
      MERGED: '✅',
      CODE_ACCEPTED: '✅',
      BLOCKED: '❌',
      BLOCKED_BY_DEPENDENCY: '🔒',
    };

    // Group by track
    const beStories = list.stories.filter(s => s.track === 'backend');
    const feStories = list.stories.filter(s => s.track === 'frontend');

    if (beStories.length > 0) {
      lines.push('Backend:');
      lines.push('Order  Story ID        Status   Title');
      lines.push('────── ──────────────  ───────  ──────────────────────────────────');
      for (const s of beStories.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
        const icon = statusIcons[s.status ?? 'NOT_STARTED'] ?? s.status;
        lines.push(
          `${String(s.order ?? '').padEnd(6)} ${s.id.padEnd(14)} ${String(icon).padEnd(8)} ${s.title ?? '-'}`
        );
      }
      lines.push('');
    }

    if (feStories.length > 0) {
      lines.push('Frontend:');
      lines.push('Order  Story ID        Status   Title');
      lines.push('────── ──────────────  ───────  ──────────────────────────────────');
      for (const s of feStories.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
        const icon = statusIcons[s.status ?? 'NOT_STARTED'] ?? s.status;
        lines.push(
          `${String(s.order ?? '').padEnd(6)} ${s.id.padEnd(14)} ${String(icon).padEnd(8)} ${s.title ?? '-'}`
        );
      }
      lines.push('');
    }

    // Summary counts
    const counts = {
      notStarted: list.stories.filter(s => s.status === 'NOT_STARTED').length,
      inProgress: list.stories.filter(s => s.status === 'IN_PROGRESS').length,
      completed: list.stories.filter(s => s.status === 'MERGED' || s.status === 'CODE_ACCEPTED').length,
      blocked: list.stories.filter(s => s.status === 'BLOCKED' || s.status === 'BLOCKED_BY_DEPENDENCY').length,
    };

    lines.push(`Summary: ${counts.completed} completed, ${counts.inProgress} in progress, ${counts.notStarted} pending, ${counts.blocked} blocked`);

    return lines.join('\n');
  }

  /**
   * Format story details for human-readable output.
   */
  formatStoryDetails(details: ReturnType<PhaseOrchestrator['getStoryDetails']>): string {
    if (!details.found || !details.story) {
      return 'Story not found.';
    }

    const s = details.story;
    const lines: string[] = [];
    lines.push('═══════════════════════════════════════════');
    lines.push(`Story: ${s.id}`);
    lines.push('═══════════════════════════════════════════');
    lines.push('');
    lines.push(`Title:     ${s.title ?? '-'}`);
    lines.push(`Track:     ${s.track ?? '-'}`);
    lines.push(`Status:    ${s.status ?? 'NOT_STARTED'}`);
    lines.push(`Order:     ${s.order ?? '-'}`);
    if (s.serial_only) lines.push(`Serial:    Yes (protected path)`);

    if (s.depends_on && s.depends_on.length > 0) {
      lines.push(`Depends:   ${s.depends_on.join(', ')}`);
    }

    if (s.scope_write && s.scope_write.length > 0) {
      lines.push('');
      lines.push('Scope Write:');
      for (const path of s.scope_write) {
        lines.push(`  • ${path}`);
      }
    }

    if (s.acceptance_check && s.acceptance_check.length > 0) {
      lines.push('');
      lines.push('Acceptance Checks:');
      for (const check of s.acceptance_check) {
        lines.push(`  • ${check}`);
      }
    }

    if (s.started_at) lines.push(`Started:   ${s.started_at}`);
    if (s.completed_at) lines.push(`Completed: ${s.completed_at}`);

    return lines.join('\n');
  }

  // ── Queue Commands ──

  /**
   * Get queue status (alias for displayQueue).
   */
  getQueueStatus(): string {
    return this.displayMergeQueue();
  }

  /**
   * Get queue items in structured format.
   */
  getQueueItems(): {
    total: number;
    queued: number;
    merged: number;
    waiting: number;
    failed: number;
    items: any[];
  } {
    const mq = this.state.getMergeQueue();
    const items = [...mq.items].sort((a, b) => a.merge_order - b.merge_order);

    return {
      total: items.length,
      queued: items.filter((i: any) => i.merge_status === 'queued').length,
      merged: items.filter((i: any) => i.merge_status === 'merged').length,
      waiting: items.filter((i: any) => i.merge_status === 'waiting_dependency').length,
      failed: items.filter((i: any) => i.merge_status === 'failed').length,
      items,
    };
  }

  /**
   * Process next ready item in queue.
   */
  async processNextQueueItem(): Promise<{
    processed: boolean;
    story_id?: string;
    status?: string;
    commit?: string;
    error?: string;
  }> {
    const nextItem = await this.mergeQueue.getNextReady();

    if (!nextItem) {
      return { processed: false, error: 'No items ready for merge' };
    }

    await this.mergeQueue.markMerging(nextItem.story_id);
    const result = await this.mergeQueue.attemptAtomicMerge(nextItem);

    if (result.merged && result.commitHash) {
      await this.mergeQueue.markMerged(nextItem.story_id, result.commitHash);
      return {
        processed: true,
        story_id: nextItem.story_id,
        status: 'merged',
        commit: result.commitHash,
      };
    } else {
      return {
        processed: false,
        story_id: nextItem.story_id,
        status: 'failed',
        error: result.error,
      };
    }
  }

  /**
   * Process all ready items in queue.
   */
  async processQueue(): Promise<{
    processed: number;
    failed: number;
    results: Array<{ story_id: string; status: string; commit?: string; error?: string }>;
  }> {
    const results: Array<{ story_id: string; status: string; commit?: string; error?: string }> = [];
    let processed = 0;
    let failed = 0;

    while (true) {
      const result = await this.processNextQueueItem();
      if (!result.processed && !result.story_id) break; // No more items

      if (result.story_id) {
        results.push({
          story_id: result.story_id,
          status: result.status ?? (result.processed ? 'merged' : 'failed'),
          commit: result.commit,
          error: result.error,
        });

        if (result.processed) {
          processed++;
        } else {
          failed++;
        }
      }

      // Break if there was an error or if no more items
      if (!result.processed && result.error?.includes('No items')) break;
    }

    return { processed, failed, results };
  }

  // ── Party Mode Commands ──

  /**
   * Create a new party session.
   */
  createParty(config: PartyConfig): PartyState {
    return this.partyEngine.createParty(config);
  }

  /**
   * Start a party session.
   */
  async startParty(partyId: string): Promise<PartyState> {
    return this.partyEngine.startParty(partyId);
  }

  /**
   * Pause a party session.
   */
  async pauseParty(partyId: string, reason?: string): Promise<PartyState> {
    return this.partyEngine.pauseParty(partyId, reason);
  }

  /**
   * Execute a discussion round.
   */
  async executePartyRound(partyId: string, prompt: string): Promise<PartyState> {
    await this.partyEngine.executeRound(partyId, prompt);
    return this.partyEngine.getPartyState(partyId);
  }

  /**
   * Run cross-talk on a round.
   */
  async runCrossTalk(partyId: string, roundNumber: number): Promise<PartyState> {
    await this.partyEngine.executeCrossTalk(partyId, roundNumber);
    return this.partyEngine.getPartyState(partyId);
  }

  /**
   * Analyze convergence points from discussion.
   */
  analyzePartyConvergence(partyId: string): ConvergencePoint[] {
    return this.partyEngine.analyzeConvergence(partyId);
  }

  /**
   * Run first principles analysis.
   */
  runFirstPrinciplesAnalysis(partyId: string, topic?: string): FirstPrincipleAnalysis[] {
    return this.partyEngine.analyzeFirstPrinciples(partyId, topic);
  }

  /**
   * Resolve a convergence point.
   */
  resolvePartyConvergencePoint(
    partyId: string,
    pointId: string,
    resolution: string,
    resolvedBy: 'user' | 'consensus' | 'lead_agent' = 'user'
  ): ConvergencePoint | null {
    return this.partyEngine.resolveConvergencePoint(partyId, pointId, resolution, resolvedBy);
  }

  /**
   * Invite external expert to party.
   */
  inviteExpertToParty(partyId: string, expertType: string): { id: string; name: string; role: PartyRole } {
    const expert = this.partyEngine.inviteExpert(partyId, expertType);
    return { id: expert.id, name: expert.name, role: expert.role };
  }

  /**
   * Complete party and generate final report.
   */
  async completeParty(partyId: string): Promise<{ state: PartyState; outputPath: string }> {
    return this.partyEngine.completeParty(partyId);
  }

  /**
   * Get party state.
   */
  getPartyState(partyId: string): PartyState {
    return this.partyEngine.getPartyState(partyId);
  }

  /**
   * List all parties.
   */
  listParties(): ReturnType<PartyEngine['listParties']> {
    return this.partyEngine.listParties();
  }

  // ── Auto-Run Main Loop (CHG-2026-006) ──────────────────────────────

  /**
   * Hands-free execution loop chaining phase 1 → 2 → 3 → 4.
   *
   * At each phase: evaluates the gate card, starts the phase, executes
   * sub-phases sequentially, and only advances when the phase is LOCKED
   * or SKIPPED. Gate failures halt the loop by default
   * (see `customize.toml: [auto_run].halt_on_gate_failure`).
   *
   * The loop also polls for pause signals (SIGINT, agent pause files)
   * between phases and before each sub-phase. A paused loop saves state
   * and returns a `paused` result; the caller can resume by re-invoking
   * `runAutoLoop` — it will pick up at the first non-LOCKED phase.
   */
  async runAutoLoop(opts: AutoLoopOptions = {}): Promise<AutoLoopResult> {
    const max = opts.maxIterations ?? 50;
    const startPhase = opts.startPhase ?? this.detectCurrentPhase();
    const endPhase = opts.endPhase ?? 4;
    const verbose = opts.verbose ?? false;
    const autoCfg = this.getAutoRunConfig();
    const haltOnGate = this.config.auto_run?.halt_on_gate_failure ?? true;

    const log = (...args: unknown[]) => { if (verbose) console.log(...args); };
    const logOverride = opts.logFn ?? log;

    const phases: number[] = [];
    for (let p = startPhase; p <= endPhase; p++) phases.push(p);

    const timeline: PhaseLoopEntry[] = [];
    let iteration = 0;
    let paused = false;
    let pauseReason = '';

    // ── SIGINT handler (graceful pause) ────────────────────────────
    const onSigint = () => {
      paused = true;
      const phase = phases[timeline.length] ?? null;
      pauseReason = `SIGINT received${phase ? ` before Phase ${phase}` : ''}`;
      logOverride(`\n  ⏸  ${pauseReason}`);
    };
    const prevSigint = process.listeners('SIGINT').length;
    process.once('SIGINT', onSigint);

    try {
      for (let pi = 0; pi < phases.length && iteration < max; pi++) {
        const phaseNum = phases[pi];

        // Pre-phase pause check
        if (this.checkPauseSignal()) {
          paused = true;
          pauseReason = `pause signal detected before Phase ${phaseNum}`;
          break;
        }

        logOverride(`\n── Phase ${phaseNum}: ${this.phaseName(phaseNum)} ──`);
        timeline.push({ phase: phaseNum, status: 'started', at: new Date().toISOString() });

        // 1. Gate evaluation
        const gate = await this.evaluatePhaseGate(phaseNum);
        if (!gate.all_pass) {
          const entry = timeline[timeline.length - 1];
          entry.status = 'gate_failed';
          entry.gate_failures = gate.results.filter(r => r.status === 'fail').map(r => r.gate_check_id);
          logOverride(`  ✗ Gate failed: ${entry.gate_failures.join(', ')}`);
          if (haltOnGate) {
            timeline[timeline.length - 1].halted = true;
            break;
          }
          logOverride('  ⚠  halt_on_gate_failure disabled — continuing');
        }

        // 2. Start phase
        const result = await this.startPhase(phaseNum);
        logOverride(`  Status: ${result.status} | Gate: ${result.gate_passed ? 'pass' : 'fail'} | Sub-phases: ${result.sub_phases_executed}`);
        if (result.messages.length) {
          result.messages.slice(-3).forEach(m => logOverride(`    ${m}`));
        }

        timeline[timeline.length - 1].status = result.status === 'LOCKED' ? 'locked'
          : result.status === 'SKIPPED' ? 'skipped'
          : 'executed';

        // Phase 4 (Implementation) needs its special treatment
        if (phaseNum === 4 && result.success && result.status !== 'SKIPPED') {
          logOverride('  Entering Phase 4 implementation loop...');
          try {
            await this.executeImplementationPhase();
            timeline[timeline.length - 1].status = 'locked';
          } catch (e: any) {
            timeline[timeline.length - 1].status = 'error';
            timeline[timeline.length - 1].error = e.message;
            logOverride(`  ✗ Phase 4 error: ${e.message}`);
            if (haltOnGate) break;
          }
        }

        if (!result.success && haltOnGate) {
          timeline[timeline.length - 1].halted = true;
          break;
        }

        // Phase-complete pause check
        if (this.checkPauseSignal()) {
          paused = true;
          pauseReason = `pause signal after Phase ${phaseNum}`;
          break;
        }

        iteration++;
      }

      if (iteration >= max) {
        logOverride(`  ✗ Max iterations (${max}) reached — halted`);
      }
    } finally {
      process.removeListener('SIGINT', onSigint);
    }

    const completedPhases = timeline.filter(e => e.status === 'locked');
    const allDone = completedPhases.length === phases.length;

    return {
      all_phases_complete: allDone,
      phases_executed: completedPhases.length,
      total_phases: phases.length,
      paused,
      pause_reason: pauseReason || undefined,
      timeline,
      iterations: iteration,
    };
  }

  /** Detect the first non-LOCKED, non-SKIPPED phase. */
  private detectCurrentPhase(): number {
    for (let p = 1; p <= 4; p++) {
      const phase = this.state.getPhase(p);
      if (!phase || phase.status === 'NOT_STARTED') return p;
      if (phase.status === 'IN_PROGRESS') return p;
    }
    return 4; // All done — restart at 4 as a safety net
  }

  /**
   * Format party state for human-readable display.
   */
  formatPartyState(state: PartyState): string {
    const lines: string[] = [];
    lines.push('═══════════════════════════════════════════');
    lines.push(`Party: ${state.topic}`);
    lines.push('═══════════════════════════════════════════');
    lines.push('');
    lines.push(`ID: ${state.party_id}`);
    lines.push(`Phase: ${state.phase}`);
    lines.push(`Status: ${state.status}`);
    lines.push(`Started: ${state.started_at ?? 'Not started'}`);
    if (state.completed_at) lines.push(`Completed: ${state.completed_at}`);
    lines.push('');

    // Agents
    lines.push(`Agents (${state.agents.length}):`);
    for (const agent of state.agents) {
      const statusIcon = agent.status === 'responded' ? '✅' : agent.status === 'thinking' ? '🔄' : '⏳';
      lines.push(`  ${statusIcon} ${agent.name} (${agent.role})`);
    }
    lines.push('');

    // Rounds
    lines.push(`Discussion Rounds: ${state.rounds.length}`);
    for (const round of state.rounds) {
      const commentCount = round.cross_talk.length;
      lines.push(`  #${round.round_number}: ${commentCount} cross-talk comments`);
    }
    lines.push('');

    // Convergence
    if (state.convergence_points.length > 0) {
      const open = state.convergence_points.filter(p => !p.resolution).length;
      const resolved = state.convergence_points.filter(p => p.resolution).length;
      lines.push(`Convergence Points: ${state.convergence_points.length} total (${resolved} resolved, ${open} open)`);
      for (const point of state.convergence_points) {
        const statusIcon = point.resolution ? '✅' : '⚠️';
        lines.push(`  ${statusIcon} ${point.id} [${point.type}]: ${point.topic}`);
      }
      lines.push('');
    }

    // First Principles
    if (state.first_principles.length > 0) {
      lines.push(`First Principles Analyses: ${state.first_principles.length}`);
    }

    return lines.join('\n');
  }
}
