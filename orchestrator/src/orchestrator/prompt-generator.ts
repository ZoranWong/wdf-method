// Prompt Generator — generates Claude-ready execution prompts
// based on current project state. Does NOT execute anything.
//
// The CLI reads state, finds the gap, and outputs a prompt.
// Claude reads the prompt and executes.
//
// V3.8: Rich prompts with embedded agent methodologies, quality checklists,
// anti-patterns, and previous-artifact context snippets.
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { SprintStatusManager } from './sprint-status.js';
import { StoryEntry } from './types.js';
import { getSubPhaseConfig, SubPhaseConfig } from './subphase-executor.js';

export interface PromptResult {
  target: string;
  status: string;
  completed: string[];
  pending: string[];
  prompt: string;
  nextCommand: string;
}

export function generatePrompt(state: SprintStatusManager, projectRoot: string): PromptResult {
  const completed: string[] = [];
  const pending: string[] = [];
  let currentPhase = 1;
  for (let p = 1; p <= 4; p++) {
    const phase = state.getPhase(p);
    if (!phase || phase.status === 'NOT_STARTED' || phase.status === 'IN_PROGRESS') {
      currentPhase = p;
      break;
    }
    completed.push(`Phase ${p}: ${phase.status}`);
  }
  if (currentPhase <= 3) {
    return generateSubPhasePrompt(state, projectRoot, currentPhase, completed, pending);
  }
  return generateStoryPrompt(state, projectRoot, completed, pending);
}

// ── Phase 1-3: Rich sub-phase prompts ──────────────────────────

