import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseSpecDoc,
  parsePrdReqs,
  parseEpicsTracks,
  inferDomainFromReq,
  prdToSpecDocument,
  formatSpecDoc,
  validateSpec,
  forwardSync,
  reverseSync,
  applySync,
  type SpecDocument,
  type SpecRequirement,
  type ParsedReq,
  type SpecSyncConfig,
} from './spec-sync.js';

// ─────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────

const DEMO_PRD = `---
artifact_type: prd
phase: 2
sub_phase: 2_5
status: LOCKED
---

# PRD — Demo

## 2. Functional Requirements

### REQ-001: User Registration

**Priority:** P0
**Domain:** auth
**Description:** A visitor can register.

**Acceptance Criteria:**
AC1: The system MUST create a user record when a visitor submits valid credentials
AC2: The system MUST reject duplicate emails with a 409 response

### REQ-002: Todo Creation

**Priority:** P0
**Domain:** todos
**Description:** A user can create a todo.

**Acceptance Criteria:**
AC1: The system MUST persist the todo with title and owner
AC2: The system MUST reject empty titles with a 422 response

### REQ-003: Audit Logging

**Priority:** P2
**Description:** Cross-cutting audit hook.

**Acceptance Criteria:**
AC1: The system MUST log every state-changing request
`;

const DEMO_EPICS = `# Epics

## EPIC-AUTH: Authentication

- **S-AUTH-01**: Register endpoint (REQ-001)

## EPIC-TODO: Todos

- **S-TODO-01**: Create endpoint (REQ-002)
`;

function makeConfig(specsDir: string, sourceOfTruth = false): SpecSyncConfig {
  return {
    specsDir,
    sourceOfTruth,
    managedRegionMarker: 'wdf:specs-sync',
    enforceUniqueRequirementNames: true,
  };
}

const VALID_SPEC_MD = `---
artifact_type: spec
domain: auth
version: 1
---

# Spec — Auth

## Requirement: User Registration
- id: REQ-001
- priority: P0

GIVEN a visitor with a valid email and a password of length >= 8
WHEN they submit the registration form
THEN the system MUST create the user record and set session cookies

GIVEN a visitor with an already-registered email
WHEN they submit the registration form
THEN the system MUST respond 409 with message "email already registered"
`;

// ─────────────────────────────────────────
// Tests
// ─────────────────────────────────────────

describe('parseSpecDoc', () => {
  it('extracts requirement with 2 scenarios, all G/W/T non-empty', () => {
    const doc = parseSpecDoc(VALID_SPEC_MD, 'auth');
    expect(doc.domain).toBe('auth');
    expect(doc.version).toBe(1);
    expect(doc.requirements).toHaveLength(1);

    const req = doc.requirements[0];
    expect(req.id).toBe('REQ-001');
    expect(req.priority).toBe('P0');
    expect(req.name).toBe('User Registration');
    expect(req.scenarios).toHaveLength(2);

    const s1 = req.scenarios[0];
    expect(s1.given.length).toBeGreaterThan(0);
    expect(s1.when.length).toBeGreaterThan(0);
    expect(s1.then.length).toBeGreaterThan(0);
    expect(s1.then.join(' ')).toMatch(/\bMUST\b/);
  });

  it('parses multiple requirements in order', () => {
    const md = `${VALID_SPEC_MD}
## Requirement: Login
- id: REQ-002
- priority: P0

GIVEN a registered user
WHEN they submit valid credentials
THEN the system MUST issue a session cookie
`;
    const doc = parseSpecDoc(md, 'auth');
    expect(doc.requirements).toHaveLength(2);
    expect(doc.requirements[0].id).toBe('REQ-001');
    expect(doc.requirements[1].id).toBe('REQ-002');
  });
});

