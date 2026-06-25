/**
 * Handoff/Self-check template writer for Story Pack v1.0.
 *
 * When a story enters the dev stage, starter handoff.md and self-check.md
 * files are written to the story's dispatch directory. The dev agent fills
 * them in; the pipeline validates required sections before advancing.
 *
 * This mirrors StoryRail's pattern: `start-run` writes starter files,
 * `submit-run` validates required sections.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { renderTemplateFile, type TemplateContext } from './template-renderer.js';
import type { StoryEntry } from './types.js';

/**
 * Paths to the framework's Story Pack templates. Resolved relative to the
 * orchestrator source so the same templates work whether the framework is
 * installed via npm or run from source.
 */
export function templatePaths(frameworkRoot: string): {
  handoff: string;
  selfCheck: string;
} {
  return {
    handoff: join(frameworkRoot, 'templates', 'story-pack', 'handoff.md.tmpl'),
    selfCheck: join(frameworkRoot, 'templates', 'story-pack', 'self-check.md.tmpl'),
  };
}

/**
 * Build the template context for a story. Shared by handoff + self-check
 * so both documents agree on the metadata header.
 */
export function buildTemplateContext(story: StoryEntry, runId?: string): TemplateContext {
  return {
    story_id: story.story_id,
    title: story.title,
    track: story.track,
    run_id: runId ?? `${story.story_id}-${Date.now()}`,
    completed_at: new Date().toISOString(),
    handoff_artifacts: story.handoff_artifacts ?? ['diff_summary', 'test_results', 'blockers'],
    command: story.acceptance_check[0] ?? '<no acceptance check defined>',
  };
}

/**
 * Write starter handoff.md and self-check.md to the story's handoff directory.
 *
 * Files land at `_wdf_output/handoff/{story_id}/handoff.md` and
 * `_wdf_output/handoff/{story_id}/self-check.md`. The dev agent is expected
 * to fill in the body sections.
 *
 * Returns the paths written. Idempotent: existing files are NOT overwritten
 * — the agent may have partially filled them during a prior dispatch.
 */
export function writeStarterHandoffFiles(
  story: StoryEntry,
  outputDir: string,
  frameworkRoot: string,
  runId?: string,
): { handoffPath: string; selfCheckPath: string; skipped: boolean } {
  const handoffDir = join(outputDir, 'handoff', story.story_id);
  const handoffPath = join(handoffDir, 'handoff.md');
  const selfCheckPath = join(handoffDir, 'self-check.md');

  // Idempotent — don't clobber files the agent has started filling in.
  if (existsSync(handoffPath) && existsSync(selfCheckPath)) {
    return { handoffPath, selfCheckPath, skipped: true };
  }

  mkdirSync(handoffDir, { recursive: true });

  const tplPaths = templatePaths(frameworkRoot);
  const ctx = buildTemplateContext(story, runId);

  if (!existsSync(handoffPath)) {
    const rendered = renderTemplateFile(tplPaths.handoff, ctx);
    writeFileSync(handoffPath, rendered, 'utf-8');
  }
  if (!existsSync(selfCheckPath)) {
    const rendered = renderTemplateFile(tplPaths.selfCheck, ctx);
    writeFileSync(selfCheckPath, rendered, 'utf-8');
  }

  return { handoffPath, selfCheckPath, skipped: false };
}

/**
 * Required sections for handoff.md and self-check.md.
 *
 * Mirrors StoryRail's submit-run validation: a run cannot be submitted
 * until these sections have non-placeholder content.
 */
export const REQUIRED_SECTIONS = {
  handoff: ['Summary', 'Files changed', 'Verification summary'],
  selfCheck: ['Commands run', 'Results'],
} as const;

/**
 * Validate that a filled-in handoff.md or self-check.md has the required
 * sections with non-placeholder content.
 *
 * @returns array of missing section names (empty = valid)
 */
export function validateHandoffSections(
  filePath: string,
  kind: 'handoff' | 'selfCheck',
): string[] {
  if (!existsSync(filePath)) {
    return [`${kind} file missing`];
  }
  // Lazy require to avoid pulling fs in for callers that only need the
  // pure helpers above.
  const { readFileSync } = require('fs') as typeof import('fs');
  const content = readFileSync(filePath, 'utf-8');
  const required = REQUIRED_SECTIONS[kind];
  const missing: string[] = [];
  const placeholders = new Set(['todo', 'tbd', 'none', 'n/a', '-', '<brief change description>', '<describe gap>', '<describe risk>', '<command>']);

  for (const section of required) {
    const sectionRegex = new RegExp(`## ${section}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
    const match = content.match(sectionRegex);
    if (!match) {
      missing.push(section);
      continue;
    }
    const body = match[1].trim();
    // Strip leading comment markers and check for placeholder content
    const lines = body
      .split('\n')
      .map((l) => l.replace(/^<!--.*?-->\s*$/, '').replace(/^<!--\s*$/, '').replace(/^\s*-->\s*$/, '').trim())
      .filter((l) => l.length > 0);
    const meaningful = lines.filter((l) => !placeholders.has(l.toLowerCase()));
    if (meaningful.length === 0) {
      missing.push(section);
    }
  }

  return missing;
}
