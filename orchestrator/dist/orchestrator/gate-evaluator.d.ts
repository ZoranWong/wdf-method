import { GateCard, Track } from './types.js';
import { SprintStatusManager } from './sprint-status.js';
/**
 * Known check types — must be kept in sync with the workflow spec.
 * Adding a new type here forces the dispatch switch to handle it (TypeScript
 * exhaustiveness check via {@link assertNever}). Anything not in this set is
 * rejected as an unknown check type by {@link GateEvaluator.evaluate}.
 */
export type KnownCheckType = 'artifact_exists' | 'artifact_metadata' | 'dependency_status' | 'user_confirmation' | 'all_stories_complete' | 'scope_boundary' | 'field_exists' | 'custom_check';
export type CheckResult = {
    id: string;
    status: 'pass' | 'fail' | 'skipped';
    reason?: string;
};
/**
 * Evaluates Gate Cards to determine whether a phase or sub-phase may be
 * entered. Behaviour is fail-closed: any check the evaluator does not
 * explicitly handle becomes a `fail` result with a human-readable reason.
 *
 * Supported types: artifact_exists, artifact_metadata, dependency_status,
 * user_confirmation, all_stories_complete, scope_boundary, field_exists,
 * custom_check.
 */
export declare class GateEvaluator {
    private projectRoot;
    constructor(projectRoot: string);
    /**
     * Evaluate a full Gate Card. Returns `{ all_pass, results }`.
     */
    evaluate(gateCard: GateCard, state: SprintStatusManager, options?: {
        storyId?: string;
        track?: Track;
    }): Promise<{
        all_pass: boolean;
        results: CheckResult[];
    }>;
    private evaluateCheck;
    private checkArtifactExists;
    private checkArtifactMetadata;
    /**
     * dependency_status checks read against {@link SprintStatusManager}. Only
     * the four fields enumerated in {@link SUPPORTED_DEPENDENCY_FIELDS} are
     * implemented. Anything else — including unsupported operators (`eq`,
     * `neq`, etc.) — fails with an explicit reason. There is no catch-all
     * "not yet implemented" pass any longer.
     */
    private checkDependencyStatus;
    private checkAllStoriesComplete;
    private checkScopeBoundary;
    /**
     * field_exists fails when the named field is missing from the source
     * artifact. The legacy implementation always passed; that silent pass is
     * removed.
     *
     * The story runner is still responsible for resolving `source: story_file`
     * placeholders when it knows the active story file. If the source cannot
     * be resolved here (no file path / placeholder unresolved), the check
     * fails-closed with a clear reason.
     */
    private checkFieldExists;
    /**
     * Custom checks (e.g. SRG-05 scope overlap, SRG-07 parent-dirs-exist) are
     * verified at the story-runner level — the gate evaluator records them
     * as `pass` with an explicit "delegated" reason so the audit trail makes
     * it clear the gate did not perform the verification itself. This is an
     * explicit, documented check type, not a catch-all default.
     */
    private checkCustom;
}
//# sourceMappingURL=gate-evaluator.d.ts.map