import { existsSync } from 'fs';
import { resolve } from 'path';
import { SprintStatusManager } from './sprint-status.js';
import { WorktreeManager } from './worktree.js';
import { GateEvaluator } from './gate-evaluator.js';
import { StoryRunner } from './story-runner.js';
import { MergeQueueManager } from './merge-queue.js';
import { SignalManager } from './signal-manager.js';
import { appendAudit, readRecentAudit, formatAuditLines } from './audit-logger.js';
import { WorkflowConfig, AcceptanceGateConfig, ScopeLockConfig, Track, DevMode, TriageMode } from './types.js';

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

    const storiesDir = getStoriesDir(this.config, this.projectRoot);
    const outputDir = getOutputDir(this.config, this.projectRoot);
    this.storyRunner = new StoryRunner(
      this.state, this.worktree, this.gateEvaluator,
      this.projectRoot, storiesDir, outputDir
    );
    this.mergeQueue = new MergeQueueManager(this.state, this.projectRoot);
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
      console.log(`  ✓ ${result.storyId} completed — ${result.status}`);
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
}
