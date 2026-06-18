import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildTraceabilityGraph,
  saveGraph,
  loadGraph,
  indexGraph,
  downstream,
  type TraceabilityGraph,
  GraphBuilder,
} from './traceability-graph.js';
import {
  analyzeImpact,
  analyzeDeltaImpact,
  deltaToAnchors,
  formatImpactReport,
  planUnlockTransitions,
  formatUnlockPlan,
  type ChangeAnchor,
} from './cr-impact-analyzer.js';

function setupRoot(): string {
  return mkdtempSync(join(tmpdir(), 'wdf-trace-'));
}

/**
 * Helper: scaffold an `_wdf_output/` tree dense enough to exercise every
 * parser. Aim for ≥30 graph nodes when fully loaded.
 *
 * Inventory:
 *   prd.md: REQ-1..5                                       → 5 REQ
 *   epics.md: EPIC-1 (REQ-1,2), EPIC-2 (REQ-3,4)            → 2 EPIC
 *   stories/*.md: STORY-001..006 with refs / acs            → 6 STORY
 *   api-spec.yaml: GET/POST/DELETE /todos, GET /todos/{id}  → 4 API
 *   db-schema.md: ## todos, ## users                        → 2 DB
 *   jtbd-cards.md: JTBD-1..3                                → 3 JTBD
 *   tests/*.test.ts: 8 AC-bound tests                       → 8 TEST
 *   ──────────────────────────────────────────────────────
 *   Total                                                  ≥ 30 nodes
 */
function scaffold(root: string): void {
  const out = join(root, '_wdf_output');
  mkdirSync(out, { recursive: true });

  writeFileSync(join(out, 'prd.md'), [
    '# PRD',
    '## REQ-1: User can sign up',
    '## REQ-2: User can log in',
    '## REQ-3: User can create todo',
    '## REQ-4: User can mark todo done',
    '## REQ-5: User can delete todo',
  ].join('\n'));

  writeFileSync(join(out, 'epics.md'), [
    '# Epics',
    '## EPIC-1: Auth — covers REQ-1, REQ-2',
    'Some text',
    '## EPIC-2: Todo CRUD — covers REQ-3, REQ-4, REQ-5',
  ].join('\n'));

  mkdirSync(join(out, 'stories'));
  // STORY-001..006. ACs distributed so total = 8 (matches 8 TEST nodes).
  //   STORY-001 → [AC-1]
  //   STORY-002 → [AC-2]
  //   STORY-003 → [AC-3, AC-7]
  //   STORY-004 → [AC-4, AC-8]
  //   STORY-005 → [AC-5]
  //   STORY-006 → [AC-6]
  const acsByStory: Record<number, string> = {
    1: '[AC-1]', 2: '[AC-2]', 3: '[AC-3, AC-7]',
    4: '[AC-4, AC-8]', 5: '[AC-5]', 6: '[AC-6]',
  };
  for (let i = 1; i <= 6; i++) {
    // PRD has REQ-1..5; STORY-006 reuses REQ-5 (a single REQ can back multiple stories).
    const reqId = i <= 5 ? i : 5;
    const refs = i <= 2 ? `[REQ-${reqId}, EPIC-1]` : `[REQ-${reqId}, EPIC-2]`;
    writeFileSync(join(out, 'stories', `STORY-00${i}.md`), [
      '---',
      `story_id: STORY-00${i}`,
      `title: Story ${i}`,
      `refs: ${refs}`,
      `acceptance_criteria: ${acsByStory[i]}`,
      '---',
    ].join('\n'));
  }

  writeFileSync(join(out, 'api-spec.yaml'), [
    'openapi: 3.0.0',
    'paths:',
    '  /todos:',
    '    get:',
    '      summary: list',
    '    post:',
    '      summary: create',
    '    delete:',
    '      summary: bulk delete',
    '  /todos/{id}:',
    '    get:',
    '      summary: detail',
  ].join('\n'));

  writeFileSync(join(out, 'db-schema.md'), [
    '# Schema',
    '## todos',
    '## users',
  ].join('\n'));

  writeFileSync(join(out, 'jtbd-cards.md'), [
    '# JTBD',
    '## JTBD-1: When I sign up …',
    '## JTBD-2: When I log in …',
    '## JTBD-3: When I track tasks …',
  ].join('\n'));

  mkdirSync(join(root, 'tests'));
  // 8 AC-bound tests across 2 files (one per AC declared above)
  writeFileSync(join(root, 'tests', 'auth.test.ts'), [
    `it('AC-1: signup happy path', () => {});`,
    `it('AC-2: login bad credentials', () => {});`,
  ].join('\n'));
  writeFileSync(join(root, 'tests', 'todos.test.ts'), [
    `it('AC-3: create todo', () => {});`,
    `it('AC-7: returns 400 on empty title', () => {});`,
    `it('AC-4: mark done', () => {});`,
    `it('AC-8: marks atomically', () => {});`,
    `it('AC-5: delete todo', () => {});`,
    `it('AC-6: idempotent delete', () => {});`,
  ].join('\n'));
}

