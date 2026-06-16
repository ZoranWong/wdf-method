/**
 * Create a backup copy of `filePath` before it is overwritten.
 *
 * Behavior:
 * - If the target file does not exist, returns null with no side effects.
 * - Otherwise creates `<statusDir>/backup/<ISO-TIMESTAMP>-<basename>.js` and
 *   returns the absolute backup path.
 *
 * The backup directory is created (recursively) on demand.
 */
export declare function backupFileBeforeWrite(filePath: string, statusDir: string): string | null;
//# sourceMappingURL=status-backup.d.ts.map