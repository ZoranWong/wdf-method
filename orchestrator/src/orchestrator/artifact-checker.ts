// Artifact Quality Checker
//
// Validates wdf-method artifacts against defined standards.
// Reports issues with fix guidance — tells Claude WHAT is wrong
// and WHAT the standard expects.
//
// Does NOT execute AI work. Only checks and reports.
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import YAML from 'js-yaml';

export type CheckSeverity = 'error' | 'warning' | 'info';

export interface CheckIssue {
  severity: CheckSeverity;
  file: string;
  rule: string;
  message: string;
  expected: string;
  actual: string;
  fix?: string;
}

export interface CheckResult {
  artifact: string;
  passed: boolean;
  issues: CheckIssue[];
  checkedAt: string;
  standards: string[];
}

export interface CheckOptions {
  projectRoot: string;
  artifact?: string;
  phase?: number;
  story?: string;
  strict?: boolean;
}

interface Rule {
  id: string;
  severity: CheckSeverity;
  description: string;
  check: (content: string, file: string) => CheckIssue | null;
}

interface PhaseArtifactConfig {
  path: string;
  standard: string;
}

type ArtifactType =
  | 'prd'
  | 'story'
  | 'epic'
  | 'system-context'
  | 'container-design'
  | 'component-design'
  | 'architecture'
  | 'api-spec'
  | 'db-schema'
  | 'unknown';

export function checkArtifact(opts: CheckOptions): CheckResult[] {
  const outputDir = resolveOutputDir(opts.projectRoot);
  const results: CheckResult[] = [];
  if (opts.artifact) {
    const path = join(outputDir, opts.artifact);
    results.push(checkSingleArtifact(path, opts.projectRoot));
  }
  else if (opts.phase) {
    const configs = getPhaseArtifactConfigs(opts.phase);
    for (const cfg of configs) {
      const path = join(outputDir, cfg.path);
      if (existsSync(path)) {
        results.push(checkSingleArtifact(path, opts.projectRoot));
      }
      else {
        results.push(missingArtifact(cfg.path, cfg.standard));
      }
    }
  }
  else if (opts.story) {
    const storyPath = join(outputDir, 'stories', `${opts.story}.md`);
    if (existsSync(storyPath)) {
      results.push(checkSingleArtifact(storyPath, opts.projectRoot));
    }
    else {
      results.push(missingArtifact(`stories/${opts.story}.md`, 'Story file with YAML frontmatter'));
    }
  }
  else {
    // Check all existing artifacts
    const allArtifacts = findAllArtifacts(outputDir);
    for (const path of allArtifacts) {
      results.push(checkSingleArtifact(path, opts.projectRoot));
    }
  }
  return results;
}

