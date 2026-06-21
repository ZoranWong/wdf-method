/**
 * Custom Schema Engine — enables per-project sub-phase customization.
 *
 * Projects can override the framework's default workflow by:
 *   1. Disabling sub-phases (e.g. skip Phase 1 entirely)
 *   2. Reordering sub-phases within a phase
 *   3. Adding custom sub-phases (project-specific steps)
 *
 * The customization is layered:
 *   - Framework default: customize.toml
 *   - Team override:     _bmad/custom/web-dev-flow.toml
 *   - Project override:  {project}/_bmad/custom/web-dev-flow.toml
 *
 * Higher layers override lower ones. Reordering is interpreted as
 * "given this explicit order, apply it"; disabled phases are filtered out.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ── Types ──────────────────────────────────────────────────

export interface CustomSubPhase {
  phase: string;       // e.g. "phase_3"
  key: string;         // e.g. "3_10"
  name: string;
  produces: string | string[];
  requires_input?: string[];
  gate?: string[];
  dod: string;
  skip_allowed?: boolean;
}

export interface CustomSchemaConfig {
  /** Sub-phase keys to disable (e.g. "phase_1_1") */
  disabled_sub_phases: string[];
  /** Explicit ordering per phase */
  ordering: Record<string, string[]>;
  /** Custom sub-phases to add */
  custom_sub_phases: CustomSubPhase[];
}

export interface SubPhaseInfo {
  /** Full key like "phase_2_5" */
  key: string;
  /** Phase number */
  phase: string;
  /** Sub-phase number like "2_5" */
  sub_phase: string;
  name: string;
  produces: string | string[];
  requires_input: string[];
  gate: string[];
  dod: string;
  skip_allowed: boolean;
  /** Whether this is a custom (project-defined) sub-phase */
  is_custom: boolean;
  /** Execution order (lower = earlier) */
  order: number;
  /** Whether this sub-phase is enabled (not disabled) */
  enabled: boolean;
}

export interface ResolvedSchema {
  /** All phases with their resolved sub-phases */
  phases: Record<string, SubPhaseInfo[]>;
  /** Configuration that was applied */
  config: CustomSchemaConfig;
  /** Sources loaded (for observability) */
  sources: string[];
}

// ── Config Loader ──────────────────────────────────────────

const DEFAULT_CONFIG: CustomSchemaConfig = {
  disabled_sub_phases: [],
  ordering: {},
  custom_sub_phases: [],
};

/**
 * Parse TOML content (simple subset — no nested tables, no multiline strings).
 * We use the TOML library if available, otherwise fall back to a minimal parser.
 */
function parseToml(content: string): Record<string, any> {
  try {
    // Try to use the TOML library
    const toml = require('toml');
    return toml.parse(content);
  } catch {
    // Fall back to minimal parser
    return parseMinimalToml(content);
  }
}

function parseMinimalToml(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  let currentTable = result;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Table header [section.subsection]
    const tableMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (tableMatch) {
      const parts = tableMatch[1].split('.');
      currentTable = result;
      for (const part of parts) {
        if (!currentTable[part]) currentTable[part] = {};
        currentTable = currentTable[part];
      }
      continue;
    }

    // Array of tables [[section]]
    const arrayTableMatch = trimmed.match(/^\[\[([^\]]+)\]\]$/);
    if (arrayTableMatch) {
      const parts = arrayTableMatch[1].split('.');
      let target = result;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!target[parts[i]]) target[parts[i]] = {};
        target = target[parts[i]];
      }
      const last = parts[parts.length - 1];
      if (!target[last]) target[last] = [];
      const newObj = {};
      target[last].push(newObj);
      currentTable = newObj;
      continue;
    }

    // Key-value
    const kvMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      let val: string | string[] | boolean = kvMatch[2].trim();

      // Array
      if (typeof val === 'string' && val.startsWith('[') && val.endsWith(']')) {
        val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
      }
      // String
      else if (typeof val === 'string' && val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
      }
      // Boolean
      else if (val === 'true' || val === 'false') {
        val = val === 'true';
      }

      currentTable[key] = val;
    }
  }

  return result;
}

/**
 * Load custom schema config from the standard locations.
 */
export function loadCustomSchemaConfig(projectRoot: string): { config: CustomSchemaConfig; sources: string[] } {
  const candidates = [
    join(projectRoot, '_bmad', 'custom', 'web-dev-flow.toml'),
    join(projectRoot, '_bmad', 'custom', 'web-dev-flow.user.toml'),
    join(projectRoot, 'wdf.custom.toml'),
  ];

  const sources: string[] = [];
  let merged: CustomSchemaConfig = { ...DEFAULT_CONFIG };

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const raw = readFileSync(path, 'utf-8');
    const parsed = parseToml(raw);
    const section = parsed['custom_schema'] ?? {};

    // Merge disabled_sub_phases (union)
    if (Array.isArray(section.disabled_sub_phases)) {
      merged.disabled_sub_phases = [
        ...new Set([...merged.disabled_sub_phases, ...section.disabled_sub_phases]),
      ];
    }

    // Merge ordering (project overrides team overrides framework)
    if (section.ordering && typeof section.ordering === 'object') {
      merged.ordering = { ...merged.ordering, ...section.ordering };
    }

    // Merge custom_sub_phases (concatenate)
    if (Array.isArray(section.custom_sub_phases)) {
      merged.custom_sub_phases = [
        ...merged.custom_sub_phases,
        ...section.custom_sub_phases,
      ];
    }

    sources.push(path);
  }

  return { config: merged, sources };
}

// ── Schema Resolver ────────────────────────────────────────

