import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import YAML from 'js-yaml';
import { loadConfig, getSpecsDir, getApiSpecPath } from './config.js';
import {
  reverseSync,
  reverseSyncFromApiSpec,
  applySync,
  loadSpecDocs,
  scaffoldEmptySpec,
  type SpecSyncConfig,
} from './spec-sync.js';

// ============================================================
// Init Command Types
// ============================================================

export interface InitOptions {
  projectRoot: string;
  description: string;
  name?: string;
  complexity: 'simple' | 'standard' | 'complex';
  devMode: 'separated' | 'full_stack';
  triageMode: 'light' | 'serial' | 'parallel';
  executionMode: 'auto' | 'interactive';
  frontend: string;
  backend: string;
  database: string;
  apiStyle: string;
  authMethod: string;
  deployment: string;
  yes?: boolean;
  json?: boolean;
  /** Adopt an existing project rather than creating a new one */
  fromExisting?: boolean;
}

export interface ExistingProjectDetection {
  hasPackageJson: boolean;
  hasNodeModules: boolean;
  hasSrc: boolean;
  hasTests: boolean;
  hasGitignore: boolean;
  hasWdfOutput: boolean;
  hasStories: boolean;
  detectedFramework: string;
  detectedFrontend: string;
  detectedBackend: string;
  detectedDatabase: string;
  detectedApiStyle: string;
  recommendedDevMode: 'separated' | 'full_stack';
  confidence: 'high' | 'medium' | 'low';
}

export interface InitOutput {
  success: boolean;
  projectRoot: string;
  statusDir: string;
  projectName: string;
  filesCreated: string[];
  /** S4: warnings from specs/ bootstrap (e.g. malformed api-spec.yaml). */
  bootstrapWarnings?: string[];
  /** S4: true if specs/ was bootstrapped from existing artifacts. */
  specsBootstrapped?: boolean;
}

// ============================================================
// Existing Project Detection
// ============================================================

/**
 * Scan an existing project to detect its tech stack and structure.
 * Used when `wdf init --from-existing` is called to adopt a project
 * that was not initialized with WDF.
 */
export function detectExistingProjectStructure(projectRoot: string): ExistingProjectDetection {
  const result: ExistingProjectDetection = {
    hasPackageJson: false,
    hasNodeModules: false,
    hasSrc: false,
    hasTests: false,
    hasGitignore: false,
    hasWdfOutput: false,
    hasStories: false,
    detectedFramework: '',
    detectedFrontend: 'none',
    detectedBackend: 'none',
    detectedDatabase: '',
    detectedApiStyle: '',
    recommendedDevMode: 'separated',
    confidence: 'low',
  };

  // Basic checks
  result.hasPackageJson = existsSync(join(projectRoot, 'package.json'));
  result.hasNodeModules = existsSync(join(projectRoot, 'node_modules'));
  result.hasSrc = existsSync(join(projectRoot, 'src')) || existsSync(join(projectRoot, 'app'));
  result.hasTests = existsSync(join(projectRoot, 'tests')) || existsSync(join(projectRoot, '__tests__')) || existsSync(join(projectRoot, 'test'));
  result.hasGitignore = existsSync(join(projectRoot, '.gitignore'));
  result.hasWdfOutput = existsSync(join(projectRoot, '_wdf_output'));
  result.hasStories = existsSync(join(projectRoot, '_wdf_output', 'stories'));

  if (!result.hasPackageJson) {
    return result; // Not a Node.js project
  }

  // Read package.json to detect dependencies
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'));
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };
    const depNames = Object.keys(allDeps);

    // Detect frontend framework
    if (depNames.includes('next') || depNames.includes('nuxt') || depNames.includes('@remix-run')) {
      result.detectedFrontend = 'next';
      result.detectedBackend = 'next'; // Full-stack
      result.recommendedDevMode = 'full_stack';
    } else if (depNames.includes('react') || depNames.includes('react-dom')) {
      result.detectedFrontend = 'react';
    } else if (depNames.includes('vue')) {
      result.detectedFrontend = 'vue';
    } else if (depNames.includes('@angular/core')) {
      result.detectedFrontend = 'angular';
    }

    // Detect backend framework
    if (depNames.includes('express')) {
      result.detectedBackend = 'express';
    } else if (depNames.includes('@nestjs/core')) {
      result.detectedBackend = 'nest';
    } else if (depNames.includes('fastify')) {
      result.detectedBackend = 'fastify';
    } else if (depNames.includes('hono')) {
      result.detectedBackend = 'hono';
    }

    // Detect database
    if (depNames.includes('pg') || depNames.includes('postgres') || depNames.includes('prisma')) {
      result.detectedDatabase = 'postgresql';
    } else if (depNames.includes('mysql2') || depNames.includes('mysql')) {
      result.detectedDatabase = 'mysql';
    } else if (depNames.includes('mongodb') || depNames.includes('mongoose')) {
      result.detectedDatabase = 'mongodb';
    } else if (depNames.includes('sqlite3') || depNames.includes('better-sqlite3')) {
      result.detectedDatabase = 'sqlite';
    }

    // Detect API style
    if (depNames.includes('@trpc/server') || depNames.includes('@trpc/client')) {
      result.detectedApiStyle = 'trpc';
    } else if (depNames.includes('graphql') || depNames.includes('@apollo/server')) {
      result.detectedApiStyle = 'graphql';
    } else {
      result.detectedApiStyle = 'rest';
    }

    // Determine framework label
    if (result.detectedFrontend === 'react' && result.detectedBackend === 'express') {
      result.detectedFramework = 'React + Express';
    } else if (result.detectedFrontend === 'next') {
      result.detectedFramework = 'Next.js';
    } else if (result.detectedFrontend === 'vue') {
      result.detectedFramework = 'Vue';
    }

    // Confidence
    let score = 0;
    if (result.hasPackageJson) score++;
    if (result.hasNodeModules) score++;
    if (result.hasSrc) score++;
    if (result.hasTests) score++;
    if (result.detectedFrontend !== 'none') score++;
    if (result.detectedBackend !== 'none') score++;
    if (result.detectedDatabase) score++;
    result.confidence = score >= 5 ? 'high' : score >= 3 ? 'medium' : 'low';
  } catch { /* package.json parse error — keep defaults */ }

  return result;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Atomic file write: write to temp file, then rename
 */
