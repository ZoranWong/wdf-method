// Auto-Executor — generates structured batch execution plans for Phases 1-3.
//
// The CLI cannot call AI directly (architectural constraint). Instead, it
// builds a JSON batch file listing every pending sub-phase together with:
//   1. The full prompt (agent methodology + quality checklist + anti-patterns)
//   2. The target output path
//   3. Dependency ordering (which must complete before this one)
//
// The Claude session reads this batch file and executes each prompt via its
// native Write / Agent tools. After each artifact is written, `wdf start`
// re-syncs state and the next batch reflects the new reality.
//
// This is the "last mile" that closes the loop between prompt generation
// and actual AI execution — the missing piece identified in the V3.7 gap
// analysis.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { SprintStatusManager } from './sprint-status.js';
import { getSubPhaseConfig, isSubPhaseComplete, SubPhaseContext, SubPhaseConfig } from './subphase-executor.js';

export interface BatchEntry {
  /** Sub-phase key, e.g. "phase_2_1" */
  subPhaseKey: string;
  /** Human-readable name, e.g. "Impact Mapping" */
  name: string;
  /** Phase number (1-3) */
  phase: number;
  /** Agent role file, e.g. "product-manager" */
  agentFile: string;
  /** Relative output path from _wdf_output/, e.g. "_output/planning/impact-map.md" */
  outputPath: string;
  /** Sub-phase keys this one depends on */
  dependsOn: string[];
  /** Full ready-to-execute prompt */
  prompt: string;
  /** Estimated complexity */
  effort: 'S' | 'M' | 'L';
  /** Whether this sub-phase can be auto-skipped */
  canSkip: boolean;
  /** Skip condition hint */
  skipHint?: string;
}

export interface AutoExecuteBatch {
  /** Schema version for forward compatibility */
  schema_version: '1.0';
  /** When this batch was generated */
  generated_at: string;
  /** Project name */
  project: string;
  /** Overall status */
  status: 'ready' | 'blocked' | 'complete';
  /** If blocked, why */
  block_reason?: string;
  /** Total pending sub-phases across all phases */
  total_pending: number;
  /** Execution instructions for the Claude session */
  instructions: string;
  /** Ordered list of sub-phases to execute */
  entries: BatchEntry[];
  /** What to run after all entries are done */
  next_command: string;
}

// ── Phase/sub-phase metadata ─────────────────────────────────────
const PHASE_NAMES: Record<number, string> = {
  1: 'Analysis',
  2: 'Planning',
  3: 'Solutioning',
  4: 'Implementation',
};

const SUB_PHASE_NAMES: Record<string, string> = {
  'phase_1_1': 'Brainstorming',
  'phase_1_2': 'Domain Research',
  'phase_1_3': 'Product Brief',
  'phase_2_1': 'Impact Mapping',
  'phase_2_2': 'Event Storming',
  'phase_2_3': 'JTBD Cards',
  'phase_2_4': 'Story Mapping',
  'phase_2_5': 'Kano + RICE + PRD',
  'phase_2_6': 'User Flows & IA',
  'phase_2_7': 'Wireframes',
  'phase_2_8': 'Design System',
  'phase_2_9': 'Interaction Design',
  'phase_2_10': 'Design Acceptance',
  'phase_3_1': 'System Context (C4 L1)',
  'phase_3_2': 'Architecture Style',
  'phase_3_3': 'Container Design (C4 L2)',
  'phase_3_4': 'Quality Attributes',
  'phase_3_5': 'Component Design (C4 L3)',
  'phase_3_6': 'Epics & Feature Plan',
  'phase_3_7': 'Story Design',
  'phase_3_8': 'API & Data Design',
  'phase_3_9': 'Readiness Check',
};

