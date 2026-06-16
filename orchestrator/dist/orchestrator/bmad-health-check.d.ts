/**
 * BMAD Skill Health Checker
 *
 * Validates that all required BMAD skills are available before the workflow executes.
 * Each skill failure produces a clear error message with resolution guidance.
 *
 * Skills are invoked via Claude Code's Skill tool. This checker verifies skill
 * definition files exist, not actual runtime behavior (which requires a running session).
 */
export interface HealthCheckResult {
    total_skills: number;
    available: number;
    missing: string[];
    unavailable: {
        name: string;
        skillInvocation: string;
        usedIn: string;
        critical: boolean;
    }[];
    critical_missing: string[];
    acceptance_commands: {
        name: string;
        available: boolean;
        usedIn?: string;
    }[];
    overall: 'healthy' | 'degraded' | 'blocked';
}
export declare class BmadHealthChecker {
    private bmadBaseDirs;
    constructor(projectRoot: string);
    /**
     * Check if BMAD skill files exist in the expected directories.
     * Each BMAD skill has a SKILL.md or equivalent definition file.
     */
    check(): Promise<HealthCheckResult>;
    /**
     * Format health check result as a readable report.
     */
    formatReport(check: HealthCheckResult): string;
}
//# sourceMappingURL=bmad-health-check.d.ts.map