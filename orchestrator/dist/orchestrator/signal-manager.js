import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
// V3.6: Signals live in user home, outside any git worktree.
// All worktrees (main + story/*) share the same home directory.
// Survives reboots, protected by user filesystem permissions.
//
// The default location is ~/.wdf-method/signals/ but it is overridable
// via [agent_communication].signal_dir in customize.toml. The orchestrator
// configures the path on startup by calling SignalManager.setSignalDir().
let SIGNAL_DIR = join(homedir(), '.wdf-method', 'signals');
/**
 * SignalManager — Cross-worktree agent communication via /tmp.
 * All agents (main orchestrator + story agents) share this directory.
 */
export class SignalManager {
    // Signals at ~/.wdf-method/signals/ — outside all git worktrees, persists across reboots
    // No need for init() — path is constant and always accessible from any worktree
    /** Override the signal directory (called by orchestrator from customize.toml). */
    static setSignalDir(dir) {
        SIGNAL_DIR = dir;
    }
    /** Read the current signal directory (for diagnostics). */
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