function checkSingleArtifact(filePath: string, projectRoot: string): CheckResult {
  const issues: CheckIssue[] = [];
  const standards: string[] = [];
  const ext = extname(filePath);
  let content = '';
  try {
    content = readFileSync(filePath, 'utf-8');
  }
  catch {
    return { artifact: filePath, passed: false, issues: [{
              severity: 'error', file: filePath, rule: 'FILE_READ',
              message: 'Cannot read artifact',
              expected: 'Readable file', actual: 'Unreadable',
            }], checkedAt: new Date().toISOString(), standards: [] };
  }
  const rules: Rule[] = [];
  // ── Markdown artifacts ──
  if (ext === '.md') {
    standards.push('FRONTMATTER', 'CONTENT_LENGTH', 'NO_PLACEHOLDERS');
    // Rule: YAML frontmatter
    rules.push({
      id: 'FRONTMATTER',
      severity: 'error',
      description: 'Must have YAML frontmatter with artifact_type, phase, sub_phase, status',
      check: (c, f) => {
        const fm = c.match(/^---\n([\s\S]*?)\n---/);
        if (!fm)
          return {
            severity: 'error', file: f, rule: 'FRONTMATTER',
            message: 'Missing YAML frontmatter',
            expected: 'File must start with ---\n{frontmatter}\n---',
            actual: 'No frontmatter found',
            fix: `Add frontmatter at top of file:\n---\nartifact_type: <type>\nphase: <N>\nsub_phase: "<N.N>"\nstatus: completed\n---`,
          };
        const required = ['artifact_type', 'phase', 'status'];
        const missing = required.filter(k => !fm[1].includes(`${k}:`));
        if (missing.length > 0)
          return {
            severity: 'warning', file: f, rule: 'FRONTMATTER',
            message: `Frontmatter missing fields: ${missing.join(', ')}`,
            expected: `Required fields: ${required.join(', ')}`,
            actual: `Missing: ${missing.join(', ')}`,
            fix: `Add to frontmatter:\n${missing.map(k => `${k}: <value>`).join('\n')}`,
          };
        return null;
      },
    });
    // Rule: Content length
    rules.push({
      id: 'CONTENT_LENGTH',
      severity: 'warning',
      description: 'Must have substantive content (>= 500 chars)',
      check: (c, f) => {
        const body = c.replace(/^---\n[\s\S]*?\n---/, '').trim();
        if (body.length < 500)
          return {
            severity: 'warning', file: f, rule: 'CONTENT_LENGTH',
            message: `Content too short (${body.length} chars, need >= 500)`,
            expected: '>= 500 characters of substantive analysis',
            actual: `${body.length} characters`,
            fix: 'Expand the content with detailed analysis. Each section should have at least 2-3 sentences explaining the reasoning.',
          };
        return null;
      },
    });
    // Rule: No placeholders
    rules.push({
      id: 'NO_PLACEHOLDERS',
      severity: 'error',
      description: 'No placeholder/todo text',
      check: (c, f) => {
        // Strip YAML frontmatter before checking for placeholders
        const body = c.replace(/^---\n[\s\S]*?\n---/, '');
        // Only flag standalone placeholder words, not "Todo App" etc.
        const placeholderPatterns = [
          /\bTBD\b/gi, /\b待定\b/g,
          /^[ \t]*- (xxx|\.\.\.)$/gmi,
          /\[TODO\]/gi, /\[PLACEHOLDER\]/gi,
        ];
        for (const pattern of placeholderPatterns) {
          const match = body.match(pattern);
          if (match)
            return {
              severity: 'error', file: f, rule: 'NO_PLACEHOLDERS',
              message: `Found placeholder: "${match[0]}"`,
              expected: 'No placeholder content',
              actual: `Contains: ${match[0]}`,
              fix: `Replace "${match[0]}" with actual content.`,
            };
        }
        // Check for "todo" as standalone placeholder (not part of product name)
        const todoPlaceholder = body.match(/(?:^|\s)(todo)(?:\s*$|\s*[:;-])/gim);
        if (todoPlaceholder)
          return {
            severity: 'error', file: f, rule: 'NO_PLACEHOLDERS',
            message: 'Found standalone "todo" placeholder',
            expected: 'No placeholder content',
            actual: `Contains: ${todoPlaceholder[0]}`,
            fix: 'Replace "todo" with actual content.',
          };
        return null;
      },
    });
    // Rule: No [NEEDS CLARIFICATION] markers (SpecKit-inspired)
    // AI agents may emit this tag when they would otherwise guess. Its presence
    // means the artifact is incomplete and must not pass the gate — forcing
    // the human (or Party Mode) to supply the missing detail.
    rules.push({
      id: 'NO_UNRESOLVED_CLARIFICATIONS',
      severity: 'error',
      description: 'No unresolved [NEEDS CLARIFICATION] markers',
      check: (c, f) => {
        const body = c.replace(/^---\n[\s\S]*?\n---/, '');
        const clarifyPatterns = [
          /\[NEEDS?\s+CLARIFICATION\]/gi,
          /\[NEEDS_CLARIFICATION\]/gi,
          /\[CLARIFICATION\s+NEEDED\]/gi,
          /\[CLARIFY\]/gi,
          /\[TBD[:\s][^\]]+\]/gi,
        ];
        for (const pattern of clarifyPatterns) {
          const matches = body.match(pattern);
          if (matches) {
            return {
              severity: 'error', file: f, rule: 'NO_UNRESOLVED_CLARIFICATIONS',
              message: `Unresolved clarification marker: "${matches[0]}"`,
              expected: 'All decisions and fields filled with concrete content',
              actual: `Contains ${matches.length} marker(s): ${matches[0]}`,
              fix: 'Resolve the clarification (replace the marker with the decided value) before this artifact can pass the gate. If unsure, run `/wdf-party` to debate with multiple personas.',
            };
          }
        }
        return null;
      },
    });
  }
  // ── YAML artifacts (API spec) ──
  if (ext === '.yaml' || ext === '.yml') {
    standards.push('YAML_VALID');
    rules.push({
      id: 'YAML_VALID',
      severity: 'error',
      description: 'Must be valid YAML',
      check: (c, f) => {
        try {
          YAML.load(c);
          return null;
        }
        catch (e: any) {
          return {
            severity: 'error', file: f, rule: 'YAML_VALID',
            message: `Invalid YAML: ${e.message}`,
            expected: 'Valid YAML syntax',
            actual: e.message,
            fix: `Fix YAML syntax error: ${e.message}`,
          };
        }
      },
    });
    if (filePath.includes('api-spec')) {
      standards.push('OPENAPI_STRUCTURE');
      rules.push({
        id: 'OPENAPI_STRUCTURE',
        severity: 'warning',
        description: 'Should have OpenAPI structure (paths, components)',
        check: (c, f) => {
          const hasPaths = c.includes('paths:');
          const hasInfo = c.includes('info:');
          if (!hasPaths || !hasInfo)
            return {
              severity: 'warning', file: f, rule: 'OPENAPI_STRUCTURE',
              message: 'Missing OpenAPI structure',
              expected: 'openapi, info, paths sections',
              actual: `${hasInfo ? 'has info' : 'missing info'}, ${hasPaths ? 'has paths' : 'missing paths'}`,
              fix: 'Ensure the file follows OpenAPI 3.0 format with openapi:, info:, and paths: sections.',
            };
          return null;
        },
      });
    }
  }
  // ── Apply semantic rules based on artifact type ──
  const artifactType = detectArtifactType(filePath, content);
  if (artifactType === 'prd') {
    standards.push('REQ_ENTRIES', 'REQ_ACCEPTANCE_CRITERIA', 'REQ_PRIORITY');
    rules.push(prdReqsExistRule(), prdReqAcceptanceCriteriaRule(), prdReqPriorityRule());
  }
  if (artifactType === 'story') {
    standards.push('STORY_SCOPE_VALID', 'STORY_AC_TESTABLE', 'STORY_DEPENDENCIES');
    rules.push(storyScopeValidRule(), storyAcTestableRule(), storyDependenciesRule());
  }
  if (artifactType === 'epic') {
    standards.push('EPIC_STORIES', 'EPIC_CROSS_REF');
    rules.push(epicHasStoriesRule(), epicCrossRefRule());
  }
  if (artifactType === 'architecture' || artifactType === 'system-context' ||
      artifactType === 'container-design' || artifactType === 'component-design') {
    standards.push('ARCH_C4_LEVEL', 'ARCH_ADR');
    rules.push(archC4LevelRule(), archAdrRule());
  }
  if (artifactType === 'api-spec') {
    standards.push('API_ENDPOINTS', 'API_SCHEMAS', 'API_AUTH');
    rules.push(apiEndpointsRule(), apiSchemasRule(), apiAuthRule());
  }
  if (artifactType === 'db-schema') {
    standards.push('DB_TABLES', 'DB_MIGRATIONS');
    rules.push(dbTablesRule(), dbMigrationsRule());
  }
  // ── Status / config file validation ──
  // When the LLM writes status files (skip-decisions.yaml, etc.), they
  // must pass structural validation before being accepted by the FSM.
  if (filePath.includes('skip-decisions.yaml')) {
    standards.push('SKIP_DECISIONS_STRUCTURE', 'SKIP_DECISIONS_REASON');
    rules.push(skipDecisionsStructureRule(), skipDecisionsReasonRule());
  }
  if (filePath.includes('global.yaml')) {
    standards.push('GLOBAL_STATE_REQUIRED_FIELDS');
    rules.push(globalStateRequiredFieldsRule());
  }
  if (filePath.includes('change-requests.yaml')) {
    standards.push('CR_LIST_STRUCTURE');
    rules.push(crListStructureRule());
  }
  // ── Apply all rules ──
  for (const rule of rules) {
    const issue = rule.check(content, filePath);
    if (issue)
      issues.push(issue);
  }
  return {
    artifact: filePath,
    passed: issues.filter(i => i.severity === 'error').length === 0,
    issues,
    checkedAt: new Date().toISOString(),
    standards: [...new Set(standards)],
  };
}