const SUB_PHASE_ORDER = [
  'phase_1_1', 'phase_1_2', 'phase_1_3',
  'phase_2_1', 'phase_2_2', 'phase_2_3', 'phase_2_4', 'phase_2_5',
  'phase_2_6', 'phase_2_7', 'phase_2_8', 'phase_2_9', 'phase_2_10',
  'phase_3_1', 'phase_3_2', 'phase_3_3', 'phase_3_4', 'phase_3_5',
  'phase_3_6', 'phase_3_7', 'phase_3_8', 'phase_3_9',
];

const EFFORT_MAP: Record<string, 'S' | 'M' | 'L'> = {
  'phase_1_1': 'M', 'phase_1_2': 'L', 'phase_1_3': 'M',
  'phase_2_1': 'M', 'phase_2_2': 'L', 'phase_2_3': 'M', 'phase_2_4': 'L',
  'phase_2_5': 'L', 'phase_2_6': 'M', 'phase_2_7': 'L', 'phase_2_8': 'M',
  'phase_2_9': 'S', 'phase_2_10': 'S',
  'phase_3_1': 'M', 'phase_3_2': 'M', 'phase_3_3': 'L', 'phase_3_4': 'M',
  'phase_3_5': 'L', 'phase_3_6': 'L', 'phase_3_7': 'L', 'phase_3_8': 'L',
  'phase_3_9': 'M',
};

