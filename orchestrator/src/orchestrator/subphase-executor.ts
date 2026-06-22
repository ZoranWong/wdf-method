// Subphase Executor — configuration and completion detection for Phases 1-3.
//
// This module is the "phase registry": it knows every sub-phase (phase_1_1
// through phase_3_9), what artifact each produces, what it depends on, which
// agent role executes it, and when it can be auto-skipped.
//
// It does NOT execute AI work — it only answers structural questions about
// each sub-phase. auto-executor.ts and orchestrator.ts use these answers to
// build dispatch manifests and advance the FSM.
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';

export interface SubPhaseContext {
  projectRoot: string;
  phaseNum: number;
  subPhaseKey: string;
  subPhaseName: string;
  outputPath: string;
  agentFile: string;
  agentMode?: string;
  previousArtifacts: string[];
}

export interface SubPhaseResult {
  success: boolean;
  artifactPath: string;
  summary: string;
  /** Markdown prompt ready for Claude session execution */
  prompt: string;
  /** Path to the saved prompt file */
  promptFile: string;
}

export interface SubPhaseConfig {
  agentFile: string;
  agentMode?: string;
  produces: string;
  dependsOn: string[];
  skipIf?: (projectRoot: string) => boolean;
}

// ── Sub-phase registry ──────────────────────────────────────────────────
//
// Each entry maps a sub-phase key to its configuration:
//   - agentFile: the agent role template (references/agents/{name}.md)
//   - agentMode: optional mode hint for the agent
//   - produces: relative path from _wdf_output/ to the artifact
//   - dependsOn: sub-phase keys that must complete first
//   - skipIf: optional hook to auto-skip based on project structure
export const SUB_PHASE_AGENT_MAP: Record<string, SubPhaseConfig> = {
  // ── Phase 1: Analysis (optional) ──────────────────────────────────
  'phase_1_1': {
    agentFile: 'analyst',
    produces: '_output/analysis/impact-map.md',
    dependsOn: [],
  },
  'phase_1_2': {
    agentFile: 'analyst',
    produces: '_output/analysis/domain-research.md',
    dependsOn: ['phase_1_1'],
    skipIf: (projectRoot: string) => {
      // Skip if skip-decisions.yaml says so
      const skipPath = join(projectRoot, '_wdf_output', 'status', 'skip-decisions.yaml');
      if (existsSync(skipPath)) {
        try {
          const content = readFileSync(skipPath, 'utf-8');
          const data = yamlLoad(content) as any;
          return data?.skip_decisions?.skipped?.includes('phase_1_2') === true;
        } catch { /* ignore */ }
      }
      return false;
    },
  },
  'phase_1_3': {
    agentFile: 'product-manager',
    produces: '_output/analysis/product-brief.md',
    dependsOn: ['phase_1_1'],
    skipIf: (projectRoot: string) => {
      const skipPath = join(projectRoot, '_wdf_output', 'status', 'skip-decisions.yaml');
      if (existsSync(skipPath)) {
        try {
          const content = readFileSync(skipPath, 'utf-8');
          const data = yamlLoad(content) as any;
          return data?.skip_decisions?.skipped?.includes('phase_1_3') === true;
        } catch { /* ignore */ }
      }
      return false;
    },
  },

  // ── Phase 2: Planning ────────────────────────────────────────────
  'phase_2_1': {
    agentFile: 'product-manager',
    produces: '_output/planning/impact-map.md',
    dependsOn: ['phase_1_1'],
  },
  'phase_2_2': {
    agentFile: 'analyst',
    produces: '_output/planning/event-storm.md',
    dependsOn: ['phase_2_1'],
    skipIf: (projectRoot: string) => {
      const skipPath = join(projectRoot, '_wdf_output', 'status', 'skip-decisions.yaml');
      if (existsSync(skipPath)) {
        try {
          const content = readFileSync(skipPath, 'utf-8');
          const data = yamlLoad(content) as any;
          return data?.skip_decisions?.skipped?.includes('phase_2_2') === true;
        } catch { /* ignore */ }
      }
      return false;
    },
  },
  'phase_2_3': {
    agentFile: 'product-manager',
    produces: '_output/planning/jtbd-cards.md',
    dependsOn: ['phase_2_1'],
  },
  'phase_2_4': {
    agentFile: 'product-manager',
    produces: '_output/planning/story-map.md',
    dependsOn: ['phase_2_2', 'phase_2_3'],
  },
  'phase_2_5': {
    agentFile: 'product-manager',
    produces: 'prd.md',
    dependsOn: ['phase_2_4'],
  },
  'phase_2_6': {
    agentFile: 'ux-designer',
    produces: '_output/planning/user-flows.md',
    dependsOn: ['phase_2_5'],
  },
  'phase_2_7': {
    agentFile: 'ux-designer',
    produces: '_output/planning/wireframes.md',
    dependsOn: ['phase_2_6'],
  },
  'phase_2_8': {
    agentFile: 'ux-designer',
    produces: '_output/planning/design-system.md',
    dependsOn: ['phase_2_7'],
    skipIf: (projectRoot: string) => {
      // Auto-skip if using a well-known design system
      const skipPath = join(projectRoot, '_wdf_output', 'status', 'skip-decisions.yaml');
      if (existsSync(skipPath)) {
        try {
          const content = readFileSync(skipPath, 'utf-8');
          const data = yamlLoad(content) as any;
          return data?.skip_decisions?.skipped?.includes('phase_2_8') === true;
        } catch { /* ignore */ }
      }
      return false;
    },
  },
  'phase_2_9': {
    agentFile: 'ux-designer',
    produces: '_output/planning/interaction-design.md',
    dependsOn: ['phase_2_8'],
    skipIf: (projectRoot: string) => {
      const skipPath = join(projectRoot, '_wdf_output', 'status', 'skip-decisions.yaml');
      if (existsSync(skipPath)) {
        try {
          const content = readFileSync(skipPath, 'utf-8');
          const data = yamlLoad(content) as any;
          return data?.skip_decisions?.skipped?.includes('phase_2_9') === true;
        } catch { /* ignore */ }
      }
      return false;
    },
  },
  'phase_2_10': {
    agentFile: 'ux-designer',
    produces: '_output/planning/design-acceptance.md',
    dependsOn: ['phase_2_9'],
  },

  // ── Phase 3: Solutioning ─────────────────────────────────────────
  'phase_3_1': {
    agentFile: 'architect',
    produces: '_output/solutioning/system-context.md',
    dependsOn: ['phase_2_10'],
  },
  'phase_3_2': {
    agentFile: 'architect',
    produces: '_output/solutioning/architecture-style.md',
    dependsOn: ['phase_3_1'],
  },
  'phase_3_3': {
    agentFile: 'architect',
    produces: '_output/solutioning/container-design.md',
    dependsOn: ['phase_3_2'],
  },
  'phase_3_4': {
    agentFile: 'architect',
    produces: '_output/solutioning/quality-attributes.md',
    dependsOn: ['phase_3_3'],
    skipIf: (projectRoot: string) => {
      const skipPath = join(projectRoot, '_wdf_output', 'status', 'skip-decisions.yaml');
      if (existsSync(skipPath)) {
        try {
          const content = readFileSync(skipPath, 'utf-8');
          const data = yamlLoad(content) as any;
          return data?.skip_decisions?.skipped?.includes('phase_3_4') === true;
        } catch { /* ignore */ }
      }
      return false;
    },
  },
  'phase_3_5': {
    agentFile: 'architect',
    produces: '_output/solutioning/component-design.md',
    dependsOn: ['phase_3_4'],
  },
  'phase_3_6': {
    agentFile: 'product-manager',
    produces: 'epics.md',
    dependsOn: ['phase_3_5'],
  },
  'phase_3_7': {
    agentFile: 'product-manager',
    produces: '_output/solutioning/stories.md',
    dependsOn: ['phase_3_6'],
  },
  'phase_3_8': {
    agentFile: 'api-designer',
    produces: 'api-spec.yaml',
    dependsOn: ['phase_3_7'],
  },
  'phase_3_9': {
    agentFile: 'architect',
    produces: '_output/solutioning/readiness-check.md',
    dependsOn: ['phase_3_8'],
  },
};

