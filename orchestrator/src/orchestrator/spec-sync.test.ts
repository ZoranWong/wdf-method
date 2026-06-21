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
  forwardSyncApiSpec,
  forwardSyncDbSchema,
  reverseSync,
  reverseSyncFromApiSpec,
  applySync,
  specToOpenApi,
  specToDbSchema,
  openApiToSpecDocuments,
  inferDomainFromPath,
  type SpecDocument,
  type SpecRequirement,
  type Endpoint,
  type Entity,
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

// ─────────────────────────────────────────
// CHG-2026-015 S3 — Structural fields (endpoints + entities)
// ─────────────────────────────────────────

const SPEC_WITH_STRUCT = `---
artifact_type: spec
domain: auth
version: 1
---

# Spec — Auth

## Requirement: User Registration
- id: REQ-001
- priority: P0

GIVEN a visitor with valid credentials
WHEN they submit the registration form
THEN the system MUST create the user record

### Endpoints
- POST /auth/register
  - operationId: registerUser
  - request: RegisterInput
  - response: 201 User

### Entities
- User
  - id: UUID pk
  - email: TEXT unique not_null
  - password_hash: TEXT not_null
`;

describe('CHG-2026-015 S3 — parseSpecDoc structural fields', () => {
  it('extracts endpoints from ### Endpoints subsection', () => {
    const doc = parseSpecDoc(SPEC_WITH_STRUCT, 'auth');
    expect(doc.requirements).toHaveLength(1);
    const req = doc.requirements[0];
    expect(req.endpoints).toBeDefined();
    expect(req.endpoints).toHaveLength(1);
    const ep = req.endpoints![0];
    expect(ep.method).toBe('POST');
    expect(ep.path).toBe('/auth/register');
    expect(ep.operationId).toBe('registerUser');
    expect(ep.request).toBe('RegisterInput');
    expect(ep.response).toBe('201 User');
  });

  it('extracts entities from ### Entities subsection', () => {
    const doc = parseSpecDoc(SPEC_WITH_STRUCT, 'auth');
    const req = doc.requirements[0];
    expect(req.entities).toBeDefined();
    expect(req.entities).toHaveLength(1);
    const ent = req.entities![0];
    expect(ent.name).toBe('User');
    expect(ent.fields).toHaveLength(3);
    expect(ent.fields[0]).toEqual({ name: 'id', type: 'UUID', constraints: ['pk'] });
    expect(ent.fields[1]).toEqual({ name: 'email', type: 'TEXT', constraints: ['unique', 'not_null'] });
  });

  it('omits endpoints/entities arrays when subsections absent', () => {
    const doc = parseSpecDoc(VALID_SPEC_MD, 'auth');
    expect(doc.requirements[0].endpoints).toBeUndefined();
    expect(doc.requirements[0].entities).toBeUndefined();
  });

  it('scenarios still parse correctly alongside structural subsections', () => {
    const doc = parseSpecDoc(SPEC_WITH_STRUCT, 'auth');
    expect(doc.requirements[0].scenarios).toHaveLength(1);
    expect(doc.requirements[0].scenarios[0].then.join(' ')).toMatch(/\bMUST\b/);
  });
});

describe('CHG-2026-015 S3 — formatSpecDoc round-trip with structural fields', () => {
  it('serializes endpoints and entities idempotently', () => {
    const doc = parseSpecDoc(SPEC_WITH_STRUCT, 'auth');
    const out = formatSpecDoc(doc);
    const reparsed = parseSpecDoc(out, 'auth');
    const reformatted = formatSpecDoc(reparsed);
    expect(reformatted).toBe(out);
  });

  it('emits ### Endpoints and ### Entities subsections in canonical order', () => {
    const doc = parseSpecDoc(SPEC_WITH_STRUCT, 'auth');
    const out = formatSpecDoc(doc);
    const scenariosIdx = out.indexOf('THEN ');
    const endpointsIdx = out.indexOf('### Endpoints');
    const entitiesIdx = out.indexOf('### Entities');
    expect(scenariosIdx).toBeGreaterThan(-1);
    expect(endpointsIdx).toBeGreaterThan(scenariosIdx);
    expect(entitiesIdx).toBeGreaterThan(endpointsIdx);
  });
});

