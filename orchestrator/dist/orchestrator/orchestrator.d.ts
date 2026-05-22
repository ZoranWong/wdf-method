import { TriageMode } from './types.js';
/**
 * PhaseOrchestrator is the main entry point for the wdf-method V3.6 execution engine.
 * It reads split-file status, evaluates gates, auto-advances phases, and drives
 * story implementation with worktree isolation and signal-based agent communication.
 */
export declare class PhaseOrchestrator {
    private projectRoot;
    private skillRoot;
    private state;
    private worktree;
    private gateEvaluator;
    private storyRunner;
    private mergeQueue;
    private config;
    constructor(projectRoot: string, skillRoot?: string);
    /**
     * Initialize the orchestrator: load state, config, create managers.
     */
    initialize(): Promise<void>;
    /**
     * Display the current status dashboard.
     */
    displayStatus(): string;
    private statusBar;
    private subStatusBar;
    private phaseName;
    private subPhaseName;
    /**
     * Determine task triage mode and route accordingly.
     */
    triageAndExecute(mode?: TriageMode): Promise<void>;
    /**
     * Light mode: skip Phase 1-3, go straight to simplified implementation.
     */
    private executeLightMode;
    /**
     * Serial mode: full Phase 1-3, then Phase 4 stories executed sequentially.
     */
    private executeSerialMode;
    /**
     * Parallel mode: full Phase 1-3, then Phase 4 BE+FE tracks in parallel.
     */
    private executeParallelMode;
    /**
     * Run Phase 1-3 sequentially.
     */
    private runPhases1To3;
    /**
     * Execute Phase 4: Implementation with V3.6 sub-phase progression.
     *
     * V3.6 sub-phase map:
     *   BE Track: 4.2 Scaffolding → 4.3 DB+API Client → 4.4 Endpoints (AUTO-CONTINUE) → 4.5 Testing → 4.6 Completion (CODE_ACCEPTANCE)
     *   FE Track: 4.7 Scaffolding → 4.8 Design System → 4.9 API Client → 4.10 Pages (AUTO-CONTINUE) → 4.11 A11y/Perf → 4.12 Completion (UI_ACCEPTANCE)
     *   Integration: 4.13 → 4.14 Retrospective
     */
    private executeImplementationPhase;
    /**
     * Run BE Track sub-phases 4.2 → 4.3 → 4.4 (AUTO-CONTINUE) → 4.5 → 4.6 (CODE_ACCEPTANCE)
     */
    private runBETrack;
    /**
     * Run FE Track sub-phases 4.7 → 4.8 → 4.9 → 4.10 (AUTO-CONTINUE) → 4.11 → 4.12 (UI_ACCEPTANCE)
     */
    private runFETrack;
    /**
     * Advance a sub-phase: gate check → IN_PROGRESS → execute work → LOCKED
     */
    private advanceSubPhase;
    /**
     * Run all stories in a track for a given sub-phase, respecting dependency order and concurrency.
     */
    private runTrackStories;
    /**
     * Process the merge queue in dependency order.
     */
    private processMergeQueue;
    /**
     * Run cross-story validation: test + type-check + lint after all merges.
     */
    private runCrossStoryValidation;
    /**
     * Get auto-run configuration from customize.toml, with defaults.
     */
    private getAutoRunConfig;
    private loadConfig;
    private resolveConfigPath;
    private getScopeLockConfig;
    /**
     * Get the current active phase and sub-phase for status display.
     */
    getCurrentPhase(): {
        phase: number;
        subPhase: string | null;
        status: string;
    };
    /**
     * Display merge queue status.
     */
    displayMergeQueue(): string;
}
//# sourceMappingURL=orchestrator.d.ts.map