// ── Main entry point ─────────────────────────────────────────────
export function buildAutoExecuteBatch(state: SprintStatusManager, projectRoot: string, skillRoot: string): AutoExecuteBatch {
  const outputDir = join(projectRoot, '_wdf_output');
  const entries: BatchEntry[] = [];
  const completed: string[] = [];
  const gs = state.data.global_state as any;
  const projectName = gs?.project?.name ?? (state.data as any).project ?? 'this project';
  // Project description is stored in global_state.project_description
  // by SprintStatusManager (loaded from global.yaml project.description).
  const projectDescription = gs?.project_description ?? '';
  // Check if skip-decisions.yaml exists — if not, prepend skip analysis
  // as the first task so the LLM can decide which sub-phases to skip
  // based on the project description, rather than hardcoded rules.
  const skipDecisionsPath = join(projectRoot, '_wdf_output', 'status', 'skip-decisions.yaml');
  const skipDecisionsExist = existsSync(skipDecisionsPath);
  if (!skipDecisionsExist && projectDescription) {
    entries.push({
      subPhaseKey: 'phase_0_skip_analysis',
      name: 'Skip Analysis',
      phase: 0,
      agentFile: 'analyst',
      outputPath: 'status/skip-decisions.yaml',
      dependsOn: [],
      prompt: buildSkipAnalysisPrompt(projectName, projectDescription),
      effort: 'S',
      canSkip: false,
    });
    // Return early — skip analysis must complete before any sub-phases
    const instructions = [
      'Before any sub-phases can begin, the LLM must analyze the project description',
      'to decide which sub-phases would add value and which can be skipped.',
      '',
      'Read the prompt for "Skip Analysis" below, then write',
      '`_wdf_output/status/skip-decisions.yaml` with your recommendations.',
      '',
      'Guidelines for skipping:',
      '- If the domain is well-understood (CRUD, todo, blog): skip Domain Research',
      '- If using an existing design system (MUI, shadcn): skip Design System',
      '- If standard CRUD patterns: skip Interaction Design & Event Storming',
      '- If simple app without complex domain events: skip Event Storming',
      '- If the project is well-scoped: skip Product Brief',
      '- When in doubt, DO NOT skip — run the sub-phase',
      '',
      'After writing skip-decisions.yaml, run `/wdf start` to proceed.',
    ].join('\n');
    return {
      schema_version: '1.0',
      generated_at: new Date().toISOString(),
      project: projectName,
      status: 'ready',
      total_pending: 1,
      instructions,
      entries,
      next_command: '/wdf start',
    };
  }
  // Walk sub-phases in order, stopping at the first batch of pending ones.
  // We only include sub-phases whose dependencies are already satisfied —
  // this prevents the Claude session from executing out of order.
  for (const subKey of SUB_PHASE_ORDER) {
    const phaseNum = parseInt(subKey.split('_')[1], 10);
    if (phaseNum > 3)
      continue;
    const cfg = getSubPhaseConfig(subKey);
    if (!cfg) {
      completed.push(`${subKey}: no config`);
      continue;
    }
    // Check current FSM state
    const currentStatus = state.getSubState(phaseNum, subKey);
    if (currentStatus === 'LOCKED' || currentStatus === 'SKIPPED') {
      completed.push(`${subKey}: ${currentStatus}`);
      continue;
    }
    // Check auto-skip via config hook
    if (cfg.skipIf?.(projectRoot)) {
      completed.push(`${subKey}: auto-skipped (skipIf hook)`);
      continue;
    }
    // Check auto-skip via YAML flag
    const phaseData = state.getPhase(phaseNum);
    const subData = (phaseData as any)?.substates?.[subKey];
    if (subData?.auto_skip === true) {
      completed.push(`${subKey}: auto-skipped (YAML flag)`);
      continue;
    }
    // Check if artifact already exists
    const artifactPath = join(outputDir, cfg.produces);
    const ctx: SubPhaseContext = {
      projectRoot,
      phaseNum,
      subPhaseKey: subKey,
      subPhaseName: SUB_PHASE_NAMES[subKey] ?? subKey,
      outputPath: artifactPath,
      agentFile: cfg.agentFile,
      agentMode: cfg.agentMode,
      previousArtifacts: cfg.dependsOn.map(depKey => {
        const depCfg = getSubPhaseConfig(depKey);
        return depCfg ? join(outputDir, depCfg.produces) : join(outputDir, 'unknown');
      }),
    };
    if (isSubPhaseComplete(ctx)) {
      completed.push(`${subKey}: artifact exists`);
      continue;
    }
    // Check if all dependencies are satisfied
    const unmetDeps = cfg.dependsOn.filter(depKey => {
      const depCfg = getSubPhaseConfig(depKey);
      if (!depCfg)
        return false;
      const depPath = join(outputDir, depCfg.produces);
      return !isSubPhaseComplete({ ...ctx, outputPath: depPath, subPhaseKey: depKey });
    });
    if (unmetDeps.length > 0) {
      // This sub-phase has unmet dependencies — include it but mark as blocked
      // so the Claude session knows to wait
      entries.push({
        subPhaseKey: subKey,
        name: SUB_PHASE_NAMES[subKey] ?? subKey,
        phase: phaseNum,
        agentFile: cfg.agentFile,
        outputPath: cfg.produces,
        dependsOn: cfg.dependsOn,
        prompt: `Cannot execute yet — waiting for dependencies: ${unmetDeps.join(', ')}`,
        effort: EFFORT_MAP[subKey] ?? 'M',
        canSkip: Boolean(subData?.auto_skip) || !!cfg.skipIf,
        skipHint: undefined,
      });
      continue;
    }
    // This sub-phase is ready to execute — build the full prompt
    const prompt = buildEntryPrompt(subKey, cfg.agentFile, cfg.produces, phaseNum, projectRoot, skillRoot, outputDir);
    entries.push({
      subPhaseKey: subKey,
      name: SUB_PHASE_NAMES[subKey] ?? subKey,
      phase: phaseNum,
      agentFile: cfg.agentFile,
      outputPath: cfg.produces,
      dependsOn: cfg.dependsOn,
      prompt,
      effort: EFFORT_MAP[subKey] ?? 'M',
      canSkip: !!cfg.skipIf,
      skipHint: undefined,
    });
    // Only include the first batch of ready entries — we want
    // the Claude session to execute them then re-run wdf start
    // to re-sync state before getting the next batch.
    if (entries.length >= 3)
      break;
  }
  const status: AutoExecuteBatch['status'] = entries.length === 0 ? 'complete' :
    entries.every(e => e.prompt.startsWith('Cannot execute')) ? 'blocked' :
      'ready';
  const instructions = buildInstructions(entries, status);
  return {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    project: projectName,
    status,
    block_reason: status === 'blocked'
      ? `Waiting for upstream artifacts: ${entries.map(e => e.dependsOn.join(', ')).join('; ')}`
      : undefined,
    total_pending: entries.length,
    instructions,
    entries,
    next_command: status === 'complete' ? '/wdf start' : '/wdf start',
  };
}

