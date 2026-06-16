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
export declare class SignalManager {
    /** Override the signal directory (called by orchestrator from customize.toml). */
    static setSignalDir(dir: string): void;
    /** Read the current signal directory (for diagnostics). */
    static getSignalDir(): string;
    /** Write global pause signal */
    static pauseAll(reason?: string): void;
    /** Write global resume signal */
    static resumeAll(): void;
    /** Send pause command to a specific agent */
    static pauseAgent(agentId: string): void;
    /** Clear command for an agent */
    static clearAgentCommand(agentId: string): void;
    /** Check if global pause is active */
    static isPaused(): boolean;
    /** Read agent status from heartbeat file */
    static getAgentStatus(agentId: string): AgentStatus | null;
    /** Read command for a specific agent */
    static getAgentCommand(agentId: string): PauseCommand;
    /** List all active agent IDs from signal directory */
    static listActiveAgents(): string[];
    /** Clean up all signal files */
    static cleanup(): void;
}
export {};
//# sourceMappingURL=signal-manager.d.ts.map