function generateSubPhasePrompt(
  state: SprintStatusManager,
  projectRoot: string,
  phaseNum: number,
  completed: string[],
  pending: string[],
): PromptResult {
  const phase = state.getPhase(phaseNum);
  const outputDir = join(projectRoot, '_wdf_output');
  let nextSub: { key: string; name?: string; config: SubPhaseConfig } | null = null;
  if (phase?.substates) {
    for (const [key, sub] of Object.entries(phase.substates)) {
      if (!key.startsWith('phase_')) continue;
      const s = sub as any;
      if (s.status === 'LOCKED' || s.status === 'SKIPPED') {
        completed.push(`${key}: ${s.status}`);
        continue;
      }
      if (s.auto_skip) {
        completed.push(`${key}: SKIPPED (auto)`);
        continue;
      }
      const cfg = getSubPhaseConfig(key);
      if (!cfg) {
        completed.push(`${key}: no config`);
        continue;
      }
      const artifactPath = join(outputDir, cfg.produces);
      if (artifactExists(artifactPath)) {
        completed.push(`${key}: artifact found`);
        continue;
      }
      nextSub = { key, name: s.name, config: cfg };
      pending.push(`${key}: ${s.name} — needs ${cfg.produces}`);
      break;
    }
  }
  if (!nextSub) {
    return {
      target: `Phase ${phaseNum} complete`,
      status: 'All sub-phases done. Ready for next phase.',
      completed, pending,
      prompt: `Phase ${phaseNum} is complete. Run /wdf start to proceed to Phase ${phaseNum + 1}.`,
      nextCommand: '/wdf start',
    };
  }
  const { key, name, config } = nextSub;
  if (!config) {
    return {
      target: `Phase ${phaseNum} — ${key}`,
      status: 'Configuration missing', completed, pending,
      prompt: `No configuration found for sub-phase ${key}. Check subphase-executor.ts.`,
      nextCommand: '/wdf start',
    };
  }
  // ── Load agent methodology ──
  let agentMethodology = '';
  const skillRootGuess = findSkillRoot(projectRoot);
  if (skillRootGuess) {
    const agentPath = join(skillRootGuess, 'references', 'agents', `${config.agentFile}.md`);
    if (existsSync(agentPath)) {
      agentMethodology = extractMethodology(readFileSync(agentPath, 'utf-8'));
    }
  }
  // ── Artifact-specific guidance ──
  const artifactType = getArtifactTypeForSubPhase(key);
  const qualityChecklist = getArtifactChecklist(artifactType);
  const antiPatterns = getAntiPatterns(artifactType);
  // ── Collect context snippets from previous artifacts ──
  const contextSnippets: Array<{ path: string; snippet: string }> = [];
  if (config.dependsOn) {
    for (const depKey of config.dependsOn) {
      const depCfg = getSubPhaseConfig(depKey);
      if (depCfg) {
        const depPath = join(outputDir, depCfg.produces);
        if (existsSync(depPath)) {
          try {
            const content = readFileSync(depPath, 'utf-8');
            contextSnippets.push({ path: depCfg.produces, snippet: content.slice(0, 2000) });
          } catch { /* skip */ }
        }
      }
    }
  }
  if (phaseNum >= 3 && existsSync(join(outputDir, 'prd.md'))) {
    try {
      const prd = readFileSync(join(outputDir, 'prd.md'), 'utf-8');
      contextSnippets.push({ path: 'prd.md', snippet: prd.slice(0, 2000) });
    } catch { /* skip */ }
  }
  // ── Build the rich prompt ──
  const gs = (state.data as any).global_state;
  const projectName = gs?.project?.name ?? 'this project';
  const projectDesc = gs?.project?.description ?? '';
  const subLabel = key.replace('phase_', '').replace('_', '.');
  const lines: string[] = [];
  lines.push(`# Phase ${phaseNum}.${subLabel} — ${name ?? ''}`);
  lines.push('');
  lines.push(`**Project:** ${projectName}${projectDesc ? ` — ${projectDesc}` : ''}`);
  lines.push(`**Role:** ${config.agentFile}`);
  lines.push('');
  // Agent methodology section
  if (agentMethodology) {
    lines.push('## Methodology');
    lines.push('');
    lines.push(agentMethodology);
    lines.push('');
  }
  // Previous artifact context
  if (contextSnippets.length > 0) {
    lines.push('## Context from Previous Artifacts');
    lines.push('');
    for (const ctx of contextSnippets) {
      lines.push(`### ${ctx.path}`);
      lines.push('');
      lines.push('```');
      lines.push(ctx.snippet.slice(0, 1500));
      lines.push('```');
      lines.push('');
    }
  }
  // Output target
  lines.push('## Output');
  lines.push('');
  lines.push(`Write the result to: \`_wdf_output/${config.produces}\``);
  lines.push('');
  lines.push('The file MUST start with YAML frontmatter:');
  lines.push('```yaml');
  lines.push('---');
  lines.push(`artifact_type: ${artifactType}`);
  lines.push(`phase: ${phaseNum}`);
  lines.push(`sub_phase: "${key}"`);
  lines.push('status: completed');
  lines.push('---');
  lines.push('```');
  lines.push('');
  // Quality checklist
  lines.push('## Quality Checklist');
  lines.push('');
  lines.push('Your output must satisfy ALL of the following:');
  lines.push('');
  for (const item of qualityChecklist) {
    lines.push(`- [ ] ${item}`);
  }
  lines.push('');
  // Anti-patterns
  if (antiPatterns.length > 0) {
    lines.push('## Do NOT Do This');
    lines.push('');
    for (const ap of antiPatterns) {
      lines.push(`- ❌ ${ap}`);
    }
    lines.push('');
  }
  // Execution instructions
  lines.push('## Instructions');
  lines.push('');
  lines.push('1. Read all context files above to understand the project baseline');
  lines.push('2. Follow the methodology — produce structured, specific output');
  lines.push('3. Every requirement must have clear acceptance criteria');
  lines.push('4. Use concrete names, numbers, and examples — no vague language');
  lines.push('5. Output must be 500+ characters of substantive analysis');
  lines.push('');
  // Automation loop instructions — only when execution_mode is "auto"
  // Controlled by: wdf init --mode auto|interactive
  const executionMode = gs?.execution_mode ?? 'interactive';
  if (executionMode === 'auto') {
    lines.push('## Automation Loop');
    lines.push('');
    lines.push('This prompt is part of an automated execution pipeline. Protocol:');
    lines.push('');
    lines.push('1. Write the artifact to the output path with YAML frontmatter');
    lines.push('2. VERIFY: Run `wdf check --artifact=' + config.produces + '` — all checks must pass');
    lines.push('3. If verification fails: fix the artifact and re-run `wdf check`');
    lines.push('4. If verification passes: run `/wdf start` to advance the FSM');
    lines.push('');
    lines.push('Verification is a BLOCKING GATE. Do NOT proceed until all checks pass.');
    lines.push('See SKILL.md On Activation for the complete protocol.');
    lines.push('');
  }
  lines.push('## Verification');
  lines.push('');
  lines.push(`After writing: \`wdf check --artifact=${config.produces}\``);
  lines.push('Then immediately: `/wdf start`');
  return {
    target: `${key}: ${name ?? ''}`,
    status: `Phase ${phaseNum}, sub-phase ${key}`,
    completed, pending,
    prompt: lines.join('\n'),
    nextCommand: '/wdf start',
  };
}