function atomicWrite(filePath: string, data: any): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const yamlContent = YAML.dump(data, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false, // Important! Preserve field order
  });

  const tmpPath = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmpPath, yamlContent, 'utf-8');
  renameSync(tmpPath, filePath);
}

/**
 * Derive project name from description if not provided
 */
function deriveProjectName(description: string): string {
  const words = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !['with', 'and', 'the', 'for'].includes(w));

  if (words.length >= 2) {
    return words.slice(0, 2).join('-');
  }
  if (words.length === 1) {
    return words[0];
  }
  return 'wdf-project';
}

/**
 * Get current ISO timestamp
 */
function now(): string {
  return new Date().toISOString();
}

// ============================================================
// Pre-flight Checks
// ============================================================

/**
 * Verify project can be initialized — check for existing WDF project
 */
function runPreFlightChecks(projectRoot: string, fromExisting: boolean = false): { partialWdfInit: boolean } {
  const globalYaml = join(projectRoot, '_wdf_output', 'status', 'global.yaml');
  if (existsSync(globalYaml)) {
    throw new Error('WDF project already initialized. Use `wdf status` to check.');
  }
  // In --from-existing mode, allow partial WDF output to exist (e.g. from a
  // previous failed init attempt or manually created directories).
  const partialWdfInit = fromExisting && existsSync(join(projectRoot, '_wdf_output'));
  return { partialWdfInit };
}

// ============================================================
// Directory Structure Creation
// ============================================================

function createDirectoryStructure(projectRoot: string): {
  outputDir: string;
  statusDir: string;
  signalsDir: string;
} {
  const outputDir = join(projectRoot, '_wdf_output');
  const statusDir = join(outputDir, 'status');

  // Core directories
  mkdirSync(join(statusDir, 'merge-queue', 'items'), { recursive: true });
  mkdirSync(join(statusDir, 'stories'), { recursive: true });
  mkdirSync(join(outputDir, 'signals'), { recursive: true });

  // Artifact output directories
  mkdirSync(join(outputDir, '_output', 'analysis'), { recursive: true });
  mkdirSync(join(outputDir, '_output', 'planning'), { recursive: true });
  mkdirSync(join(outputDir, '_output', 'solutioning'), { recursive: true });
  mkdirSync(join(outputDir, '_output', 'acceptance'), { recursive: true });

  return {
    outputDir,
    statusDir,
    signalsDir: join(outputDir, 'signals'),
  };
}

// ============================================================
// Global State (global.yaml)
// ============================================================

function getProtectedPaths(): string[] {
  return [
    'shared/contract',
    'shared/types',
    'schema/migration',
    'root/config',
    'api/contract',
    'route/entry',
    'permission/model',
    'build/ci',
    'env/template',
    'shared/ui/shell',
    'route/registry',
    'global/design/tokens',
  ];
}

