import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, rmSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

// V3.6: Signals live in user home, outside any git worktree.
// All worktrees (main + story/*) share the same home directory.
// Survives reboots, protected by user filesystem permissions.
//
// The default location is ~/.wdf-method/signals/ but it is overridable
// via [agent_communication].signal_dir in customize.toml. The orchestrator
// configures the path on startup by calling SignalManager.setSignalDir().
let SIGNAL_DIR = join(homedir(), '.wdf-method', 'signals');

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
  // Signals at ~/.wdf-method/signals/ — outside all git worktrees, persists across reboots
  // No need for init() — path is constant and always accessible from any worktree

  /** Override the signal directory (called by orchestrator from customize.toml). */
  static setSignalDir(dir: string): void {
    SIGNAL_DIR = dir;
  }

  /** Read the current signal directory (for diagnostics). */
  static getSignalDir(): string {
    return SIGNAL_DIR;
  }

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
      if (existsSync(SIGNAL_DIR)) rmSync(SIGNAL_DIR, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}

// ── Per-agent heartbeat / checkpoint utilities ─────────────
// These complement SignalManager for the agent-dispatcher lifecycle:
//   - computeProjectHash: namespace signal dirs by project
//   - HeartbeatEmitter:   periodic liveness ping for a dispatched agent
//   - CheckpointWriter:   persist story outcome + signal downstream deps
//   - cleanupAgent:       remove per-agent signal dir on exit

/** Stable short hash of project root, used to namespace per-project signal dirs. */
export function computeProjectHash(projectRoot: string): string {
  return createHash('sha1').update(resolve(projectRoot)).digest('hex').slice(0, 12);
}

export interface HeartbeatEmitterOptions {
  agent_id: string;
  story_id: string;
  track: string;
}

/**
 * Emits a heartbeat every `intervalMs` while a dispatched agent is alive.
 * `SignalManager.listActiveAgents()` reads these to determine liveness.
 */
export class HeartbeatEmitter {
  private timer: NodeJS.Timeout | null = null;
  private readonly opts: HeartbeatEmitterOptions;
  private readonly dir: string;

  constructor(opts: HeartbeatEmitterOptions) {
    this.opts = opts;
    this.dir = join(SIGNAL_DIR, 'agents', opts.agent_id);
  }

  start(intervalMs = 30_000): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    this.tick();
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    try {
      writeFileSync(join(this.dir, 'heartbeat.txt'), new Date().toISOString());
      writeFileSync(join(SIGNAL_DIR, `${this.opts.agent_id}-to-main.json`), JSON.stringify({
        agent_id: this.opts.agent_id,
        story_id: this.opts.story_id,
        track: this.opts.track,
        current_substep: 'running',
        heartbeat_at: new Date().toISOString(),
        status: 'running',
      }, null, 2));
    } catch {
      // Best-effort
    }
  }
}

export interface CheckpointData {
  story_id: string;
  status: string;
  timestamp: string;
  track: string;
  files_changed?: string[];
  tests_passed?: number;
  tests_total?: number;
  summary?: string;
}

/**
 * Writes per-story checkpoint JSON and signals dependency-ready / failed state.
 * Downstream stories poll `<depsDir>/<storyId>-ready.json` before implementing.
 */
export class CheckpointWriter {
  private readonly projectHash: string;
  private readonly checkpointDir: string;
  private readonly depsDir: string;

  constructor(projectHash: string) {
    this.projectHash = projectHash;
    this.checkpointDir = join(SIGNAL_DIR, 'checkpoints', projectHash);
    this.depsDir = join(SIGNAL_DIR, 'dependencies', projectHash);
  }

  write(data: CheckpointData): void {
    try {
      if (!existsSync(this.checkpointDir)) mkdirSync(this.checkpointDir, { recursive: true });
      writeFileSync(join(this.checkpointDir, `${data.story_id}.json`), JSON.stringify(data, null, 2));
      if (data.status === 'CODE_ACCEPTED') this.signalReady(data.story_id);
    } catch {
      // Best-effort
    }
  }