// ── Phase 4: Story implementation prompts ──────────────────────

function generateStoryPrompt(
  state: SprintStatusManager,
  projectRoot: string,
  completed: string[],
  pending: string[],
): PromptResult {
  const storiesDir = join(projectRoot, '_wdf_output', 'stories');
  let stories: StoryEntry[] | undefined = state.getDevelopmentOrder();
  // Load stories from disk into state if not already loaded (Phase 4 entry).
  // Mirrors the load step in `executeImplementationPhase()` so `wdf start` can
  // produce the per-story prompt without requiring `wdf run` first.
  if ((!stories || stories.length === 0) && existsSync(storiesDir)) {
    const files = readdirSync(storiesDir).filter(f => f.endsWith('.md'));
    if (files.length > 0) {
      const loaded = loadStoriesFromDirSync(storiesDir);
      if (loaded.length > 0) {
        // setDevelopmentOrder is async (writes to disk); we run it fire-and-forget
        // here because the prompt path is read-only display. The next `wdf start`
        // will see the persisted order.
        void state.setDevelopmentOrder(loaded);
        stories = loaded;
      }
    }
  }
  if (!stories || stories.length === 0) {
    if (existsSync(storiesDir)) {
      const files = readdirSync(storiesDir).filter(f => f.endsWith('.md'));
      if (files.length === 0) {
        return {
          target: 'Phase 4', status: 'No stories defined',
          completed, pending: ['Create stories in _wdf_output/stories/'],
          prompt: [
            '## Task: Create Stories for Phase 4',
            '',
            'No stories found. Create story files in `_wdf_output/stories/`.',
            '',
            'Each story file must have YAML frontmatter:',
            '```yaml',
            '---',
            'story_id: "S-XXX-01"',
            'title: "Story Title"',
            'track: backend | frontend | full-stack',
            'effort: S | M | L | XL',
            'scope_write:',
            '  - "src/modules/xxx/"',
            'acceptance_check:',
            '  - "npm run test"',
            'code_standards_source:',
            '  - "AGENTS.md"',
            '---',
            '```',
            '',
            '### Quality Checklist',
            '- [ ] story_id follows pattern S-{DOMAIN}-{NN}',
            '- [ ] scope_write paths are relative, no path traversal',
            '- [ ] acceptance_check entries are executable commands',
            '- [ ] depends_on references valid story IDs (if any)',
            '- [ ] track is explicitly set (backend / frontend / full-stack)',
            '',
            'Then run `/wdf start` to begin Phase 4.',
          ].join('\n'),
          nextCommand: '/wdf start',
        };
      }
    }
  }
  for (const story of (stories ?? [])) {
    const codeExists = story.scope_write.some(scope => existsSync(join(projectRoot, scope)));
    if (codeExists) {
      completed.push(`${story.story_id}: CODE_EXISTS`);
      continue;
    }
    pending.push(`${story.story_id}: ${story.title} — needs implementation`);
    const lines: string[] = [
      `## Story: ${story.story_id} — ${story.title}`,
      '',
      `**Track:** ${story.track}`,
      `**Scope:** ${story.scope_write.join(', ')}`,
      `**Acceptance Checks:** ${story.acceptance_check?.join(', ') ?? 'none'}`,
    ];
    if (story.depends_on?.length) {
      lines.push('', '### Dependencies', '');
      for (const dep of story.depends_on) {
        lines.push(`- ${dep.story_id} (${dep.track ?? 'unknown track'})`);
      }
    }
    lines.push('', '## Implementation', '', '1. Read the architecture: `_wdf_output/architecture.md`', '2. Follow the API contract: `_wdf_output/api-spec.yaml`', '3. Follow the DB schema: `_wdf_output/db-schema.md`', '4. Implement within the scope paths listed above — do NOT modify files outside `scope_write`', '5. Write tests for ALL implemented code (unit + integration)', '6. Run acceptance checks: `' + (story.acceptance_check?.[0] ?? 'npm run test') + '`', '', '## Quality Checklist', '', '- [ ] All code is within declared scope_write paths', '- [ ] TypeScript strict mode passes (no `any`, no implicit)', '- [ ] All acceptance_check commands exit 0', '- [ ] Test coverage meets project threshold', '- [ ] API endpoints match api-spec.yaml contract', '- [ ] Error states and edge cases are handled', '', '## Automation Loop', '', 'This story is part of a multi-step automation loop. Your actions:', '', '1. Implement the code within scope_write paths', '2. Write tests and ensure they pass', '3. Commit the completed implementation', `4. Run \`wdf check --story=${story.story_id}\` to validate`, '5. Run `/wdf start` to re-sync FSM state and advance the loop', '', '**Do NOT stop after implementing one story.** The loop continues until all', 'stories are implemented. Each `/wdf start` call produces the next pending', 'story or the Phase 4 dispatch manifest.', '', 'If a phase-4-dispatch.json manifest exists, read it programmatically and', 'dispatch stories via Agent tool in dependency order. See SKILL.md On', 'Activation for the complete loop protocol.', '', '## Verification', '', `After implementation: \`wdf check --story=${story.story_id}\``, 'Then immediately: `/wdf start`');
    return {
      target: `Story ${story.story_id}`,
      status: `Phase 4, ${story.story_id}`,
      completed, pending,
      prompt: lines.join('\n'),
      nextCommand: '/wdf start',
    };
  }
  return {
    target: 'Phase 4 complete',
    status: 'All stories implemented',
    completed, pending,
    prompt: ['## Phase 4 Complete!', '',
      'All stories have been implemented.',
      '',
      'Run acceptance gates:',
      '```',
      'wdf accept code',
      'wdf accept feature',
      'wdf accept ui',
      'wdf accept e2e',
      '```',
    ].join('\n'),
    nextCommand: '/wdf accept code',
  };
}