function writeGlobalState(statusDir: string, options: InitOptions, timestamp: string): string {
  const projectName = options.name || deriveProjectName(options.description);

  const globalState = {
    project: {
      name: projectName,
      description: options.description,
      version: '0.1.0',
      created_at: timestamp,
    },
    workflow: {
      version: '3.6.0',
      dev_mode: options.devMode,
      task_triage_mode: options.triageMode,
      complexity_tier: options.complexity,
      execution_mode: options.executionMode ?? 'interactive',
      overall_status: 'initialized',
      current_phase: 0,
      requirements_frozen_at: null,
      development_order_frozen_at: null,
    },
    tech_stack: {
      frontend: options.frontend,
      backend: options.backend,
      database: options.database,
      api_style: options.apiStyle,
      auth_method: options.authMethod,
      deployment: options.deployment,
    },
    quality_gates: {
      min_test_coverage: 80,
      min_lighthouse_score: 90,
      max_bundle_size_kb: 500,
    },
    scope_lock: {
      enabled: true,
      enforcement_mode: 'strict',
      protected_paths: getProtectedPaths(),
    },
    agents: {
      available: [
        'analyst',
        'pm',
        'ux-designer',
        'architect',
        'story-planner',
        'api-designer',
        'backend-dev',
        'frontend-dev',
        'qa',
      ],
      party_participants: {
        phase1: ['analyst', 'pm'],
        phase2: ['pm', 'ux-designer'],
        phase3: ['architect', 'story-planner', 'api-designer'],
      },
    },
    external_experts: [],
    audit: {
      created_by: 'wdf-init',
      initialized_at: timestamp,
      last_updated_at: timestamp,
    },
  };

  const filePath = join(statusDir, 'global.yaml');
  atomicWrite(filePath, globalState);
  return filePath;
}

// ============================================================
// Phase State Files
// ============================================================

interface SubPhaseConfig {
  name: string;
  key: string;
  autoSkip: boolean;
}

function getPhase1SubPhases(complexity: string): SubPhaseConfig[] {
  // Per CLAUDE.md + customize.toml semantics:
  //   - "complex": full analysis — Brainstorming + Domain Research + Product Brief
  //   - "simple" / "standard": skip Domain Research and Product Brief
  //     (they're optional enhancements; Brainstorming alone produces the
  //     impact map that Phase 2 consumes).
  // Brainstorming is never skipped — Phase 2.1 reads its output.
  const skipOptional = complexity !== 'complex';
  return [
    { name: 'Brainstorming', key: 'phase_1_1', autoSkip: false },
    { name: 'Domain Research', key: 'phase_1_2', autoSkip: skipOptional },
    { name: 'Product Brief', key: 'phase_1_3', autoSkip: skipOptional },
  ];
}

/**
 * Reads customize.toml's `[auto_run.auto_skip]` section and returns a map of
 * phase_key → autoSkip (true only when the config value is "skip").
 *
 * The "auto" and "run" values are intentionally NOT promoted to autoSkip=true
 * here: "auto" means context-dependent (re-evaluated by `wdf start` later),
 * and "run" means always run. Only "skip" is a hard pre-lock at init time.
 *
 * Bug fix: previously init.ts hardcoded autoSkip=false everywhere, contradicting
 * both customize.toml and CLAUDE.md which list phase_2_2/2_8/2_9/3_4 as "skip".
 */
function loadAutoSkipMap(projectRoot: string): Record<string, boolean> {
  const map: Record<string, boolean> = {};

  // Candidate locations for customize.toml, in priority order:
  //   1. project-local (rare — only if the user copied it in)
  //   2. framework root — where wdf-method itself lives (has SKILL.md).
  //      Detected via init.ts's own location (this file lives at
  //      <framework>/orchestrator/src/orchestrator/init.ts), so we can
  //      resolve the framework root regardless of where the user's project
  //      lives on disk.
  //   3. Walk up from projectRoot looking for SKILL.md (covers the case
  //      where the user is initializing a subdirectory of the framework).
  const candidates: string[] = [join(projectRoot, 'customize.toml')];
  try {
    const thisFile = new URL(import.meta.url).pathname;
    // <framework>/orchestrator/src/orchestrator/init.ts → up 4 dirs
    const frameworkRoot = resolve(thisFile, '..', '..', '..', '..');
    candidates.push(join(frameworkRoot, 'customize.toml'));
  } catch { /* fall through to walk-up */ }
  let walkDir = projectRoot;
  for (let i = 0; i < 8; i++) {
    const parent = dirname(walkDir);
    if (parent === walkDir) break;
    if (existsSync(join(parent, 'SKILL.md'))) {
      candidates.push(join(parent, 'customize.toml'));
      break;
    }
    walkDir = parent;
  }

  let text: string | null = null;
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      text = readFileSync(candidate, 'utf-8');
      break;
    } catch {
      continue;
    }
  }
  if (text === null) return map;

  // Locate the [auto_run.auto_skip] section (a flat key = "value" table).
  // Stop at the next top-level table header.
  const lines = text.split(/\r?\n/);
  let inSection = false;
  const entryRe = /^\s*(phase_\d+_\d+)\s*=\s*"([^"]+)"/;
  for (const line of lines) {
    const headerRe = /^\s*\[([^\]]+)\]\s*$/;
    const header = headerRe.exec(line);
    if (header) {
      inSection = header[1].trim() === 'auto_run.auto_skip';
      continue;
    }
    if (!inSection) continue;
    const m = entryRe.exec(line);
    if (!m) continue;
    if (m[2] === 'skip') {
      map[m[1]] = true;
    }
  }
  return map;
}