/**
 * Get the configuration for a sub-phase.
 * Returns null if the sub-phase key is not recognized.
 */
export function getSubPhaseConfig(subPhaseKey: string): SubPhaseConfig | null {
  return SUB_PHASE_AGENT_MAP[subPhaseKey] ?? null;
}

/**
 * Check if a sub-phase is complete by verifying its artifact exists
 * and contains valid YAML frontmatter with status: completed.
 */
export function isSubPhaseComplete(ctx: SubPhaseContext): boolean {
  const artifactPath = ctx.outputPath;

  if (!existsSync(artifactPath)) {
    return false;
  }

  // For YAML files, check if they parse
  if (artifactPath.endsWith('.yaml') || artifactPath.endsWith('.yml')) {
    try {
      const content = readFileSync(artifactPath, 'utf-8');
      const data = yamlLoad(content);
      // YAML files are considered complete if they parse successfully
      return data != null;
    } catch {
      return false;
    }
  }

  // For Markdown/text files, check for YAML frontmatter with status: completed
  try {
    const content = readFileSync(artifactPath, 'utf-8');

    // Check for YAML frontmatter (--- ... ---)
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      // No frontmatter — consider complete if file is non-empty and has substance
      return content.trim().length > 100;
    }

    // Parse frontmatter
    const frontmatter = yamlLoad(frontmatterMatch[1]) as any;
    if (!frontmatter) {
      return false;
    }

    // Check status field if present
    if (frontmatter.status === 'completed') {
      return true;
    }

    // If no status field, consider complete if file has substance
    return content.trim().length > 100;
  } catch {
    return false;
  }
}

