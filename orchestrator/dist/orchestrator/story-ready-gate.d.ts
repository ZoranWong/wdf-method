/**
 * Story Ready Gate (SRG) — V3.6
 *
 * Validates that a story is ready to be executed before dispatching an agent.
 * Provides 9 checkpoints covering scope, paths, commands, dependencies, and
 * protected areas. All checks are fail-closed: anything not explicitly
 * permitted is rejected.
 *
 * SRG-01: Story has a valid story_id
 * SRG-02: scope_write is defined and non-empty
 * SRG-03: Story file exists on disk
 * SRG-04: Path safety — no traversal, no absolute paths, no forbidden files
 * SRG-05: No scope overlap with currently active stories
 * SRG-06: Scope is within implementation boundary (if frozen)
 * SRG-07: Parent directories for all scope paths exist
 * SRG-08: Protected path intersection → serial_only enforcement
 * SRG-09: Acceptance commands are on the allowlist and safe
 */
/**
 * Result of evaluating the Story Ready Gate for a single story.
 *
 * all_pass: Every SRG check passed (the story can proceed).
 * serial_only: SRG-08 detected a protected path — the story must run
 *   serially even if the scheduler would otherwise allow parallelism.
 * results: Individual check outcomes for debugging/UX.
 */
export interface StoryReadyGateResult {
    all_pass: boolean;
    serial_only: boolean;
    results: Array<{
        id: string;
        status: 'pass' | 'fail';
        reason?: string;
    }>;
}
/**
 * Minimal shape of a story entry — enough to run the gate.
 * Callers pass whatever they have; this interface documents what we actually
 * inspect.
 */
export interface GateStory {
    story_id: string;
    scope_write: string[];
    acceptance_check?: string[];
    track?: string;
    depends_on?: Array<{
        story_id: string;
    }>;
}
/**
 * Context needed to run the gate. All derived from the orchestrator's
 * current state and project configuration.
 */
export interface GateContext {
    projectRoot: string;
    storiesDir: string;
    activeStories: Array<{
        id: string;
        scope_write?: string[];
        status?: string;
    }>;
    protectedPaths: string[];
    implementationBoundary?: {
        scope_frozen: boolean;
        backend_scope: string[];
        frontend_scope: string[];
        shared_scope: string[];
    };
}
/**
 * Evaluate all 9 Story Ready Gate checks for a story.
 *
 * This is the single entry point for SRG evaluation — callers should use
 * this instead of the individual check functions.
 *
 * @param story - The story to evaluate.
 * @param ctx - Evaluation context (project paths, active stories, config).
 * @returns Gate result with pass/fail status, serial_only flag, and
 *   individual check outcomes.
 */
export declare function evaluateStoryReadyGate(story: GateStory, ctx: GateContext): StoryReadyGateResult;
//# sourceMappingURL=story-ready-gate.d.ts.map