// ── Agent methodology extraction ────────────────────────────────

/**
 * Extract the key methodology from an agent reference file.
 * Strips frontmatter and keeps the core content.
 */
function extractMethodology(raw: string): string {
  // Remove YAML frontmatter
  let body = raw.replace(/^---\n[\s\S]*?\n---/, '').trim();
  // Take up to 3KB of methodology
  if (body.length > 3000) {
    body = body.slice(0, 3000) + '\n\n[...methodology continues, see full reference file]';
  }
  return body;
}

// ── Artifact-specific guidance ──────────────────────────────────

function getArtifactTypeForSubPhase(key: string): string {
  if (key.includes('1_1') || key.includes('2_1')) return 'impact-map';
  if (key.includes('1_2')) return 'domain-research';
  if (key.includes('1_3')) return 'product-brief';
  if (key.includes('2_2')) return 'event-storm';
  if (key.includes('2_3')) return 'jtbd-cards';
  if (key.includes('2_4')) return 'story-map';
  if (key.includes('2_5')) return 'prd';
  if (key.includes('2_6')) return 'user-flows';
  if (key.includes('2_7')) return 'wireframes';
  if (key.includes('2_8')) return 'design-tokens';
  if (key.includes('2_9') || key.includes('2_10')) return 'design-acceptance';
  if (key.includes('3_1')) return 'system-context';
  if (key.includes('3_2')) return 'architecture-style';
  if (key.includes('3_3')) return 'container-design';
  if (key.includes('3_4')) return 'quality-attributes';
  if (key.includes('3_5')) return 'component-design';
  if (key.includes('3_6')) return 'epic';
  if (key.includes('3_7')) return 'story';
  if (key.includes('3_8')) return 'api-spec';
  if (key.includes('3_9')) return 'readiness-check';
  return 'artifact';
}

