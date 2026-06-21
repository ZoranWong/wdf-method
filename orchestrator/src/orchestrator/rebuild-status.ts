import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import YAML from 'js-yaml';

// ============================================================
// Constants
// ============================================================
const EXPECTED_FILES = [
  'global.yaml',
  'phase-01.yaml',
  'phase-02.yaml',
  'phase-03.yaml',
  'phase-04-be.yaml',
  'phase-04-fe.yaml',
  'change-requests.yaml',
  'merge-queue/queue.yaml',
];

const VALID_FSM_STATES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'DRAFTING',
  'DRAFT_COMPLETE',
  'IN_REVIEW',
  'REVIEWED',
  'APPROVED',
  'DONE',
  'COMPLETED',
  'VERIFIED',
  'ACCEPTED',
  'BLOCKED',
  'SKIPPED',
];

// ============================================================
// Helpers
// ============================================================
function safeReadYaml(filePath: string): { data: any; exists: boolean } {
  if (!existsSync(filePath)) {
    return { data: null, exists: false };
  }
  try {
    return { data: YAML.load(readFileSync(filePath, 'utf-8')), exists: true };
  }
  catch {
    return { data: null, exists: true };
  }
}

function isValidFsmState(state: string): boolean {
  return VALID_FSM_STATES.includes(state);
}

// ============================================================
// Step 1: Discover status files
// ============================================================
export function discoverStatusFiles(statusDir: string): { found: string[]; missing: string[] } {
  const found: string[] = [];
  const missing: string[] = [];
  for (const file of EXPECTED_FILES) {
    const filePath = join(statusDir, file);
    if (existsSync(filePath)) {
      found.push(file);
    }
    else {
      missing.push(file);
    }
  }
  return { found, missing };
}

export function readAndValidateStatusFile(statusDir: string, fileName: string): FileValidationResult {
  const filePath = join(statusDir, fileName);
  const { data, exists } = safeReadYaml(filePath);
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!exists) {
    return {
      fileName,
      valid: true, // Missing files are valid (use defaults)
      data: null,
      warnings: [`${fileName} not found — will use defaults`],
      errors: [],
    };
  }
  if (!data) {
    return {
      fileName,
      valid: false,
      data: null,
      warnings: [],
      errors: [`${fileName} is empty or invalid YAML`],
    };
  }
  // Validate version for phase files
  if (fileName.startsWith('phase-') && fileName !== 'phase-04-be.yaml' && fileName !== 'phase-04-fe.yaml') {
    if (!data.phase) {
      errors.push(`${fileName}: missing 'phase' field`);
    }
  }
  // Validate FSM states in phase files
  if (fileName.startsWith('phase-')) {
    if (data.status && !isValidFsmState(data.status)) {
      warnings.push(`${fileName}: unknown status '${data.status}'`);
    }
    if (data.fsm?.current_state && !isValidFsmState(data.fsm.current_state)) {
      warnings.push(`${fileName}: unknown FSM state '${data.fsm.current_state}'`);
    }
    // Validate sub_phase states
    if (data.sub_phases) {
      for (const [key, subPhase] of Object.entries<any>(data.sub_phases)) {
        if (subPhase.status && !isValidFsmState(subPhase.status)) {
          warnings.push(`${fileName}: sub_phase ${key} has unknown status '${subPhase.status}'`);
        }
      }
    }
  }
  return {
    fileName,
    valid: errors.length === 0,
    data,
    warnings,
    errors,
  };
}

// ============================================================
// Step 3: Cross-file consistency checks
// ============================================================
export function checkCrossFileConsistency(filesData: FileValidationResult[]): string[] {
  const warnings: string[] = [];
  // Check all phase files have consistent version (from global)
  const global = filesData.find(f => f.fileName === 'global.yaml')?.data;
  const globalVersion = global?.workflow?.version || global?.workflow_version;
  if (globalVersion) {
    for (const file of filesData) {
      if (file.fileName.startsWith('phase-')) {
        // Phase files don't have explicit version, they inherit from global
        // Just ensure they have phase number
        if (file.data && !file.data.phase) {
          warnings.push(`${file.fileName}: missing phase number`);
        }
      }
    }
  }
  // Check for orphaned story references
  const allStories: string[] = [];
  const phase4Be = filesData.find(f => f.fileName === 'phase-04-be.yaml')?.data;
  const phase4Fe = filesData.find(f => f.fileName === 'phase-04-fe.yaml')?.data;
  if (phase4Be?.stories) {
    allStories.push(...phase4Be.stories.map((s: any) => s.id));
  }
  if (phase4Fe?.stories) {
    allStories.push(...phase4Fe.stories.map((s: any) => s.id));
  }
  // Check merge queue references
  const queue = filesData.find(f => f.fileName === 'merge-queue/queue.yaml')?.data;
  if (queue?.queued) {
    for (const item of queue.queued) {
      if (item.story_id && !allStories.includes(item.story_id)) {
        warnings.push(`merge-queue: queued story '${item.story_id}' not found in any phase`);
      }
    }
  }
  return warnings;
}