describe('parsePrdReqs', () => {
  it('parses REQ blocks with priority, description, and ACs', () => {
    const reqs = parsePrdReqs(DEMO_PRD);
    expect(reqs).toHaveLength(3);
    expect(reqs[0].id).toBe('REQ-001');
    expect(reqs[0].title).toBe('User Registration');
    expect(reqs[0].priority).toBe('P0');
    expect(reqs[0].domain).toBe('auth');
    expect(reqs[0].acceptanceCriteria.length).toBe(2);
    expect(reqs[0].acceptanceCriteria[0]).toMatch(/create a user record/);
  });

  it('extracts REQ without explicit Domain field', () => {
    const reqs = parsePrdReqs(DEMO_PRD);
    const audit = reqs.find(r => r.id === 'REQ-003');
    expect(audit).toBeDefined();
    expect(audit!.domain).toBeUndefined();
  });
});

describe('parseEpicsTracks', () => {
  it('returns lowercase tracks from EPIC-XXX headings', () => {
    const tracks = parseEpicsTracks(DEMO_EPICS);
    expect(tracks).toEqual(['auth', 'todo']);
  });

  it('returns empty array when no epics headings', () => {
    expect(parseEpicsTracks('# Just a doc\nNo epics')).toEqual([]);
  });
});

describe('inferDomainFromReq', () => {
  it('uses explicit Domain field when present', () => {
    const req: ParsedReq = {
      id: 'REQ-001',
      title: 'Some Feature',
      domain: 'auth',
      acceptanceCriteria: [],
    };
    expect(inferDomainFromReq(req, [])).toBe('auth');
  });

  it('falls back to keyword matching from title', () => {
    const req: ParsedReq = {
      id: 'REQ-010',
      title: 'Login Flow',
      acceptanceCriteria: ['User authenticates with password'],
    };
    expect(inferDomainFromReq(req, ['auth'])).toBe('auth');
  });

  it('returns general bucket when no match', () => {
    const req: ParsedReq = {
      id: 'REQ-099',
      title: 'Miscellaneous Thing',
      acceptanceCriteria: ['Some unrelated behavior'],
    };
    expect(inferDomainFromReq(req, [])).toBe('general');
  });
});

