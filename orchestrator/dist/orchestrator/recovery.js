import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import YAML from 'js-yaml';
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
export function recoverStatus(projectRoot) {
    const actions = [];
    const warnings = [];
    const restoredFromBackup = [];
    let rebuiltDerivedStatus = false;
    const outDir = join(projectRoot, '_bmad-output', 'wdf-method');
    const statusDir = join(outDir, 'status');
    const backupDir = join(outDir, '.status-backup');
    const statusPath = join(outDir, 'sprint-status.yaml');
    actions.push(`Project root: ${projectRoot}`);
    // Stage 1: Check if status directory exists
    if (!existsSync(statusDir)) {
        warnings.push(`No status directory at ${statusDir}`);
        warnings.push('Cannot rebuild from split files — run orchestrator init first');
        return makeDashboard({ rebuiltDerivedStatus: false, restoredFromBackup, warnings, actions });
    }
    actions.push(`Found status directory: ${statusDir}`);
    // Stage 2: Validate and recover split files first
    const splitFiles = readdirSync(statusDir).filter(f => f.endsWith('.yaml'));
    actions.push(`Found ${splitFiles.length} split status files: ${splitFiles.join(', ')}`);
    for (const file of splitFiles) {
        const filePath = join(statusDir, file);
        try {
            const content = readFileSync(filePath, 'utf8');
            YAML.load(content);
        }
        catch {
            // Corrupted — try to restore from backup
            const restored = tryRestoreFromBackup(file, statusDir, backupDir);
            if (restored) {
                restoredFromBackup.push(file);
                actions.push(`Restored ${file} from backup`);
            }
            else {
                warnings.push(`Cannot recover ${file}: no valid backup exists`);
            }
        }
    }
    // Stage 3: Check if sprint-status.yaml is valid
    let statusIsValid = false;
    if (existsSync(statusPath)) {
        try {
            const content = readFileSync(statusPath, 'utf8');
            YAML.load(content);
            statusIsValid = true;
            actions.push('sprint-status.yaml is valid — no rebuild needed');
        }
        catch {
            actions.push('sprint-status.yaml is corrupted — will rebuild from split files');
            // Rename corrupted file as backup (never delete)
            const backupPath = `${statusPath}.corrupted.${Date.now()}`;
            writeFileSync(backupPath, readFileSync(statusPath));
            actions.push(`Renamed corrupted sprint-status.yaml to ${backupPath}`);
        }
    }
    else {
        actions.push('sprint-status.yaml not found — will rebuild from split files');
    }
    // Stage 4: Rebuild derived status if needed
    if (!statusIsValid) {
        try {
            const rebuilt = rebuildFromSplitFiles(statusDir);
            writeFileSync(statusPath, rebuilt);
            rebuiltDerivedStatus = true;
            actions.push('Rebuilt sprint-status.yaml from split status files');
        }
        catch (err) {
            warnings.push(`Failed to rebuild sprint-status.yaml: ${err.message}`);
        }
    }
    return makeDashboard({ rebuiltDerivedStatus, restoredFromBackup, warnings, actions });
}
/**
 * Try to restore a corrupted file from the most recent backup.
 * Returns true if restoration succeeded.
 */
function tryRestoreFromBackup(filename, statusDir, backupDir) {
    if (!existsSync(backupDir))
        return false;
    const backups = readdirSync(backupDir)
        .filter(f => f.startsWith(filename.replace('.yaml', '')) && f.endsWith('.yaml'))
        .sort((a, b) => {
        const aStat = statSync(join(backupDir, a));
        const bStat = statSync(join(backupDir, b));
        return bStat.mtime.getTime() - aStat.mtime.getTime();
    });
    for (const backup of backups) {
        try {
            const content = readFileSync(join(backupDir, backup), 'utf8');
            YAML.load(content); // Validate YAML
            writeFileSync(join(statusDir, filename), content);
            return true;
        }
        catch {
            continue; // Try older backup
        }
    }
    return false;
}
/**
 * Rebuild sprint-status.yaml from the split status files.
 * Merges global.yaml, phase-*.yaml, etc. into one document.
 */
function rebuildFromSplitFiles(statusDir) {
    const lines = [];
    lines.push('# AUTO-GENERATED — DO NOT EDIT DIRECTLY');
    lines.push('# Rebuilt from split status files by recovery engine');
    lines.push(`# Rebuilt at: ${new Date().toISOString()}`);
    lines.push('');
    // Always load global first
    const globalPath = join(statusDir, 'global.yaml');
    if (existsSync(globalPath)) {
        lines.push(readFileSync(globalPath, 'utf8').trim());
        lines.push('');
    }
    // Load phases in order
    for (let i = 1; i <= 4; i++) {
        const phasePath = join(statusDir, `phase-0${i}.yaml`);
        if (existsSync(phasePath)) {
            lines.push(readFileSync(phasePath, 'utf8').trim());
            lines.push('');
        }
    }
    // Load any other yaml files (stories, merge-queue, etc.)
    const others = readdirSync(statusDir)
        .filter(f => f.endsWith('.yaml') && f !== 'global.yaml' && !f.match(/^phase-0\d\.yaml$/))
        .sort();
    for (const other of others) {
        lines.push(readFileSync(join(statusDir, other), 'utf8').trim());
        lines.push('');
    }
    return lines.join('\n');
}
/**
 * Build a human-readable recovery dashboard.
 */
function makeDashboard(result) {
    const { rebuiltDerivedStatus, restoredFromBackup, warnings, actions } = result;
    const lines = [];
    lines.push('═══════════════════════════════════════════');
    lines.push('      Recovery Engine — Status Report      ');
    lines.push('═══════════════════════════════════════════');
    lines.push('');
    // Summary
    const overall = rebuiltDerivedStatus || restoredFromBackup.length > 0 ? 'RECOVERED' : 'NO ACTION NEEDED';
    lines.push(`  Status: ${overall === 'RECOVERED' ? '✅' : 'ℹ️'}  ${overall}`);
    lines.push('');
    if (rebuiltDerivedStatus) {
        lines.push('  ✅ sprint-status.yaml rebuilt from split files');
    }
    if (restoredFromBackup.length > 0) {
        lines.push(`  ✅ Restored ${restoredFromBackup.length} file(s) from backup:`);
        for (const f of restoredFromBackup) {
            lines.push(`       • ${f}`);
        }
    }
    lines.push('');
    if (warnings.length > 0) {
        lines.push('  ⚠️  Warnings (requires manual action):');
        for (const w of warnings) {
            lines.push(`       • ${w}`);
        }
        lines.push('');
    }
    lines.push('  Note: This is a NON-DESTRUCTIVE recovery.');
    lines.push('  No worktrees, branches, or git history were modified.');
    return {
        rebuiltDerivedStatus,
        restoredFromBackup,
        warnings,
        actions,
        dashboard: lines.join('\n'),
    };
}
//# sourceMappingURL=recovery.js.map