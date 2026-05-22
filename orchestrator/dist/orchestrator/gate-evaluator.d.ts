import { GateCard, Track } from './types.js';
import { SprintStatusManager } from './sprint-status.js';
/**
 * Evaluates Gate Cards to determine if a phase/sub-phase can be entered.
 * Supports: artifact_exists, artifact_metadata, dependency_status, user_confirmation,
 *           all_stories_complete, scope_boundary, custom_check.
 */
export declare class GateEvaluator {
    private projectRoot;
    constructor(projectRoot: string);
    /**
     * Evaluate a full Gate Card. Returns { all_pass, results }.
     */
    evaluate(gateCard: GateCard, state: SprintStatusManager, options?: {
        storyId?: string;
        track?: Track;
    }): Promise<{
        all_pass: boolean;
        results: {
            id: string;
            status: 'pass' | 'fail' | 'skipped';
            reason?: string;
        }[];
    }>;
    private evaluateCheck;
    private checkArtifactExists;
    private checkArtifactMetadata;
    private checkDependencyStatus;
    private checkAllStoriesComplete;
    private checkScopeBoundary;
    private checkCustom;
}
//# sourceMappingURL=gate-evaluator.d.ts.map