/**
 * Build a structured prompt for a sub-phase.
 * This is a lightweight version — auto-executor.ts builds more detailed prompts.
 */
export function buildSubPhasePrompt(ctx: SubPhaseContext): SubPhaseResult {
  const lines: string[] = [];
  const subLabel = ctx.subPhaseKey.replace('phase_', '').replace('_', '.');
  const name = ctx.subPhaseName;

  lines.push(`# Phase ${subLabel} — ${name}`);
  lines.push('');
  lines.push(`**Role:** ${ctx.agentFile}`);
  lines.push(`**Output:** _wdf_output/${ctx.outputPath.replace(/\\/g, '/')}`);
  lines.push('');

  // Context from previous artifacts
  if (ctx.previousArtifacts.length > 0) {
    lines.push('## Context from Previous Artifacts');
    lines.push('');
    for (const artifact of ctx.previousArtifacts) {
      if (existsSync(artifact)) {
        try {
          const content = readFileSync(artifact, 'utf-8');
          lines.push(`### ${artifact}`);
          lines.push('');
          lines.push(content.slice(0, 1500));
          lines.push('');
        } catch { /* skip */ }
      }
    }
  }

  // Output specification
  lines.push('## Required Output');
  lines.push('');
  lines.push(`Write to: \`${ctx.outputPath}\``);
  lines.push('');
  lines.push('The file MUST start with YAML frontmatter:');
  lines.push('```yaml');
  lines.push('---');
  lines.push(`artifact_type: ${getArtifactType(ctx.subPhaseKey)}`);
  lines.push(`phase: ${ctx.phaseNum}`);
  lines.push(`sub_phase: "${ctx.subPhaseKey}"`);
  lines.push('status: completed');
  lines.push('---');
  lines.push('```');
  lines.push('');

  lines.push('## Execution Steps');
  lines.push('');
  lines.push('1. Read the context artifacts above to understand the baseline');
  lines.push('2. Follow the agent methodology to produce structured, specific output');
  lines.push('3. Write the artifact with complete YAML frontmatter');
  lines.push(`4. Run \`wdf check --artifact=${ctx.outputPath}\` to validate`);
  lines.push('');

  const prompt = lines.join('\n');
  const promptFile = join(ctx.projectRoot, '_wdf_output', '.prompts', `${ctx.subPhaseKey}.md`);

  return {
    success: true,
    artifactPath: ctx.outputPath,
    summary: `Sub-phase ${ctx.subPhaseKey} prompt generated`,
    prompt,
    promptFile,
  };
}

/**
 * Build a short task description for an agent dispatch.
 */
export function buildAgentTask(ctx: SubPhaseContext): string {
  const subLabel = ctx.subPhaseKey.replace('phase_', '').replace('_', '.');
  const deps = ctx.previousArtifacts.length > 0
    ? `Dependencies: ${ctx.previousArtifacts.join(', ')}. `
    : '';

  return [
    `Execute Phase ${subLabel}: ${ctx.subPhaseName}.`,
    `Role: ${ctx.agentFile}.`,
    `Output: ${ctx.outputPath}.`,
    deps,
    'Read context artifacts, produce substantive output with YAML frontmatter, verify with wdf check.',
  ].join(' ');
}

// ── Helpers ─────────────────────────────────────────────────────────────

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