// ── Prompt builder for a single entry ────────────────────────────
function buildEntryPrompt(subKey: string, agentFile: string, outputRelPath: string, phaseNum: number, projectRoot: string, skillRoot: string, outputDir: string): string {
  const lines: string[] = [];
  const subLabel = subKey.replace('phase_', '').replace('_', '.');
  const name = SUB_PHASE_NAMES[subKey] ?? subKey;
  lines.push(`# Phase ${subLabel} — ${name}`);
  lines.push('');
  lines.push(`**Role:** ${agentFile}`);
  lines.push(`**Output:** _wdf_output/${outputRelPath}`);
  lines.push('');
  // Load agent methodology
  const agentPath = findAgentFile(agentFile, skillRoot);
  if (agentPath) {
    try {
      const raw = readFileSync(agentPath, 'utf-8');
      const body = raw.replace(/^---\n[\s\S]*?\n---/, '').trim();
      lines.push('## Agent Methodology');
      lines.push('');
      lines.push(body.slice(0, 3000));
      lines.push('');
    }
    catch { /* skip */ }
  }
  // Load context from dependency artifacts
  const cfg = getSubPhaseConfig(subKey);
  if (cfg?.dependsOn) {
    const contextParts: string[] = [];
    for (const depKey of cfg.dependsOn) {
      const depCfg = getSubPhaseConfig(depKey);
      if (depCfg) {
        const depPath = join(outputDir, depCfg.produces);
        if (existsSync(depPath)) {
          try {
            const content = readFileSync(depPath, 'utf-8');
            contextParts.push(`### Context from: ${depCfg.produces}\n\n${content.slice(0, 2000)}`);
          }
          catch { /* skip */ }
        }
      }
    }
    // Also include PRD for phase 2/3 sub-phases
    if (phaseNum >= 2) {
      const prdPath = join(outputDir, 'prd.md');
      if (existsSync(prdPath)) {
        try {
          const prd = readFileSync(prdPath, 'utf-8');
          contextParts.push(`### Context from: prd.md\n\n${prd.slice(0, 2000)}`);
        }
        catch { /* skip */ }
      }
    }
    if (contextParts.length > 0) {
      lines.push('## Context from Previous Artifacts');
      lines.push('');
      lines.push(contextParts.join('\n\n'));
      lines.push('');
    }
  }
  // Output specification
  lines.push('## Required Output');
  lines.push('');
  lines.push(`Write to: \`_wdf_output/${outputRelPath}\``);
  lines.push('');
  lines.push('The file MUST start with YAML frontmatter:');
  lines.push('```yaml');
  lines.push('---');
  lines.push(`artifact_type: ${getArtifactType(subKey)}`);
  lines.push(`phase: ${phaseNum}`);
  lines.push(`sub_phase: "${subKey}"`);
  lines.push('status: completed');
  lines.push('---');
  lines.push('```');
  lines.push('');
  // Quality checklist
  const checklist = getChecklist(subKey);
  if (checklist.length > 0) {
    lines.push('## Quality Checklist (ALL must be satisfied)');
    lines.push('');
    for (const item of checklist) {
      lines.push(`- [ ] ${item}`);
    }
    lines.push('');
  }
  // Anti-patterns
  const antiPatterns = getAntiPatterns(subKey);
  if (antiPatterns.length > 0) {
    lines.push('## Anti-Patterns (Do NOT do these)');
    lines.push('');
    for (const ap of antiPatterns) {
      lines.push(`- ❌ ${ap}`);
    }
    lines.push('');
  }
  // Execution steps
  lines.push('## Execution Steps');
  lines.push('');
  lines.push('1. Read any context files referenced above to understand the baseline');
  lines.push('2. Follow the agent methodology to produce structured, specific output');
  lines.push('3. Write the artifact with complete YAML frontmatter');
  lines.push('4. Verify the quality checklist — every item must be checked');
  lines.push(`5. Run \`wdf check --artifact=${outputRelPath}\` to validate`);
  lines.push('');
  lines.push('## Automation Loop');
  lines.push('');
  lines.push('This prompt is part of a batch execution plan. After completing this entry:');
  lines.push('');
  lines.push('1. Move to the next entry in the batch that is not blocked by dependencies');
  lines.push('2. For each entry, write its artifact following the same pattern');
  lines.push('3. After ALL entries are done, run `/wdf start` to re-sync FSM state');
  lines.push('');
  lines.push('The loop continues until all sub-phases across Phases 1-3 are LOCKED.');
  lines.push('Each `/wdf start` call generates a fresh auto-execute.json reflecting');
  lines.push('the latest state, including any new dependencies that are now satisfied.');
  lines.push('');
  return lines.join('\n');
}