function writePhase1State(statusDir: string, complexity: string, timestamp: string, autoSkipMap: Record<string, boolean> = {}): string {
  const subPhases: Record<string, any> = {};
  for (const sp of getPhase1SubPhases(complexity)) {
    subPhases[sp.key] = {
      name: sp.name,
      status: 'NOT_STARTED',
      auto_skip: autoSkipMap[sp.key] ?? sp.autoSkip,
    };
  }

  const phaseState = {
    phase: 1,
    title: 'Analysis',
    status: 'NOT_STARTED',
    fsm: {
      current_state: 'NOT_STARTED',
      state_history: [
        { state: 'NOT_STARTED', at: timestamp },
      ],
    },
    sub_phases: subPhases,
    gates: {
      entry: [],
      exit: [],
    },
    artifact_paths: {
      brainstorming: '_wdf_output/_output/analysis/brainstorming.md',
      domain_research: '_wdf_output/_output/analysis/domain-research.md',
      product_brief: '_wdf_output/_output/analysis/product-brief.md',
    },
  };

  const filePath = join(statusDir, 'phase-01.yaml');
  atomicWrite(filePath, phaseState);
  return filePath;
}

function writePhase2State(statusDir: string, _complexity: string, timestamp: string, autoSkipMap: Record<string, boolean> = {}): string {
  const subPhases: Record<string, any> = {};

  // Phase 2 has 10 sub-phases
  const p2SubPhases: { name: string; key: string; autoSkip?: boolean }[] = [
    { name: 'Impact Mapping', key: 'phase_2_1' },
    { name: 'Event Storming', key: 'phase_2_2' },
    { name: 'Jobs to Be Done', key: 'phase_2_3' },
    { name: 'Story Mapping', key: 'phase_2_4' },
    { name: 'Prioritization & PRD', key: 'phase_2_5' },
    { name: 'User Flows & IA', key: 'phase_2_6' },
    { name: 'Wireframes', key: 'phase_2_7' },
    { name: 'Design System', key: 'phase_2_8' },
    { name: 'Interaction Design', key: 'phase_2_9' },
    { name: 'Design Acceptance', key: 'phase_2_10' },
  ];

  for (const sp of p2SubPhases) {
    subPhases[sp.key] = {
      name: sp.name,
      status: 'NOT_STARTED',
      auto_skip: autoSkipMap[sp.key] ?? sp.autoSkip ?? false,
    };
  }

  const phaseState = {
    phase: 2,
    title: 'Planning',
    status: 'NOT_STARTED',
    fsm: {
      current_state: 'NOT_STARTED',
      state_history: [
        { state: 'NOT_STARTED', at: timestamp },
      ],
    },
    sub_phases: subPhases,
    gates: {
      entry: [],
      exit: [],
    },
    artifact_paths: {
      impact_map: '_wdf_output/_output/planning/impact-map.md',
      event_storming: '_wdf_output/_output/planning/event-storm.md',
      story_map: '_wdf_output/_output/planning/story-map.md',
      prd: '_wdf_output/_output/planning/prd.md',
      user_flows: '_wdf_output/_output/planning/user-flows.md',
      wireframes: '_wdf_output/_output/planning/wireframes.md',
      design_tokens: '_wdf_output/_output/planning/design-tokens.md',
      design_acceptance: '_wdf_output/_output/planning/design-acceptance.md',
    },
  };

  const filePath = join(statusDir, 'phase-02.yaml');
  atomicWrite(filePath, phaseState);
  return filePath;
}

function writePhase3State(statusDir: string, _complexity: string, timestamp: string, autoSkipMap: Record<string, boolean> = {}): string {
  const subPhases: Record<string, any> = {};

  // Phase 3 has 9 sub-phases
  const p3SubPhases: { name: string; key: string; autoSkip?: boolean }[] = [
    { name: 'System Context (C4 Level 1)', key: 'phase_3_1' },
    { name: 'Architecture Style', key: 'phase_3_2' },
    { name: 'Container Design (C4 Level 2)', key: 'phase_3_3' },
    { name: 'Quality Attributes', key: 'phase_3_4' },
    { name: 'Component Synthesis (C4 Level 3)', key: 'phase_3_5' },
    { name: 'Epics & Feature Plan', key: 'phase_3_6' },
    { name: 'Story Design', key: 'phase_3_7' },
    { name: 'API & Data Design', key: 'phase_3_8' },
    { name: 'Readiness Check', key: 'phase_3_9' },
  ];

  for (const sp of p3SubPhases) {
    subPhases[sp.key] = {
      name: sp.name,
      status: 'NOT_STARTED',
      auto_skip: autoSkipMap[sp.key] ?? sp.autoSkip ?? false,
    };
  }

  const phaseState = {
    phase: 3,
    title: 'Solutioning',
    status: 'NOT_STARTED',
    fsm: {
      current_state: 'NOT_STARTED',
      state_history: [
        { state: 'NOT_STARTED', at: timestamp },
      ],
    },
    sub_phases: subPhases,
    gates: {
      entry: [],
      exit: [],
    },
    artifact_paths: {
      system_context: '_wdf_output/_output/solutioning/system-context.md',
      architecture_style: '_wdf_output/_output/solutioning/architecture-style.md',
      container_design: '_wdf_output/_output/solutioning/container-design.md',
      component_design: '_wdf_output/_output/solutioning/component-design.md',
      epics: '_wdf_output/_output/solutioning/epics.md',
      stories: '_wdf_output/_output/solutioning/stories/',
      api_spec: '_wdf_output/_output/solutioning/api-spec.yaml',
      db_schema: '_wdf_output/_output/solutioning/db-schema.md',
      readiness_check: '_wdf_output/_output/solutioning/readiness-check.md',
    },
  };

  const filePath = join(statusDir, 'phase-03.yaml');
  atomicWrite(filePath, phaseState);
  return filePath;
}

