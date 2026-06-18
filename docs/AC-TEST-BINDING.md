# AC ↔ Test Binding

CHG-2026-005 introduces a strict gate at acceptance phases 4.6 (BE Code
Acceptance) and 4.12 (FE UI Acceptance): every story acceptance criterion
(AC) must be bound to at least one test case that **passed** in the latest
test run. Stories with unbound, failing, or skipped ACs are blocked from
clearing the gate.

## Why

Pre-3.7, a story could clear acceptance simply because `npm test` exited
with status 0 — even when zero tests touched the AC the story shipped. The
binding gate closes that loophole by joining three pieces of data:

1. **What the story promises** — `acceptance_criteria` in the frontmatter
2. **What tests claim to cover** — explicit AC bindings in test source
3. **What the test runner actually says** — pass/fail from JSON reporter

A story is gate-eligible only when all three agree.

## Declaring ACs on a story

In `_wdf_output/stories/STORY-XXX.md`, list AC IDs in the YAML frontmatter:

```yaml
---
story_id: STORY-001
title: Signup endpoint
acceptance_criteria:
  - AC-1: rejects malformed email with 400
  - AC-2: returns 409 when email already taken
  - AC-3: hashes the password with argon2id
  - AC-4
  - AC-5
---
```

Both inline (`acceptance_criteria: [AC-1, AC-2]`) and block forms work.
IDs match `AC-\d+`; casing is normalised (`ac-1` → `AC-1`).

## Binding tests to ACs

Two conventions are recognised. Mix them freely within a file.

### Name-prefix

The test argument starts with `AC-N: ` (note the colon and space):

```ts
it('AC-1: rejects malformed email with 400', () => { … });
test('AC-2: returns 409 when email already taken', () => { … });
```

### Comment annotation

A `// @ac AC-N` line on its own immediately above an `it()` or `test()`
call (within the next 5 non-blank lines):

```ts
// @ac AC-3
it('hashes the password with argon2id', () => { … });

// Multiple ACs on one test:
// @ac AC-4
// @ac AC-5
it('emits a verification email and creates the user atomically', () => { … });
```

A working example lives at
[`assets/templates/testing/test-ac-binding.example.ts`](../assets/templates/testing/test-ac-binding.example.ts).

## Running the gate

The gate is invoked from acceptance phases 4.6 and 4.12. Programmatic
entry point:

```ts
import { runAcBindingCheck, formatAcBindingReport } from
  './orchestrator/contract-validator.js';

const { report } = await runAcBindingCheck({
  storyPath: '_wdf_output/stories/STORY-001.md',
  testRoots: ['orchestrator/src'],
  projectRoot: process.cwd(),
  framework: 'vitest',          // or 'jest'
});

console.log(formatAcBindingReport(report));
if (!report.all_pass) process.exit(1);
```

Set `reporterJson` to skip spawning the test runner — useful when CI
already wrote a `vitest.json` artefact:

```ts
const json = JSON.parse(readFileSync('coverage/vitest.json', 'utf8'));
await runAcBindingCheck({ …, reporterJson: json });
```

## Reporter compatibility

| Framework | Command | Notes |
|---|---|---|
| **vitest** | `npx vitest run --reporter=json` | Default. Output captured from stdout. |
| **jest** | `npx jest --json` | Same shape as vitest's reporter. |

Both produce `testResults[].assertionResults[]` with `title` + `status`
fields, which is all the validator needs.

## Report shape

```
═══════════════════════════════════════════
AC ↔ Test Binding — STORY-001
═══════════════════════════════════════════
  ACs declared: 5
  Bindings:     6

  ✓ AC-1 — OK (1 binding)
  ✗ AC-2 — FAILING (1 binding, at least one fail/missing)
      └ tests/signup.test.ts:18  AC-2: returns 409 when email already taken
  ✓ AC-3 — OK (1 binding)
  ✓ AC-4 — OK (2 bindings)
  ✗ AC-5 — UNBOUND (no test refers to this AC)

  ! Unknown bindings (test refers to AC not declared on story):
      └ AC-9 ← tests/legacy.test.ts:42

───────────────────────────────────────────
  Status: BLOCKED — fix bindings before acceptance
═══════════════════════════════════════════
```

| Field | Meaning |
|---|---|
| `unbound_acs` | ACs declared on the story with **zero** matching test bindings |
| `failing_acs` | ACs whose bound tests had at least one failure or never ran |
| `skipped_acs` | ACs whose bound tests were only skipped (never executed) |
| `unknown_bindings` | Tests claim to cover an AC ID not on the story (typo or stale story) |
| `missing_test_results` | Bindings on disk that produced no entry in the reporter (filter mismatch) |

## Strict mode rollout

`customize.toml` controls enforcement:

```toml
[acceptance_gates]
contract_strict_mode = false   # default in 3.7.x — warn but don't block
```

In 3.7.x the gate emits a warning and lets the phase pass. In 3.8.0 the
default flips to `true` and any unbound / failing AC blocks acceptance.

To opt into strict mode early:

```bash
wdf customize set acceptance_gates.contract_strict_mode true
```

## Common pitfalls

- **ID typo** — `AC1` (missing dash) is rejected by the scanner. The
  parser normalises `AC1` → `AC-1` in the story frontmatter, but the
  test binding regex requires `AC-N` literally.
- **Test name describe-prefixing** — vitest reports `auth > AC-1: x`.
  The validator uses suffix-matching to handle this; if you see false
  unbound results, ensure `describe` blocks don't *replace* the leading
  `AC-N:` prefix.
- **`it.skip` / `test.skip`** — counts as a binding but the test is
  skipped. The AC will land in `skipped_acs`, not `unbound_acs`. Either
  un-skip the test or remove the AC from the story's `acceptance_criteria`.
- **Generic `npm test`** — `acceptance_checks: ['npm test']` is rejected
  by the existing `StoryContractValidator` (Phase 3.7). Use a specific
  script, e.g. `npx vitest run tests/signup.test.ts`.
- **Comment annotation gap** — `// @ac AC-N` must be within 5 non-blank
  lines of the test call. Long comment blocks between annotation and
  `it()` will skip the binding.

## Codemod

To audit an existing project:

```bash
wdf cr ac-check --report-only
```

This walks every story, scans test files, and prints a coverage matrix
without enforcing failure. Use the report to decide where to invest in
binding annotations before flipping `contract_strict_mode = true`.

## Related

- `schemas/change-request-schema.yaml` — story frontmatter spec
- `orchestrator/src/orchestrator/ac-test-binding.ts` — implementation
- `orchestrator/src/orchestrator/contract-validator.ts` — re-export entrypoint + StoryContractValidator (Phase 3.7 freeze gate)
- `assets/templates/testing/test-ac-binding.example.ts` — annotated example
- `docs/plans/2026-06-17-standardization-automation-roadmap.md` — OPT-04
