// Spec Sync Engine — CHG-2026-015 S1
//
// Introduces _wdf_output/specs/<domain>/spec.md as the canonical BDD source of
// truth. Provides bidirectional sync with PRD:
//
//   reverseSync (default):  PRD -> specs/   (non-destructive bootstrap)
//   forwardSync (gated):    specs/ -> PRD   (requires [specs] source_of_truth = true)
//
// Round-trip stability: forwardSync(reverseSync(prd)) must produce byte-identical
// PRD when source_of_truth flips. formatSpecDoc is the single canonical serializer.

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  readdirSync,
} from 'fs';
import { join, dirname } from 'path';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export interface Scenario {
  name?: string;
  given: string[];
  when: string[];
  then: string[];
}

export interface SpecRequirement {
  id?: string;
  name: string;
  priority?: 'P0' | 'P1' | 'P2';
  description?: string;
  scenarios: Scenario[];
}

export interface SpecDocument {
  domain: string;
  version: number;
  requirements: SpecRequirement[];
}

export interface ParsedReq {
  id: string;
  title: string;
  priority?: 'P0' | 'P1' | 'P2';
  domain?: string;
  description?: string;
  acceptanceCriteria: string[];
}

export interface ValidationError {
  ruleId: string;
  severity: 'error' | 'warning';
  message: string;
  path?: string;
}

export interface WriteAction {
  path: string;
  content: string;
  action: 'create' | 'update' | 'delete' | 'noop';
}

export interface SyncResult {
  direction: 'forward' | 'reverse';
  writes: WriteAction[];
  warnings: string[];
}

export interface SpecSyncConfig {
  specsDir: string;
  sourceOfTruth: boolean;
  managedRegionMarker: string;
  enforceUniqueRequirementNames: boolean;
}

// ─────────────────────────────────────────
// Constants
// ─────────────────────────────────────────

const RFC2119_PATTERN = /\b(MUST|SHALL|WILL|SHOULD|EXPECTED)\b/;
const PLACEHOLDER_PATTERN = /\b(TODO|FIXME|XXX)\b|\.\.\.|…/;
const REQ_ID_PATTERN = /^REQ-\d{3,4}$/;
const REQ_ID_REGEX_GLOBAL = /REQ-\d{3,4}/g;
const REQ_HEADING_REGEX = /^###\s+(REQ-\d{3,4})\s*:\s*(.+?)\s*$/gm;
const EPIC_HEADING_REGEX = /^##\s+EPIC-([A-Z]+)\s*:/gm;
const SPEC_HEADING_REGEX = /^##\s+Requirement:\s*(.+?)\s*$/m;
const DOMAIN_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;
const DOMAIN_KEYWORD_MAP: Array<{ regex: RegExp; domain: string }> = [
  { regex: /\b(auth|login|session|password|token|jwt|oauth)\b/i, domain: 'auth' },
  { regex: /\b(todo|task|note|item|reminder)\b/i, domain: 'todos' },
  { regex: /\b(database|schema|migration|storage|persistence)\b/i, domain: 'db' },
  { regex: /\b(deploy|ci|cd|pipeline|infrastructure|monitoring)\b/i, domain: 'ops' },
  { regex: /\b(test|qa|quality|coverage|lint)\b/i, domain: 'qa' },
];

// ─────────────────────────────────────────
// Spec document parsing
// ─────────────────────────────────────────