describe('reverseSync', () => {
  let tmpRoot: string;
  let specsDir: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `wdf-spec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    specsDir = join(tmpRoot, '_wdf_output', 'specs');
    mkdirSync(specsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('produces specs for each discovered domain', () => {
    const result = reverseSync(DEMO_PRD, DEMO_EPICS, [], makeConfig(specsDir));
    const domains = result.writes.map(w => w.path.split('/').slice(-2, -1)[0]).sort();
    expect(domains).toEqual(['auth', 'general', 'todos']);
  });

  it('maps REQs to correct domains via explicit field', () => {
    const result = reverseSync(DEMO_PRD, DEMO_EPICS, [], makeConfig(specsDir));
    const authWrite = result.writes.find(w => w.path.includes('/auth/spec.md'));
    expect(authWrite).toBeDefined();
    const doc = parseSpecDoc(authWrite!.content, 'auth');
    const ids = doc.requirements.map(r => r.id);
    expect(ids).toContain('REQ-001');
    expect(ids).not.toContain('REQ-002'); // REQ-002 is todos
  });

  it('falls back to general bucket when no mapping found', () => {
    const result = reverseSync(DEMO_PRD, DEMO_EPICS, [], makeConfig(specsDir));
    const generalWrite = result.writes.find(w => w.path.includes('/general/spec.md'));
    expect(generalWrite).toBeDefined();
    const doc = parseSpecDoc(generalWrite!.content, 'general');
    const ids = doc.requirements.map(r => r.id);
    expect(ids).toContain('REQ-003');
  });

  it('preserves hand-edited requirements with non-matching IDs', () => {
    // Seed an existing spec with a hand-written REQ-999 that's not in PRD
    const existing: SpecDocument[] = [{
      domain: 'auth',
      version: 1,
      requirements: [{
        id: 'REQ-999',
        name: 'Handcrafted Logout',
        priority: 'P1',
        scenarios: [{
          given: ['a logged-in user'],
          when: ['they click logout'],
          then: ['the system MUST destroy the session'],
        }],
      }],
    }];

    const result = reverseSync(DEMO_PRD, DEMO_EPICS, existing, makeConfig(specsDir));
    const authWrite = result.writes.find(w => w.path.includes('/auth/spec.md'));
    expect(authWrite).toBeDefined();
    const doc = parseSpecDoc(authWrite!.content, 'auth');
    const ids = doc.requirements.map(r => r.id);
    expect(ids).toContain('REQ-001');   // from PRD
    expect(ids).toContain('REQ-999');   // preserved hand-edited
  });

  it('dry-run produces WritePlan with 0 disk writes', () => {
    const result = reverseSync(DEMO_PRD, DEMO_EPICS, [], makeConfig(specsDir));
    expect(result.writes.length).toBeGreaterThan(0);
    const { applied, skipped } = applySync(result, true); // dryRun=true
    expect(applied).toHaveLength(0);
    expect(skipped.length).toBe(result.writes.length);

    // Nothing on disk
    expect(existsSync(join(specsDir, 'auth', 'spec.md'))).toBe(false);
  });

  it('round-trip: formatSpecDoc → parseSpecDoc is stable', () => {
    const result = reverseSync(DEMO_PRD, DEMO_EPICS, [], makeConfig(specsDir));
    const authWrite = result.writes.find(w => w.path.includes('/auth/spec.md'))!;
    const reparsed = parseSpecDoc(authWrite.content, 'auth');
    const reformatted = formatSpecDoc(reparsed);
    expect(reformatted).toBe(authWrite.content);
  });
});

describe('forwardSync', () => {
  let tmpRoot: string;
  let specsDir: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `wdf-spec-fwd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    specsDir = join(tmpRoot, '_wdf_output', 'specs');
    mkdirSync(specsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('refuses to write PRD when source_of_truth = false', () => {
    const doc: SpecDocument = {
      domain: 'auth',
      version: 1,
      requirements: [{
        id: 'REQ-001', name: 'User Registration', priority: 'P0',
        scenarios: [{ given: ['x'], when: ['y'], then: ['the system MUST z'] }],
      }],
    };
    const result = forwardSync([doc], DEMO_PRD, '/tmp/prd.md', makeConfig(specsDir, false));
    expect(result.writes).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/source_of_truth/);
  });

  it('injects managed region when source_of_truth = true', () => {
    const doc: SpecDocument = {
      domain: 'auth',
      version: 1,
      requirements: [{
        id: 'REQ-001', name: 'User Registration', priority: 'P0',
        scenarios: [{ given: ['x'], when: ['y'], then: ['the system MUST z'] }],
      }],
    };
    const result = forwardSync([doc], DEMO_PRD, '/tmp/prd.md', makeConfig(specsDir, true));
    expect(result.writes).toHaveLength(1);
    expect(result.writes[0].content).toMatch(/wdf:specs-sync:start/);
    expect(result.writes[0].content).toMatch(/wdf:specs-sync:end/);
    expect(result.writes[0].content).toMatch(/REQ-001: User Registration/);
  });

  it('replaces existing managed region idempotently', () => {
    const doc: SpecDocument = {
      domain: 'auth',
      version: 1,
      requirements: [{
        id: 'REQ-001', name: 'User Registration', priority: 'P0',
        scenarios: [{ given: ['x'], when: ['y'], then: ['the system MUST z'] }],
      }],
    };
    const cfg = makeConfig(specsDir, true);
    const first = forwardSync([doc], DEMO_PRD, '/tmp/prd.md', cfg);
    const second = forwardSync([doc], first.writes[0].content, '/tmp/prd.md', cfg);
    // Second pass should produce identical content
    expect(second.writes[0].content).toBe(first.writes[0].content);
  });
});

