// Schema loader for wdf-method gate evaluation.
//
// The "schema" is the set of allowed check types, dependency fields, and
// (eventually) artifact contracts. Baseline lives in code; projects can fork
// it via `_wdf_output/schema.local.yaml` to add team-specific check types
// without modifying the framework.
//
// Inspired by OpenSpec's schema-fork mechanism.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'js-yaml';

export interface CheckTypeDef {
  id: string;
  description: string;
}

export interface DependencyFieldDef {
  id: string;
  description: string;
}

export interface WdfSchema {
  version: string;
  check_types: CheckTypeDef[];
  dependency_fields: DependencyFieldDef[];
  forked_from?: string;
  fork_note?: string;
}

export interface SchemaValidationReport {
  ok: boolean;
  missing_check_types: string[];
  missing_dependency_fields: string[];
  added_check_types: string[];
  added_dependency_fields: string[];
}

const BASELINE_SCHEMA: WdfSchema = {
  version: '1.0.0',
  check_types: [
    { id: 'artifact_exists', description: 'Verify an artifact file exists at the expected path' },
    { id: 'artifact_metadata', description: 'Verify frontmatter fields on an artifact' },
    { id: 'artifact_checksum', description: 'Verify artifact content checksum matches recorded value' },
    { id: 'dependency_status', description: 'Verify a status field in sprint-tracking has expected value' },
    { id: 'user_confirmation', description: 'Manual user confirmation (auto_mode provides auto alternative)' },
    { id: 'all_stories_complete', description: 'Verify all stories in a phase are complete' },
    { id: 'scope_boundary', description: 'Verify story scope is bounded by parent epic' },
    { id: 'quality_threshold', description: 'Verify a quality metric meets threshold (coverage, perf, etc.)' },
    { id: 'field_exists', description: 'Verify a YAML field exists in a status file' },
    { id: 'traceability_complete', description: 'Verify full JTBD→REQ→Story→Test→Commit chain' },
    { id: 'custom_check', description: 'Project-specific custom check (must register a handler)' },
  ],
  dependency_fields: [
    { id: 'phase_3.status', description: 'Phase 3 FSM state' },
    { id: 'development_order_frozen_at', description: 'Timestamp when dev order was frozen' },
    { id: 'requirements_frozen_at', description: 'Timestamp when requirements were frozen' },
    { id: 'phase_3_9', description: 'Phase 3.9 readiness sub-phase state' },
  ],
};

function tryReadLocalSchema(projectRoot: string): WdfSchema | null {
  const localPath = join(projectRoot, '_wdf_output', 'schema.local.yaml');
  if (!existsSync(localPath))
    return null;
  try {
    const raw = readFileSync(localPath, 'utf8');
    const parsed: any = YAML.load(raw);
    if (!parsed || !Array.isArray(parsed.check_types))
      return null;
    return {
      version: parsed.version ?? BASELINE_SCHEMA.version,
      check_types: parsed.check_types,
      dependency_fields: (parsed.dependency_fields ?? BASELINE_SCHEMA.dependency_fields),
      forked_from: 'baseline',
      fork_note: parsed.fork_note,
    };
  }
  catch {
    return null;
  }
}

export function loadSchema(projectRoot: string): WdfSchema {
  const local = tryReadLocalSchema(projectRoot);
  if (local)
    return local;
  return {
    version: BASELINE_SCHEMA.version,
    check_types: [...BASELINE_SCHEMA.check_types],
    dependency_fields: [...BASELINE_SCHEMA.dependency_fields],
  };
}

export function getBaselineSchema(): WdfSchema {
  return {
    version: BASELINE_SCHEMA.version,
    check_types: [...BASELINE_SCHEMA.check_types],
    dependency_fields: [...BASELINE_SCHEMA.dependency_fields],
  };
}

export function getKnownCheckTypes(schema: WdfSchema): Set<string> {
  return new Set(schema.check_types.map(t => t.id));
}

export function getSupportedDependencyFields(schema: WdfSchema): Set<string> {
  return new Set(schema.dependency_fields.map(f => f.id));
}

/**
 * Validate that a forked schema is compatible with baseline:
 * - All baseline check types must still be present (no removal of framework-required checks).
 * - All baseline dependency fields must still be present.
 * - Extra additions are allowed.
 */
export function validateSchema(fork: WdfSchema): SchemaValidationReport {
  const baseline = getBaselineSchema();
  const baseChecks = new Set(baseline.check_types.map(t => t.id));
  const baseFields = new Set(baseline.dependency_fields.map(f => f.id));
  const forkChecks = new Set(fork.check_types.map(t => t.id));
  const forkFields = new Set(fork.dependency_fields.map(f => f.id));
  const missing_check_types = [...baseChecks].filter(c => !forkChecks.has(c));
  const missing_dependency_fields = [...baseFields].filter(f => !forkFields.has(f));
  const added_check_types = [...forkChecks].filter(c => !baseChecks.has(c));
  const added_dependency_fields = [...forkFields].filter(f => !baseFields.has(f));
  return {
    ok: missing_check_types.length === 0 && missing_dependency_fields.length === 0,
    missing_check_types,
    missing_dependency_fields,
    added_check_types,
    added_dependency_fields,
  };
}

/**
 * Write baseline schema to `_wdf_output/schema.yaml` — a read-only reference
 * for project owners to see what the framework enforces.
 */
export function initSchema(projectRoot: string): string {
  const schemaDir = join(projectRoot, '_wdf_output');
  if (!existsSync(schemaDir))
    mkdirSync(schemaDir, { recursive: true });
  const targetPath = join(schemaDir, 'schema.yaml');
  const baseline = getBaselineSchema();
  const header = [
    '# WDF Schema Reference (read-only)',
    '#',
    '# This is a copy of the framework baseline. To customize, run:',
    '#   wdf schema fork',
    '# which creates schema.local.yaml that overrides this file.',
    '',
  ].join('\n');
  writeFileSync(targetPath, header + YAML.dump(baseline, { lineWidth: 100 }), 'utf8');
  return targetPath;
}

/**
 * Create `_wdf_output/schema.local.yaml` — a project-level fork.
 * Callers can edit this file to add team-specific check types.
 */
export function forkSchema(projectRoot: string, note?: string): string {
  const schemaDir = join(projectRoot, '_wdf_output');
  if (!existsSync(schemaDir))
    mkdirSync(schemaDir, { recursive: true });
  const targetPath = join(schemaDir, 'schema.local.yaml');
  const baseline = getBaselineSchema();
  const fork: WdfSchema = {
    ...baseline,
    forked_from: 'baseline',
    fork_note: note ?? 'Project-level fork. Add custom check_types here; do not remove baseline entries.',
  };
  const header = [
    '# WDF Schema Fork (project-local override)',
    '#',
    '# This file overrides the baseline schema for this project.',
    '# Add custom check types / dependency fields as needed.',
    '# Do NOT remove baseline entries — gate-evaluator fails closed otherwise.',
    '',
  ].join('\n');
  writeFileSync(targetPath, header + YAML.dump(fork, { lineWidth: 100 }), 'utf8');
  return targetPath;
}

// Re-export the dirname helper for callers that need the schema file location.
export function schemaFilePaths(projectRoot: string): {
  baseline_reference: string;
  local_fork: string;
} {
  return {
    baseline_reference: join(projectRoot, '_wdf_output', 'schema.yaml'),
    local_fork: join(projectRoot, '_wdf_output', 'schema.local.yaml'),
  };
}

// Avoid an unused-import warning when this file is imported in environments
// where fileURLToPath/dirname aren't otherwise referenced.
void fileURLToPath;
void dirname;