describe('CHG-2026-015 S3 — validateSpec for structural fields', () => {
  const baseDoc: SpecDocument = {
    domain: 'auth',
    version: 1,
    requirements: [{
      id: 'REQ-001', name: 'User Registration',
      scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }],
    }],
  };

  it('flags endpoint path not starting with /', () => {
    const doc: SpecDocument = {
      ...baseDoc,
      requirements: [{
        ...baseDoc.requirements[0],
        endpoints: [{ method: 'POST', path: 'auth/register', operationId: 'registerUser' }],
      }],
    };
    const errors = validateSpec(doc);
    expect(errors.some(e => e.ruleId === 'endpoint_path_format')).toBe(true);
  });

  it('flags endpoint operationId not camelCase', () => {
    const doc: SpecDocument = {
      ...baseDoc,
      requirements: [{
        ...baseDoc.requirements[0],
        endpoints: [{ method: 'POST', path: '/auth/register', operationId: 'RegisterUser' }],
      }],
    };
    const errors = validateSpec(doc);
    expect(errors.some(e => e.ruleId === 'endpoint_operationId_format')).toBe(true);
  });

  it('flags conflicting entity definitions with same name', () => {
    const doc: SpecDocument = {
      domain: 'auth',
      version: 1,
      requirements: [
        {
          id: 'REQ-001', name: 'Create User',
          scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }],
          entities: [{ name: 'User', fields: [{ name: 'id', type: 'UUID', constraints: ['pk'] }] }],
        },
        {
          id: 'REQ-002', name: 'Read User',
          scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }],
          entities: [{ name: 'User', fields: [{ name: 'id', type: 'TEXT', constraints: ['pk'] }] }],
        },
      ],
    };
    const errors = validateSpec(doc);
    expect(errors.some(e => e.ruleId === 'entity_name_unique_within_domain')).toBe(true);
  });

  it('accepts identical entity definitions across requirements', () => {
    const ent: Entity = { name: 'User', fields: [{ name: 'id', type: 'UUID', constraints: ['pk'] }] };
    const doc: SpecDocument = {
      domain: 'auth',
      version: 1,
      requirements: [
        { id: 'REQ-001', name: 'Create User', scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }], entities: [ent] },
        { id: 'REQ-002', name: 'Read User', scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }], entities: [ent] },
      ],
    };
    const errors = validateSpec(doc);
    expect(errors.filter(e => e.ruleId === 'entity_name_unique_within_domain')).toHaveLength(0);
  });

  it('flags unknown entity field type', () => {
    const doc: SpecDocument = {
      ...baseDoc,
      requirements: [{
        ...baseDoc.requirements[0],
        entities: [{ name: 'Widget', fields: [{ name: 'data', type: 'BLOB', constraints: [] }] }],
      }],
    };
    const errors = validateSpec(doc);
    expect(errors.some(e => e.ruleId === 'entity_field_type_known')).toBe(true);
  });

  it('accepts valid endpoints + entities', () => {
    const doc: SpecDocument = {
      ...baseDoc,
      requirements: [{
        ...baseDoc.requirements[0],
        endpoints: [{ method: 'POST', path: '/users', operationId: 'createUser', response: '201 User' }],
        entities: [{ name: 'User', fields: [{ name: 'id', type: 'UUID', constraints: ['pk'] }] }],
      }],
    };
    expect(validateSpec(doc)).toEqual([]);
  });
});