// ─── Builder ────────────────────────────────────────────────────────

describe('buildTraceabilityGraph', () => {
  let root: string;
  beforeEach(() => { root = setupRoot(); scaffold(root); });

  it('builds ≥30 nodes from a fully populated _wdf_output tree', () => {
    const g = buildTraceabilityGraph({ projectRoot: root });
    expect(g.nodes.length).toBeGreaterThanOrEqual(30);
    const counts: Record<string, number> = {};
    for (const n of g.nodes) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
    expect(counts.REQ).toBe(5);
    expect(counts.EPIC).toBe(2);
    expect(counts.STORY).toBe(6);
    expect(counts.API).toBe(4);
    expect(counts.DB).toBe(2);
    expect(counts.JTBD).toBe(3);
    expect(counts.TEST).toBe(8);
  });

  it('emits derives_from / belongs_to edges from STORY refs', () => {
    const g = buildTraceabilityGraph({ projectRoot: root });
    const reqEdge = g.edges.find(e => e.from === 'STORY-003' && e.to === 'REQ-3' && e.kind === 'derives_from');
    const epicEdge = g.edges.find(e => e.from === 'STORY-003' && e.to === 'EPIC-2' && e.kind === 'belongs_to');
    expect(reqEdge).toBeDefined();
    expect(epicEdge).toBeDefined();
  });

  it('emits TEST → STORY tests edges via AC binding', () => {
    const g = buildTraceabilityGraph({ projectRoot: root });
    const testNodes = g.nodes.filter(n => n.kind === 'TEST');
    expect(testNodes.length).toBe(8);
    const ac3Test = testNodes.find(n => (n.meta as any).ac_id === 'AC-3');
    expect(ac3Test).toBeDefined();
    const edge = g.edges.find(e => e.from === ac3Test!.id && e.to === 'STORY-003' && e.kind === 'tests');
    expect(edge).toBeDefined();
  });

  it('is idempotent — same inputs produce identical source_hash', () => {
    const g1 = buildTraceabilityGraph({ projectRoot: root });
    const g2 = buildTraceabilityGraph({ projectRoot: root });
    expect(g1.source_hash).toBe(g2.source_hash);
    expect(g1.nodes.length).toBe(g2.nodes.length);
    expect(g1.edges.length).toBe(g2.edges.length);
  });

  it('returns cached graph when source_hash matches', () => {
    const g1 = buildTraceabilityGraph({ projectRoot: root });
    const g2 = buildTraceabilityGraph({ projectRoot: root, cached: g1 });
    expect(g2).toBe(g1);
  });

  it('builds in under 2 seconds', () => {
    const start = Date.now();
    buildTraceabilityGraph({ projectRoot: root });
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('round-trips through saveGraph / loadGraph', () => {
    const g = buildTraceabilityGraph({ projectRoot: root });
    saveGraph(g, join(root, '_wdf_output'));
    const reloaded = loadGraph(join(root, '_wdf_output'));
    expect(reloaded?.source_hash).toBe(g.source_hash);
    expect(reloaded?.nodes.length).toBe(g.nodes.length);
  });

  it('GraphBuilder.addNode merges metadata without overwriting', () => {
    const b = new GraphBuilder();
    b.addNode({ id: 'X', kind: 'STORY', title: 'first' });
    b.addNode({ id: 'X', kind: 'STORY', meta: { extra: 1 } });
    const g = b.build('/r', 'h');
    const node = g.nodes.find(n => n.id === 'X')!;
    expect(node.title).toBe('first');
    expect((node.meta as any).extra).toBe(1);
  });
});

// ─── Impact analyzer (proposal §5: REQ change → downstream) ─────────

describe('analyzeImpact', () => {
  let root: string;
  let g: TraceabilityGraph;
  beforeEach(() => {
    root = setupRoot();
    scaffold(root);
    g = buildTraceabilityGraph({ projectRoot: root });
  });

  it('REQ-3 changes affect STORY-003 + bound tests (proposal §5 acceptance scenario)', () => {
    const anchors: ChangeAnchor[] = [{ file: 'prd.md', section: '## REQ-3: User can create todo' }];
    const r = analyzeImpact(anchors, g);
    expect(r.seeds).toEqual(['REQ-3']);
    expect(r.affected_ids).toContain('STORY-003');
    // 2 tests bound to AC-3 / AC-7 (STORY-003's ACs)
    const testIds = (r.by_kind.TEST ?? []).map(n => (n.meta as any).ac_id).sort();
    expect(testIds).toEqual(['AC-3', 'AC-7']);
  });

  it('EPIC-2 changes cascade to STORY-003,004,005 + their tests', () => {
    const anchors: ChangeAnchor[] = [{ file: 'epics.md', section: '## EPIC-2: Todo CRUD' }];
    const r = analyzeImpact(anchors, g);
    expect(r.seeds).toEqual(['EPIC-2']);
    const stories = (r.by_kind.STORY ?? []).map(n => n.id).sort();
    expect(stories).toEqual(['STORY-003', 'STORY-004', 'STORY-005', 'STORY-006']);
  });

  it('records unmapped anchors instead of failing silently', () => {
    const anchors: ChangeAnchor[] = [{ file: 'README.md' }];
    const r = analyzeImpact(anchors, g);
    expect(r.seeds).toEqual([]);
    expect(r.unmapped_anchors).toHaveLength(1);
  });

  it('test file change seeds all TEST nodes from that file', () => {
    const anchors: ChangeAnchor[] = [{ file: 'tests/todos.test.ts' }];
    const r = analyzeImpact(anchors, g);
    expect(r.seeds.length).toBeGreaterThanOrEqual(6);
    expect(r.seeds.every(s => s.startsWith('TEST:tests/todos.test.ts'))).toBe(true);
  });

  it('analyzeDeltaImpact accepts a CHG-002 Delta directly', () => {
    const r = analyzeDeltaImpact({
      change_id: 'CHG-X',
      summary: 's', base_version: '1', target_version: '2',
      operations: [
        { op: 'modify', target: { kind: 'spec_section', file: 'prd.md', section: '## REQ-3: User can create todo' }, before: 'a', after: 'b' },
      ],
    }, g);
    expect(r.change_id).toBe('CHG-X');
    expect(r.seeds).toEqual(['REQ-3']);
  });

  it('deltaToAnchors maps every op to a ChangeAnchor', () => {
    const anchors = deltaToAnchors({
      change_id: 'CHG-Y', summary: 's', base_version: '1', target_version: '2',
      operations: [
        { op: 'set', target: { kind: 'toml_key', file: 'a.toml', path: 'x.y' }, value: 1 },
        { op: 'modify', target: { kind: 'spec_section', file: 'b.md', section: '## H' }, before: 'a', after: 'b' },
      ],
    });
    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toEqual({ file: 'a.toml', section: undefined, path: 'x.y' });
    expect(anchors[1]).toEqual({ file: 'b.md', section: '## H', path: undefined });
  });

  it('formatImpactReport renders kinds + unmapped section', () => {
    const r = analyzeImpact(
      [{ file: 'prd.md', section: '## REQ-1: User can sign up' }, { file: 'unrelated.md' }],
      g,
    );
    const out = formatImpactReport(r);
    expect(out).toContain('REQ-1');
    expect(out).toContain('Unmapped anchors');
  });
});

// ─── Phase unlock plan ─────────────────────────────────────────────

describe('planUnlockTransitions', () => {
  let root: string;
  let g: TraceabilityGraph;
  beforeEach(() => {
    root = setupRoot(); scaffold(root);
    g = buildTraceabilityGraph({ projectRoot: root });
  });

  it('emits LOCKED → UNLOCK_RESOLVE for each impacted phase', () => {
    const r = analyzeImpact([{ file: 'prd.md', section: '## REQ-3: User can create todo' }], g);
    const status = { '2.7': 'LOCKED' as const, '3.7': 'LOCKED' as const, '4.5': 'LOCKED' as const, '4.6': 'LOCKED' as const };
    const plan = planUnlockTransitions(r, status);
    expect(plan.length).toBeGreaterThan(0);
    for (const t of plan) {
      expect(t.to).toBe('UNLOCK_RESOLVE');
      expect(t.valid).toBe(true);
    }
  });

  it('reports invalid when phase is not LOCKED', () => {
    const r = analyzeImpact([{ file: 'prd.md', section: '## REQ-1: User can sign up' }], g);
    const status = { '2.7': 'NOT_STARTED' as const };
    const plan = planUnlockTransitions(r, status);
    const t = plan.find(x => x.phase === '2.7');
    expect(t?.valid).toBe(false);
  });

  it('formatUnlockPlan renders ✓ and ⊘ rows', () => {
    const out = formatUnlockPlan([
      { phase: '2.7', from: 'LOCKED', to: 'UNLOCK_RESOLVE', valid: true },
      { phase: '3.7', from: 'NOT_STARTED', to: 'UNLOCK_RESOLVE', valid: false, reason: 'no rules' },
    ]);
    expect(out).toContain('✓');
    expect(out).toContain('⊘');
    expect(out).toContain('no rules');
  });
});

// ─── Pure graph traversal ──────────────────────────────────────────

describe('downstream BFS', () => {
  it('visits children via incoming derives_from / tests / belongs_to / implements', () => {
    const b = new GraphBuilder();
    b.addNode({ id: 'A', kind: 'REQ' });
    b.addNode({ id: 'B', kind: 'STORY' });
    b.addNode({ id: 'C', kind: 'TEST' });
    b.addNode({ id: 'D', kind: 'API' });
    b.addEdge({ from: 'B', to: 'A', kind: 'derives_from' });
    b.addEdge({ from: 'C', to: 'B', kind: 'tests' });
    b.addEdge({ from: 'B', to: 'D', kind: 'implements' });
    const g = b.build('/r', 'h');
    const idx = indexGraph(g);
    const visited = downstream(idx, ['A']);
    expect([...visited].sort()).toEqual(['A', 'B', 'C']);
    // D is upstream-of-B for `implements` so visited via incoming on B
    const visited2 = downstream(idx, ['D']);
    expect([...visited2].sort()).toEqual(['B', 'C', 'D']);
  });
});

// ─── Linter: STORY_REFS_REQUIRED ────────────────────────────────────

describe('StoryRefsRequiredRule', () => {
  it('passes a story with inline refs', async () => {
    const { StoryRefsRequiredRule } = await import('./linter/rules/story-refs-required.js');
    const file = {
      path: '_wdf_output/stories/STORY-001.md',
      content: `---\nstory_id: STORY-001\nrefs: [REQ-1, EPIC-1]\n---\nbody`,
      lines: [],
    };
    file.lines = file.content.split('\n');
    const r = StoryRefsRequiredRule.check({ projectRoot: '/r', files: [file], config: {} });
    expect(r).toEqual([]);
  });

  it('flags missing refs:', async () => {
    const { StoryRefsRequiredRule } = await import('./linter/rules/story-refs-required.js');
    const file = {
      path: '_wdf_output/stories/STORY-002.md',
      content: `---\nstory_id: STORY-002\ntitle: x\n---\n`,
      lines: [],
    };
    file.lines = file.content.split('\n');
    const r = StoryRefsRequiredRule.check({ projectRoot: '/r', files: [file], config: {} });
    expect(r).toHaveLength(1);
    expect(r[0].message).toMatch(/missing refs:/);
  });

  it('flags empty refs: []', async () => {
    const { StoryRefsRequiredRule } = await import('./linter/rules/story-refs-required.js');
    const file = {
      path: '_wdf_output/stories/STORY-003.md',
      content: `---\nstory_id: S\nrefs: []\n---\n`,
      lines: [],
    };
    file.lines = file.content.split('\n');
    const r = StoryRefsRequiredRule.check({ projectRoot: '/r', files: [file], config: {} });
    expect(r).toHaveLength(1);
    expect(r[0].message).toMatch(/empty refs/);
  });

  it('ignores non-story files', async () => {
    const { StoryRefsRequiredRule } = await import('./linter/rules/story-refs-required.js');
    const file = {
      path: 'README.md',
      content: `# readme`,
      lines: ['# readme'],
    };
    const r = StoryRefsRequiredRule.check({ projectRoot: '/r', files: [file], config: {} });
    expect(r).toEqual([]);
  });
});
