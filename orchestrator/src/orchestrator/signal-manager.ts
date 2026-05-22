import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const SIGNAL_DIR = '/tmp/web-dev-flow/signals';

interface PauseCommand {
  type: 'pause' | 'abort' | 'none';
  issued_at: string;
  reason?: string;
}

interface AgentStatus {
  agent_id: string;
  story_id: string;
  track: string;
  current_substep: string;
  heartbeat_at: string;
  status: 'running' | 'paused' | 'aborted';
}

/**
 * SignalManager — Cross-worktree agent communication via /tmp.
 * All agents (main orchestrator + story agents) share this directory.
 */
export class SignalManager {
  /** Write global pause signal */
  static pauseAll(reason?: string): void {
    if (!existsSync(SIGNAL_DIR)) mkdirSync(SIGNAL_DIR, { recursive: true });
    writeFileSync(join(SIGNAL_DIR, 'global.json'), JSON.stringify({
      action: 'pause_all',
      issued_at: new Date().toISOString(),
      reason: reason ?? 'User requested pause',
    }, null, 2));
  }

  /** Write global resume signal */
  static resumeAll(): void {
    if (existsSync(join(SIGNAL_DIR, 'global.json'))) {
      writeFileSync(join(SIGNAL_DIR, 'global.json'), JSON.stringify({
        action: 'none',
        issued_at: new Date().toISOString(),
      }, null, 2));
    }
  }

  /** Send pause command to a specific agent */
  static pauseAgent(agentId: string): void {
    const dir = join(SIGNAL_DIR, 'agents', agentId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(SIGNAL_DIR, `main-to-${agentId}.json`), JSON.stringify({
      type: 'pause',
      issued_at: new Date().toISOString(),
    }, null, 2));
  }

  /** Clear command for an agent */
  static clearAgentCommand(agentId: string): void {
    const path = join(SIGNAL_DIR, `main-to-${agentId}.json`);
    if (existsSync(path)) {
      writeFileSync(path, JSON.stringify({ type: 'none', issued_at: new Date().toISOString() }, null, 2));
    }
  }

  /** Check if global pause is active */
  static isPaused(): boolean {
    try {
      const globalFile = join(SIGNAL_DIR, 'global.json');
      if (!existsSync(globalFile)) return false;
      const data = JSON.parse(readFileSync(globalFile, 'utf-8'));
      return data.action === 'pause_all';
    } catch {
      return false;
    }
  }

  /** Read agent status from heartbeat file */
  static getAgentStatus(agentId: string): AgentStatus | null {
    try {
      const statusFile = join(SIGNAL_DIR, `${agentId}-to-main.json`);
      if (!existsSync(statusFile)) return null;
      return JSON.parse(readFileSync(statusFile, 'utf-8')) as AgentStatus;
    } catch {
      return null;
    }
  }

  /** Read command for a specific agent */
  static getAgentCommand(agentId: string): PauseCommand {
    try {
      const cmdFile = join(SIGNAL_DIR, `main-to-${agentId}.json`);
      if (!existsSync(cmdFile)) return { type: 'none', issued_at: '' };
      return JSON.parse(readFileSync(cmdFile, 'utf-8')) as PauseCommand;
    } catch {
      return { type: 'none', issued_at: '' };
    }
  }

  /** List all active agent IDs from signal directory */
  static listActiveAgents(): string[] {
    try {
      const agentsDir = join(SIGNAL_DIR, 'agents');
      if (!existsSync(agentsDir)) return [];
      const { readdirSync } = require('fs');
      return readdirSync(agentsDir).filter((d: string) => {
        const heartbeat = join(agentsDir, d, 'heartbeat.txt');
        if (!existsSync(heartbeat)) return false;
        try {
          const ts = readFileSync(heartbeat, 'utf-8').trim();
          const age = Date.now() - new Date(ts).getTime();
          return age < 120_000; // 120s heartbeat timeout
        } catch {
          return false;
        }
      });
    } catch {
      return [];
    }
  }

  /** Clean up all signal files */
  static cleanup(): void {
    try {
      const { rmSync } = require('fs');
      if (existsSync(SIGNAL_DIR)) rmSync(SIGNAL_DIR, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}