/**
 * Resolve the full workflow schema by:
 *   1. Reading the framework's customize.toml
 *   2. Applying project-level customizations
 *   3. Filtering disabled sub-phases
 *   4. Sorting by explicit ordering
 *   5. Adding custom sub-phases
 *
 * Returns the resolved schema ready for the FSM engine to consume.
 */
export function resolveSchema(
  frameworkRoot: string,
  projectRoot: string,
): ResolvedSchema {
  const { config: custom, sources } = loadCustomSchemaConfig(projectRoot);

  // Load framework config to get default sub-phase definitions
  const frameworkConfigPath = join(frameworkRoot, 'customize.toml');
  const frameworkConfig = existsSync(frameworkConfigPath)
    ? parseToml(readFileSync(frameworkConfigPath, 'utf-8'))
    : {};

  const workflow = frameworkConfig.workflow ?? {};
  const phases: Record<string, SubPhaseInfo[]> = {};

  // Process each phase
  for (let phaseNum = 1; phaseNum <= 4; phaseNum++) {
    const phaseKey = `phase_0${phaseNum}`;
    const phaseConfig = workflow[phaseKey];
    if (!phaseConfig) continue;

    const subPhases = extractSubPhases(phaseConfig, phaseKey, phaseNum);

    // Apply explicit ordering if specified
    const explicitOrder = custom.ordering[phaseKey];
    if (explicitOrder) {
      subPhases.sort((a, b) => {
        const aIdx = explicitOrder.indexOf(a.sub_phase);
        const bIdx = explicitOrder.indexOf(b.sub_phase);
        if (aIdx === -1 && bIdx === -1) return 0;
        if (aIdx === -1) return 1;
        if (bIdx === -1) return -1;
        return aIdx - bIdx;
      });
    }

    // Apply order indices
    subPhases.forEach((sp, idx) => { sp.order = idx; });

    // Filter disabled sub-phases
    for (const sp of subPhases) {
      // sp.key is now "phase_X_Y" (e.g. phase_1_2); also check the dotted form
      sp.enabled = !custom.disabled_sub_phases.includes(sp.key) &&
                   !custom.disabled_sub_phases.includes(`${phaseKey}.${sp.sub_phase}`);
    }

    // Add custom sub-phases for this phase
    const customForPhase = custom.custom_sub_phases
      .filter(c => c.phase === phaseKey)
      .map(c => ({
        key: `phase_${c.key}`,
        phase: phaseKey,
        sub_phase: c.key,
        name: c.name,
        produces: c.produces,
        requires_input: c.requires_input ?? [],
        gate: c.gate ?? [],
        dod: c.dod,
        skip_allowed: c.skip_allowed ?? false,
        is_custom: true,
        order: subPhases.length + 1,
        enabled: true,
      }));

    phases[phaseKey] = [...subPhases.filter(sp => sp.enabled), ...customForPhase];
  }

  // Add custom sub-phases for phases NOT in the framework config
  // (e.g. a project adds phase_05 or targets phase_03 which was undefined)
  for (const c of custom.custom_sub_phases) {
    if (phases[c.phase]) continue;  // Already processed in the main loop
    if (!phases[c.phase]) phases[c.phase] = [];
    phases[c.phase].push({
      key: `phase_${c.key}`,
      phase: c.phase,
      sub_phase: c.key,
      name: c.name,
      produces: c.produces,
      requires_input: c.requires_input ?? [],
      gate: c.gate ?? [],
      dod: c.dod,
      skip_allowed: c.skip_allowed ?? false,
      is_custom: true,
      order: phases[c.phase].length + 1,
      enabled: true,
    });
  }

  return { phases, config: custom, sources };
}

function extractSubPhases(
  phaseConfig: any,
  phaseKey: string,
  phaseNum: number,
): SubPhaseInfo[] {
  const subPhases: SubPhaseInfo[] = [];

  for (const key of Object.keys(phaseConfig)) {
    if (!key.startsWith('sub_phase_')) continue;
    const sp = phaseConfig[key];
    // sub_phase_1_1 → "1_1" (phase 1, sub 1)
    const subPhaseNum = key.replace('sub_phase_', '');
    // Full key: phase_1_1 (without leading zero on phase, matching customize.toml convention)
    const fullKey = `phase_${subPhaseNum}`;
    subPhases.push({
      key: fullKey,
      phase: phaseKey,
      sub_phase: subPhaseNum,
      name: sp.name ?? key,
      produces: sp.produces ?? '',
      requires_input: sp.requires_input ?? [],
      gate: sp.gate ?? [],
      dod: sp.dod ?? '',
      skip_allowed: sp.skip_allowed ?? false,
      is_custom: false,
      order: parseInt(subPhaseNum.split('_').pop() ?? '0', 10),
      enabled: true,
    });
  }

  return subPhases;
}

// ── Query Helpers ──────────────────────────────────────────

/**
 * Get the ordered, enabled sub-phases for a specific phase.
 */
export function getEnabledSubPhases(
  resolved: ResolvedSchema,
  phaseKey: string,
): SubPhaseInfo[] {
  return (resolved.phases[phaseKey] ?? [])
    .filter(sp => sp.enabled)
    .sort((a, b) => a.order - b.order);
}

/**
 * Check if a sub-phase is enabled.
 */
export function isSubPhaseEnabled(
  resolved: ResolvedSchema,
  fullKey: string,
): boolean {
  for (const phaseKey of Object.keys(resolved.phases)) {
    const sp = resolved.phases[phaseKey].find(s => s.key === fullKey);
    if (sp) return sp.enabled;
  }
  return false;
}
