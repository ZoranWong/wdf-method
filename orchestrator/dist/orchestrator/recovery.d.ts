/**
 * Result of the non-destructive recovery operation.
 * All actions are logged but NO destructive operations are ever performed.
 */
export interface RecoveryResult {
    /** Whether sprint-status.yaml was rebuilt from split files */
    rebuiltDerivedStatus: boolean;
    /** Which split files were restored from backup */
    restoredFromBackup: string[];
    /** Any warnings for the user to act on manually */
    warnings: string[];
    /** All actions taken during recovery */
    actions: string[];
    /** Human-readable dashboard summary */
    dashboard: string;
}
/**
 * Non-destructive recovery engine for wdf-method.
 *
 * Core principles:
 * 1. NEVER delete anything — only rebuild derived state from source files
 * 2. NEVER reset git, branches, or worktrees
 * 3. All actions are logged and reversible
 * 4. Fail-closed: if unsure, warn and do nothing
 *
 * Recovery flow:
 * 1. Locate status directory and sprint-status.yaml
 * 2. Validate sprint-status.yaml
 * 3. If corrupted, rebuild from split status files
 * 4. If any split file is corrupted, restore from .status-backup/
 * 5. Never modify the original corrupted file (rename to .bak instead)
 *
 * @param projectRoot Root of the wdf-method project
 * @returns Recovery result with all actions and warnings
 */
export declare function recoverStatus(projectRoot: string): RecoveryResult;
//# sourceMappingURL=recovery.d.ts.map