describe('validateSpec', () => {
  const validDoc: SpecDocument = {
    domain: 'auth',
    version: 1,
    requirements: [{
      id: 'REQ-001', name: 'User Registration', priority: 'P0',
      scenarios: [{
        given: ['a visitor'],
        when: ['they submit the form'],
        then: ['the system MUST create the record'],
      }],
    }],
  };

  it('passes a valid doc', () => {
    expect(validateSpec(validDoc)).toEqual([]);
  });

  it('flags placeholder tokens (TODO/FIXME/xxx)', () => {
    const doc: SpecDocument = {
      domain: 'auth',
      version: 1,
      requirements: [{
        id: 'REQ-002', name: 'Incomplete Flow',
        scenarios: [{
          given: ['a TODO'],
          when: ['user does something'],
          then: ['the system MUST respond'],
        }],
      }],
    };
    const errors = validateSpec(doc);
    expect(errors.some(e => e.ruleId === 'no_placeholder_tokens')).toBe(true);
  });

  it('flags missing RFC 2119 keyword in THEN', () => {
    const doc: SpecDocument = {
      domain: 'auth',
      version: 1,
      requirements: [{
        id: 'REQ-003', name: 'Weak Outcome',
        scenarios: [{
          given: ['x'],
          when: ['y'],
          then: ['some outcome without keyword'],
        }],
      }],
    };
    const errors = validateSpec(doc);
    expect(errors.some(e => e.ruleId === 'scenario_then_rfc2119')).toBe(true);
  });

  it('flags duplicate requirement names', () => {
    const doc: SpecDocument = {
      domain: 'auth',
      version: 1,
      requirements: [
        { id: 'REQ-001', name: 'Duplicate', scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }] },
        { id: 'REQ-002', name: 'Duplicate', scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }] },
      ],
    };
    const errors = validateSpec(doc);
    expect(errors.some(e => e.ruleId === 'requirement_name_unique')).toBe(true);
  });

  it('flags empty scenario blocks', () => {
    const doc: SpecDocument = {
      domain: 'auth',
      version: 1,
      requirements: [{
        id: 'REQ-004', name: 'Empty Scenario',
        scenarios: [{ given: [], when: [], then: [] }],
      }],
    };
    const errors = validateSpec(doc);
    expect(errors.filter(e => e.ruleId === 'scenario_blocks_nonempty').length).toBeGreaterThanOrEqual(3);
  });
});

describe('formatSpecDoc canonicalization', () => {
  it('sorts requirements by ID ascending', () => {
    const doc: SpecDocument = {
      domain: 'auth',
      version: 1,
      requirements: [
        { id: 'REQ-003', name: 'C Requirement', scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }] },
        { id: 'REQ-001', name: 'A Requirement', scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }] },
        { id: 'REQ-002', name: 'B Requirement', scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }] },
      ],
    };
    const out = formatSpecDoc(doc);
    const idx1 = out.indexOf('REQ-001');
    const idx2 = out.indexOf('REQ-002');
    const idx3 = out.indexOf('REQ-003');
    expect(idx1).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idx3);
  });

  it('round-trip is byte-stable on canonical input', () => {
    const doc = parseSpecDoc(VALID_SPEC_MD, 'auth');
    const out = formatSpecDoc(doc);
    const reparsed = parseSpecDoc(out, 'auth');
    const reformatted = formatSpecDoc(reparsed);
    expect(reformatted).toBe(out);
  });
});

describe('prdToSpecDocument', () => {
  it('filters REQs by inferred domain', () => {
    const reqs = parsePrdReqs(DEMO_PRD);
    const authDoc = prdToSpecDocument(reqs, 'auth');
    expect(authDoc.domain).toBe('auth');
    expect(authDoc.requirements.every(r => r.id !== 'REQ-002')).toBe(true); // todos
  });

  it('synthesizes RFC 2119 keyword when AC lacks one', () => {
    const reqs: ParsedReq[] = [{
      id: 'REQ-099',
      title: 'Miscellaneous Widget',
      acceptanceCriteria: ['responds with a friendly greeting message'],
    }];
    const doc = prdToSpecDocument(reqs, 'general');
    expect(doc.requirements.length).toBeGreaterThan(0);
    const thenText = doc.requirements[0].scenarios[0].then.join(' ');
    expect(thenText).toMatch(/\bMUST\b/);
  });
});