describe('CHG-2026-015 S3 — specToOpenApi derivation', () => {
  it('emits paths grouped by URL with merged methods', () => {
    const docs: SpecDocument[] = [{
      domain: 'todos',
      version: 1,
      requirements: [
        {
          id: 'REQ-001', name: 'Create Todo',
          scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }],
          endpoints: [{ method: 'POST', path: '/todos', operationId: 'createTodo', response: '201 Todo' }],
        },
        {
          id: 'REQ-002', name: 'List Todos',
          scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }],
          endpoints: [{ method: 'GET', path: '/todos', operationId: 'listTodos', response: '200 TodoList' }],
        },
      ],
    }];
    const out = specToOpenApi(docs);
    expect(out).toMatch(/^paths:/);
    expect(out).toMatch(/\/todos:/);
    expect(out).toMatch(/post:/);
    expect(out).toMatch(/get:/);
    expect(out).toMatch(/operationId: createTodo/);
    expect(out).toMatch(/operationId: listTodos/);
  });

  it('emits components.schemas with one entry per unique entity', () => {
    const docs: SpecDocument[] = [{
      domain: 'auth',
      version: 1,
      requirements: [{
        id: 'REQ-001', name: 'User Registration',
        scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }],
        entities: [{
          name: 'User',
          fields: [
            { name: 'id', type: 'UUID', constraints: ['pk'] },
            { name: 'email', type: 'TEXT', constraints: ['unique'] },
          ],
        }],
      }],
    }];
    const out = specToOpenApi(docs);
    expect(out).toMatch(/components:/);
    expect(out).toMatch(/schemas:/);
    expect(out).toMatch(/User:/);
    expect(out).toMatch(/type: object/);
    expect(out).toMatch(/id:/);
    expect(out).toMatch(/email:/);
  });
});

