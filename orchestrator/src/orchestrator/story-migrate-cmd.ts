/**
 * `wdf story migrate-pack <story-id>` — backfill Story Pack v1.0 frontmatter.
 *
 * Legacy stories declare scope_write and acceptance_check at the story
 * level. Story Pack v1.0 wraps them in a single execution_unit so the
 * dispatcher can treat the story as unit-aware from the first dispatch.
 *
 * The migration is:
 *   - Reads the story .md file
 *   - Parses existing frontmatter (scope_write, acceptance_check, track)
 *   - Synthesizes a single execution_unit named "main" containing both
 *   - Adds `story_pack_version: '1.0'` and `execution_units:` blocks
 *   - Preserves all other frontmatter fields and the story body
 *
 * Idempotent: running twice produces the same output. If the story
 * already has `story_pack_version: '1.0'`, the command is a no-op.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface MigratePackResult {
  storyId: string;
  storyPath: string;
  migrated: boolean;
  alreadyV1: boolean;
  unitId: string;
}

/**
 * Run the migrate-pack transformation on a story file.
 *
 * @param storyId    e.g. "S-AUTH-01"
 * @param outputDir  typically `_wdf_output/`
 * @returns result describing what happened
 */
export function migrateStoryPack(
  storyId: string,
  outputDir: string,
): MigratePackResult {
  const storyPath = join(outputDir, 'stories', `${storyId}.md`);
  if (!existsSync(storyPath)) {
    throw new Error(`Story file not found: ${storyPath}`);
  }

  const original = readFileSync(storyPath, 'utf-8');
  const parsed = splitFrontmatter(original);
  if (!parsed) {
    throw new Error(`Story ${storyId} has no YAML frontmatter`);
  }

  // Already migrated — no-op
  if (/^story_pack_version:\s*['"]?1\.0['"]?\s*$/m.test(parsed.frontmatter)) {
    return {
      storyId,
      storyPath,
      migrated: false,
      alreadyV1: true,
      unitId: 'main',
    };
  }

  const scopeWrite = extractListField(parsed.frontmatter, 'scope_write');
  const acceptanceCheck = extractListField(parsed.frontmatter, 'acceptance_check');

  if (scopeWrite.length === 0) {
    throw new Error(
      `Story ${storyId} has no scope_write — cannot synthesize execution_unit. ` +
      `Add scope_write to the frontmatter before migrating.`,
    );
  }

  const unitId = 'main';
  const executionUnitsBlock = renderExecutionUnitsBlock(unitId, scopeWrite, acceptanceCheck);

  // Insert story_pack_version + execution_units block right after the opening ---
  const lines = parsed.frontmatter.split('\n');
  const newFrontmatterLines: string[] = [
    lines[0] ?? '',
    `story_pack_version: '1.0'`,
  ];
  for (let i = 1; i < lines.length; i++) {
    newFrontmatterLines.push(lines[i]);
  }
  // Append execution_units block at end of frontmatter
  newFrontmatterLines.push(executionUnitsBlock);

  const newFrontmatter = newFrontmatterLines.join('\n');
  const updated = `---\n${newFrontmatter}\n---${parsed.body}`;

  writeFileSync(storyPath, updated, 'utf-8');

  return {
    storyId,
    storyPath,
    migrated: true,
    alreadyV1: false,
    unitId,
  };
}

interface SplitResult {
  frontmatter: string;
  body: string;
}

function splitFrontmatter(content: string): SplitResult | null {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/);
  if (!m) return null;
  return { frontmatter: m[1], body: m[2] };
}

function extractListField(frontmatter: string, fieldName: string): string[] {
  const values: string[] = [];
  const lines = frontmatter.split('\n');

  // Inline form: fieldName: [a, b]  OR  fieldName: single
  const inlineRe = new RegExp(`^${fieldName}:\\s*(.+?)\\s*$`);
  for (const line of lines) {
    const m = line.match(inlineRe);
    if (!m) continue;
    const raw = m[1].replace(/[[\]]/g, '').trim();
    if (raw === '' || raw === '[]') return [];
    for (const item of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
      values.push(item);
    }
    return values;
  }

  // Block form:
  //   fieldName:
  //     - item
  const blockHeaderRe = new RegExp(`^${fieldName}:\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    if (!blockHeaderRe.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (/^\S/.test(next)) break;
      const item = next.match(/^\s+-\s+(\S.*?)\s*$/);
      if (item) values.push(item[1]);
    }
    return values;
  }

  return values;
}

function renderExecutionUnitsBlock(
  unitId: string,
  scopeWrite: string[],
  acceptanceCheck: string[],
): string {
  const lines: string[] = [
    'execution_units:',
    `  ${unitId}:`,
    '    scope_write:',
  ];
  for (const path of scopeWrite) {
    lines.push(`      - ${path}`);
  }
  lines.push('    acceptance_check:');
  if (acceptanceCheck.length === 0) {
    lines.push('      - npm test');
  } else {
    for (const check of acceptanceCheck) {
      lines.push(`      - ${check}`);
    }
  }
  return lines.join('\n');
}