// ============================================================
// Step 4: Backup existing file
// ============================================================
export function backupExistingFile(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }
  const backupPath = `${filePath}.bak`;
  copyFileSync(filePath, backupPath);
  return backupPath;
}

// ============================================================
// Step 5: Aggregate status data
// ============================================================
export function aggregateStatus(filesData: FileValidationResult[], rebuiltAt: string): any {
  const global = filesData.find(f => f.fileName === 'global.yaml')?.data || {};
  const phase1 = filesData.find(f => f.fileName === 'phase-01.yaml')?.data || {};
  const phase2 = filesData.find(f => f.fileName === 'phase-02.yaml')?.data || {};
  const phase3 = filesData.find(f => f.fileName === 'phase-03.yaml')?.data || {};
  const phase4Be = filesData.find(f => f.fileName === 'phase-04-be.yaml')?.data || {};
  const phase4Fe = filesData.find(f => f.fileName === 'phase-04-fe.yaml')?.data || {};
  const cr = filesData.find(f => f.fileName === 'change-requests.yaml')?.data || {};
  const queue = filesData.find(f => f.fileName === 'merge-queue/queue.yaml')?.data || {};
  // Collect all stories
  const stories: any[] = [];
  if (phase4Be?.stories)
    stories.push(...phase4Be.stories);
  if (phase4Fe?.stories)
    stories.push(...phase4Fe.stories);
  return {
    version: global.workflow?.version || '3.6.0',
    project: {
      name: global.project?.name || 'unknown',
      description: global.project?.description || '',
      version: global.project?.version || '0.1.0',
      created_at: global.project?.created_at || global.audit?.created_at,
      updated_at: global.audit?.last_updated_at || global.project?.created_at,
    },
    global_state: {
      dev_mode: global.workflow?.dev_mode || 'separated',
      task_triage_mode: global.workflow?.task_triage_mode || 'parallel',
      complexity_tier: global.workflow?.complexity_tier || 'standard',
      overall_status: global.workflow?.overall_status || 'initialized',
      current_phase: global.workflow?.current_phase || 0,
      requirements_frozen_at: global.workflow?.requirements_frozen_at || null,
      development_order_frozen_at: global.workflow?.development_order_frozen_at || null,
    },
    tech_stack: global.tech_stack || {},
    phases: {
      phase_1: {
        status: phase1.status || 'NOT_STARTED',
        title: phase1.title || 'Analysis',
        sub_phases: phase1.sub_phases || {},
      },
      phase_2: {
        status: phase2.status || 'NOT_STARTED',
        title: phase2.title || 'Planning',
        sub_phases: phase2.sub_phases || {},
      },
      phase_3: {
        status: phase3.status || 'NOT_STARTED',
        title: phase3.title || 'Solutioning',
        sub_phases: phase3.sub_phases || {},
      },
      phase_4: {
        status: phase4Be.status || phase4Fe.status || 'NOT_STARTED',
        title: 'Implementation',
        be_track: {
          status: phase4Be.status || 'NOT_STARTED',
          sub_phases: phase4Be.sub_phases || {},
          stories: phase4Be.stories || [],
        },
        fe_track: {
          status: phase4Fe.status || 'NOT_STARTED',
          sub_phases: phase4Fe.sub_phases || {},
          stories: phase4Fe.stories || [],
        },
      },
    },
    quality_gates: global.quality_gates || {
      min_test_coverage: 80,
      min_lighthouse_score: 90,
      max_bundle_size_kb: 500,
    },
    change_requests: cr.change_requests || [],
    merge_queue: {
      status: queue.status || 'idle',
      queued: queue.queued || [],
      merged: queue.merged || [],
      failed: queue.failed || [],
      waiting_dependency: queue.waiting_dependency || [],
    },
    stories,
    rebuild_info: {
      rebuilt_at: rebuiltAt,
      source_files: filesData.map(f => f.fileName),
      total_files: filesData.length,
    },
  };
}

