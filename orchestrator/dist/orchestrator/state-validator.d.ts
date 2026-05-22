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
export declare class SprintStatusValidator {
    private projectRoot;
    constructor(projectRoot: string);
    /**
     * Run all validation checks on a sprint status object.
     */
    validate(status: SprintStatus): ValidationReport;
    /**
     * Validate that all FSM states in the document are known valid states.
     */
    private validateFSMStates;
    private isValidPhaseStatus;
    /**
     * Detect cycles in the merge queue dependency graph using DFS.
     */
    private detectMergeCycle;
    private computeSha256;
    /**
     * Format validation report as readable text.
     */
    formatReport(report: ValidationReport): string;
}
//# sourceMappingURL=state-validator.d.ts.map