function writePhase4SharedState(statusDir: string, timestamp: string): string {
  // Shared Phase 4 sub-phases (run once, not per-track):
  //   4.1  Sprint Planning
  //   4.13 Integration (BE + FE)
  //   4.14 Retrospective
  // The track-specific sub-phases (4.2-4.6 BE, 4.7-4.12 FE) live in the
  // per-track files written by writePhase4TrackState below.
  const subPhases: Record<string, any> = {};
  const shared: { name: string; key: string }[] = [
    { name: 'Sprint Planning', key: 'phase_4_1' },
    { name: 'Integration', key: 'phase_4_13' },
    { name: 'Retrospective', key: 'phase_4_14' },
  ];
  for (const sp of shared) {
    subPhases[sp.key] = { name: sp.name, status: 'NOT_STARTED' };
  }
  const phaseState = {
    phase: 4,
    title: 'Phase 4 — Implementation',
    status: 'NOT_STARTED',
    fsm: {
      current_state: 'NOT_STARTED',
      state_history: [{ state: 'NOT_STARTED', at: timestamp }],
    },
    sub_phases: subPhases,
    gates: { entry: [], exit: [] },
    stories: [],
  };
  const filePath = join(statusDir, 'phase-04.yaml');
  atomicWrite(filePath, phaseState);
  return filePath;
}

function writePhase4TrackState(statusDir: string, track: 'backend' | 'frontend', timestamp: string): string {
  const trackName = track === 'backend' ? 'Backend' : 'Frontend';
  const trackShort = track === 'backend' ? 'be' : 'fe';
  const subPhases: Record<string, any> = {};

  // Phase 4 track sub-phases — keys MUST match customize.toml and orchestrator.ts.
  // BE: 4.2 Scaffolding, 4.3 DB & API Client, 4.4 Endpoints, 4.5 Testing, 4.6 Completion
  // FE: 4.7 Scaffolding, 4.8 Design System, 4.9 API Client, 4.10 Pages, 4.11 A11y, 4.12 Completion
  // The shared 4.1 / 4.13 / 4.14 live in phase-04.yaml — see writePhase4SharedState.
  const p4SubPhases: { name: string; key: string }[] = track === 'backend'
    ? [
      { name: 'Scaffolding', key: 'phase_4_2' },
      { name: 'Database & API Client', key: 'phase_4_3' },
      { name: 'Endpoint Implementation', key: 'phase_4_4' },
      { name: 'Testing Suite', key: 'phase_4_5' },
      { name: 'Completion Review', key: 'phase_4_6' },
    ] : [
      { name: 'Scaffolding', key: 'phase_4_7' },
      { name: 'Design System', key: 'phase_4_8' },
      { name: 'API Client Setup', key: 'phase_4_9' },
      { name: 'Page Implementation', key: 'phase_4_10' },
      { name: 'A11y & Performance Audit', key: 'phase_4_11' },
      { name: 'Completion Review', key: 'phase_4_12' },
    ];

  for (const sp of p4SubPhases) {
    subPhases[sp.key] = {
      name: sp.name,
      status: 'NOT_STARTED',
    };
  }

  const phaseState = {
    phase: 4,
    track,
    title: `Phase 4 — ${trackName} Implementation`,
    status: 'NOT_STARTED',
    fsm: {
      current_state: 'NOT_STARTED',
      state_history: [
        { state: 'NOT_STARTED', at: timestamp },
      ],
    },
    sub_phases: subPhases,
    gates: {
      entry: [],
      exit: [],
    },
    stories: [],
  };

  const filePath = join(statusDir, `phase-04-${trackShort}.yaml`);
  atomicWrite(filePath, phaseState);
  return filePath;
}

// ============================================================
// Change Requests
// ============================================================

function writeInitialChangeRequests(statusDir: string): string {
  const crState = {
    version: '3.6.0',
    change_requests: [],
  };

  const filePath = join(statusDir, 'change-requests.yaml');
  atomicWrite(filePath, crState);
  return filePath;
}