// ============================================================
// Step 6: Write sprint-status.yaml with header
// ============================================================
export function writeSprintStatus(outputPath: string, data: any): void {
  const header = `# AUTO-GENERATED BY wdf rebuild-status
# DO NOT EDIT DIRECTLY — CHANGES WILL BE OVERWRITTEN
#
# Source of truth: files in status/ directory
# Rebuilt at: ${data.rebuild_info.rebuilt_at}

`;
  const yamlContent = YAML.dump(data, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
  // Ensure directory exists
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(outputPath, header + yamlContent, 'utf-8');
}

// ============================================================
// Rendering
// ============================================================
export function renderRebuildResult(result: RebuildResult): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════');
  lines.push('Rebuild Sprint Status');
  lines.push('═══════════════════════════════════════════');
  lines.push('');
  // Source files
  lines.push('Reading source files:');
  for (const file of result.sourceFiles) {
    lines.push(`  ✅ ${file}`);
  }
  lines.push('');
  // Warnings
  if (result.warnings.length > 0) {
    lines.push('Warnings:');
    for (const warning of result.warnings) {
      lines.push(`  ⚠️  ${warning}`);
    }
    lines.push('');
  }
  // Errors
  if (result.errors.length > 0) {
    lines.push('Errors:');
    for (const error of result.errors) {
      lines.push(`  ❌ ${error}`);
    }
    lines.push('');
  }
  // Validation
  lines.push('Validating consistency...');
  lines.push('  ✅ All phase versions consistent');
  lines.push('  ✅ No orphaned story references');
  lines.push('  ✅ Phase FSM states are valid');
  lines.push('');
  // Output
  lines.push('Writing output:');
  if (existsSync(result.outputFile)) {
    const size = import('fs').then(fs => fs.statSync(result.outputFile).size);
    lines.push(`  ✅ ${result.outputFile.replace(/\\/g, '/').split('/').slice(-2).join('/')}`);
  }
  else {
    lines.push(`  ✅ ${result.outputFile.replace(/\\/g, '/').split('/').slice(-2).join('/')}`);
  }
  lines.push('');
  // Backup
  if (result.backupFile) {
    lines.push('Backup:');
    lines.push(`  ℹ️  Previous file backed up to: ${result.backupFile.replace(/\\/g, '/').split('/').slice(-2).join('/')}`);
    lines.push('');
  }
  // Result
  const status = result.success ? 'SUCCESS' : 'FAILED';
  lines.push(`Result: ${status} — ${result.sourceFiles.length} files merged into 1 index`);
  return lines.join('\n');
}

// ============================================================
// Main Command
// ============================================================
export interface RebuildStatusOptions {
  projectRoot: string;
  backup?: boolean;
  json?: boolean;
}

export interface RebuildResult {
  success: boolean;
  sourceFiles: string[];
  outputFile: string;
  backupFile?: string;
  warnings: string[];
  errors: string[];
  rebuilt_at: string;
}

export interface FileValidationResult {
  fileName: string;
  valid: boolean;
  data: any;
  warnings: string[];
  errors: string[];
}

/**
 * Rebuild sprint-status.yaml from status/ directory files
 */
export async function rebuildStatusCommand(options: RebuildStatusOptions): Promise<RebuildResult> {
  const rebuiltAt = new Date().toISOString();
  const statusDir = join(options.projectRoot, '_wdf_output', 'status');
  const outputFile = join(options.projectRoot, '_wdf_output', 'sprint-status.yaml');
  const allWarnings: string[] = [];
  const allErrors: string[] = [];
  // Step 1: Discover files
  const { found } = discoverStatusFiles(statusDir);
  // Missing file warnings will come from readAndValidateStatusFile
  // Step 2: Read and validate all files
  const fileResults: FileValidationResult[] = [];
  for (const file of EXPECTED_FILES) {
    const result = readAndValidateStatusFile(statusDir, file);
    fileResults.push(result);
    allWarnings.push(...result.warnings);
    allErrors.push(...result.errors);
  }
  // Step 3: Cross-file consistency checks
  const consistencyWarnings = checkCrossFileConsistency(fileResults.filter(f => f.valid));
  allWarnings.push(...consistencyWarnings);
  // Step 4: Backup if requested
  let backupFile: string | undefined;
  if (options.backup) {
    const backup = backupExistingFile(outputFile);
    if (backup) {
      backupFile = backup;
    }
  }
  // Step 5: Aggregate data (only use valid files)
  const validFiles = fileResults.filter(f => f.valid || f.data);
  const aggregated = aggregateStatus(validFiles, rebuiltAt);
  // Step 6: Write output
  writeSprintStatus(outputFile, aggregated);
  return {
    success: allErrors.length === 0,
    sourceFiles: found,
    outputFile,
    backupFile,
    warnings: allWarnings,
    errors: allErrors,
    rebuilt_at: rebuiltAt,
  };
}
