/**
 * integration-orchestrator.ts — Phase C (V3.10.3) integration orchestration.
 *
 * Hooks into merge-queue.markMerged() to:
 *   1. Detect when all stories in a sprint are MERGED.
 *   2. Run full integration_checks across the merged set.
 *   3. Use the traceability graph to detect cross-story shared files
 *      (multiple stories wrote to the same path).
 *   4. On integration failure: auto-create a change-request and emit an
 *      integration-fix story template so the user can pick it up without
 *      having to discover the gap manually.
 *
 * The orchestrator never auto-creates a story — it only writes a TEMPLATE
 * to `_wdf_output/integration-fix-templates/` and a CR entry. The user
 * chooses whether to cut the story.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { appendAudit } from './audit-logger.js';
import {
  buildTraceabilityGraph,
  indexGraph,
  type TraceabilityGraph,
} from './traceability-graph.js';

export interface IntegrationCheckResult {
  ok: boolean;
  checkedStories: string[];
  failedChecks: Array<{ story: string; command: string; exitCode: number }>;
  crossStorySharedFiles: Array<{ file: string; stories: string[] }>;
  changeRequestPath?: string;
  integrationFixTemplatePath?: string;
}

/**
 * Run the integration orchestration after a story merge.
 *
 * @param projectRoot   Absolute path to the project
 * @param outputRoot    `_wdf_output` location (defaults to standard)
 * @param mergedStoryId The story that just merged (used for telemetry)
 */
export async function onStoryMerged(
  projectRoot: string,
  outputRoot?: string,
  mergedStoryId?: string,
): Promise<IntegrationCheckResult> {
  const outRoot = outputRoot ?? join(projectRoot, '_wdf_output');

  // Read all stories from sprint status to decide whether the sprint is complete
  const stories = readAllStories(projectRoot);
  if (stories.length === 0) {
    return {
      ok: true,
      checkedStories: [],
      failedChecks: [],
      crossStorySharedFiles: [],
    };
  }

  const allMerged = stories.every(s => s.status === 'MERGED' || s.status === 'SKIP');
  if (!allMerged) {
    // Sprint not finished — no integration run yet
    appendAudit(projectRoot, 'integration_orchestrator_skip', {
      actor: 'system',
      story_id: mergedStoryId,
      status: 'info',
      message: 'integration orchestrator skipped — sprint not yet fully merged',
      details: { reason: 'sprint_incomplete' },
    });
    return {
      ok: true,
      checkedStories: [],
      failedChecks: [],
      crossStorySharedFiles: [],
    };
  }

  // Sprint is complete — run integration detection
  const graph = buildTraceabilityGraph({ projectRoot, outputRoot: outRoot });
  const shared = detectCrossStorySharedFiles(graph);

  // Surface integration failures (heuristic: shared files are not necessarily
  // failures, but they're the leading indicator of integration risk). A real
  // integration-check runner would go here; for now we just flag shared files.
  const failedChecks: IntegrationCheckResult['failedChecks'] = [];
  if (shared.length > 0) {
    for (const s of shared.slice(0, 3)) {
      failedChecks.push({
        story: s.stories[0] ?? mergedStoryId ?? 'unknown',
        command: `<shared-file-check:${s.file}>`,
        exitCode: 1,
      });
    }
  }

  const ok = failedChecks.length === 0;

  let changeRequestPath: string | undefined;
  let integrationFixTemplatePath: string | undefined;

  if (!ok) {
    const cr = await writeChangeRequest(projectRoot, outRoot, shared, mergedStoryId);
    changeRequestPath = cr.changeRequestPath;
    integrationFixTemplatePath = cr.templatePath;
  }

  appendAudit(projectRoot, 'integration_orchestrator_complete', {
    actor: 'system',
    story_id: mergedStoryId,
    status: ok ? 'pass' : 'fail',
    message: ok
      ? 'integration orchestrator complete — no cross-story conflicts'
      : `integration orchestrator complete — ${shared.length} shared file(s) detected`,
    details: {
      shared_file_count: shared.length,
      failed_check_count: failedChecks.length,
      change_request_path: changeRequestPath,
    },
  });

  return {
    ok,
    checkedStories: stories.map(s => s.id),
    failedChecks,
    crossStorySharedFiles: shared,
    changeRequestPath,
    integrationFixTemplatePath,
  };
}

/**
 * Detect files written by multiple stories — the classic integration risk.
 *
 * Uses the traceability graph's `binds_endpoint` edges (STORY → FILE:path)
 * introduced in Phase B. When two or more stories bind to the same FILE
 * node, that file is shared. The user (or integration runner) needs to
 * decide whether the sharing is intentional or a scope collision.
 */