function getArtifactChecklist(type: string): string[] {
  const checklists: Record<string, string[]> = {
    'impact-map': [
      'Identifies primary and secondary actors',
      'Maps goals → impacts → deliverables for each actor',
      'Includes constraints and assumptions section',
      'Prioritizes impacts by business value',
    ],
    'product-brief': [
      'Defines the core problem and target users',
      'Lists 3-5 key hypotheses to validate',
      'Describes competitive landscape or alternatives',
      'Includes success metrics (how will we know this worked?)',
      'Defines scope boundaries (what is OUT of scope)',
    ],
    'prd': [
      'Contains at least 3 REQ-NNN entries with unique IDs',
      'Each REQ has acceptance criteria (how to verify)',
      'Each REQ has a priority label (P0/P1/P2)',
      'Non-functional requirements are included (perf, security, a11y)',
      'Cross-references source JTBD or user stories',
      'Specifies success metrics and KPIs',
    ],
    'user-flows': [
      'Covers the primary happy path for each user goal',
      'Includes error states and recovery paths',
      'Documents entry/exit conditions for each flow',
      'Identifies dependencies between flows',
    ],
    'wireframes': [
      'Shows all key states: loading, empty, error, success',
      'Includes responsive breakpoints (mobile / tablet / desktop)',
      'Labels interactive elements consistently',
      'Documents content hierarchy and information architecture',
    ],
    'system-context': [
      'Identifies all external systems and actors',
      'Shows data flow direction between systems',
      'Documents protocols and interfaces at boundaries',
      'Includes trust boundaries and security zones (C4 L1)',
    ],
    'container-design': [
      'Decomposes system into deployable containers',
      'Documents technology choices for each container',
      'Shows inter-container communication patterns',
      'Identifies data storage per container (C4 L2)',
    ],
    'component-design': [
      'Decomposes each container into components',
      'Documents component responsibilities and interfaces',
      'Shows dependency direction (depends on, not depends from)',
      'Identifies cross-cutting concerns (C4 L3)',
    ],
    'epic': [
      'References at least 2 child stories',
      'Cross-references source PRD requirements (REQ-NNN)',
      'Defines epic-level acceptance criteria',
      'Identifies epic dependencies on other epics',
    ],
    'story': [
      'Has a unique story_id (S-{DOMAIN}-{NN})',
      'scope_write contains valid relative paths',
      'acceptance_check contains executable commands',
      'depends_on references valid story IDs (if any)',
      'Defines effort estimate (S/M/L/XL)',
      'Track is explicitly set',
    ],
    'api-spec': [
      'Defines at least 2 endpoints with HTTP methods',
      'Each endpoint has request and response schemas',
      'Defines authentication method (security scheme)',
      'Error responses are documented (4xx, 5xx)',
      'Follows OpenAPI 3.0+ format',
    ],
    'db-schema': [
      'Defines at least 2 tables/collections',
      'Each table has column names, types, and constraints',
      'Documents relationships (foreign keys, references)',
      'Includes migration strategy (up/down)',
      'Indexes are documented for performance-critical queries',
    ],
    'readiness-check': [
      'Verifies all phase 1-3 artifacts exist',
      'Checks traceability: REQ → Epic → Story',
      'Confirms all stories have acceptance criteria',
      'Confirms API contract covers all endpoints',
      'Gate check summary: all pass before Phase 4 entry',
    ],
  };
  return checklists[type] ?? [
    'Content is substantive (500+ characters)',
    'All claims are backed by analysis',
    'No placeholder text (TBD, TODO, ...)',
    'Follows the methodology for this artifact type',
  ];
}