describe('CHG-2026-015 S3 — specToDbSchema derivation', () => {
  it('emits CREATE TABLE per entity with column table', () => {
    const docs: SpecDocument[] = [{
      domain: 'todos',
      version: 1,
      requirements: [{
        id: 'REQ-001', name: 'Create Todo',
        scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }],
        entities: [{
          name: 'Todo',
          fields: [
            { name: 'id', type: 'UUID', constraints: ['pk'] },
            { name: 'title', type: 'TEXT', constraints: ['not_null'] },
          ],
        }],
      }],
    }];
    const out = specToDbSchema(docs);
    expect(out).toMatch(/^## Tables/);
    expect(out).toMatch(/### Table: Todo/);
    expect(out).toMatch(/CREATE TABLE todo \(/);
    expect(out).toMatch(/id UUID PK/);
    expect(out).toMatch(/title TEXT NOT_NULL/);
    expect(out).toMatch(/\| id \| UUID \| pk \|/);
  });
});

describe('CHG-2026-015 S3 — forwardSyncApiSpec + forwardSyncDbSchema', () => {
  const cfg: SpecSyncConfig = {
    specsDir: '/tmp/specs',
    sourceOfTruth: true,
    managedRegionMarker: 'wdf:specs-sync',
    enforceUniqueRequirementNames: true,
  };

  const docs: SpecDocument[] = [{
    domain: 'auth',
    version: 1,
    requirements: [{
      id: 'REQ-001', name: 'User Registration',
      scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }],
      endpoints: [{ method: 'POST', path: '/auth/register', operationId: 'registerUser', response: '201 User' }],
      entities: [{ name: 'User', fields: [{ name: 'id', type: 'UUID', constraints: ['pk'] }] }],
    }],
  }];

  it('refuses to write when source_of_truth=false', () => {
    const result = forwardSyncApiSpec(docs, 'openapi: 3.0.3\n', '/tmp/api.yaml', { ...cfg, sourceOfTruth: false });
    expect(result.writes).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/source_of_truth/);
  });

  it('silently no-ops when no endpoints/entities present (behavioral-only specs are valid)', () => {
    const noStructDocs: SpecDocument[] = [{
      domain: 'auth', version: 1,
      requirements: [{ id: 'REQ-001', name: 'X', scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }] }],
    }];
    const result = forwardSyncApiSpec(noStructDocs, 'openapi: 3.0.3\n', '/tmp/api.yaml', cfg);
    expect(result.writes).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('inserts managed YAML block on first sync', () => {
    const apiText = `openapi: 3.0.3\ninfo:\n  title: x\n  version: '1'\n`;
    const result = forwardSyncApiSpec(docs, apiText, '/tmp/api.yaml', cfg);
    expect(result.writes).toHaveLength(1);
    const content = result.writes[0].content;
    expect(content).toMatch(/# wdf:specs-sync:start/);
    expect(content).toMatch(/# wdf:specs-sync:end/);
    expect(content).toMatch(/operationId: registerUser/);
    // Hand-authored content preserved
    expect(content).toMatch(/title: x/);
  });

  it('replaces existing managed YAML block idempotently', () => {
    const apiText = `openapi: 3.0.3\n# wdf:specs-sync:start\n# (old)\n# wdf:specs-sync:end\n`;
    const first = forwardSyncApiSpec(docs, apiText, '/tmp/api.yaml', cfg);
    const second = forwardSyncApiSpec(docs, first.writes[0].content, '/tmp/api.yaml', cfg);
    expect(second.writes[0].content).toBe(first.writes[0].content);
  });

  it('forwardSyncDbSchema inserts managed HTML block', () => {
    const dbText = `# DB Schema\n\n## Performance notes\nhand-authored\n`;
    const result = forwardSyncDbSchema(docs, dbText, '/tmp/db.md', cfg);
    expect(result.writes).toHaveLength(1);
    const content = result.writes[0].content;
    expect(content).toMatch(/<!-- wdf:specs-sync:start -->/);
    expect(content).toMatch(/<!-- wdf:specs-sync:end -->/);
    expect(content).toMatch(/### Table: User/);
    // Hand-authored preserved
    expect(content).toMatch(/## Performance notes/);
  });

  it('forwardSyncDbSchema replaces existing managed block idempotently', () => {
    const dbText = `# DB Schema\n\n<!-- wdf:specs-sync:start -->\n## Tables\n\n(old)\n<!-- wdf:specs-sync:end -->\n`;
    const first = forwardSyncDbSchema(docs, dbText, '/tmp/db.md', cfg);
    const second = forwardSyncDbSchema(docs, first.writes[0].content, '/tmp/db.md', cfg);
    expect(second.writes[0].content).toBe(first.writes[0].content);
  });
});

// ─────────────────────────────────────────
// CHG-2026-015 S4 — OpenAPI → specs bootstrap
// ─────────────────────────────────────────

const OPENAPI_FIXTURE = `
openapi: 3.0.3
info:
  title: t
  version: 0.1.0
paths:
  /auth/register:
    post:
      operationId: registerUser
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/RegisterInput'
      responses:
        '201':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
  /todos:
    get:
      operationId: listTodos
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Todo'
components:
  schemas:
    User:
      type: object
      required: [id, email]
      properties:
        id: { type: string, format: uuid }
        email: { type: string }
        created_at: { type: string, format: date-time }
    RegisterInput:
      type: object
      required: [email]
      properties:
        email: { type: string }
        password: { type: string }
    Todo:
      type: object
      properties:
        id: { type: string, format: uuid }
        title: { type: string }
        completed: { type: boolean }
`;

describe('CHG-2026-015 S4 — inferDomainFromPath', () => {
  it('extracts first path segment', () => {
    expect(inferDomainFromPath('/auth/register')).toBe('auth');
    expect(inferDomainFromPath('/todos/{id}')).toBe('todos');
  });

  it('returns "general" for parameter-only or root paths', () => {
    expect(inferDomainFromPath('/{id}')).toBe('general');
    expect(inferDomainFromPath('/')).toBe('general');
    expect(inferDomainFromPath('')).toBe('general');
  });
});

describe('CHG-2026-015 S4 — openApiToSpecDocuments', () => {
  it('produces one SpecDocument per path prefix', () => {
    const docs = openApiToSpecDocuments(OPENAPI_FIXTURE);
    const domains = docs.map(d => d.domain).sort();
    expect(domains).toEqual(['auth', 'todos']);
  });

  it('creates one requirement per (path, method) pair with proper Endpoint', () => {
    const docs = openApiToSpecDocuments(OPENAPI_FIXTURE);
    const auth = docs.find(d => d.domain === 'auth')!;
    expect(auth.requirements).toHaveLength(1);
    const req = auth.requirements[0];
    expect(req.name).toBe('POST /auth/register');
    expect(req.endpoints).toBeDefined();
    expect(req.endpoints![0]).toEqual({
      method: 'POST',
      path: '/auth/register',
      operationId: 'registerUser',
      request: 'RegisterInput',
      response: '201 User',
    });
  });

  it('attaches schemas as Entities on the first referencing requirement', () => {
    const docs = openApiToSpecDocuments(OPENAPI_FIXTURE);
    const auth = docs.find(d => d.domain === 'auth')!;
    const entities = auth.requirements[0].entities!;
    const names = entities.map(e => e.name);
    expect(names).toContain('RegisterInput');
    expect(names).toContain('User');
  });

  it('maps property types correctly (uuid → UUID, date-time → TIMESTAMP, boolean → BOOLEAN)', () => {
    const docs = openApiToSpecDocuments(OPENAPI_FIXTURE);
    const auth = docs.find(d => d.domain === 'auth')!;
    const user = auth.requirements[0].entities!.find(e => e.name === 'User')!;
    const fields = Object.fromEntries(user.fields.map(f => [f.name, f.type]));
    expect(fields['id']).toBe('UUID');
    expect(fields['email']).toBe('TEXT');
    expect(fields['created_at']).toBe('TIMESTAMP');

    const todos = docs.find(d => d.domain === 'todos')!;
    const todo = todos.requirements[0].entities!.find(e => e.name === 'Todo')!;
    const todoFields = Object.fromEntries(todo.fields.map(f => [f.name, f.type]));
    expect(todoFields['completed']).toBe('BOOLEAN');
  });

  it('adds not_null constraint to required properties', () => {
    const docs = openApiToSpecDocuments(OPENAPI_FIXTURE);
    const auth = docs.find(d => d.domain === 'auth')!;
    const user = auth.requirements[0].entities!.find(e => e.name === 'User')!;
    const id = user.fields.find(f => f.name === 'id')!;
    expect(id.constraints).toContain('not_null');
    const createdAt = user.fields.find(f => f.name === 'created_at')!;
    expect(createdAt.constraints).toEqual([]);
  });

  it('falls back to "METHOD /path" requirement name when operationId missing', () => {
    const noOpId = `
openapi: 3.0.3
paths:
  /things:
    get:
      responses:
        '200':
          description: ok
`;
    const docs = openApiToSpecDocuments(noOpId);
    expect(docs[0].requirements[0].name).toBe('GET /things');
    expect(docs[0].requirements[0].endpoints![0].operationId).toBe('GET /things');
  });

  it('returns empty array on malformed YAML', () => {
    expect(openApiToSpecDocuments('not: : valid: yaml: ::')).toEqual([]);
    expect(openApiToSpecDocuments('')).toEqual([]);
  });
});

describe('CHG-2026-015 S4 — reverseSyncFromApiSpec', () => {
  let tmpRoot: string;
  let s4Cfg: SpecSyncConfig;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `wdf-s4-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tmpRoot, 'specs'), { recursive: true });
    s4Cfg = {
      specsDir: join(tmpRoot, 'specs'),
      sourceOfTruth: false,
      managedRegionMarker: 'wdf:specs-sync',
      enforceUniqueRequirementNames: false,
    };
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('writes one spec.md per discovered domain', () => {
    const result = reverseSyncFromApiSpec(OPENAPI_FIXTURE, [], s4Cfg);
    expect(result.writes.length).toBe(2);
    const domains = result.writes.map(w => w.path.split('/').slice(-2, -1)[0]).sort();
    expect(domains).toEqual(['auth', 'todos']);
  });

  it('produces parseable spec.md content', () => {
    const result = reverseSyncFromApiSpec(OPENAPI_FIXTURE, [], s4Cfg);
    const authWrite = result.writes.find(w => w.path.includes('/auth/spec.md'))!;
    const parsed = parseSpecDoc(authWrite.content, 'auth');
    expect(parsed.requirements).toHaveLength(1);
    expect(parsed.requirements[0].endpoints![0].operationId).toBe('registerUser');
  });

  it('preserves hand-edited existing requirements via merge', () => {
    const existing: SpecDocument[] = [{
      domain: 'auth',
      version: 1,
      requirements: [{
        id: 'REQ-999',
        name: 'Custom Hand-Edited Requirement',
        scenarios: [{ given: ['a'], when: ['b'], then: ['MUST c'] }],
      }],
    }];
    const result = reverseSyncFromApiSpec(OPENAPI_FIXTURE, existing, s4Cfg);
    const authWrite = result.writes.find(w => w.path.includes('/auth/spec.md'))!;
    expect(authWrite.content).toMatch(/Custom Hand-Edited Requirement/);
    expect(authWrite.content).toMatch(/POST \/auth\/register/);
  });

  it('returns warning when OpenAPI is malformed', () => {
    const result = reverseSyncFromApiSpec('not valid yaml: : :', [], s4Cfg);
    expect(result.writes).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/api-spec\.yaml/i);
  });
});
