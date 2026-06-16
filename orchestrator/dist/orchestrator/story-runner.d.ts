import { SprintStatusManager } from './sprint-status.js';
import { WorktreeManager } from './worktree.js';
import { GateEvaluator } from './gate-evaluator.js';
import { Track } from './types.js';
/**
 * StoryRunner manages the lifecycle of individual stories during Phase 4.
 * Handles: worktree creation, story execution, scope validation, git commits, merge.
 */
export declare class StoryRunner {
    private state;
    private worktree;
    private gateEvaluator;
    private agentDispatcher;
    private storiesDir;
    private outputDir;
    constructor(state: SprintStatusManager, worktree: WorktreeManager, gateEvaluator: GateEvaluator, projectRoot: string, storiesDir: string, outputDir: string);
    /**
     * Main entry: run the next eligible story from development_order for the given track.
     * Returns the story that was run, or null if no story is ready.
     */
    runNextStory(track: Track): Promise<{
        storyId: string;
        status: string;
    } | null>;
    private tryRunStory;
    private resumeStory;
    /**
     * Check cross-track dependencies. Returns true if all deps are MERGED.
     */
    private checkDependencies;
    private isStoryMerged;
    /**
     * Story Ready Gate V3.6: validates all 9 SRG gates via the extracted
     * story-ready-gate module. Returns { all_pass, serial_only, results }.
     */
    private runStoryReadyGate;
    /**
     * Execute story implementation by dispatching a Claude Code agent to the story worktree.
     * The agent performs all steps (4c → 4j/4k) autonomously and returns CODE_ACCEPTED or failure.
     */
    private executeStorySteps;
    private executeStoryStepsFrom;
    /**
     * Execute a single sub-step. Used only for pre/post-agent validation steps.
     * The actual coding steps (4c-4k) are handled by the dispatched agent.
     */
    private executeStep;
    /**
     * Scope Exit Verification: git diff vs scope_write.
     */
    private runScopeExitVerification;
}
//# sourceMappingURL=story-runner.d.ts.map