// ── Helpers ────────────────────────────────────────────────────
function missingArtifact(path: string, standard: string): CheckResult {
  return {
    artifact: path,
    passed: false,
    issues: [{
            severity: 'error',
            file: path,
            rule: 'MISSING',
            message: `Artifact not found: ${path}`,
            expected: standard,
            actual: 'File does not exist',
            fix: `Create ${path} following the ${standard} standard.`,
          }],
    checkedAt: new Date().toISOString(),
    standards: [standard],
  };
}

function getPhaseArtifactConfigs(phase: number): PhaseArtifactConfig[] {
  const configs: Record<number, PhaseArtifactConfig[]> = {
    1: [
      { path: '_output/analysis/impact-map.md', standard: 'Impact Map with YAML frontmatter' },
    ],
    2: [
      { path: '_output/planning/impact-map.md', standard: 'Impact Map (Planning)' },
      { path: '_output/planning/story-map.md', standard: 'Story Map with release slices' },
      { path: 'prd.md', standard: 'PRD with functional/non-functional requirements' },
      { path: '_output/planning/user-flows.md', standard: 'User Flows with error paths' },
      { path: '_output/planning/wireframes.md', standard: 'Wireframes with all UI states' },
      { path: '_output/planning/design-acceptance.md', standard: 'Design Acceptance checklist' },
    ],
    3: [
      { path: '_output/solutioning/system-context.md', standard: 'C4 L1 System Context' },
      { path: '_output/solutioning/architecture-style.md', standard: 'ADR-001 Architecture Decision' },
      { path: '_output/solutioning/container-design.md', standard: 'C4 L2 Container Design' },
      { path: '_output/solutioning/component-design.md', standard: 'C4 L3 Component Design' },
      { path: 'epics.md', standard: 'Epic hierarchy with stories' },
      { path: 'api-spec.yaml', standard: 'OpenAPI 3.0 specification' },
      { path: 'db-schema.md', standard: 'DB Schema with migrations' },
      { path: '_output/solutioning/readiness-check.md', standard: 'Readiness checklist' },
    ],
    4: [],
  };
  return configs[phase] ?? [];
}