// ============================================================
// Merge Queue
// ============================================================

function writeInitialMergeQueue(statusDir: string): string {
  const queueState = {
    version: '3.6.0',
    status: 'idle',
    queued: [],
    merged: [],
    failed: [],
    waiting_dependency: [],
  };

  const filePath = join(statusDir, 'merge-queue', 'queue.yaml');
  atomicWrite(filePath, queueState);
  return filePath;
}

// ============================================================
// Project Constitution
// ============================================================

function writeProjectConstitution(projectRoot: string, options: InitOptions, timestamp: string): string {
  const constitution = buildConstitution(options);
  const filePath = join(projectRoot, '_wdf_output', 'constitution.yaml');
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, constitution, 'utf-8');
  return filePath;
}

function buildConstitution(options: InitOptions): string {
  const lines: string[] = [
    `# Project Constitution — Auto-generated by wdf-init`,
    `# Created: ${new Date().toISOString()}`,
    `# Target project: ${options.name || 'wdf-project'}`,
    '',
    `# This constitution defines non-negotiable quality gates`,
    `# and coding standards for the target project. CI enforces`,
    `# these rules; violations block PR merges.`,
    '',
    `# Machine-readable version — bump via \`wdf constitution bump\`.`,
    `version: "0.1.0"`,
    '',
    `project:`,
    `  name: "${options.name || 'wdf-project'}"`,
    `  description: "${(options.description || '').replace(/"/g, '\\"')}"`,
    `  complexity: ${options.complexity}`,
    '',
    `quality_gates:`,
    `  test_coverage:`,
    `    backend_min_pct: 80`,
    `    frontend_min_pct: 70`,
    `    enforcement: blocking`,
    `  type_safety:`,
    `    strict_mode: ${options.frontend === 'react' || options.backend === 'express' ? 'true' : 'true'}`,
    `    no_implicit_any: true`,
    `    enforcement: blocking`,
    `  linting:`,
    `    required: true`,
    `    zero_warnings: ${options.complexity === 'complex' ? 'true' : 'false'}`,
    `    enforcement: ${options.complexity === 'complex' ? 'blocking' : 'warning'}`,
    `  accessibility:`,
    `    wcag_level: AA`,
    `    critical_issues: 0`,
    `    serious_issues_max: ${options.complexity === 'simple' ? 5 : 0}`,
    `    enforcement: ${options.frontend !== 'none' ? 'blocking' : 'warning'}`,
    `  performance:`,
    `    lighthouse_min: 90`,
    `    max_bundle_kb: 500`,
    `    max_first_contentful_paint_ms: 2500`,
    `    enforcement: ${options.frontend !== 'none' ? 'blocking' : 'warning'}`,
    `  security:`,
    `    https_required: true`,
    `    input_validation_all_endpoints: true`,
    `    no_shell_injection: true`,
    `    dependency_audit: monthly`,
    `    enforcement: blocking`,
    '',
    `coding_standards:`,
    `  source: [".wdf/code-standards.md", "project .wdf/ directory"]`,
    `  rules:`,
    `    - "All public functions must have JSDoc"`,
    `    - "No console.log in production code"`,
    `    - "Error messages must not leak internal state"`,
    `    - "All async operations must have error handling"`,
    `    - "Environment variables must be validated at startup"`,
  ];

  // Tech-stack specific rules
  if (options.frontend === 'react') {
    lines.push(
      `  frontend_rules:`,
      `    - "Use React functional components with hooks"`,
      `    - "PropTypes or TypeScript interfaces for all component props"`,
      `    - "Each component must handle loading, error, and empty states"`,
      `    - "CSS modules or styled-components — no inline styles"`,
    );
  }
  if (options.frontend === 'vue') {
    lines.push(
      `  frontend_rules:`,
      `    - "Use Vue 3 Composition API"`,
      `    - "Props must have type declarations"`,
      `    - "Each component must handle loading, error, and empty states"`,
    );
  }
  if (options.backend === 'express' || options.backend === 'nest' || options.backend === 'fastify') {
    lines.push(
      `  backend_rules:`,
      `    - "All endpoints must have input validation (Zod / Joi / class-validator)"`,
      `    - "Structured error responses: { error: { code, message, details? } }"`,
      `    - "Database queries must use parameterized statements — never string interpolation"`,
      `    - "All endpoints require authentication unless explicitly marked public"`,
    );
  }
  if (options.database === 'postgresql' || options.database === 'mysql') {
    lines.push(
      `  database_rules:`,
      `    - "All migrations must have UP and DOWN scripts"`,
      `    - "Foreign keys must be explicitly defined"`,
      `    - "No raw SQL in application code — use query builder or ORM"`,
    );
  }
  if (options.authMethod === 'jwt') {
    lines.push(
      `  auth_rules:`,
      `    - "JWT stored in httpOnly cookies, not localStorage"`,
      `    - "Access tokens: 15 min TTL; Refresh tokens: 7 day TTL with rotation"`,
      `    - "CSRF protection on all state-changing endpoints"`,
    );
  }

  lines.push(
    '',
    `testing_requirements:`,
    `  unit:`,
    `    required: true`,
    `    per_story_min: 1`,
    `  integration:`,
    `    required: ${options.complexity !== 'simple' ? 'true' : 'false'}`,
    `    per_api_endpoint_min: 1`,
    `  e2e:`,
    `    required: ${options.complexity === 'complex' ? 'true' : 'false'}`,
    `    critical_paths_min: ${options.complexity === 'complex' ? 5 : 0}`,
    '',
    `constitution_enforcement:`,
    `  ci_check: "wdf lint --strict"`,
    `  pre_commit: none`,
    `  blocking_merge_on_failure: true`,
    `  review_required_for_constitution_changes: true`,
  );

  return lines.join('\n');
}