// ── Instruction builder ──────────────────────────────────────────
function buildInstructions(entries: BatchEntry[], status: AutoExecuteBatch['status']): string {
  switch (status) {
    case 'complete':
      return 'All Phase 1-3 sub-phases are complete. Run `/wdf start` to proceed to Phase 4.';
    case 'blocked':
      return 'Some sub-phases have unmet dependencies. Ensure upstream artifacts are generated first, then re-run `/wdf start`.';
    case 'ready': {
      const names = entries.map(e => `"${e.name}" (${e.subPhaseKey})`).join(', ');
      return [
        `Execute the following ${entries.length} sub-phase(s) in order: ${names}.`,
        '',
        'For each entry:',
        '1. Read the prompt and context',
        '2. Write the artifact to the specified output path with YAML frontmatter',
        '3. Verify against the quality checklist',
        '4. After ALL entries are complete, run `/wdf start` to re-sync state',
        '',
        'IMPORTANT: Write complete, substantive artifacts. No placeholder text.',
      ].join('\n');
    }
  }
}

// ── Artifact type / checklist / anti-pattern helpers ─────────────
function getArtifactType(subKey: string): string {
  if (subKey.includes('1_1') || subKey.includes('2_1'))
    return 'impact-map';
  if (subKey.includes('1_2'))
    return 'domain-research';
  if (subKey.includes('1_3'))
    return 'product-brief';
  if (subKey.includes('2_2'))
    return 'event-storm';
  if (subKey.includes('2_3'))
    return 'jtbd-cards';
  if (subKey.includes('2_4'))
    return 'story-map';
  if (subKey.includes('2_5'))
    return 'prd';
  if (subKey.includes('2_6'))
    return 'user-flows';
  if (subKey.includes('2_7'))
    return 'wireframes';
  if (subKey.includes('2_8'))
    return 'design-tokens';
  if (subKey.includes('2_9') || subKey.includes('2_10'))
    return 'design-acceptance';
  if (subKey.includes('3_1'))
    return 'system-context';
  if (subKey.includes('3_2'))
    return 'architecture-style';
  if (subKey.includes('3_3'))
    return 'container-design';
  if (subKey.includes('3_4'))
    return 'quality-attributes';
  if (subKey.includes('3_5'))
    return 'component-design';
  if (subKey.includes('3_6'))
    return 'epic';
  if (subKey.includes('3_7'))
    return 'story';
  if (subKey.includes('3_8'))
    return 'api-spec';
  if (subKey.includes('3_9'))
    return 'readiness-check';
  return 'artifact';
}

