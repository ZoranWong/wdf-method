import { StoryEntry, Track } from './types.js';
/**
 * Agent dispatch configuration.
 */
export interface AgentDispatchConfig {
    worktreePath: string;
    storyId: string;
    track: Track;
    timeoutMinutes: number;
    maxRetries: number;
}
export interface AgentResult {
    storyId: string;
    status: 'CODE_ACCEPTED' | 'FAILED' | 'TIMEOUT' | 'BLOCKED_BY_DEPENDENCY';
    summary: string;
    exitCode: number;
    durationMs: number;
}
/**
 * AgentPromptBuilder constructs the minimal context prompt for each story agent.
 * Following the "One Story = One Agent = One Worktree = One Context" principle,
 * each agent receives only: story file, api-spec, architecture, db-schema/design-tokens, code standards.
 */
export declare class AgentPromptBuilder {
    private projectRoot;
    private storiesDir;
    private outputDir;
    constructor(projectRoot: string, storiesDir: string, outputDir: string);
    /**
     * Build the agent prompt for a story implementation.
     * The prompt includes only the minimum necessary context (~38KB).
     */
    buildPrompt(story: StoryEntry, track: Track): string;
    /**
     * Read the story file content (for inclusion in full agent context).
     */
    readStoryContent(story: StoryEntry): string;
}
/**
 * AgentDispatcher spawns Claude Code agents for each story in isolated worktrees.
 *
 * Uses `claude` CLI (Claude Code) to spawn agents. Each agent:
 *   - Works in its own git worktree
 *   - Receives a minimal-context prompt (~38KB)
 *   - Returns { storyId, status } on completion
 */
export declare class AgentDispatcher {
    private projectRoot;
    private promptBuilder;
    constructor(projectRoot: string, storiesDir: string, outputDir: string);
    /**
     * Dispatch a story agent synchronously via Claude Code CLI.
     * Writes the prompt to a temp file and invokes `claude` in the worktree.
     */
    dispatchStoryAgent(story: StoryEntry, config: AgentDispatchConfig): Promise<AgentResult>;
    /**
     * Dispatch multiple story agents in parallel, respecting the concurrency limit.
     */
    dispatchParallel(stories: StoryEntry[], configs: AgentDispatchConfig[], maxConcurrent: number): Promise<AgentResult[]>;
}
//# sourceMappingURL=agent-dispatcher.d.ts.map