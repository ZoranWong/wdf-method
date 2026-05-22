import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
/**
 * AgentPromptBuilder constructs the minimal context prompt for each story agent.
 * Following the "One Story = One Agent = One Worktree = One Context" principle,
 * each agent receives only: story file, api-spec, architecture, db-schema/design-tokens, code standards.
 */
export class AgentPromptBuilder {
    projectRoot;
    storiesDir;
    outputDir;
    constructor(projectRoot, storiesDir, outputDir) {
        this.projectRoot = projectRoot;
        this.storiesDir = storiesDir;
        this.outputDir = outputDir;
    }
    /**
     * Build the agent prompt for a story implementation.
     * The prompt includes only the minimum necessary context (~38KB).
     */
    buildPrompt(story, track) {
        const storyFile = join(this.storiesDir, `${story.story_id}.md`);
        const apiSpecFile = join(this.outputDir, 'api-spec.yaml');
        const archFile = join(this.outputDir, 'architecture.md');
        const dbSchemaFile = join(this.outputDir, 'db-schema.md');
        const designTokensFile = join(this.outputDir, '_output', 'planning', 'design-tokens.md');
        const codeStandardsFile = join(this.projectRoot, 'AGENTS.md');
        const isFE = track === 'frontend';
        const prompt = [
            `You are implementing Story ${story.story_id}: ${story.title}`,
            `Track: ${track.toUpperCase()}`,
            '',
            `=== YOUR SCOPE ===`,
            `Files you MAY modify:`,
            ...story.scope_write.map(s => `  - ${s}`),
            '',
            `Files you MUST NOT touch (scope_lock strict):`,
            `  Everything outside scope_write above.`,
            '',
            `=== ACCEPTANCE CHECKS ===`,
            ...(story.acceptance_check?.map(c => `  [ ] ${c}`) ?? ['  [ ] No acceptance checks defined — define them before coding']),
            '',
            `=== EXECUTION STEPS ===`,
            `4b: Read the story file and mark status IN_PROGRESS`,
            `4c: Implement the code (follow architecture.md patterns, api-spec.yaml contract)`,
            `4d: Write tests — unit tests for services, integration tests for endpoints`,
            `4e: Validate against api-spec.yaml — check request/response shapes match`,
            `4f: Generate self-check.md and handoff.md`,
            `4f2/4h2: Scope Exit Verification — git diff HEAD must be within scope_write`,
            `4g: Run acceptance checks — all commands must exit 0`,
            `4h: CODE ACCEPTANCE: verify MG-01 through MG-09`,
            `4j/4k: Mark CODE_ACCEPTED and return result`,
            '',
            `=== COMMIT DISCIPLINE ===`,
            `You MUST commit at these 3 milestones (minimum):`,
            `  1. After step 4c: "${story.story_id}: ${story.title} — IMPLEMENTED"`,
            `  2. After step 4f: "${story.story_id}: ${story.title} — TESTED + SUBMITTED"`,
            `  3. After step 4j/4k: "${story.story_id}: ${story.title} — CODE_ACCEPTED"`,
            '',
            `=== REQUIRED CONTEXT FILES ===`,
        ];
        // Required context files with existence check
        const contextFiles = [
            { path: storyFile, label: 'Story definition', required: true },
            { path: apiSpecFile, label: 'API spec (contract)', required: true },
            { path: archFile, label: 'Architecture constraints', required: true },
            { path: dbSchemaFile, label: 'DB schema', required: !isFE },
            { path: designTokensFile, label: 'Design tokens', required: isFE },
            { path: codeStandardsFile, label: 'Code standards', required: false },
        ];
        for (const { path, label, required } of contextFiles) {
            if (existsSync(path)) {
                prompt.push(`  📄 ${label}: ${path}`);
            }
            else if (required) {
                prompt.push(`  ⚠ ${label} NOT FOUND at ${path} — this may cause implementation issues`);
            }
        }
        prompt.push('');
        prompt.push('=== RETURN VALUE ===');
        prompt.push('When done, return exactly:');
        prompt.push(`  { "storyId": "${story.story_id}", "status": "CODE_ACCEPTED", "summary": "<1-line>" }`);
        return prompt.join('\n');
    }
    /**
     * Read the story file content (for inclusion in full agent context).
     */
    readStoryContent(story) {
        const storyFile = join(this.storiesDir, `${story.story_id}.md`);
        if (!existsSync(storyFile)) {
            return `⚠ Story file not found: ${storyFile}`;
        }
        return readFileSync(storyFile, 'utf-8');
    }
}
/**
 * AgentDispatcher spawns Claude Code agents for each story in isolated worktrees.
 *
 * Uses `claude` CLI (Claude Code) to spawn agents. Each agent:
 *   - Works in its own git worktree
 *   - Receives a minimal-context prompt (~38KB)
 *   - Returns { storyId, status } on completion
 */