function getChecklist(subKey: string): string[] {
  const type = getArtifactType(subKey);
  const lists: Record<string, string[]> = {
    'impact-map': [
      'Identifies primary and secondary actors',
      'Maps goals → impacts → deliverables for each actor',
      'Includes constraints and assumptions section',
    ],
    'product-brief': [
      'Defines the core problem and target users',
      'Lists 3-5 key hypotheses to validate',
      'Describes competitive landscape or alternatives',
      'Defines scope boundaries (what is OUT of scope)',
    ],
    'prd': [
      'Contains at least 3 REQ-NNN entries with unique IDs',
      'Each REQ has acceptance criteria',
      'Each REQ has a priority label (P0/P1/P2)',
      'Non-functional requirements are included',
      'Cross-references source JTBD or user stories',
    ],
    'user-flows': [
      'Covers primary happy path for each user goal',
      'Includes error states and recovery paths',
      'Documents entry/exit conditions for each flow',
    ],
    'wireframes': [
      'Shows key states: loading, empty, error, success',
      'Includes responsive breakpoints',
      'Labels interactive elements consistently',
    ],
    'system-context': [
      'Identifies all external systems and actors',
      'Shows data flow direction between systems',
      'Documents protocols and interfaces at boundaries',
    ],
    'container-design': [
      'Decomposes system into deployable containers',
      'Documents technology choices for each container',
      'Shows inter-container communication patterns',
    ],
    'component-design': [
      'Decomposes each container into components',
      'Documents component responsibilities and interfaces',
      'Identifies cross-cutting concerns',
    ],
    'epic': [
      'References at least 2 child stories',
      'Cross-references source PRD requirements',
      'Defines epic-level acceptance criteria',
    ],
    'story': [
      'Has unique story_id (S-{DOMAIN}-{NN})',
      'scope_write contains valid relative paths',
      'acceptance_check contains executable commands',
      'Track is explicitly set',
    ],
    'api-spec': [
      'Defines at least 2 endpoints with HTTP methods',
      'Each endpoint has request and response schemas',
      'Error responses are documented (4xx, 5xx)',
      'Follows OpenAPI 3.0+ format',
    ],
    'db-schema': [
      'Defines at least 2 tables/collections',
      'Each table has column names, types, constraints',
      'Documents relationships',
      'Includes migration strategy',
    ],
    'readiness-check': [
      'Verifies all phase 1-3 artifacts exist',
      'Checks traceability: REQ → Epic → Story',
      'Confirms all stories have acceptance criteria',
      'Gate check summary: all pass before Phase 4',
    ],
  };
  return lists[type] ?? [
    'Content is substantive (500+ characters)',
    'All claims are backed by analysis',
    'No placeholder text (TBD, TODO, ...)',
  ];
}

function getAntiPatterns(subKey: string): string[] {
  const type = getArtifactType(subKey);
  const patterns: Record<string, string[]> = {
    'prd': [
      'Writing generic requirements without specific acceptance criteria',
      'Listing features without prioritization',
      'Vague language: "good performance", "user-friendly", "fast"',
    ],
    'story': [
      'Writing acceptance checks as descriptions instead of executable commands',
      'Using absolute paths or path traversal in scope_write',
      'Omitting the track field',
    ],
    'api-spec': [
      'Defining endpoints without request/response schemas',
      'Omitting error response formats',
      'No authentication scheme defined',
    ],
    'db-schema': [
      'Defining tables without column types',
      'No migration strategy documented',
      'No relationship documentation between tables',
    ],
    'architecture-style': [
      'No trade-off analysis for key decisions',
      'Skipping ADR documentation',
      'Describing implementation instead of architecture',
    ],
  };
  return patterns[type] ?? [];
}

// ── Helpers ──────────────────────────────────────────────────────
function findAgentFile(agentName: string, skillRoot: string): string | null {
  const candidates = [
    join(skillRoot, 'references', 'agents', `${agentName}.md`),
    join(skillRoot, '..', 'references', 'agents', `${agentName}.md`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate))
      return candidate;
  }
  return null;
}

