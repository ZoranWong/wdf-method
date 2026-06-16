import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { basename, join } from 'path';
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
export function backupFileBeforeWrite(filePath, statusDir) {
    if (!existsSync(filePath)) {
        return null;
    }
    const backupDir = join(statusDir, 'backup');
    if (!existsSync(backupDir)) {
        mkdirSync(backupDir, { recursive: true });
    }
    // ISO timestamps contain ':' which is illegal on some filesystems — sanitise.
    const timestamp = new Date().toISOString().replace(/[:]/g, '-');
    const backupName = `${timestamp}-${basename(filePath)}.js`;
    const backupPath = join(backupDir, backupName);
    copyFileSync(filePath, backupPath);
    return backupPath;
}
//# sourceMappingURL=status-backup.js.map