export class AgentDispatcher {
    projectRoot;
    promptBuilder;
    constructor(projectRoot, storiesDir, outputDir) {
        this.projectRoot = projectRoot;
        this.promptBuilder = new AgentPromptBuilder(projectRoot, storiesDir, outputDir);
    }
    /**
     * Dispatch a story agent synchronously via Claude Code CLI.
     * Writes the prompt to a temp file and invokes `claude` in the worktree.
     */
    async dispatchStoryAgent(story, config) {
        const startTime = Date.now();
        const prompt = this.promptBuilder.buildPrompt(story, config.track);
        const storyContent = this.promptBuilder.readStoryContent(story);
        // Write prompt to a temp file in the worktree
        const promptDir = join(config.worktreePath, '.claude', 'agent-prompts');
        mkdirSync(promptDir, { recursive: true });
        const promptFile = join(promptDir, `${story.story_id}.md`);
        writeFileSync(promptFile, `# Story Agent Prompt — ${story.story_id}\n\n${prompt}\n\n---\n\n## Story File\n\n${storyContent}`, 'utf-8');
        console.log(`  🚀 Dispatching agent for ${story.story_id} (${config.track})...`);
        console.log(`     Worktree: ${config.worktreePath}`);
        console.log(`     Prompt: ${promptFile}`);
        return new Promise((resolve) => {
            const timeoutMs = config.timeoutMinutes * 60 * 1000;
            let timedOut = false;
            let lastOutput = '';
            const timer = setTimeout(() => {
                timedOut = true;
                resolve({
                    storyId: story.story_id,
                    status: 'TIMEOUT',
                    summary: `Agent timed out after ${config.timeoutMinutes} minutes`,
                    exitCode: -1,
                    durationMs: Date.now() - startTime,
                });
            }, timeoutMs);
            try {
                // Spawn Claude Code in non-interactive print mode within the worktree
                const child = spawn('claude', [
                    '--print',
                    '--output-format', 'json',
                    '--allowedTools', 'Read,Write,Edit,Bash(ls),Bash(git *),Bash(npm *),Bash(npx *)',
                    '-p', prompt, // Use the prompt directly
                ], {
                    cwd: config.worktreePath,
                    env: { ...process.env, CI: 'true' },
                    stdio: ['pipe', 'pipe', 'pipe'],
                    timeout: timeoutMs,
                });
                child.stdout.on('data', (data) => {
                    lastOutput += data.toString();
                });
                child.stderr.on('data', (data) => {
                    const msg = data.toString();
                    if (!msg.includes('Warning') && !msg.includes('info')) {
                        console.error(`     [${story.story_id}] ${msg.trim()}`);
                    }
                });
                child.on('close', (code) => {
                    clearTimeout(timer);
                    if (timedOut)
                        return;
                    const durationMs = Date.now() - startTime;
                    if (code === 0) {
                        // Try to parse the returned JSON
                        try {
                            const jsonMatch = lastOutput.match(/\{[^}]*"storyId"[^}]*"status"[^}]*\}/);
                            if (jsonMatch) {
                                const result = JSON.parse(jsonMatch[0]);
                                resolve({
                                    storyId: result.storyId ?? story.story_id,
                                    status: result.status === 'CODE_ACCEPTED' ? 'CODE_ACCEPTED' : 'FAILED',
                                    summary: result.summary ?? '',
                                    exitCode: code,
                                    durationMs,
                                });
                                return;
                            }
                        }
                        catch { }
                        // If no structured output, assume success if exit code 0 and output exists
                        resolve({
                            storyId: story.story_id,
                            status: lastOutput.includes('CODE_ACCEPTED') ? 'CODE_ACCEPTED' : 'FAILED',
                            summary: lastOutput.slice(-200).trim(),
                            exitCode: code,
                            durationMs,
                        });
                    }
                    else {
                        resolve({
                            storyId: story.story_id,
                            status: code === 1 ? 'BLOCKED_BY_DEPENDENCY' : 'FAILED',
                            summary: `Agent exited with code ${code}: ${lastOutput.slice(-200).trim()}`,
                            exitCode: code ?? -1,
                            durationMs,
                        });
                    }
                });
                child.on('error', (err) => {
                    clearTimeout(timer);
                    if (timedOut)
                        return;
                    resolve({
                        storyId: story.story_id,
                        status: 'FAILED',
                        summary: `Failed to spawn agent: ${err.message}`,
                        exitCode: -1,
                        durationMs: Date.now() - startTime,
                    });
                });
            }
            catch (err) {
                clearTimeout(timer);
                resolve({
                    storyId: story.story_id,
                    status: 'FAILED',
                    summary: `Dispatch error: ${err.message}`,
                    exitCode: -1,
                    durationMs: Date.now() - startTime,
                });
            }
        });
    }
    /**
     * Dispatch multiple story agents in parallel, respecting the concurrency limit.
     */
    async dispatchParallel(stories, configs, maxConcurrent) {
        const results = [];
        const queue = stories.map((s, i) => ({ story: s, config: configs[i] }));
        // Process in chunks of maxConcurrent
        for (let i = 0; i < queue.length; i += maxConcurrent) {
            const batch = queue.slice(i, i + maxConcurrent);
            console.log(`\n  📦 Batch ${Math.floor(i / maxConcurrent) + 1}: ${batch.map(b => b.story.story_id).join(', ')}`);
            const batchResults = await Promise.all(batch.map(({ story, config }) => this.dispatchStoryAgent(story, config)));
            results.push(...batchResults);
            // Report batch results
            for (const r of batchResults) {
                const icon = r.status === 'CODE_ACCEPTED' ? '✓' : r.status === 'TIMEOUT' ? '⏱' : '✗';
                console.log(`  ${icon} ${r.storyId}: ${r.status} (${(r.durationMs / 1000).toFixed(1)}s)`);
            }
        }
        return results;
    }
}
//# sourceMappingURL=agent-dispatcher.js.map