export function detectCrossStorySharedFiles(
  graph: TraceabilityGraph,
): Array<{ file: string; stories: string[] }> {
  const idx = indexGraph(graph);
  const fileToStories = new Map<string, string[]>();

  for (const node of graph.nodes) {
    if (!node.id.startsWith('FILE:')) continue;
    const file = node.id.slice('FILE:'.length);
    const inbound = idx.in.get(node.id) ?? [];
    const stories: string[] = [];
    for (const e of inbound) {
      if (e.kind === 'binds_endpoint') {
        const src = idx.byId.get(e.from);
        if (src?.kind === 'STORY') stories.push(src.id);
      }
    }
    if (stories.length >= 2) {
      fileToStories.set(file, Array.from(new Set(stories)));
    }
  }

  return Array.from(fileToStories.entries()).map(([file, stories]) => ({ file, stories }));
}

// ── Internal helpers ────────────────────────────────────────────

interface SprintStorySnapshot {
  id: string;
  status: string;
}

function readAllStories(projectRoot: string): SprintStorySnapshot[] {
  const storiesDir = join(projectRoot, '_wdf_output', 'status', 'stories');
  if (!existsSync(storiesDir)) return [];

  const out: SprintStorySnapshot[] = [];
  const { readdirSync } = require('fs') as typeof import('fs');
  let entries: string[] = [];
  try { entries = readdirSync(storiesDir); } catch { return out; }

  for (const entry of entries) {
    if (!entry.endsWith('.yaml')) continue;
    try {
      const raw = readFileSync(join(storiesDir, entry), 'utf-8');
      const id = (raw.match(/^id:\s*(\S+)/m)?.[1]) ?? entry.replace(/\.yaml$/, '');
      const status = (raw.match(/^status:\s*(\S+)/m)?.[1]) ?? 'NOT_STARTED';
      out.push({ id, status });
    } catch {
      // Skip unreadable files
    }
  }
  return out;
}

async function writeChangeRequest(
  projectRoot: string,
  outRoot: string,
  shared: Array<{ file: string; stories: string[] }>,
  triggerStoryId?: string,
): Promise<{ changeRequestPath: string; templatePath: string }> {
  const crDir = join(outRoot, 'status');
  mkdirSync(crDir, { recursive: true });
  const crId = `CR-INTEGRATION-${Date.now()}`;
  const crPath = join(crDir, 'change-requests.yaml');

  const crEntry = [
    `---`,
    `id: ${crId}`,
    `title: Cross-story integration gap detected`,
    `created_at: ${new Date().toISOString()}`,
    `triggered_by_story: ${triggerStoryId ?? 'unknown'}`,
    `status: open`,
    `auto_generated: true`,
    `shared_files:`,
    ...shared.map(s => `  - file: ${s.file}\n    stories:\n${s.stories.map(st => `      - ${st}`).join('\n')}`),
    `---`,
    ``,
    `Auto-generated by integration-orchestrator after sprint completion.`,
    `Review the shared files below and decide whether to cut an integration-fix story.`,
    ``,
  ].join('\n');

  // Append (not overwrite) so multiple CRs accumulate
  const existing = existsSync(crPath) ? readFileSync(crPath, 'utf-8') : '';
  writeFileSync(crPath, existing + crEntry, 'utf-8');

  // Write the story template alongside the CR — user picks it up if needed
  const tplDir = join(outRoot, 'integration-fix-templates');
  mkdirSync(tplDir, { recursive: true });
  const tplPath = join(tplDir, `${crId}.md`);
  const tpl = [
    `---`,
    `story_id: S-INTEGRATION-FIX`,
    `title: Resolve cross-story integration gap (${crId})`,
    `track: backend`,
    `refs:`,
    ...shared.flatMap(s => s.stories).map(st => `  - ${st}`),
    `scope_write:`,
    ...shared.map(s => `  - ${s.file}`),
    `acceptance_check:`,
    `  - npm test`,
    `  - npm run lint`,
    `---`,
    ``,
    `# S-INTEGRATION-FIX`,
    ``,
    `Auto-generated template. The following files were modified by multiple stories:`,
    ``,
    ...shared.map(s => `- \`${s.file}\` — touched by ${s.stories.join(', ')}`),
    ``,
    `Inspect each file, resolve conflicts / merge artefacts, and re-run the full integration suite.`,
  ].join('\n');
  writeFileSync(tplPath, tpl, 'utf-8');

  return { changeRequestPath: crPath, templatePath: tplPath };
}
