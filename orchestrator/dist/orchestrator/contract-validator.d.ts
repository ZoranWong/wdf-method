/**
 * Story Contract Freeze Gate — validates 7 contract fields before a story can enter Phase 4.
 * Blocked stories cannot enter implementation until all fields are compliant.
 *
 * V3.1 requirement: Stories with non-compliant contracts are BLOCKED at Phase 3.7.
 */
export interface StoryContract {
    story_id: string;
    title: string;
    scope_write: string[];
    out_of_scope?: string[];
    acceptance_checks: string[];
    code_standards_source: string[];
    dependencies?: {
        story_id: string;
        track: string;
    }[];
    parallel_safe: boolean;
    ui_truth_source?: string;
    execution_units?: Record<string, any>;
}
export interface ContractValidationResult {
    story_id: string;
    passed: boolean;
    checks: {
        field: string;
        status: 'pass' | 'fail';
        reason?: string;
    }[];
    missing_fields: string[];
}
export declare class StoryContractValidator {
    private projectRoot;
    constructor(projectRoot: string);
    /**
     * Validate a single story's contract against all 7 required fields.
     */
    validate(story: StoryContract): ContractValidationResult;
    /**
     * Validate all stories in development_order. Returns a report.
     */
    validateAll(stories: StoryContract[]): {
        all_pass: boolean;
        blocked_stories: string[];
        results: ContractValidationResult[];
    };
    /**
     * Format validation report as readable text.
     */
    formatReport(results: ContractValidationResult[]): string;
}
//# sourceMappingURL=contract-validator.d.ts.map