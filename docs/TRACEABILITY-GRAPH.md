# Traceability Graph

CHG-2026-003 introduces a project-wide traceability graph that joins eight
node kinds — JTBD, REQ, EPIC, STORY, API, DB, TEST, COMMIT — so that a
Change Request touching any artefact can enumerate downstream impact and
auto-schedule UNLOCK_RESOLVE transitions on the affected phases.

## Why

Pre-3.7, modifying `prd.md` or `epics.md` left no machine-readable
breadcrumb to "what stories does this break? which tests should re-run?
which phases need to re-open?" Reviewers had to grep, guess, and miss.

The graph closes that gap: every story has a `refs:` field that points
upstream, every test optionally binds to an AC (CHG-2026-005), and every
spec section is addressable. A CR's [delta](CR-DELTA-WORKFLOW.md) becomes
a set of seed nodes; a BFS produces the full impacted set in well under a
second on projects of realistic size.

## Node kinds and edges

| Kind | Source | ID format |
|---|---|---|
| `JTBD` | `_wdf_output/(_output/{analysis,planning}/)?jtbd-cards.md` | `JTBD-N` |
| `REQ` | `_wdf_output/prd.md` | `REQ-N` |
| `EPIC` | `_wdf_output/epics.md` | `EPIC-N` |
| `STORY` | `_wdf_output/stories/*.md` | `STORY-NNN` (from frontmatter `story_id`) |
| `API` | `_wdf_output/api-spec.yaml` | `API:METHOD /path` |
| `DB` | `_wdf_output/db-schema.md` | `DB:table_name` |
| `TEST` | `**/*.{test,spec}.{ts,tsx,js,jsx}` | `TEST:file:line` |
| `COMMIT` | (reserved for future git integration) | `COMMIT:<sha>` |

Edges:

| Kind | Direction | Established by |
|---|---|---|
| `derives_from` | STORY → REQ, REQ → JTBD | story `refs:` |
| `belongs_to` | STORY → EPIC | story `refs:` |
| `implements` | STORY → API/DB | story `refs:` |
| `tests` | TEST → STORY | AC binding (CHG-005) joins via STORY's `acceptance_criteria` |
| `references` | catch-all | reserved |

> **Note:** epics.md mentions of `REQ-N` deliberately do **not** create
> EPIC → REQ edges. An epic is a grouping abstraction, not a derivation;
> letting REQ-3 cascade up to EPIC-2 and back down to every sibling
> story under that epic would dramatically over-report impact. Story-level
> `STORY → REQ` edges are the authoritative path.

## Building the graph

```ts
import { buildTraceabilityGraph, saveGraph } from './traceability-graph.js';

const graph = buildTraceabilityGraph({
  projectRoot: process.cwd(),
  // testRoots: ['orchestrator/src'],   // override if tests live elsewhere
  // cached: priorGraph,                 // skip rebuild when source_hash matches
});

saveGraph(graph, '_wdf_output/');        // → _wdf_output/traceability.graph.json
```

The build is idempotent: re-running with no source changes produces an
identical `source_hash` (sha-256 over the contributing file list + their
contents). Pass the previous graph as `cached` to short-circuit.

The output file is generated — git-ignore it (already covered by the
existing `_wdf_output/` ignore in most repos).

## Querying impact

A CR's surface area becomes a list of `ChangeAnchor`s; the analyser
maps each anchor to seed nodes and BFS-walks the graph downstream:

```ts
import { analyzeDeltaImpact, formatImpactReport, planUnlockTransitions }
  from './cr-impact-analyzer.js';
import { loadDelta } from './cr-applier.js';

const delta = loadDelta('changes/CHG-2026-XYZ/delta.yaml');
const graph = loadGraph('_wdf_output/')!;
const report = analyzeDeltaImpact(delta, graph);

console.log(formatImpactReport(report));
//
// CR Impact — CHG-2026-XYZ
// ───────────────────────
//   Seeds:             1
//   Affected nodes:    7
//   Unlock phases:     2.7, 3.7, 4.5, 4.6
//
//   REQ (1):    REQ-3
//   STORY (1):  STORY-003 — Create todo
//   TEST (5):   AC-3 / AC-7 bindings
//
```

When the CR is approved, hand the report to `planUnlockTransitions` to get
a validated batch of FSM hops:

```ts
const plan = planUnlockTransitions(report, currentPhaseStatus);
//   ✓ phase 2.7: LOCKED → UNLOCK_RESOLVE
//   ✓ phase 3.7: LOCKED → UNLOCK_RESOLVE
//   ⊘ phase 4.5: NOT_STARTED → UNLOCK_RESOLVE   (no rules)
```