// ============================================================
// Project Config (wdf.toml)
// ============================================================

function writeProjectToml(projectRoot: string, options: InitOptions): string {
  const projectName = options.name || deriveProjectName(options.description);

  const tomlContent = `# WDF Method Project Configuration
# Auto-generated by wdf init

[project]
name = "${projectName}"
description = "${options.description.replace(/"/g, '\\"')}"
version = "0.1.0"
wdf_version = "3.6.0"

[workflow]
dev_mode = "${options.devMode}"
triage_mode = "${options.triageMode}"
complexity_tier = "${options.complexity}"

[tech_stack]
frontend = "${options.frontend}"
backend = "${options.backend}"
database = "${options.database}"
api_style = "${options.apiStyle}"
auth_method = "${options.authMethod}"
deployment = "${options.deployment}"

[quality_gates]
min_test_coverage = 80
min_lighthouse_score = 90
max_bundle_size_kb = 500

[scope_lock]
enabled = true
enforcement_mode = "strict"

# Cross-artifact semantic validation. When enabled (default), "wdf check"
# surfaces semantic gaps (uncovered REQ, orphan API endpoint, phantom DB
# entity, unbound acceptance criterion) as advisory warnings, and the
# Phase 3.9 -> Phase 4 entry gate enforces them (plus traceability + per-story
# checklist) as a fail-closed gate. Set enabled = false to opt out for legacy
# projects that have not migrated to Story Pack v1.0.
[semantic_gate]
enabled = true
`;

  const filePath = join(projectRoot, 'wdf.toml');
  if (!existsSync(filePath)) {
    writeFileSync(filePath, tomlContent, 'utf-8');
  }
  return filePath;
}

// ============================================================
// .gitignore Update
// ============================================================

function updateGitignore(projectRoot: string): string {
  const gitignorePath = join(projectRoot, '.gitignore');
  const rules = [
    '# WDF Method',
    '_wdf_output/',
    '*.tmp.*',
    '',
  ];

  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, rules.join('\n'), 'utf-8');
  } else {
    const existing = readFileSync(gitignorePath, 'utf-8');
    if (!existing.includes('_wdf_output')) {
      appendFileSync(gitignorePath, '\n' + rules.join('\n'), 'utf-8');
    }
  }
  return gitignorePath;
}

// ============================================================
// CHG-2026-015 S4 — Brownfield specs bootstrap
// ============================================================

/**
 * Bootstrap `_wdf_output/specs/` from existing project artifacts.
 *
 * Trigger: only invoked when `initCommand` is called with `fromExisting: true`.
 *
 * Decision tree:
 *   1. specs/ already populated (any spec.md under a domain subdir) → skip
 *   2. _wdf_output/api-spec.yaml exists → reverseSyncFromApiSpec
 *   3. _wdf_output/prd.md exists         → reverseSync (existing PRD to specs)
 *   4. neither                           → scaffoldEmptySpec('general')
 *
 * Returns written relPaths and any warnings. Caller surfaces warnings + hint.
 */