export function parseSpecDoc(md: string, fallbackDomain = 'general'): SpecDocument {
  const frontmatter = parseFrontmatter(md);
  const domain = (frontmatter.domain as string) || fallbackDomain;
  const version = (frontmatter.version as number) || 1;

  const body = stripFrontmatter(md);
  const requirements: SpecRequirement[] = [];

  // Split body on `## Requirement:` headings
  const reqBlocks = splitOnHeading(body, /^##\s+Requirement:\s+/m);

  for (const block of reqBlocks) {
    if (!block.trim()) continue;
    const req = parseRequirementBlock(block);
    if (req) requirements.push(req);
  }

  return { domain, version, requirements };
}

function parseRequirementBlock(block: string): SpecRequirement | null {
  // Strip leading `## Requirement: ` heading; first line is "Name" (heading content)
  const lines = block.split('\n');
  let nameLineIdx = -1;
  let name = '';
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    const headingMatch = t.match(/^##\s+Requirement:\s*(.+?)\s*$/);
    if (headingMatch) {
      name = headingMatch[1];
      nameLineIdx = i;
      break;
    }
    // Fall back to first non-empty line if heading was stripped upstream
    if (t.trim() && !name) {
      name = t.trim().replace(/^##\s+Requirement:\s*/, '');
      nameLineIdx = i;
      break;
    }
  }
  if (!name) return null;

  // Parse metadata bullets: `- id: REQ-001`, `- priority: P0`
  let id: string | undefined;
  let priority: 'P0' | 'P1' | 'P2' | undefined;
  let description: string | undefined;
  let metaEndIdx = lines.length;
  for (let i = nameLineIdx + 1; i < lines.length; i++) {
    const t = lines[i];
    if (!t.trim()) continue;
    const idMatch = t.match(/^-\s+id:\s*(.+?)\s*$/);
    const priMatch = t.match(/^-\s+priority:\s*(P[012])\s*$/);
    const descMatch = t.match(/^-\s+description:\s*(.+?)\s*$/);
    if (idMatch) {
      id = idMatch[1].trim();
    } else if (priMatch) {
      priority = priMatch[1] as 'P0' | 'P1' | 'P2';
    } else if (descMatch) {
      description = descMatch[1].trim();
    } else {
      metaEndIdx = i;
      break;
    }
    metaEndIdx = i + 1;
  }

  const body = lines.slice(metaEndIdx).join('\n');
  const scenarios = parseScenarios(body);
  return { id, name, priority, description, scenarios };
}

function parseScenarios(body: string): Scenario[] {
  const scenarios: Scenario[] = [];
  const normalized = body.replace(/\r\n/g, '\n');
  const scenarioRegex = /(?:^|\n)(GIVEN\b[\s\S]*?)(?=\nGIVEN\b|\n##|$)/g;
  let match: RegExpExecArray | null;
  while ((match = scenarioRegex.exec(normalized)) !== null) {
    const block = match[1].trim();
    if (!block) continue;
    const scenario = parseScenarioBlock(block);
    if (scenario) scenarios.push(scenario);
  }
  return scenarios;
}

function parseScenarioBlock(block: string): Scenario | null {
  const given: string[] = [];
  const when: string[] = [];
  const then: string[] = [];

  let current: 'given' | 'when' | 'then' | null = null;
  for (const line of block.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const givenMatch = t.match(/^GIVEN\s+(.+?)\s*$/i);
    const whenMatch = t.match(/^WHEN\s+(.+?)\s*$/i);
    const thenMatch = t.match(/^THEN\s+(.+?)\s*$/i);
    if (givenMatch) {
      current = 'given';
      given.push(givenMatch[1]);
    } else if (whenMatch) {
      current = 'when';
      when.push(whenMatch[1]);
    } else if (thenMatch) {
      current = 'then';
      then.push(thenMatch[1]);
    } else if (current) {
      // Continuation of the previous block
      if (current === 'given') given[given.length - 1] += ' ' + t;
      else if (current === 'when') when[when.length - 1] += ' ' + t;
      else then[then.length - 1] += ' ' + t;
    }
  }

  if (given.length === 0 && when.length === 0 && then.length === 0) return null;
  return { given, when, then };
}

// ─────────────────────────────────────────
// PRD parsing
// ─────────────────────────────────────────

export function parsePrdReqs(md: string): ParsedReq[] {
  const reqs: ParsedReq[] = [];
  const text = md.replace(/\r\n/g, '\n');

  // Split on `### REQ-NNN:` headings
  const blocks = splitOnHeading(text, /^###\s+REQ-\d{3,4}\s*:/m);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    // Strip leading `### ` prefix so the REQ-NNN line starts at column 0
    const deheadinged = trimmed.replace(/^###\s+/, '');
    const headingMatch = deheadinged.match(/^REQ-(\d{3,4})\s*:\s*(.+?)\s*$/m);
    if (!headingMatch) continue;
    const id = `REQ-${headingMatch[1]}`;
    const title = headingMatch[2];

    const priority = extractField(deheadinged, /^\*\*Priority:\*\*\s*(P[012])\s*$/m);
    const domain = extractField(deheadinged, /^\*\*Domain:\*\*\s*([a-z][a-z0-9-]{1,30})\s*$/m);
    const description = extractField(deheadinged, /^\*\*Description:\*\*\s*(.+?)\s*$/m);
    const ac = extractAcceptanceCriteria(deheadinged);

    reqs.push({
      id,
      title,
      priority: priority as 'P0' | 'P1' | 'P2' | undefined,
      domain: domain || undefined,
      description: description || undefined,
      acceptanceCriteria: ac,
    });
  }

  return reqs;
}

function extractField(text: string, regex: RegExp): string | null {
  const m = text.match(regex);
  return m ? m[1] : null;
}

function extractAcceptanceCriteria(text: string): string[] {
  const acs: string[] = [];
  const acMatch = text.match(/\*\*Acceptance Criteria:\*\*\s*([\s\S]*?)(?=\n\*\*|\n###|\n##|$)/);
  if (!acMatch) return acs;
  const acBlock = acMatch[1];
  for (const line of acBlock.split('\n')) {
    const t = line.trim();
    const m = t.match(/^(?:AC\d+|[-*])\s*[:.]?\s*(.+?)\s*$/);
    if (m && m[1]) acs.push(m[1]);
  }
  return acs;
}

// ─────────────────────────────────────────
// Epics parsing
// ─────────────────────────────────────────

export function parseEpicsTracks(md: string): string[] {
  const tracks: string[] = [];
  const text = md.replace(/\r\n/g, '\n');
  let m: RegExpExecArray | null;
  const re = new RegExp(EPIC_HEADING_REGEX);
  while ((m = re.exec(text)) !== null) {
    const track = m[1].toLowerCase();
    if (!tracks.includes(track)) tracks.push(track);
  }
  return tracks;
}

// ─────────────────────────────────────────
// Domain inference
// ─────────────────────────────────────────

export function inferDomainFromReq(req: ParsedReq, epicsTracks: string[]): string {
  // 1. Explicit Domain field
  if (req.domain && DOMAIN_PATTERN.test(req.domain)) return req.domain;

  // 2. EPIC cross-ref: search epics.md text would require epicsText param;
  //    here we just trust the tracks list and infer from title keywords.
  const titleAndDesc = `${req.title} ${req.description ?? ''} ${req.acceptanceCriteria.join(' ')}`;

  // 3. Keyword fallback
  for (const { regex, domain } of DOMAIN_KEYWORD_MAP) {
    if (regex.test(titleAndDesc) && epicsTracks.includes(domain)) return domain;
  }

  // 4. Bare keyword (even if no epic track matches)
  for (const { regex, domain } of DOMAIN_KEYWORD_MAP) {
    if (regex.test(titleAndDesc)) return domain;
  }

  return 'general';
}

// ─────────────────────────────────────────
// Transformations
// ─────────────────────────────────────────

export function prdToSpecDocument(reqs: ParsedReq[], domain: string): SpecDocument {
  const filtered = reqs.filter(r => inferDomainFromReq(r, [domain]) === domain);
  const requirements: SpecRequirement[] = filtered.map(r => ({
    id: r.id,
    name: toTitleCase(r.title),
    priority: r.priority,
    description: r.description,
    scenarios: r.acceptanceCriteria.length > 0
      ? r.acceptanceCriteria.map((ac, idx) => acToScenario(ac, idx))
      : [defaultSkeletonScenario()],
  }));
  return { domain, version: 1, requirements };
}

function acToScenario(acText: string, idx: number): Scenario {
  // Strip leading "AC1:" or numeric prefix
  const cleaned = acText.replace(/^(AC\d+|[-*])\s*[:.]?\s*/, '').trim();

  // If the AC already has RFC 2119 keyword, use as-is in THEN
  const hasRfc = RFC2119_PATTERN.test(cleaned);
  const thenText = hasRfc ? cleaned : `the system MUST ${lowerFirst(cleaned)}`;

  return {
    name: `Scenario ${idx + 1}`,
    given: ['the system is initialized'],
    when: ['the user performs the documented action'],
    then: [thenText],
  };
}

function defaultSkeletonScenario(): Scenario {
  return {
    name: 'Scenario 1',
    given: ['<precondition>'],
    when: ['<action>'],
    then: ['the system MUST <observable outcome>'],
  };
}

export function specToPrdRequirements(doc: SpecDocument): string {
  const blocks: string[] = [];
  for (const req of doc.requirements) {
    if (!req.id) continue; // skip requirements without stable IDs (PRD requires REQ-NNN)
    const lines: string[] = [];
    lines.push(`### ${req.id}: ${req.name}`);
    lines.push('');
    if (req.priority) lines.push(`**Priority:** ${req.priority}`);
    if (req.description) lines.push(`**Description:** ${req.description}`);
    lines.push(`**Domain:** ${doc.domain}`);
    lines.push('');
    lines.push('**Acceptance Criteria:**');
    req.scenarios.forEach((s, idx) => {
      const acText = s.then.map(t => t.replace(/^the system MUST\s+/i, '')).join('; ');
      lines.push(`AC${idx + 1}: When ${s.when[0] || '<trigger>'}, then ${acText}`);
    });
    lines.push('');
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n');
}

// ─────────────────────────────────────────
// Sync: reverse (PRD -> specs/)
// ─────────────────────────────────────────

export function reverseSync(
  prdText: string,
  epicsText: string,
  existingDocs: SpecDocument[],
  config: SpecSyncConfig,
): SyncResult {
  const warnings: string[] = [];
  const reqs = parsePrdReqs(prdText);
  if (reqs.length === 0) {
    warnings.push('No REQ-NNN blocks found in PRD; nothing to sync.');
  }

  const tracks = parseEpicsTracks(epicsText);

  // Group REQs by inferred domain
  const byDomain = new Map<string, ParsedReq[]>();
  for (const req of reqs) {
    const domain = inferDomainFromReq(req, tracks);
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain)!.push(req);
  }

  const writes: WriteAction[] = [];
  for (const [domain, domainReqs] of byDomain) {
    const newDoc = prdToSpecDocument(domainReqs, domain);

    // Merge with existing doc (preserve hand-edited requirements with non-matching IDs)
    const existing = existingDocs.find(d => d.domain === domain);
    const merged = existing ? mergeSpecDocs(existing, newDoc) : newDoc;

    const filePath = join(config.specsDir, domain, 'spec.md');
    const content = formatSpecDoc(merged);
    const action: WriteAction['action'] = existing ? 'update' : 'create';
    writes.push({ path: filePath, content, action });
  }

  return { direction: 'reverse', writes, warnings };
}

function mergeSpecDocs(existing: SpecDocument, incoming: SpecDocument): SpecDocument {
  // Index incoming by ID (only those with IDs)
  const incomingById = new Map<string, SpecRequirement>();
  const incomingNoId: SpecRequirement[] = [];
  for (const r of incoming.requirements) {
    if (r.id) incomingById.set(r.id, r);
    else incomingNoId.push(r);
  }

  const merged: SpecRequirement[] = [];
  const seenIds = new Set<string>();

  // Walk existing: replace if matching ID in incoming, else preserve as-is
  for (const r of existing.requirements) {
    if (r.id && incomingById.has(r.id)) {
      merged.push(incomingById.get(r.id)!);
      seenIds.add(r.id);
    } else {
      merged.push(r); // preserve hand-edited or unmatched
    }
  }

  // Append incoming requirements not yet merged (sorted by ID for stability)
  const remaining = [...incomingById.values()]
    .filter(r => !seenIds.has(r.id!))
    .sort((a, b) => (a.id! < b.id! ? -1 : 1));
  merged.push(...remaining);
  merged.push(...incomingNoId);

  return { domain: incoming.domain, version: existing.version || 1, requirements: merged };
}

// ─────────────────────────────────────────
// Sync: forward (specs/ -> PRD)
// ─────────────────────────────────────────

export function forwardSync(
  docs: SpecDocument[],
  prdText: string,
  prdPath: string,
  config: SpecSyncConfig,
): SyncResult {
  const warnings: string[] = [];
  if (!config.sourceOfTruth) {
    warnings.push(
      'Forward sync (specs/ -> PRD) requires [specs] source_of_truth = true. ' +
        'Current value is false; PRD remains the canonical source. Skipping.',
    );
    return { direction: 'forward', writes: [], warnings };
  }

  // Build managed block content from all spec docs
  const reqBlocks = docs.map(specToPrdRequirements).filter(s => s.trim()).join('\n');
  if (!reqBlocks.trim()) {
    warnings.push('No requirements with stable IDs found in specs/; PRD unchanged.');
    return { direction: 'forward', writes: [], warnings };
  }

  const startMarker = `<!-- ${config.managedRegionMarker}:start -->`;
  const endMarker = `<!-- ${config.managedRegionMarker}:end -->`;
  const managedBlock = `${startMarker}\n${reqBlocks}\n${endMarker}`;

  // Locate PRD's `## 2. Functional Requirements` section by finding the next
  // `## ` heading (or EOF) as the boundary. We avoid regex lookahead because
  // JS `m` flag makes `$` match every line end.
  const sectionStartRegex = /^##\s+2\.\s+Functional Requirements\s*$/m;
  const startMatch = prdText.match(sectionStartRegex);
  if (!startMatch) {
    warnings.push(
      "Could not locate '## 2. Functional Requirements' section in PRD. " +
        'Append a managed block manually or restructure PRD.',
    );
    return { direction: 'forward', writes: [], warnings };
  }

  const headingEnd = startMatch.index! + startMatch[0].length;
  // Find next top-level heading after the section start
  const rest = prdText.slice(headingEnd);
  const nextHeadingMatch = rest.match(/\n##\s/m);
  const bodyEnd = nextHeadingMatch
    ? headingEnd + nextHeadingMatch.index! + 1 // +1 to keep the `\n` before next heading
    : prdText.length;

  const newSection = `${startMatch[0]}\n${managedBlock}\n`;
  const newPrd = prdText.slice(0, startMatch.index!) + newSection + prdText.slice(bodyEnd);

  return {
    direction: 'forward',
    writes: [{ path: prdPath, content: newPrd, action: 'update' }],
    warnings,
  };
}

// ─────────────────────────────────────────
// Serialization (canonical, byte-stable)
// ─────────────────────────────────────────

export function formatSpecDoc(doc: SpecDocument): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push('artifact_type: spec');
  lines.push(`domain: ${doc.domain}`);
  lines.push(`version: ${doc.version}`);
  lines.push('---');
  lines.push('');
  lines.push(`# Spec — ${toTitleCase(doc.domain)}`);
  lines.push('');

  // Sort requirements by ID ascending; requirements without IDs sort last
  const sorted = [...doc.requirements].sort((a, b) => {
    if (a.id && b.id) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    if (a.id && !b.id) return -1;
    if (!a.id && b.id) return 1;
    return a.name.localeCompare(b.name);
  });

  sorted.forEach((req, idx) => {
    lines.push(`## Requirement: ${req.name}`);
    if (req.id) lines.push(`- id: ${req.id}`);
    if (req.priority) lines.push(`- priority: ${req.priority}`);
    if (req.description) lines.push(`- description: ${req.description}`);
    if (!req.id && !req.priority && !req.description) {
      // Ensure at least one metadata line for parser stability
      lines.push(`- id:`);
    }
    lines.push('');

    req.scenarios.forEach((s, sIdx) => {
      const name = s.name || `Scenario ${sIdx + 1}`;
      lines.push(`GIVEN ${s.given.join(' and ')}`);
      lines.push(`WHEN ${s.when.join(' and ')}`);
      lines.push(`THEN ${s.then.join(' and ')}`);
      if (sIdx < req.scenarios.length - 1) lines.push('');
    });

    if (idx < sorted.length - 1) lines.push('');
  });

  lines.push(''); // trailing newline
  return lines.join('\n');
}

// ─────────────────────────────────────────
// Validation
// ─────────────────────────────────────────

export function validateSpec(doc: SpecDocument): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!DOMAIN_PATTERN.test(doc.domain)) {
    errors.push({
      ruleId: 'domain_name_format',
      severity: 'error',
      message: `Domain "${doc.domain}" does not match pattern ^[a-z][a-z0-9-]{1,30}$`,
    });
  }

  const names = new Set<string>();
  const ids = new Set<string>();
  for (const req of doc.requirements) {
    if (names.has(req.name)) {
      errors.push({
        ruleId: 'requirement_name_unique',
        severity: 'error',
        message: `Duplicate requirement name: "${req.name}"`,
      });
    }
    names.add(req.name);

    if (!/^[A-Z][A-Za-z0-9 _-]{2,80}$/.test(req.name)) {
      errors.push({
        ruleId: 'requirement_name_format',
        severity: 'error',
        message: `Requirement name "${req.name}" does not match pattern ^[A-Z][A-Za-z0-9 _-]{2,80}$`,
      });
    }

    if (req.id) {
      if (!REQ_ID_PATTERN.test(req.id)) {
        errors.push({
          ruleId: 'id_format',
          severity: 'error',
          message: `Requirement id "${req.id}" does not match pattern REQ-NNN`,
        });
      }
      if (ids.has(req.id)) {
        errors.push({
          ruleId: 'id_unique_within_domain',
          severity: 'error',
          message: `Duplicate requirement id: ${req.id}`,
        });
      }
      ids.add(req.id);
    }

    if (!req.scenarios || req.scenarios.length === 0) {
      errors.push({
        ruleId: 'requirement_has_scenario',
        severity: 'error',
        message: `Requirement "${req.name}" has no scenarios`,
      });
      continue;
    }

    req.scenarios.forEach((s, idx) => {
      const path = `${req.name}.scenarios[${idx}]`;
      if (s.given.length === 0) {
        errors.push({
          ruleId: 'scenario_blocks_nonempty',
          severity: 'error',
          message: `Scenario ${idx + 1} GIVEN block is empty`,
          path,
        });
      }
      if (s.when.length === 0) {
        errors.push({
          ruleId: 'scenario_blocks_nonempty',
          severity: 'error',
          message: `Scenario ${idx + 1} WHEN block is empty`,
          path,
        });
      }
      if (s.then.length === 0) {
        errors.push({
          ruleId: 'scenario_blocks_nonempty',
          severity: 'error',
          message: `Scenario ${idx + 1} THEN block is empty`,
          path,
        });
      } else {
        if (!RFC2119_PATTERN.test(s.then.join(' '))) {
          errors.push({
            ruleId: 'scenario_then_rfc2119',
            severity: 'error',
            message: `Scenario ${idx + 1} THEN must contain RFC 2119 keyword (MUST/SHALL/WILL/SHOULD/EXPECTED)`,
            path,
          });
        }
      }

      const allLines = [...s.given, ...s.when, ...s.then];
      for (const line of allLines) {
        if (PLACEHOLDER_PATTERN.test(line)) {
          errors.push({
            ruleId: 'no_placeholder_tokens',
            severity: 'error',
            message: `Placeholder token detected in: "${line}"`,
            path,
          });
        }
      }
    });
  }

  return errors;
}

// ─────────────────────────────────────────
// I/O wrapper
// ─────────────────────────────────────────

export function applySync(result: SyncResult, dryRun: boolean): {
  applied: WriteAction[];
  skipped: WriteAction[];
} {
  const applied: WriteAction[] = [];
  const skipped: WriteAction[] = [];

  for (const w of result.writes) {
    if (w.action === 'noop') {
      skipped.push(w);
      continue;
    }
    if (dryRun) {
      skipped.push(w);
      continue;
    }

    mkdirSync(dirname(w.path), { recursive: true });
    const tmpPath = `${w.path}.tmp`;
    writeFileSync(tmpPath, w.content, 'utf8');
    renameSync(tmpPath, w.path);
    applied.push(w);
  }

  return { applied, skipped };
}

export function loadSpecDocs(specsDir: string): SpecDocument[] {
  if (!existsSync(specsDir)) return [];
  const docs: SpecDocument[] = [];
  for (const entry of readdirSync(specsDir)) {
    const specPath = join(specsDir, entry, 'spec.md');
    if (!existsSync(specPath)) continue;
    const md = readFileSync(specPath, 'utf8');
    docs.push(parseSpecDoc(md, entry));
  }
  return docs;
}

export function scaffoldEmptySpec(domain: string, specsDir: string): WriteAction {
  const doc: SpecDocument = {
    domain,
    version: 1,
    requirements: [],
  };
  const filePath = join(specsDir, domain, 'spec.md');
  const content = formatSpecDoc(doc);
  return { path: filePath, content, action: existsSync(filePath) ? 'update' : 'create' };
}

export function listDomains(specsDir: string, epicsText: string): string[] {
  const fromDisk = existsSync(specsDir)
    ? readdirSync(specsDir).filter(e => existsSync(join(specsDir, e, 'spec.md')))
    : [];
  const fromEpics = parseEpicsTracks(epicsText);
  const merged = new Set<string>([...fromDisk, ...fromEpics]);
  return [...merged].sort();
}

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

function parseFrontmatter(md: string): Record<string, unknown> {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const result: Record<string, unknown> = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+?)\s*$/);
    if (!kv) continue;
    const [, k, v] = kv;
    if (v === 'true') result[k] = true;
    else if (v === 'false') result[k] = false;
    else if (/^-?\d+$/.test(v)) result[k] = Number(v);
    else result[k] = v.replace(/^"(.*)"$/, '$1');
  }
  return result;
}

function stripFrontmatter(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n?/, '');
}

function splitOnHeading(text: string, headingRegex: RegExp): string[] {
  // Find all heading positions and return content between them
  const indices: number[] = [];
  const re = new RegExp(headingRegex.source, headingRegex.flags.includes('g') ? headingRegex.flags : headingRegex.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Find start of the line containing the heading
    let lineStart = m.index;
    while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart--;
    indices.push(lineStart);
  }
  if (indices.length === 0) return [];
  const blocks: string[] = [];
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1] : text.length;
    blocks.push(text.slice(start, end));
  }
  return blocks;
}

function toTitleCase(s: string): string {
  const trimmed = s.trim();
  // Already SHOUTING_CASE → leave as-is
  if (/^[A-Z][A-Z0-9 _-]+$/.test(trimmed)) return trimmed;
  // Title Case: first letter of each word uppercase
  return trimmed.replace(/\b\w/g, c => c.toUpperCase());
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