// ── Write batch to disk ──────────────────────────────────────────
export function writeAutoExecuteBatch(batch: AutoExecuteBatch, projectRoot: string): string {
  const dispatchDir = join(projectRoot, '_wdf_output', '.dispatch');
  mkdirSync(dispatchDir, { recursive: true });
  const batchPath = join(dispatchDir, 'auto-execute.json');
  writeFileSync(batchPath, JSON.stringify(batch, null, 2), 'utf-8');
  // Also write a human-readable summary
  const summaryPath = join(dispatchDir, 'auto-execute.md');
  const summaryLines: string[] = [
    '# Auto-Execute Batch',
    '',
    `**Generated:** ${batch.generated_at}`,
    `**Status:** ${batch.status.toUpperCase()}`,
    `**Pending:** ${batch.total_pending} sub-phase(s)`,
    '',
    '## Instructions',
    '',
    batch.instructions,
    '',
    '## Pending Sub-Phases',
    '',
  ];
  for (const entry of batch.entries) {
    summaryLines.push(`### Phase ${entry.phase} — ${entry.name} (${entry.subPhaseKey})`);
    summaryLines.push('');
    summaryLines.push(`- **Agent:** ${entry.agentFile}`);
    summaryLines.push(`- **Output:** _wdf_output/${entry.outputPath}`);
    summaryLines.push(`- **Effort:** ${entry.effort}`);
    summaryLines.push(`- **Can Skip:** ${entry.canSkip ? 'Yes' : 'No'}`);
    if (entry.dependsOn.length > 0) {
      summaryLines.push(`- **Depends On:** ${entry.dependsOn.join(', ')}`);
    }
    summaryLines.push('');
  }
  writeFileSync(summaryPath, summaryLines.join('\n'), 'utf-8');
  return batchPath;
}

// ── Skip Analysis Prompt ─────────────────────────────────────────
/**
 * Build a prompt for the LLM to analyze the project description and
 * recommend which sub-phases to skip. Called when no
 * _wdf_output/status/skip-decisions.yaml exists yet.
 */