  signalReady(storyId: string, filesChanged?: string[]): void {
    try {
      if (!existsSync(this.depsDir)) mkdirSync(this.depsDir, { recursive: true });
      writeFileSync(join(this.depsDir, `${storyId}-ready.json`), JSON.stringify({
        story_id: storyId,
        ready_at: new Date().toISOString(),
        files_changed: filesChanged,
      }, null, 2));
    } catch {
      // Best-effort
    }
  }

  signalFailed(storyId: string, reason: string): void {
    try {
      if (!existsSync(this.depsDir)) mkdirSync(this.depsDir, { recursive: true });
      writeFileSync(join(this.depsDir, `${storyId}-failed.json`), JSON.stringify({
        story_id: storyId,
        failed_at: new Date().toISOString(),
        reason,
      }, null, 2));
    } catch {
      // Best-effort
    }
  }
}

/** Remove per-agent signal directory after dispatch completes. */
export function cleanupAgent(agentId: string): void {
  try {
    const agentDir = join(SIGNAL_DIR, 'agents', agentId);
    if (existsSync(agentDir)) rmSync(agentDir, { recursive: true, force: true });
  } catch {
    // Best-effort
  }
}

export interface AgentStatusInfo {
  agent_id: string;
  status: 'running' | 'dead';
  story_id?: string;
  track?: string;
  current_substep?: string;
  heartbeat_at?: string;
  age_seconds?: number;
}

const HEARTBEAT_TIMEOUT_MS = 120_000;

/**
 * Detects agents whose heartbeats have gone stale.
 * Used by `wdf agent status` and `wdf agent cleanup` to surface orphaned dispatches.
 */
export class DeadAgentDetector {
  listAllStatuses(): AgentStatusInfo[] {
    const agentsDir = join(SIGNAL_DIR, 'agents');
    if (!existsSync(agentsDir)) return [];
    try {
      const entries = readdirSync(agentsDir);
      const result: AgentStatusInfo[] = [];
      for (const agentId of entries) {
        const agentDir = join(agentsDir, agentId);
        const stat = statSync(agentDir);
        if (!stat.isDirectory()) continue;
        const heartbeatFile = join(agentDir, 'heartbeat.txt');
        if (!existsSync(heartbeatFile)) continue;
        let heartbeatAt: string;
        try {
          heartbeatAt = readFileSync(heartbeatFile, 'utf-8').trim();
        } catch {
          continue;
        }
        const ts = new Date(heartbeatAt).getTime();
        const age = Date.now() - ts;
        const statusFile = join(SIGNAL_DIR, `${agentId}-to-main.json`);
        let meta: { story_id?: string; track?: string; current_substep?: string } = {};
        try {
          if (existsSync(statusFile)) meta = JSON.parse(readFileSync(statusFile, 'utf-8'));
        } catch {
          // ignore
        }
        result.push({
          agent_id: agentId,
          status: age < HEARTBEAT_TIMEOUT_MS ? 'running' : 'dead',
          story_id: meta.story_id,
          track: meta.track,
          current_substep: meta.current_substep,
          heartbeat_at: heartbeatAt,
          age_seconds: Math.floor(age / 1000),
        });
      }
      return result;
    } catch {
      return [];
    }
  }

  listDead(): AgentStatusInfo[] {
    return this.listAllStatuses().filter(a => a.status === 'dead');
  }
}

/**
 * Remove signal directories for agents whose heartbeats have gone stale.
 * Returns the count of removed agent signal directories.
 */
export function cleanupStale(): number {
  const detector = new DeadAgentDetector();
  const dead = detector.listDead();
  let removed = 0;
  for (const a of dead) {
    try {
      const agentDir = join(SIGNAL_DIR, 'agents', a.agent_id);
      if (existsSync(agentDir)) {
        rmSync(agentDir, { recursive: true, force: true });
        removed++;
      }
    } catch {
      // best-effort
    }
  }
  return removed;
}
