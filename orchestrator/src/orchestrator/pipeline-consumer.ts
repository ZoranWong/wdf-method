/**
 * Pipeline Consumer — reads Phase 4 pipeline dispatch manifests and returns
 * structured instructions for the parent Claude session to auto-dispatch agents.
 *
 * This is the Phase 4 counterpart to `auto-executor.ts` (which handles Phases 1-3).
 * Together they close the autonomous loop:
 *
 *   wdf start → processAllStoriesPipeline() writes manifests
 *             → consumePipelineManifests() collects pending dispatches
 *             → writes phase-4-auto-execute.json
 *             → parent session reads it → dispatches agents → /wdf start → loop
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SprintStatusManager } from './sprint-status.js';
import type { PipelineStage, StoryEntry } from './types.js';
import { processAllStoriesPipeline } from './pipeline-runner.js';

export interface Phase4Action {
  story_id: string;
  stage: PipelineStage;
  attempt: number;
  manifest_path: string;
  prompt: string;
  worktree_path?: string;
  track: string;
  depends_on: string[];
  scope_write: string[];
  acceptance_check: string[];
}

export interface Phase4AutoExecuteBatch {
  schema_version: '1.0';
  generated_at: string;
  project: string;
  status: 'ready' | 'blocked' | 'complete' | 'escalated';
  total_pending: number;
  instructions: string;
  actions: Phase4Action[];
  next_command: string;
}

// ── Main entry point ─────────────────────────────────────────────
/**
 * Scan pipeline dispatch manifests and collect all actions that need
 * agent dispatch. Returns a structured batch the parent session can
 * iterate to dispatch agents via its Agent tool.
 */
export function consumePipelineManifests(
  stories: StoryEntry[],
  state: SprintStatusManager,
  outputDir: string,
  projectRoot: string,
): Phase4AutoExecuteBatch {
  const pipelineDir = join(outputDir, '.dispatch', 'pipeline');
  const actions: Phase4Action[] = [];
  const escalated: string[] = [];
  const projectName = state.data.project ?? 'this project';
  // Process each story through the pipeline to get current state
  const allActions = processAllStoriesPipeline(stories, state, outputDir, projectRoot);
  for (const action of allActions) {
    if (action.kind === 'dispatch' && action.manifest) {
      const m = action.manifest;
      const storyEntry = stories.find((s) => s.story_id === m.story_id);
      actions.push({
        story_id: m.story_id,
        stage: m.stage,
        attempt: m.attempt,
        manifest_path: action.manifest_path!,
        prompt: m.prompt,
        worktree_path: m.worktree_path,
        track: m.track,
        depends_on: storyEntry?.depends_on?.map((d) => d.story_id) ?? [],
        scope_write: m.scope_write,
        acceptance_check: m.acceptance_check,
      });
    }
    if (action.kind === 'escalation') {
      escalated.push(action.story_id);
    }
  }
  // Determine overall status
  const status: Phase4AutoExecuteBatch['status'] =
    escalated.length > 0
      ? 'escalated'
      : actions.length === 0
        ? 'complete'
        : 'ready';
  // Sort by dependency: stories with no deps first
  const sorted = sortByDependency(actions, stories);
  const instructions = buildPhase4Instructions(sorted, status);
  return {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    project: projectName,
    status,
    total_pending: actions.length,
    instructions,
    actions: sorted,
    next_command: '/wdf start',
  };
}

/**
 * Sort Phase 4 actions by dependency order.
 * Stories with no dependencies come first; stories with deps come after
 * their dependencies.
 */
function sortByDependency(actions: Phase4Action[], stories: StoryEntry[]): Phase4Action[] {
  const orderMap = new Map<string, number>();
  for (const s of stories) {
    orderMap.set(s.story_id, s.order);
  }
  const sorted = [...actions].sort((a, b) => {
    const aDeps = a.depends_on.length;
    const bDeps = b.depends_on.length;
    if (aDeps !== bDeps) return aDeps - bDeps;
    // Within same dep level, sort by development order
    return (orderMap.get(a.story_id) ?? 0) - (orderMap.get(b.story_id) ?? 0);
  });
  return sorted;
}

function buildPhase4Instructions(actions: Phase4Action[], status: Phase4AutoExecuteBatch['status']): string {
  switch (status) {
    case 'complete':
      return 'All pipeline stages are complete. Run `/wdf start` to proceed.';
    case 'escalated':
      return [
        'Some stories have been escalated due to retry budget exhaustion.',
        'Review the escalation notices and decide whether to fix manually,',
        'modify acceptance criteria, or skip the story.',
      ].join(' ');
    case 'blocked':
      return 'Some pipeline stages are blocked by unmet dependencies. Ensure upstream stories complete first.';
    case 'ready': {
      const stageCounts = new Map<PipelineStage, number>();
      for (const a of actions) {
        stageCounts.set(a.stage, (stageCounts.get(a.stage) ?? 0) + 1);
      }
      const parts: string[] = [];
      for (const [stage, count] of stageCounts) {
        parts.push(`${count} story(ies) at stage "${stage}"`);
      }
      return [
        `Pipeline dispatch pending: ${parts.join(', ')}.`,
        '',
        'For each action:',
        '1. Read the prompt from manifest_path',
        '2. Dispatch a sub-agent via your Agent tool with the prompt as the task',
        '3. Set the working directory to worktree_path if provided',
        '4. The agent will write results/reports to the output directory',
        '5. After all dispatches complete, run `/wdf start` to re-sync state',
        '',
        'IMPORTANT: Respect depends_on ordering. Dispatch stories with no',
        'dependencies first, then proceed to dependent stories.',
      ].join('\n');
    }
  }
}

// ── Write to disk ────────────────────────────────────────────────
/**
 * Write the Phase 4 auto-execute batch to disk.
 * Follows the same pattern as writeAutoExecuteBatch for Phases 1-3.
 */
export function writePhase4AutoExecuteBatch(
  batch: Phase4AutoExecuteBatch,
  projectRoot: string,
): { batchPath: string; summaryPath: string } {
  const dispatchDir = join(projectRoot, '_wdf_output', '.dispatch');
  mkdirSync(dispatchDir, { recursive: true });
  const batchPath = join(dispatchDir, 'phase-4-auto-execute.json');
  writeFileSync(batchPath, JSON.stringify(batch, null, 2), 'utf-8');
  // Human-readable summary
  const summaryLines = [
    '# Phase 4 Auto-Execute Batch',
    '',
    `**Generated:** ${batch.generated_at}`,
    `**Status:** ${batch.status.toUpperCase()}`,
    `**Pending:** ${batch.total_pending} pipeline stage(s)`,
    '',
    '## Instructions',
    '',
    batch.instructions,
    '',
    '## Pending Actions',
    '',
  ];
  for (const action of batch.actions) {
    summaryLines.push(`### ${action.story_id} — Stage: ${action.stage} (Attempt ${action.attempt})`);
    summaryLines.push('');
    summaryLines.push(`- **Track:** ${action.track}`);
    summaryLines.push(`- **Manifest:** ${action.manifest_path}`);
    if (action.worktree_path) {
      summaryLines.push(`- **Worktree:** ${action.worktree_path}`);
    }
    if (action.depends_on.length > 0) {
      summaryLines.push(`- **Depends On:** ${action.depends_on.join(', ')}`);
    }
    summaryLines.push('');
  }
  const summaryPath = join(dispatchDir, 'phase-4-auto-execute.md');
  writeFileSync(summaryPath, summaryLines.join('\n'), 'utf-8');
  return { batchPath, summaryPath };
}
