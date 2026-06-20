import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import YAML from 'js-yaml';

// ============================================================
// Types
// ============================================================

export interface StatusOptions {
  projectRoot: string;
  phase?: number;
  json?: boolean;
  short?: boolean;
}

export interface PhaseStatusSummary {
  phase: number;
  title: string;
  status: string;
  progress_pct: number;
  sub_phases: {
    id: string;
    name: string;
    status: string;
    auto_skip?: boolean;
  }[];
}

export interface StatusOutput {
  project: {
    name: string;
    description: string;
    version: string;
    created_at: string;
    updated_at: string;
  };
  configuration: {
    complexity_tier: string;
    dev_mode: string;
    triage_mode: string;
    tech_stack: Record<string, string>;
  };
  phases: PhaseStatusSummary[];
  quality_gates: Record<string, number>;
  counts: {
    stories_total: number;
    stories_in_progress: number;
    stories_done: number;
    crs_open: number;
    crs_resolved: number;
    queue_queued: number;
    queue_merged: number;
  };
  current_phase: number;
  overall_status: string;
  _raw?: {
    global?: any;
    phases?: Record<string, any>;
    cr?: any;
    queue?: any;
  };
}

// ============================================================
// Helpers
// ============================================================

function safeReadYaml(filePath: string): any {
  if (!existsSync(filePath)) return null;
  try {
    return YAML.load(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Calculate phase progress percentage based on sub_phases
 */
export function calculatePhaseProgress(subPhases: { status: string }[]): number {
  if (!subPhases || subPhases.length === 0) return 0;

  const doneStatuses = ['DONE', 'COMPLETED', 'APPROVED', 'ACCEPTED', 'VERIFIED'];
  const inProgressStatuses = ['IN_PROGRESS', 'DRAFTING', 'CODING', 'TESTING'];

  let score = 0;
  for (const sp of subPhases) {
    if (doneStatuses.includes(sp.status)) score += 1;
    else if (inProgressStatuses.includes(sp.status)) score += 0.5;
  }

  return Math.round((score / subPhases.length) * 100);
}

/**
 * Render a progress bar: [▓▓▓░░]
 */
export function renderProgressBar(percent: number, width: number = 4): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '[' + '▓'.repeat(filled) + '░'.repeat(empty) + ']';
}

// ============================================================
// Status Data Collection
// ============================================================

function collectStatusData(projectRoot: string): StatusOutput {
  const statusDir = join(projectRoot, '_wdf_output', 'status');

  // Read global state
  const global = safeReadYaml(join(statusDir, 'global.yaml'));
  if (!global) {
    throw new Error('WDF project not initialized. Run `wdf init` first.');
  }

  // Read phase states
  const phases: PhaseStatusSummary[] = [];
  const phaseTitles: Record<number, string> = {
    1: 'Analysis',
    2: 'Planning',
    3: 'Solutioning',
    4: 'Implementation',
  };

  for (const phaseNum of [1, 2, 3]) {
    const phaseData = safeReadYaml(join(statusDir, `phase-0${phaseNum}.yaml`));
    if (phaseData) {
      const subPhases = Object.entries(phaseData.sub_phases || {}).map(([id, sp]: [string, any]) => ({
        id,
        name: sp.name,
        status: sp.status || 'NOT_STARTED',
        auto_skip: sp.auto_skip,
      }));

      phases.push({
        phase: phaseNum,
        title: phaseData.title || phaseTitles[phaseNum],
        status: phaseData.status || 'NOT_STARTED',
        progress_pct: calculatePhaseProgress(subPhases),
        sub_phases: subPhases,
      });
    }
  }

  // Phase 4: shared (4.1, 4.13, 4.14) + BE track (4.2-4.6) + FE track (4.7-4.12)
  const phase4Shared = safeReadYaml(join(statusDir, 'phase-04.yaml'));
  const phase4Be = safeReadYaml(join(statusDir, 'phase-04-be.yaml'));
  const phase4Fe = safeReadYaml(join(statusDir, 'phase-04-fe.yaml'));

  if (phase4Shared || phase4Be || phase4Fe) {
    const allSubPhases: PhaseStatusSummary['sub_phases'] = [];

    // Shared sub-phases (Sprint Planning, Integration, Retrospective) —
    // shown without a track prefix since they're not BE- or FE-specific.
    if (phase4Shared?.sub_phases) {
      Object.entries(phase4Shared.sub_phases).forEach(([id, sp]: [string, any]) => {
        allSubPhases.push({
          id: `shared_${id}`,
          name: sp.name,
          status: sp.status || 'NOT_STARTED',
        });
      });
    }

    if (phase4Be?.sub_phases) {
      Object.entries(phase4Be.sub_phases).forEach(([id, sp]: [string, any]) => {
        allSubPhases.push({
          id: `be_${id}`,
          name: `[BE] ${sp.name}`,
          status: sp.status || 'NOT_STARTED',
        });
      });
    }

    if (phase4Fe?.sub_phases) {
      Object.entries(phase4Fe.sub_phases).forEach(([id, sp]: [string, any]) => {
        allSubPhases.push({
          id: `fe_${id}`,
          name: `[FE] ${sp.name}`,
          status: sp.status || 'NOT_STARTED',
        });
      });
    }

    phases.push({
      phase: 4,
      title: 'Implementation',
      status: phase4Shared?.status || phase4Be?.status || phase4Fe?.status || 'NOT_STARTED',
      progress_pct: calculatePhaseProgress(allSubPhases),
      sub_phases: allSubPhases,
    });
  }

  // Read CRs
  const crData = safeReadYaml(join(statusDir, 'change-requests.yaml'));
  const crs = crData?.change_requests ?? [];
  const crsOpen = crs.filter((cr: any) => cr.status === 'open').length;
  const crsResolved = crs.filter((cr: any) => cr.status === 'resolved').length;

  // Read merge queue
  const queueData = safeReadYaml(join(statusDir, 'merge-queue', 'queue.yaml'));
  const queueQueued = (queueData?.queued ?? []).length;
  const queueMerged = (queueData?.merged ?? []).length;

  // Stories: count from phase 4
  let storiesTotal = 0;
  let storiesInProgress = 0;
  let storiesDone = 0;

  const doneStoryStatuses = ['DONE', 'COMPLETED', 'MERGED', 'ACCEPTED'];
  const inProgressStoryStatuses = ['IN_PROGRESS', 'CODING', 'REVIEW'];

  [phase4Be, phase4Fe].forEach(track => {
    if (track?.stories) {
      for (const story of track.stories) {
        storiesTotal++;
        if (doneStoryStatuses.includes(story.status)) {
          storiesDone++;
        } else if (inProgressStoryStatuses.includes(story.status)) {
          storiesInProgress++;
        }
      }
    }
  });

  // Build output
  return {
    project: {
      name: global.project?.name ?? 'unknown',
      description: global.project?.description ?? '',
      version: global.project?.version ?? '0.1.0',
      created_at: global.project?.created_at ?? global.audit?.created_at ?? new Date().toISOString(),
      updated_at: global.audit?.last_updated_at ?? global.project?.created_at ?? new Date().toISOString(),
    },
    configuration: {
      complexity_tier: global.workflow?.complexity_tier ?? 'standard',
      dev_mode: global.workflow?.dev_mode ?? 'separated',
      triage_mode: global.workflow?.task_triage_mode ?? 'parallel',
      tech_stack: {
        frontend: global.tech_stack?.frontend ?? 'react',
        backend: global.tech_stack?.backend ?? 'express',
        database: global.tech_stack?.database ?? 'postgresql',
        api_style: global.tech_stack?.api_style ?? 'rest',
        auth_method: global.tech_stack?.auth_method ?? 'jwt',
        deployment: global.tech_stack?.deployment ?? 'docker',
      },
    },
    phases,
    quality_gates: {
      min_test_coverage: global.quality_gates?.min_test_coverage ?? 80,
      min_lighthouse_score: global.quality_gates?.min_lighthouse_score ?? 90,
      max_bundle_size_kb: global.quality_gates?.max_bundle_size_kb ?? 500,
    },
    counts: {
      stories_total: storiesTotal,
      stories_in_progress: storiesInProgress,
      stories_done: storiesDone,
      crs_open: crsOpen,
      crs_resolved: crsResolved,
      queue_queued: queueQueued,
      queue_merged: queueMerged,
    },
    current_phase: global.workflow?.current_phase ?? 0,
    overall_status: global.workflow?.overall_status ?? 'initialized',
    _raw: {
      global,
      phases: {
        phase_1: safeReadYaml(join(statusDir, 'phase-01.yaml')),
        phase_2: safeReadYaml(join(statusDir, 'phase-02.yaml')),
        phase_3: safeReadYaml(join(statusDir, 'phase-03.yaml')),
        phase_4_be: phase4Be,
        phase_4_fe: phase4Fe,
      },
      cr: crData,
      queue: queueData,
    },
  };
}

// ============================================================
// Rendering Functions
// ============================================================

function renderShortOutput(output: StatusOutput): string {
  const parts = [
    output.project.name,
    output.overall_status,
    `Phase ${output.current_phase}`,
    `${output.counts.stories_total} stories`,
  ];
  return parts.join(' — ');
}

function renderSubPhaseList(subPhases: PhaseStatusSummary['sub_phases'], prefix: string = '  └─ '): string {
  return subPhases.map(sp => {
    const label = sp.auto_skip ? `${sp.name} (auto-skip)` : sp.name;
    return `${prefix}${renderProgressBar(calculatePhaseProgress([sp]))} ${sp.status}  ${label}`;
  }).join('\n');
}

function renderFullDashboard(output: StatusOutput): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════');
  lines.push('WDF Project Status — V3.8.0');
  lines.push('═══════════════════════════════════════════');
  lines.push('');

  // Project header
  lines.push(`Project: ${output.project.name}`);
  lines.push(`Created: ${output.project.created_at}`);
  lines.push(`Updated: ${output.project.updated_at}`);
  lines.push('');

  // Configuration
  lines.push('── Configuration ───────────────────────────');
  lines.push(`  Complexity:    ${output.configuration.complexity_tier}`);
  lines.push(`  Dev Mode:      ${output.configuration.dev_mode}`);
  lines.push(`  Triage Mode:   ${output.configuration.triage_mode}`);
  lines.push(`  Tech Stack:    ${output.configuration.tech_stack.frontend} + ${output.configuration.tech_stack.backend} + ${output.configuration.tech_stack.database}`);
  lines.push('');

  // Phase Progress
  lines.push('── Phase Progress ──────────────────────────');
  for (const phase of output.phases) {
    lines.push(`  Phase ${phase.phase} ${renderProgressBar(phase.progress_pct)} ${phase.status}  ${phase.title}`);
  }
  lines.push('');

  // Phase Details
  lines.push('── Phase Details ────────────────────────────');
  lines.push('');
  for (const phase of output.phases) {
    lines.push(`Phase ${phase.phase}: ${phase.title}`);
    lines.push(renderSubPhaseList(phase.sub_phases));
    lines.push('');
  }

  // Quality Gates
  lines.push('── Quality Gates ────────────────────────────');
  lines.push(`  Test Coverage:    ${output.quality_gates.min_test_coverage}% min  (not started)`);
  lines.push(`  Lighthouse Score: ${output.quality_gates.min_lighthouse_score}% min  (not started)`);
  lines.push(`  Bundle Size:      ${output.quality_gates.max_bundle_size_kb}KB max (not started)`);
  lines.push('');

  // Work Items
  lines.push('── Work Items ───────────────────────────────');
  lines.push(`  Stories: ${output.counts.stories_total} total, ${output.counts.stories_in_progress} in progress, ${output.counts.stories_done} done`);
  lines.push(`  CRs:     ${output.counts.crs_open} open, ${output.counts.crs_resolved} resolved`);
  lines.push(`  Queue:   ${output.counts.queue_queued} queued, ${output.counts.queue_merged} merged`);
  lines.push('');

  // Next Actions
  lines.push('── Next Actions ─────────────────────────────');
  lines.push(`  /wdf start           Start sequential execution`);
  lines.push(`  /wdf party           Start multi-agent Party Mode`);
  lines.push(`  /wdf phase 1         Jump to Phase 1`);
  lines.push('═══════════════════════════════════════════');

  return lines.join('\n');
}

function renderPhaseDetails(output: StatusOutput, phaseNum: number): string {
  const phase = output.phases.find(p => p.phase === phaseNum);
  if (!phase) {
    return `Phase ${phaseNum} not found.`;
  }

  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════');
  lines.push(`Phase ${phase.phase}: ${phase.title} — ${phase.status}`);
  lines.push('═══════════════════════════════════════════');
  lines.push('');

  lines.push(`Sub-phases (${phase.sub_phases.length} total):`);
  lines.push(renderSubPhaseList(phase.sub_phases, '  '));
  lines.push('');

  // Get artifacts from raw data
  const artifacts: string[] = [];
  const rawPhase = output._raw?.phases?.[`phase_${phaseNum}` as keyof typeof output._raw.phases];
  if (rawPhase?.artifact_paths) {
    Object.values(rawPhase.artifact_paths).forEach((val: any) => {
      if (typeof val === 'string') artifacts.push(val.split('/').pop() || val);
      else artifacts.push(...Object.values(val).map(v => String(v).split('/').pop() || String(v)));
    });
  }

  if (artifacts.length > 0) {
    lines.push('Artifacts to produce:');
    artifacts.forEach(a => lines.push(`  - ${a}`));
    lines.push('');
  }

  // Gate status
  const gateChecks = rawPhase?.gates?.entry ?? [];
  lines.push('Gate Status:');
  lines.push(`  Entry gate: ${gateChecks.filter((c: any) => c.status === 'pass').length}/${gateChecks.length} checks passed`);
  lines.push(`  Exit gate: not evaluated yet`);
  lines.push('');
  lines.push(`Next Action: /wdf phase ${phaseNum} start`);

  return lines.join('\n');
}

// ============================================================
// Main Command
// ============================================================

/**
 * Get WDF project status
 */
export async function statusCommand(projectRoot: string, options?: RenderOptions): Promise<StatusOutput> {
  return collectStatusData(projectRoot);
}

// ============================================================
// Rendering Types & Functions
// ============================================================

export interface RenderOptions {
  phase?: number;
  json?: boolean;
  short?: boolean;
}

/**
 * Render status output to string based on options
 */
export function renderStatus(output: StatusOutput, options: RenderOptions): string {
  if (options.json) {
    return JSON.stringify(output, null, 2);
  }

  if (options.short) {
    return renderShortOutput(output);
  }

  if (options.phase !== undefined) {
    return renderPhaseDetails(output, options.phase);
  }

  return renderFullDashboard(output);
}