The planner only emits transitions; the orchestrator decides when to
apply them via `fsm-engine.transitionState`. That separation keeps the
graph layer side-effect-free and trivial to test.

## Anchor-to-seed mapping rules

| Anchor | Seed nodes |
|---|---|
| `prd.md` + section heading containing `REQ-N` | the `REQ-N` node |
| `prd.md` (no section) | every `REQ` node (coarse) |
| `epics.md` + section heading containing `EPIC-N` | the `EPIC-N` node |
| `epics.md` (no section) | every `EPIC` node |
| `_wdf_output/stories/<file>.md` | the matching `STORY` node |
| `api-spec.yaml` + path `paths."/x".get` | the `API:GET /x` node |
| `db-schema.md` + section heading | the matching `DB:table` node |
| `*.test.ts` / `*.spec.ts` | every `TEST` node from that file |
| anchor with no match | recorded in `unmapped_anchors` for manual review |

The analyser never silently drops an anchor — anything it can't resolve
shows up in the report as **unmapped**, so the reviewer can decide
whether the change should still trigger a CR re-evaluation manually.

## Phase mapping

When unlocking, each affected node kind maps to the sub-phase that owns it:

| Kind | Phase(s) |
|---|---|
| `JTBD` | 1.3, 2.5 |
| `REQ` | 2.7 |
| `EPIC` | 3.6 |
| `STORY` | 3.7 |
| `API` | 3.8 |
| `DB` | 3.8 |
| `TEST` | 4.5, 4.6 |

Override via `customize.toml` if your project uses different sub-phase
numbering (future hook).

## Linter: `STORY_REFS_REQUIRED`

Stories without a `refs:` field are invisible to impact analysis. The
new lint rule (CHG-003 Task 7) fails CI when:

- a story under `_wdf_output/stories/` lacks YAML frontmatter, or
- frontmatter has no `refs:` key, or
- `refs:` is `[]` or has zero block-list items.

Author every story with at least one upstream reference:

```yaml
---
story_id: STORY-007
title: Add user logout
refs: [REQ-2, EPIC-1]            # required
acceptance_criteria: [AC-12, AC-13]
---
```

## Performance

- Build is O(files + lines). Typical project (~50 stories, ~30 tests)
  builds in under 200 ms locally; the test suite asserts < 2 s for the
  30-node fixture.
- The graph file is JSON; loading is O(nodes + edges).
- BFS impact analysis is O(N+E) per CR, so even pathological cascades
  finish in milliseconds.

## Round-trip example

A complete flow, for the suspicious reviewer:

```bash
# 1. Build the graph from current artefacts.
node -e "
  import('./orchestrator/dist/orchestrator/traceability-graph.js').then(m => {
    const g = m.buildTraceabilityGraph({ projectRoot: process.cwd() });
    m.saveGraph(g, '_wdf_output/');
    console.log('built', g.nodes.length, 'nodes');
  });"

# 2. Author a CR with a delta touching prd.md REQ-3.
$EDITOR changes/CHG-2026-XYZ/delta.yaml

# 3. Preview impact before applying.
wdf cr apply CHG-2026-XYZ --dry-run

# 4. Run the impact analyser.
node -e "
  import('./orchestrator/dist/orchestrator/cr-applier.js').then(async cr => {
    const trace = await import('./orchestrator/dist/orchestrator/traceability-graph.js');
    const ana   = await import('./orchestrator/dist/orchestrator/cr-impact-analyzer.js');
    const delta = cr.loadDelta('changes/CHG-2026-XYZ/delta.yaml');
    const graph = trace.loadGraph('_wdf_output/');
    const report = ana.analyzeDeltaImpact(delta, graph);
    console.log(ana.formatImpactReport(report));
  });"

# 5. If the report looks right, apply, then plan unlocks.
wdf cr apply CHG-2026-XYZ
```

## Related

- `orchestrator/src/orchestrator/traceability-graph.ts` — builder + parsers
- `orchestrator/src/orchestrator/cr-impact-analyzer.ts` — analyser + plan
- `orchestrator/src/orchestrator/linter/rules/story-refs-required.ts` — CI gate
- `docs/CR-DELTA-WORKFLOW.md` — CHG-2026-002 deltas (input to the analyser)
- `docs/AC-TEST-BINDING.md` — CHG-2026-005 (TEST → STORY edge source)
- `docs/plans/2026-06-17-standardization-automation-roadmap.md#opt-02`