function buildSkipAnalysisPrompt(projectName: string, description: string): string {
  const lines: string[] = [];
  lines.push('# Phase 0: Skip Analysis');
  lines.push('');
  lines.push(`**Project:** ${projectName}`);
  lines.push(`**Description:** ${description}`);
  lines.push('');
  lines.push('Analyze the project description above and decide which of the following');
  lines.push('sub-phases would add value and which can be safely skipped.');
  lines.push('');
  lines.push('## Available Sub-Phases');
  lines.push('');
  lines.push('### Phase 1: Analysis (optional)');
  lines.push('- **phase_1_1 — Brainstorming:** Explore problem space, generate ideas');
  lines.push('  Skip if: requirements are clear and well-understood');
  lines.push('- **phase_1_2 — Domain Research:** Study competitors, existing solutions');
  lines.push('  Skip if: the domain is well-known (CRUD, todo, blog, CMS)');
  lines.push('- **phase_1_3 — Product Brief:** Synthesize vision, define target users');
  lines.push('  Skip if: the project scope is well-defined');
  lines.push('');
  lines.push('### Phase 2: Planning');
  lines.push('- **phase_2_1 — Impact Mapping:** Map goals → actors → deliverables');
  lines.push('  Skip if: very simple project with single actor');
  lines.push('- **phase_2_2 — Event Storming:** Identify domain events/commands');
  lines.push('  Skip if: no complex domain logic (CRUD-only)');
  lines.push('- **phase_2_3 — JTBD Cards:** User motivation analysis');
  lines.push('  Skip if: straightforward user needs');
  lines.push('- **phase_2_4 — Story Mapping:** Activity backbone → release slices');
  lines.push('  Do NOT skip: core planning artifact');
  lines.push('- **phase_2_5 — Kano+RICE+PRD:** Prioritization + product spec');
  lines.push('  Do NOT skip: primary output of Phase 2');
  lines.push('- **phase_2_6 — User Flows:** Primary + error path flows');
  lines.push('  Do NOT skip: essential for UX');
  lines.push('- **phase_2_7 — Wireframes:** Page layouts with all states');
  lines.push('  Do NOT skip: essential for UI');
  lines.push('- **phase_2_8 — Design System:** Color, typography, components');
  lines.push('  Skip if: using MUI / shadcn / Tailwind UI / Ant Design');
  lines.push('- **phase_2_9 — Interaction Design:** Animations, transitions, micro-interactions');
  lines.push('  Skip if: standard CRUD patterns');
  lines.push('- **phase_2_10 — Design Acceptance:** Compile UX acceptance criteria');
  lines.push('  Do NOT skip: gates UX quality');
  lines.push('');
  lines.push('### Phase 3: Solutioning');
  lines.push('- **phase_3_1 — System Context (C4 L1):** System boundary + external actors');
  lines.push('  Do NOT skip: foundation for architecture');
  lines.push('- **phase_3_2 — Architecture Style:** Evaluate and select architecture patterns');
  lines.push('  Do NOT skip: critical decision point');
  lines.push('- **phase_3_3 — Container Design (C4 L2):** Deployable units');
  lines.push('  Do NOT skip: defines deployment architecture');
  lines.push('- **phase_3_4 — Quality Attributes (ATAM-lite):** Perf, security, scalability');
  lines.push('  Skip if: simple CRUD, proof-of-concept, internal tool');
  lines.push('- **phase_3_5 — Component Design (C4 L3):** Component breakdown');
  lines.push('  Do NOT skip: drives story scope_write paths');
  lines.push('- **phase_3_6 — Epics & Feature Plan:** Feature hierarchy');
  lines.push('  Do NOT skip: foundation for stories');
  lines.push('- **phase_3_7 — Story Design:** Atomic implementation stories');
  lines.push('  Do NOT skip: drives Phase 4 implementation');
  lines.push('- **phase_3_8 — API & Data Design:** API spec + DB schema');
  lines.push('  Do NOT skip: drives Phase 4 contracts');
  lines.push('- **phase_3_9 — Readiness Check:** Gate audit before Phase 4');
  lines.push('  Do NOT skip: last quality gate');
  lines.push('');
  lines.push('## Output Format');
  lines.push('');
  lines.push('Write to `_wdf_output/status/skip-decisions.yaml`:');
  lines.push('```yaml');
  lines.push('---');
  lines.push('skip_decisions:');
  lines.push(`  analyzed_at: "${new Date().toISOString()}"`);
  lines.push(`  project: "${projectName}"`);
  lines.push(`  description: "${description}"`);
  lines.push('  skipped:');
  lines.push('    - phase_1_2  # reason: ...');
  lines.push('    - phase_2_9  # reason: ...');
  lines.push('  reason: "Brief overall justification"');
  lines.push('---');
  lines.push('```');
  lines.push('');
  lines.push('Only list sub-phases you recommend skipping. Any sub-phase not listed');
  lines.push('will be executed. When in doubt, DO NOT skip — extra analysis is better');
  lines.push('than missing critical insights.');
  lines.push('');
  lines.push('## Verification — Required Before Proceeding');
  lines.push('');
  lines.push('After writing the file, you MUST run:');
  lines.push('');
  lines.push('```');
  lines.push(`wdf check --artifact=status/skip-decisions.yaml`);
  lines.push('```');
  lines.push('');
  lines.push('This validates:');
  lines.push('- YAML syntax is valid');
  lines.push('- `skip_decisions` top-level key exists');
  lines.push('- `skipped` is an array of valid phase keys');
  lines.push('- Each skipped entry follows `phase_N_N` format');
  lines.push('');
  lines.push('**If validation fails**, fix the reported issues and re-run `wdf check`');
  lines.push('until it passes. Then run `/wdf start` to proceed.');
  return lines.join('\n');
}