function findAllArtifacts(outputDir: string): string[] {
  const artifacts: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir))
      return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) {
          if (!entry.startsWith('.') && entry !== 'status' && entry !== 'merge-queue') {
            walk(full);
          }
        }
        else if (/\.(md|ya?ml)$/.test(entry)) {
          artifacts.push(full);
        }
      }
      catch { /* skip */ }
    }
  };
  walk(outputDir);
  return artifacts;
}

function resolveOutputDir(projectRoot: string): string {
  const wdf = join(projectRoot, '_wdf_output');
  if (existsSync(wdf))
    return wdf;
  return join(projectRoot, '_bmad-output', 'web-dev-flow');
}

function detectArtifactType(filePath: string, content: string): ArtifactType {
  const basename = filePath.toLowerCase();
  if (basename.includes('prd') || basename.includes('product-requirement'))
    return 'prd';
  if (basename.includes('/stories/') && basename.endsWith('.md'))
    return 'story';
  if (basename.includes('epic'))
    return 'epic';
  if (basename.includes('system-context'))
    return 'system-context';
  if (basename.includes('container-design'))
    return 'container-design';
  if (basename.includes('component-design'))
    return 'component-design';
  if (basename.includes('architecture'))
    return 'architecture';
  if (basename.includes('api-spec') || (basename.endsWith('.yaml') && content.includes('paths:')))
    return 'api-spec';
  if (basename.includes('db-schema') || basename.includes('database'))
    return 'db-schema';
  // Content-based detection for markdown files
  if (content.includes('## Requirements') || content.match(/^### REQ-\d+/m))
    return 'prd';
  if (content.match(/^## Epic:/m) || content.match(/epic_id\s*:/))
    return 'epic';
  if (content.match(/story_id\s*:/) && content.match(/scope_write\s*:/))
    return 'story';
  return 'unknown';
}

// ── PRD Semantic Rules ──────────────────────────────────────────
function prdReqsExistRule(): Rule {
  return {
    id: 'REQ_ENTRIES',
    severity: 'error',
    description: 'PRD must have at least 3 numbered REQ entries',
    check: (c, f) => {
      const matches = c.match(/REQ-\d{3,4}/g);
      if (!matches || matches.length < 3) {
        return {
          severity: 'warning', file: f, rule: 'REQ_ENTRIES',
          message: `Found ${matches?.length ?? 0} REQ entries (need >= 3)`,
          expected: 'At least 3 requirements in REQ-NNN format',
          actual: `${matches?.length ?? 0} REQ entries found`,
          fix: 'Add numbered requirements (e.g. REQ-001, REQ-002...) with clear descriptions.',
        };
      }
      return null;
    },
  };
}

function prdReqAcceptanceCriteriaRule(): Rule {
  return {
    id: 'REQ_ACCEPTANCE_CRITERIA',
    severity: 'error',
    description: 'Each REQ must have acceptance criteria',
    check: (c, f) => {
      const reqSections = c.split(/^###?\s+REQ-\d{3,4}/gm).slice(1);
      const reqHeaders = c.match(/^###?\s+(REQ-\d{3,4}.*)/gm) ?? [];
      const missingAc: string[] = [];
      for (let i = 0; i < reqSections.length; i++) {
        const section = reqSections[i];
        const header = reqHeaders[i]?.replace(/^###?\s+/, '') ?? `REQ #${i + 1}`;
        const hasAc = /acceptance criteri|AC\s*\d|✅|verification|must\s+(have|be|pass|return)|SHALL/i.test(section);
        if (!hasAc)
          missingAc.push(header);
      }
      if (missingAc.length > 0) {
        return {
          severity: 'warning', file: f, rule: 'REQ_ACCEPTANCE_CRITERIA',
          message: `${missingAc.length} REQ(s) missing acceptance criteria: ${missingAc.slice(0, 3).join(', ')}${missingAc.length > 3 ? '...' : ''}`,
          expected: 'Each REQ entry should include acceptance criteria (how to verify the requirement is met)',
          actual: `${missingAc.length} REQ(s) without clear AC`,
          fix: 'Add acceptance criteria to each REQ. Use format: "AC: ..." or numbered criteria.',
        };
      }
      return null;
    },
  };
}

function prdReqPriorityRule(): Rule {
  return {
    id: 'REQ_PRIORITY',
    severity: 'warning',
    description: 'REQ entries should have priority labels (P0/P1/P2)',
    check: (c, f) => {
      const reqSections = c.split(/^###?\s+REQ-\d{3,4}/gm).slice(1);
      const reqHeaders = c.match(/^###?\s+(REQ-\d{3,4}.*)/gm) ?? [];
      const unprioritized: string[] = [];
      for (let i = 0; i < reqSections.length; i++) {
        const section = reqSections[i];
        const header = reqHeaders[i]?.replace(/^###?\s+/, '') ?? '';
        const hasPriority = /\bP[0123]\b|priority|critical|high|medium|low|must.have|should.have/i.test(section);
        if (!hasPriority)
          unprioritized.push(header || `REQ #${i + 1}`);
      }
      if (unprioritized.length > reqSections.length * 0.3) {
        return {
          severity: 'warning', file: f, rule: 'REQ_PRIORITY',
          message: `${unprioritized.length} REQ(s) missing priority labels`,
          expected: 'Each REQ should indicate priority (P0=must have, P1=should have, P2=nice to have)',
          actual: `${unprioritized.length} unprioritized REQs`,
          fix: 'Add priority labels: `**Priority:** P0` or `[P1]` to each REQ.',
        };
      }
      return null;
    },
  };
}

// ── Story Semantic Rules ────────────────────────────────────────
function storyScopeValidRule(): Rule {
  return {
    id: 'STORY_SCOPE_VALID',
    severity: 'error',
    description: 'Story scope_write must contain valid relative paths',
    check: (c, f) => {
      const scopeMatch = c.match(/scope_write\s*:\s*\n((?:\s+-\s+.+\n?)+)/);
      if (!scopeMatch) {
        return {
          severity: 'error', file: f, rule: 'STORY_SCOPE_VALID',
          message: 'Missing scope_write in story frontmatter',
          expected: 'scope_write with at least one relative path',
          actual: 'No scope_write found',
          fix: 'Add `scope_write:` to story frontmatter with relative paths, e.g. `- "src/modules/auth/"`',
        };
      }
      const paths = scopeMatch[1].split('\n')
        .map(l => l.replace(/^\s+-\s+/, '').trim())
        .filter(l => l.length > 0);
      for (const p of paths) {
        if (p.startsWith('/') || p.includes('..')) {
          return {
            severity: 'error', file: f, rule: 'STORY_SCOPE_VALID',
            message: `Invalid scope_write path: "${p}"`,
            expected: 'Relative paths without .. or absolute paths',
            actual: p,
            fix: `Change "${p}" to a relative path within the project.`,
          };
        }
      }
      return null;
    },
  };
}

function storyAcTestableRule(): Rule {
  return {
    id: 'STORY_AC_TESTABLE',
    severity: 'error',
    description: 'Story acceptance_check must reference executable commands',
    check: (c, f) => {
      const acMatch = c.match(/acceptance_check\s*:\s*\n((?:\s+-\s+.+\n?)+)/);
      if (!acMatch) {
        return {
          severity: 'warning', file: f, rule: 'STORY_AC_TESTABLE',
          message: 'No acceptance_check defined',
          expected: 'At least one executable acceptance check command',
          actual: 'No acceptance_check in frontmatter',
          fix: 'Add `acceptance_check:` with testable commands, e.g. `- "npm run test:auth"`',
        };
      }
      const checks = acMatch[1].split('\n')
        .map(l => l.replace(/^\s+-\s+/, '').trim())
        .filter(l => l.length > 0 && l !== '-');
      // Check for non-executable descriptions (no command syntax)
      const nonExecutable = checks.filter(c => !/[a-z]/.test(c) || c.startsWith('Verify') || c.startsWith('Check'));
      if (nonExecutable.length > 0 && checks.every(c => !c.includes('npm') && !c.includes('npx') && !c.includes('node') && !c.includes('curl'))) {
        return {
          severity: 'warning', file: f, rule: 'STORY_AC_TESTABLE',
          message: 'Acceptance checks should be executable commands, not descriptions',
          expected: 'Executable commands (npm run test, npx vitest, etc.)',
          actual: 'Descriptive text instead of commands',
          fix: 'Replace descriptive checks with executable test commands.',
        };
      }
      return null;
    },
  };
}

function storyDependenciesRule(): Rule {
  return {
    id: 'STORY_DEPENDENCIES',
    severity: 'warning',
    description: 'Story depends_on entries must reference valid story IDs',
    check: (c, f) => {
      const depMatch = c.match(/depends_on\s*:\s*\n((?:\s+-\s+.+\n?)+)/);
      if (!depMatch)
        return null; // No dependencies is fine
      const deps = depMatch[1].split('\n')
        .map(l => l.replace(/^\s+-\s+/, '').trim())
        .filter(l => l.length > 0);
      for (const dep of deps) {
        if (!dep.match(/^S-\w{2,6}-\d{2,3}/) && !dep.match(/^STORY-\d+/)) {
          return {
            severity: 'warning', file: f, rule: 'STORY_DEPENDENCIES',
            message: `Dependency "${dep}" does not match story ID format (e.g. S-AUTH-01)`,
            expected: 'Story IDs like S-AUTH-01, S-TODO-02',
            actual: dep,
            fix: `Update "${dep}" to use standard story ID format.`,
          };
        }
      }
      return null;
    },
  };
}

// ── Epic Semantic Rules ─────────────────────────────────────────
function epicHasStoriesRule(): Rule {
  return {
    id: 'EPIC_STORIES',
    severity: 'error',
    description: 'Epic must reference at least 2 child stories',
    check: (c, f) => {
      const storyRefs = c.match(/S-\w{2,6}-\d{2,3}/g) ?? [];
      if (storyRefs.length < 2) {
        return {
          severity: 'warning', file: f, rule: 'EPIC_STORIES',
          message: `Epic references only ${storyRefs.length} stories (need >= 2)`,
          expected: 'At least 2 story references in the epic',
          actual: `${storyRefs.length} story reference(s)`,
          fix: 'Add child story references to the epic breakdown.',
        };
      }
      return null;
    },
  };
}

function epicCrossRefRule(): Rule {
  return {
    id: 'EPIC_CROSS_REF',
    severity: 'info',
    description: 'Epic should cross-reference source PRD requirements',
    check: (c, f) => {
      const hasReqRef = /REQ-\d{3,4}/.test(c) || /traces to/i.test(c) || /source/i.test(c);
      if (!hasReqRef) {
        return {
          severity: 'info', file: f, rule: 'EPIC_CROSS_REF',
          message: 'Epic does not reference source PRD requirements',
          expected: 'Cross-reference to PRD REQ entries for traceability',
          actual: 'No REQ references found',
          fix: 'Add "Traces to: REQ-001, REQ-002" for each epic to maintain traceability.',
        };
      }
      return null;
    },
  };
}

// ── Architecture Semantic Rules ─────────────────────────────────
function archC4LevelRule(): Rule {
  return {
    id: 'ARCH_C4_LEVEL',
    severity: 'warning',
    description: 'Architecture should identify its C4 level (L1/L2/L3)',
    check: (c, f) => {
      const hasC4Level = /C4\s*(Level|L)[123]/i.test(c) || /system.context|container|component/i.test(c);
      if (!hasC4Level) {
        return {
          severity: 'warning', file: f, rule: 'ARCH_C4_LEVEL',
          message: 'Architecture document does not identify C4 level',
          expected: 'C4 model level (System Context / Container / Component)',
          actual: 'No C4 level identified',
          fix: 'Add "C4 Level: L1 (System Context)" to frontmatter or heading.',
        };
      }
      return null;
    },
  };
}

function archAdrRule(): Rule {
  return {
    id: 'ARCH_ADR',
    severity: 'info',
    description: 'Architecture should document key decisions (ADR format)',
    check: (c, f) => {
      const hasAdr = /ADR-\d{3}|architectur(e|al)\s+decision|decision\s+record/i.test(c);
      if (!hasAdr) {
        return {
          severity: 'info', file: f, rule: 'ARCH_ADR',
          message: 'Architecture document does not use ADR format',
          expected: 'At least one Architecture Decision Record (ADR-001, ADR-002...)',
          actual: 'No ADR entries found',
          fix: 'Document key architecture decisions as ADRs: ADR-001: Chose X over Y because Z.',
        };
      }
      return null;
    },
  };
}

// ── API Spec Semantic Rules ─────────────────────────────────────
function apiEndpointsRule(): Rule {
  return {
    id: 'API_ENDPOINTS',
    severity: 'error',
    description: 'API spec must define at least 2 endpoints with HTTP methods',
    check: (c, f) => {
      const endpoints = c.match(/(?:get|post|put|delete|patch):\s*\n/gmi) ?? [];
      const pathMatches = c.match(/^\s+\/[^\s:]+:/gm) ?? [];
      if (pathMatches.length < 2 && endpoints.length < 2) {
        return {
          severity: 'error', file: f, rule: 'API_ENDPOINTS',
          message: `Found only ${Math.max(pathMatches.length, endpoints.length)} API endpoint(s) (need >= 2)`,
          expected: 'At least 2 API endpoints with HTTP methods',
          actual: `${pathMatches.length} path(s), ${endpoints.length} method(s)`,
          fix: 'Define API endpoints with HTTP methods. In OpenAPI, add paths: with get/post/etc.',
        };
      }
      return null;
    },
  };
}

function apiSchemasRule(): Rule {
  return {
    id: 'API_SCHEMAS',
    severity: 'warning',
    description: 'API spec should have request/response schemas',
    check: (c, f) => {
      const hasSchemas = /components:\s*\n\s+schemas:/i.test(c) ||
        /schema:\s*\n/i.test(c) ||
        /requestBody/i.test(c) ||
        /responses:\s*\n/i.test(c);
      const endpointCount = (c.match(/^\s+\/[^\s:]+:/gm) ?? []).length;
      if (!hasSchemas && endpointCount > 2) {
        return {
          severity: 'warning', file: f, rule: 'API_SCHEMAS',
          message: 'API spec has endpoints but no request/response schemas',
          expected: 'Request and response schemas for each endpoint',
          actual: 'No schema definitions found',
          fix: 'Add `components/schemas:` and reference them in endpoint requestBody and responses.',
        };
      }
      return null;
    },
  };
}

function apiAuthRule(): Rule {
  return {
    id: 'API_AUTH',
    severity: 'warning',
    description: 'API spec should define authentication method',
    check: (c, f) => {
      const hasAuth = /security:|bearer|jwt|oauth|api.?key|authorization/i.test(c);
      const epCount = (c.match(/^\s+\/[^\s:]+:/gm) ?? []).length;
      if (!hasAuth && epCount > 1) {
        return {
          severity: 'warning', file: f, rule: 'API_AUTH',
          message: 'API spec does not define authentication method',
          expected: 'Security scheme definition (Bearer JWT, OAuth2, API Key)',
          actual: 'No security/authentication found',
          fix: 'Add `security:` and `components/securitySchemes:` section.',
        };
      }
      return null;
    },
  };
}

// ── DB Schema Semantic Rules ────────────────────────────────────
function dbTablesRule(): Rule {
  return {
    id: 'DB_TABLES',
    severity: 'error',
    description: 'DB schema must define at least 2 tables/collections',
    check: (c, f) => {
      const tables = c.match(/(?:CREATE TABLE|create table|Table:)\s+`?(\w+)`?/g) ?? [];
      const collections = c.match(/(?:collection|model|entity):\s*`?(\w+)`?/gi) ?? [];
      const total = tables.length + collections.length;
      if (total < 2) {
        return {
          severity: 'error', file: f, rule: 'DB_TABLES',
          message: `Found ${total} table(s)/collection(s) (need >= 2)`,
          expected: 'At least 2 tables or collections defined',
          actual: `${total} found`,
          fix: 'Define database tables/collections with column/field names, types, and constraints.',
        };
      }
      return null;
    },
  };
}

function dbMigrationsRule(): Rule {
  return {
    id: 'DB_MIGRATIONS',
    severity: 'warning',
    description: 'DB schema should include migration strategy',
    check: (c, f) => {
      const hasMigrations = /migration|up\s*:|down\s*:|version|change/i.test(c);
      if (!hasMigrations) {
        return {
          severity: 'warning', file: f, rule: 'DB_MIGRATIONS',
          message: 'DB schema does not mention migration strategy',
          expected: 'Migration approach (up/down, versioned migrations, etc.)',
          actual: 'No migration information',
          fix: 'Document your migration strategy: how schema changes are versioned and applied.',
        };
      }
      return null;
    },
  };
}

// ── Status File Validation Rules ────────────────────────────────
// Validate YAML structure of status/config files written by the LLM
// during automation (e.g. skip-decisions.yaml). These checks ensure
// the FSM can correctly consume the files.
function skipDecisionsStructureRule(): Rule {
  return {
    id: 'SKIP_DECISIONS_STRUCTURE',
    severity: 'error',
    description: 'skip-decisions.yaml must have skip_decisions.skipped array',
    check: (c, f) => {
      try {
        const data = YAML.load(c) as any;
        if (!data?.skip_decisions) {
          return {
            severity: 'error', file: f, rule: 'SKIP_DECISIONS_STRUCTURE',
            message: 'Missing top-level skip_decisions key',
            expected: 'skip_decisions: { skipped: [...], reason: "..." }',
            actual: 'No skip_decisions key found',
            fix: 'Add `skip_decisions:` as the top-level key with `skipped` and `reason` fields.',
          };
        }
        const skipped = data.skip_decisions.skipped;
        if (!Array.isArray(skipped)) {
          return {
            severity: 'error', file: f, rule: 'SKIP_DECISIONS_STRUCTURE',
            message: 'skip_decisions.skipped must be an array',
            expected: 'Array of phase keys like ["phase_1_2", "phase_2_8"]',
            actual: `Got type: ${typeof skipped}`,
            fix: 'Change `skipped` to a YAML list: `skipped:\n  - phase_1_2\n  - phase_2_8`',
          };
        }
        for (const key of skipped) {
          if (!/^phase_\d_\d$/.test(String(key))) {
            return {
              severity: 'warning', file: f, rule: 'SKIP_DECISIONS_STRUCTURE',
              message: `Invalid phase key format: "${key}"`,
              expected: 'Format: phase_N_N (e.g. phase_1_2, phase_2_8)',
              actual: key,
              fix: `Change "${key}" to format "phase_N_N".`,
            };
          }
        }
        return null;
      }
      catch (e: any) {
        return {
          severity: 'error', file: f, rule: 'SKIP_DECISIONS_STRUCTURE',
          message: `Invalid YAML: ${e.message}`,
          expected: 'Valid YAML with skip_decisions structure',
          actual: e.message,
          fix: 'Fix YAML syntax error and ensure skip_decisions.skipped is present.',
        };
      }
    },
  };
}

function skipDecisionsReasonRule(): Rule {
  return {
    id: 'SKIP_DECISIONS_REASON',
    severity: 'info',
    description: 'skip-decisions.yaml should include a reason for the overall decision',
    check: (c, f) => {
      try {
        const data = YAML.load(c) as any;
        if (!data?.skip_decisions?.reason) {
          return {
            severity: 'info', file: f, rule: 'SKIP_DECISIONS_REASON',
            message: 'No overall reason for skip decisions',
            expected: 'skip_decisions.reason summarizing the skip strategy',
            actual: 'Missing reason field',
            fix: 'Add `reason: "Brief justification for skipped phases"` under skip_decisions.',
          };
        }
        return null;
      }
      catch {
        return null; // Handled by structure rule above
      }
    },
  };
}

function globalStateRequiredFieldsRule(): Rule {
  return {
    id: 'GLOBAL_STATE_REQUIRED_FIELDS',
    severity: 'error',
    description: 'global.yaml must have required workflow fields',
    check: (c, f) => {
      try {
        const data = YAML.load(c) as any;
        // Determine whether file is flat (global_state: {...}) or nested
        const gs = data?.global_state ?? data;
        const missing: string[] = [];
        if (!gs.dev_mode)
          missing.push('dev_mode');
        if (!gs.task_triage_mode)
          missing.push('task_triage_mode');
        if (!gs.overall_status)
          missing.push('overall_status');
        if (missing.length > 0) {
          return {
            severity: 'error', file: f, rule: 'GLOBAL_STATE_REQUIRED_FIELDS',
            message: `Missing required fields: ${missing.join(', ')}`,
            expected: `Required fields: dev_mode, task_triage_mode, overall_status`,
            actual: `Missing: ${missing.join(', ')}`,
            fix: `Add missing fields to global.yaml:`,
          };
        }
        return null;
      }
      catch (e: any) {
        return {
          severity: 'error', file: f, rule: 'GLOBAL_STATE_REQUIRED_FIELDS',
          message: `Invalid YAML: ${e.message}`,
          expected: 'Valid YAML with required workflow fields',
          actual: e.message,
          fix: 'Fix YAML syntax error.',
        };
      }
    },
  };
}

function crListStructureRule(): Rule {
  return {
    id: 'CR_LIST_STRUCTURE',
    severity: 'error',
    description: 'change-requests.yaml must have change_requests array',
    check: (c, f) => {
      try {
        const data = YAML.load(c) as any;
        if (!data || !Array.isArray(data.change_requests)) {
          return {
            severity: 'error', file: f, rule: 'CR_LIST_STRUCTURE',
            message: 'Missing or invalid change_requests array',
            expected: 'change_requests: [] or change_requests: [{id: ..., title: ...}]',
            actual: data ? 'No change_requests key' : 'Empty file',
            fix: 'Add `change_requests: []` to initialize the CR list.',
          };
        }
        return null;
      }
      catch (e: any) {
        return {
          severity: 'error', file: f, rule: 'CR_LIST_STRUCTURE',
          message: `Invalid YAML: ${e.message}`,
          expected: 'Valid YAML with change_requests array',
          actual: e.message,
          fix: 'Fix YAML syntax error.',
        };
      }
    },
  };
}

// ── Formatters ─────────────────────────────────────────────────
export function formatCheckResults(results: CheckResult[]): string {
  const lines: string[] = [];
  const allIssues = results.flatMap(r => r.issues);
  const errors = allIssues.filter(i => i.severity === 'error');
  const warnings = allIssues.filter(i => i.severity === 'warning');
  lines.push('');
  lines.push('═══════════════════════════════════════════');
  lines.push('  wdf check — Artifact Quality Report');
  lines.push('═══════════════════════════════════════════');
  lines.push(`  Checked: ${results.length} artifact(s)`);
  lines.push(`  Errors: ${errors.length} | Warnings: ${warnings.length}`);
  lines.push('');
  for (const result of results) {
    const icon = result.passed ? '✓' : '✗';
    const fileName = result.artifact.replace(/^.*\/_wdf_output\//, '');
    lines.push(`  ${icon} ${fileName}`);
    lines.push(`    Standards checked: ${result.standards.join(', ')}`);
    for (const issue of result.issues) {
      const sev = issue.severity === 'error' ? '✗' : issue.severity === 'warning' ? '⚠' : 'ℹ';
      lines.push(`    ${sev} [${issue.rule}] ${issue.message}`);
      lines.push(`      Expected: ${issue.expected}`);
      lines.push(`      Actual:   ${issue.actual}`);
      if (issue.fix) {
        lines.push(`      Fix: ${issue.fix.split('\n')[0]}`);
      }
    }
    lines.push('');
  }
  if (allIssues.length === 0) {
    lines.push('  ✅ All artifacts pass quality checks.');
  }
  else if (errors.length > 0) {
    lines.push(`  ❌ ${errors.length} error(s) must be fixed.`);
    lines.push('  Re-run "wdf check" after fixing to verify.');
  }
  lines.push('═══════════════════════════════════════════');
  lines.push('');
  return lines.join('\n');
}
