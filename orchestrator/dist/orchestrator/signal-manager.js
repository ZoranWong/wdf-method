import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
// V3.6: Signals live under the project's _wdf_output/signals/ directory.
// Worktrees (main + story/*) share the same project root via the orchestrator.
// Default falls back to cwd-relative until SignalManager.setProjectRoot() is called.
let SIGNAL_DIR = join(process.cwd(), '_wdf_output', 'signals');
/**
 * SignalManager — Cross-worktree agent communication via /tmp.
 * All agents (main orchestrator + story agents) share this directory.
 */
export class SignalManager {
    // Signals at _wdf_output/signals/ — relative to project root, scoped per-project
    // Use SignalManager.setProjectRoot(projectRoot) once at orchestrator startup
    // to point at the correct project's signal directory.
    /** Configure the signal directory based on the project root. */
    static setProjectRoot(projectRoot) {
        SIGNAL_DIR = join(projectRoot, '_wdf_output', 'signals');
    }
    /** Get the current signal directory (used for diagnostics) */
    static getSignalDir() {
        return SIGNAL_DIR;
    }
    /** Write global pause signal */
    static pauseAll(reason) {
        if (!existsSync(SIGNAL_DIR))
            mkdirSync(SIGNAL_DIR, { recursive: true });
        writeFileSync(join(SIGNAL_DIR, 'global.json'), JSON.stringify({
            action: 'pause_all',
            issued_at: new Date().toISOString(),
            reason: reason ?? 'User requested pause',
        }, null, 2));
    }
    /** Write global resume signal */
    static resumeAll() {
        if (existsSync(join(SIGNAL_DIR, 'global.json'))) {
            writeFileSync(join(SIGNAL_DIR, 'global.json'), JSON.stringify({
                action: 'none',
                issued_at: new Date().toISOString(),
            }, null, 2));
        }
    }
    /** Send pause command to a specific agent */
    static pauseAgent(agentId) {
        const dir = join(SIGNAL_DIR, 'agents', agentId);
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        writeFileSync(join(SIGNAL_DIR, `main-to-${agentId}.json`), JSON.stringify({
            type: 'pause',
            issued_at: new Date().toISOString(),
        }, null, 2));
    }
    /** Clear command for an agent */
    static clearAgentCommand(agentId) {
        const path = join(SIGNAL_DIR, `main-to-${agentId}.json`);
        if (existsSync(path)) {
            writeFileSync(path, JSON.stringify({ type: 'none', issued_at: new Date().toISOString() }, null, 2));
        }
    }
    /** Check if global pause is active */
    static isPaused() {
        try {
            const globalFile = join(SIGNAL_DIR, 'global.json');
            if (!existsSync(globalFile))
                return false;
            const data = JSON.parse(readFileSync(globalFile, 'utf-8'));
            return data.action === 'pause_all';
        }
        catch {
            return false;
        }
    }
    /** Read agent status from heartbeat file */
    static getAgentStatus(agentId) {
        try {
            const statusFile = join(SIGNAL_DIR, `${agentId}-to-main.json`);
            if (!existsSync(statusFile))
                return null;
            return JSON.parse(readFileSync(statusFile, 'utf-8'));
        }
        catch {
            return null;
        }
    }
    /** Read command for a specific agent */
    static getAgentCommand(agentId) {
        try {
            const cmdFile = join(SIGNAL_DIR, `main-to-${agentId}.json`);
            if (!existsSync(cmdFile))
                return { type: 'none', issued_at: '' };
            return JSON.parse(readFileSync(cmdFile, 'utf-8'));
        }
        catch {
            return { type: 'none', issued_at: '' };
        }
    }
    /** List all active agent IDs from signal directory */
    static listActiveAgents() {
        try {
            const agentsDir = join(SIGNAL_DIR, 'agents');
            if (!existsSync(agentsDir))
                return [];
            const { readdirSync } = require('fs');
            return readdirSync(agentsDir).filter((d) => {
                const heartbeat = join(agentsDir, d, 'heartbeat.txt');
                if (!existsSync(heartbeat))
                    return false;
                try {
                    const ts = readFileSync(heartbeat, 'utf-8').trim();
                    const age = Date.now() - new Date(ts).getTime();
                    return age < 120_000; // 120s heartbeat timeout
                }
                catch {
                    return false;
                }
            });
        }
        catch {
            return [];
        }
    }
    /** Clean up all signal files */
    static cleanup() {
        try {
            const { rmSync } = require('fs');
            if (existsSync(SIGNAL_DIR))
                rmSync(SIGNAL_DIR, { recursive: true, force: true });
        }
        catch {
            // Best-effort cleanup
        }
    }
}
//# sourceMappingURL=signal-manager.js.map