function bootstrapSpecsFromArtifacts(projectRoot: string): { writes: string[]; warnings: string[]; bootstrapped: boolean } {
  const writes: string[] = [];
  const warnings: string[] = [];

  const { config } = loadConfig(projectRoot, { silent: true });
  const specsDir = getSpecsDir(config, projectRoot);

  // 1. Skip if specs/ already populated
  if (existsSync(specsDir)) {
    const existing = readdirSync(specsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .some(d => existsSync(join(specsDir, d.name, 'spec.md')));
    if (existing) {
      return { writes, warnings, bootstrapped: false };
    }
  }

  const specConfig: SpecSyncConfig = {
    specsDir,
    sourceOfTruth: config.specs.source_of_truth,
    managedRegionMarker: config.specs.managed_region_marker,
    enforceUniqueRequirementNames: config.specs.enforce_unique_requirement_names,
  };

  // 2. Try api-spec.yaml
  const apiPath = getApiSpecPath(config, projectRoot);
  if (existsSync(apiPath)) {
    const apiText = readFileSync(apiPath, 'utf8');
    const result = reverseSyncFromApiSpec(apiText, loadSpecDocs(specsDir), specConfig);
    if (result.writes.length > 0) {
      const applied = applySync(result, false);
      for (const w of applied.applied) writes.push(w.path);
      return { writes, warnings: result.warnings, bootstrapped: true };
    }
    // OpenAPI parse failed — fall through to PRD
    warnings.push(...result.warnings);
  }

  // 3. Try PRD
  const prdPath = join(projectRoot, '_wdf_output', 'prd.md');
  if (existsSync(prdPath)) {
    const prdText = readFileSync(prdPath, 'utf8');
    const result = reverseSync(prdText, '', loadSpecDocs(specsDir), specConfig);
    if (result.writes.length > 0) {
      const applied = applySync(result, false);
      for (const w of applied.applied) writes.push(w.path);
      return { writes, warnings: result.warnings, bootstrapped: true };
    }
    warnings.push(...result.warnings);
  }

  // 4. Fall back to empty general/spec.md
  const action = scaffoldEmptySpec('general', specsDir);
  const applied = applySync({ direction: 'reverse', writes: [action], warnings: [] }, false);
  for (const w of applied.applied) writes.push(w.path);
  return { writes, warnings, bootstrapped: true };
}

// ============================================================
// Main Command
// ============================================================

/**
 * Initialize a new WDF project
 */
export async function initCommand(options: InitOptions): Promise<InitOutput> {
  const timestamp = now();
  const filesCreated: string[] = [];

  // Step 1: Pre-flight checks
  const { partialWdfInit } = runPreFlightChecks(options.projectRoot, options.fromExisting);

  // Detect existing project tech stack if in from-existing mode
  let detection: ExistingProjectDetection | null = null;
  if (options.fromExisting) {
    detection = detectExistingProjectStructure(options.projectRoot);
  }

  // Merge detected values with explicit options (explicit wins)
  const frontend = options.frontend || detection?.detectedFrontend || options.frontend;
  const backend = options.backend || detection?.detectedBackend || options.backend;
  const database = options.database || detection?.detectedDatabase || options.database;
  const devMode = options.devMode || detection?.recommendedDevMode || options.devMode;

  // Step 2: Create directory structure (skips if dirs already exist)
  const { statusDir } = createDirectoryStructure(options.projectRoot);

  // Step 3: Write global state (with detected values when available)
  const mergedOptions: InitOptions = {
    ...options,
    frontend,
    backend,
    database,
    devMode,
  };
  filesCreated.push(writeGlobalState(statusDir, mergedOptions, timestamp));

  // Step 4: Write phase states
  // Auto-skip map is loaded from customize.toml [auto_run.auto_skip] section.
  // Only phases marked "skip" override the catalog defaults; "auto"/"run" fall through.
  const autoSkipMap = loadAutoSkipMap(options.projectRoot);
  filesCreated.push(writePhase1State(statusDir, options.complexity, timestamp, autoSkipMap));
  filesCreated.push(writePhase2State(statusDir, options.complexity, timestamp, autoSkipMap));
  filesCreated.push(writePhase3State(statusDir, options.complexity, timestamp, autoSkipMap));
  filesCreated.push(writePhase4SharedState(statusDir, timestamp));
  filesCreated.push(writePhase4TrackState(statusDir, 'backend', timestamp));
  filesCreated.push(writePhase4TrackState(statusDir, 'frontend', timestamp));

  // Step 5: Write change requests
  filesCreated.push(writeInitialChangeRequests(statusDir));

  // Step 6: Write merge queue
  filesCreated.push(writeInitialMergeQueue(statusDir));

  // Step 7: Write project config (only if not exists in from-existing mode)
  filesCreated.push(writeProjectToml(options.projectRoot, mergedOptions));

  // Step 8: Write project constitution
  filesCreated.push(writeProjectConstitution(options.projectRoot, mergedOptions, timestamp));

  // Step 9: Update .gitignore
  filesCreated.push(updateGitignore(options.projectRoot));

  // Step 10 (S4): Bootstrap specs/ from existing artifacts in --from-existing mode
  let bootstrapWarnings: string[] | undefined;
  let specsBootstrapped = false;
  if (options.fromExisting) {
    const bootstrapped = bootstrapSpecsFromArtifacts(options.projectRoot);
    filesCreated.push(...bootstrapped.writes);
    bootstrapWarnings = bootstrapped.warnings.length > 0 ? bootstrapped.warnings : undefined;
    specsBootstrapped = bootstrapped.bootstrapped;
  }

  const projectName = options.name || deriveProjectName(options.description);

  return {
    success: true,
    projectRoot: options.projectRoot,
    statusDir,
    projectName,
    filesCreated,
    bootstrapWarnings,
    specsBootstrapped,
  };
}