function getAntiPatterns(type: string): string[] {
  const patterns: Record<string, string[]> = {
    'prd': [
      'Writing generic requirements without specific acceptance criteria',
      'Mixing functional and non-functional requirements without labels',
      'Listing features without prioritization',
      'Vague language: "good performance", "user-friendly", "fast"',
      'Copying requirements from another project without adaptation',
    ],
    'story': [
      'Writing acceptance checks as descriptions instead of executable commands',
      'Using absolute paths or path traversal in scope_write',
      'Referencing stories that do not exist in depends_on',
      'Omitting the track field (backend/frontend/full-stack)',
    ],
    'api-spec': [
      'Defining endpoints without request/response schemas',
      'Omitting error response formats',
      'No authentication scheme defined',
      'Using generic 200 OK for all responses',
    ],
    'db-schema': [
      'Defining tables without column types',
      'No migration strategy documented',
      'Missing indexes for query patterns',
      'No relationship documentation between tables',
    ],
    'architecture': [
      'Skipping C4 level documentation',
      'No architecture decision records (ADRs)',
      'Describing implementation details instead of architecture',
      'No trade-off analysis for key decisions',
    ],
  };
  return patterns[type] ?? [];
}

// ── Helpers ────────────────────────────────────────────────────

function findSkillRoot(projectRoot: string): string | null {
  const candidates = [
    join(projectRoot, '..', '..'),
    join(projectRoot, '..'),
    projectRoot,
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'references', 'agents'))) return c;
  }
  return null;
}

function artifactExists(path: string): boolean {
  if (!existsSync(path)) return false;
  if (path.endsWith('/')) {
    try {
      return readdirSync(path).length > 0;
    } catch {
      return false;
    }
  }
  try {
    const content = readFileSync(path, 'utf-8');
    if (path.endsWith('.yaml') || path.endsWith('.yml')) {
      return content.includes('openapi:') || content.includes('paths:') || content.length > 50;
    }
    return content.includes('---') && content.length > 200;
  } catch {
    return false;
  }
}

/**
 * Sync loader for `_wdf_output/stories/*.md` → StoryEntry[]. Mirrors the parser
 * used by `loadStoriesFromDirectory` in orchestrator.ts but avoids the cross-
 * file import (and async glue) so the prompt-generator can populate state
 * lazily on Phase 4 entry.
 */
function loadStoriesFromDirSync(storiesDir: string): StoryEntry[] {
  if (!existsSync(storiesDir)) return [];
  const files = readdirSync(storiesDir).filter(f => f.endsWith('.md'));
  const stories: StoryEntry[] = [];
  for (const f of files) {
    try {
      const content = readFileSync(join(storiesDir, f), 'utf-8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;
      const fm: Record<string, any> = {};
      // Extremely small YAML parser — handles the limited shape we emit.
      const lines = fmMatch[1].split('\n');
      let currentKey: string | null = null;
      let currentList: string[] | null = null;
      for (const line of lines) {
        if (line.match(/^[a-z_]+:/)) {
          // flush previous list
          if (currentKey && currentList) fm[currentKey] = currentList;
          currentList = null;
          currentKey = null;
          const m = line.match(/^([a-z_]+):\s*(.*)$/);
          if (!m) continue;
          const [, key, val] = m;
          if (val.trim() === '') {
            currentKey = key;
            currentList = [];
          } else {
            fm[key] = val.replace(/^["']|["']$/g, '').trim();
          }
        } else if (line.match(/^\s+-\s/) && currentList) {
          const item = line.replace(/^\s+-\s+/, '').replace(/^["']|["']$/g, '').trim();
          currentList.push(item);
        }
      }
      if (currentKey && currentList) fm[currentKey] = currentList;
      if (!fm.story_id || !fm.scope_write) continue;
      stories.push({
        story_id: fm.story_id,
        title: fm.title ?? fm.story_id,
        track: fm.track ?? 'backend',
        order: typeof fm.order === 'string' ? parseInt(fm.order, 10) : (fm.order ?? stories.length + 1),
        scope_write: Array.isArray(fm.scope_write) ? fm.scope_write : [fm.scope_write],
        acceptance_check: Array.isArray(fm.acceptance_check) ? fm.acceptance_check : (fm.acceptance_check ? [fm.acceptance_check] : []),
        code_standards_source: Array.isArray(fm.code_standards_source) ? fm.code_standards_source : ['AGENTS.md'],
        depends_on: Array.isArray(fm.depends_on)
          ? fm.depends_on.map((id: string) => ({ story_id: id, track: 'backend' }))
          : [],
      });
    } catch {
      // skip malformed story files
    }
  }
  // Sort by order
  stories.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return stories;
}
